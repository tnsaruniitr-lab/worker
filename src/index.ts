import { config, validateConfig } from "./config";
import { getPool, closePool } from "./db";
import { claimMessages, requeueForShutdown } from "./claim";
import { processMessage, ProcessResult } from "./processor";
import { log, setLogContext } from "./utils/logger";
import { sleep } from "./utils/backoff";
import { startHeartbeat, stopHeartbeat, incrementJobsProcessed, getWorkerId, upsertHeartbeat } from "./heartbeat";

const WORKER_VERSION = "1.5.0";

let isShuttingDown = false;
let inFlightMessages: string[] = [];

const HARD_FAILURE_WINDOW_MS = 2 * 60 * 1000;
const HARD_FAILURE_THRESHOLD = 5;
const hardFailureTimestamps: number[] = [];
let lastHardFailureError: string | null = null;

function recordHardFailure(errorMessage?: string): void {
  const now = Date.now();
  hardFailureTimestamps.push(now);
  if (errorMessage) {
    lastHardFailureError = errorMessage;
  }
  
  while (hardFailureTimestamps.length > 0 && hardFailureTimestamps[0] < now - HARD_FAILURE_WINDOW_MS) {
    hardFailureTimestamps.shift();
  }
}

function getRecentHardFailureCount(): number {
  const now = Date.now();
  while (hardFailureTimestamps.length > 0 && hardFailureTimestamps[0] < now - HARD_FAILURE_WINDOW_MS) {
    hardFailureTimestamps.shift();
  }
  return hardFailureTimestamps.length;
}

function isDegraded(): boolean {
  return getRecentHardFailureCount() >= HARD_FAILURE_THRESHOLD;
}

async function sendHeartbeatWithStatus(): Promise<void> {
  const inFlightCount = inFlightMessages.length;
  if (isDegraded()) {
    await upsertHeartbeat(inFlightCount, "degraded", lastHardFailureError || "Multiple hard failures detected");
  } else {
    await upsertHeartbeat(inFlightCount, "healthy");
  }
}

async function runWorkerLoop(): Promise<void> {
  const { pollIntervalMs } = config.worker;
  const workerId = getWorkerId();
  
  setLogContext({ workerId });
  log.info(`Worker version ${WORKER_VERSION} starting`, { version: WORKER_VERSION, workerId, pollIntervalMs, batchSize: config.worker.batchSize });

  // Check WORKER_MODE - external worker only runs when mode is 'external'
  const workerMode = process.env.WORKER_MODE || 'legacy';
  if (workerMode !== 'external') {
    log.info(`External worker disabled (WORKER_MODE=${workerMode}, requires 'external')`, { workerMode });
    log.info("External worker will sleep indefinitely until WORKER_MODE=external");
    // Sleep indefinitely - don't exit so container stays up for monitoring
    while (!isShuttingDown) {
      await sleep(60000); // Check every minute if shutdown requested
    }
    return;
  }

  log.info(`External worker enabled (WORKER_MODE=${workerMode})`, { workerMode });

  const pool = getPool();
  await pool.query("SELECT 1");
  log.info("Database connection verified");

  startHeartbeat(() => inFlightMessages.length, sendHeartbeatWithStatus);

  let pollCount = 0;
  while (!isShuttingDown) {
    try {
      pollCount++;
      const messages = await claimMessages();

      if (messages.length === 0) {
        log.info("Poll attempt - no messages", { pollCount, nextPollMs: pollIntervalMs });
        await sleep(pollIntervalMs);
        continue;
      }

      inFlightMessages = messages.map((m) => m.messageSid);

      const results = await Promise.allSettled(
        messages.map((msg) => processMessage(msg))
      );

      let successCount = 0;
      let failCount = 0;

      for (const result of results) {
        if (result.status === "fulfilled") {
          const processResult = result.value as ProcessResult;
          if (processResult.success) {
            successCount++;
            incrementJobsProcessed();
          } else {
            failCount++;
            if (processResult.isHardFailure) {
              recordHardFailure(processResult.errorMessage);
            }
          }
        } else {
          failCount++;
          const errorStr = String(result.reason);
          if (errorStr.includes("429") || errorStr.includes("5") || errorStr.includes("timeout")) {
            recordHardFailure(errorStr);
          }
        }
      }

      log.info("Batch complete", {
        total: messages.length,
        success: successCount,
        failed: failCount,
        recentHardFailures: getRecentHardFailureCount(),
        degraded: isDegraded(),
      });

      inFlightMessages = [];
    } catch (err) {
      log.error("Worker loop error", { error: String(err) });
      recordHardFailure(String(err));
      await sleep(pollIntervalMs);
    }
  }

  log.info("Worker loop exited");
}

async function gracefulShutdown(signal: string): Promise<void> {
  if (isShuttingDown) {
    log.warn("Shutdown already in progress");
    return;
  }

  log.info(`Received ${signal}, initiating graceful shutdown`);
  isShuttingDown = true;

  stopHeartbeat();

  if (inFlightMessages.length > 0) {
    log.info(`Requeuing ${inFlightMessages.length} in-flight messages`);
    try {
      await requeueForShutdown(inFlightMessages);
    } catch (err) {
      log.error("Failed to requeue messages", { error: String(err) });
    }
  }

  try {
    await closePool();
  } catch (err) {
    log.error("Error closing database pool", { error: String(err) });
  }

  log.info("Shutdown complete");
  process.exit(0);
}

async function main(): Promise<void> {
  try {
    validateConfig();
    log.info("Configuration validated");
  } catch (err) {
    log.error("Configuration error", { error: String(err) });
    process.exit(1);
  }

  process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
  process.on("SIGINT", () => gracefulShutdown("SIGINT"));

  process.on("uncaughtException", (err) => {
    log.error("Uncaught exception", { error: err.message, stack: err.stack });
    gracefulShutdown("uncaughtException");
  });

  process.on("unhandledRejection", (reason) => {
    log.error("Unhandled rejection", { reason: String(reason) });
  });

  try {
    await runWorkerLoop();
  } catch (err) {
    log.error("Fatal worker error", { error: String(err) });
    await gracefulShutdown("fatal_error");
  }
}

main();
