import { config, validateConfig } from "./config";
import { getPool, closePool } from "./db";
import { claimMessages, requeueForShutdown } from "./claim";
import { processMessage } from "./processor";
import { log, setLogContext } from "./utils/logger";
import { sleep } from "./utils/backoff";

let isShuttingDown = false;
let inFlightMessages: string[] = [];

async function runWorkerLoop(): Promise<void> {
  const { id: workerId, pollIntervalMs } = config.worker;
  
  setLogContext({ workerId });
  log.info("Worker starting", { pollIntervalMs, batchSize: config.worker.batchSize });

  const pool = getPool();
  await pool.query("SELECT 1");
  log.info("Database connection verified");

  while (!isShuttingDown) {
    try {
      const messages = await claimMessages();

      if (messages.length === 0) {
        await sleep(pollIntervalMs);
        continue;
      }

      inFlightMessages = messages.map((m) => m.messageSid);

      const results = await Promise.allSettled(
        messages.map((msg) => processMessage(msg))
      );

      const successCount = results.filter(
        (r) => r.status === "fulfilled" && r.value === true
      ).length;
      const failCount = results.length - successCount;

      log.info("Batch complete", {
        total: messages.length,
        success: successCount,
        failed: failCount,
      });

      inFlightMessages = [];
    } catch (err) {
      log.error("Worker loop error", { error: String(err) });
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
