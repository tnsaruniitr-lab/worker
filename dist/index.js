"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const config_1 = require("./config");
const db_1 = require("./db");
const claim_1 = require("./claim");
const processor_1 = require("./processor");
const logger_1 = require("./utils/logger");
const backoff_1 = require("./utils/backoff");
const heartbeat_1 = require("./heartbeat");
const WORKER_VERSION = "1.6.3";
let isShuttingDown = false;
let inFlightMessages = [];
const HARD_FAILURE_WINDOW_MS = 2 * 60 * 1000;
const HARD_FAILURE_THRESHOLD = 5;
const hardFailureTimestamps = [];
let lastHardFailureError = null;
function recordHardFailure(errorMessage) {
    const now = Date.now();
    hardFailureTimestamps.push(now);
    if (errorMessage) {
        lastHardFailureError = errorMessage;
    }
    while (hardFailureTimestamps.length > 0 && hardFailureTimestamps[0] < now - HARD_FAILURE_WINDOW_MS) {
        hardFailureTimestamps.shift();
    }
}
function getRecentHardFailureCount() {
    const now = Date.now();
    while (hardFailureTimestamps.length > 0 && hardFailureTimestamps[0] < now - HARD_FAILURE_WINDOW_MS) {
        hardFailureTimestamps.shift();
    }
    return hardFailureTimestamps.length;
}
function isDegraded() {
    return getRecentHardFailureCount() >= HARD_FAILURE_THRESHOLD;
}
async function sendHeartbeatWithStatus() {
    const inFlightCount = inFlightMessages.length;
    if (isDegraded()) {
        await (0, heartbeat_1.upsertHeartbeat)(inFlightCount, "degraded", lastHardFailureError || "Multiple hard failures detected");
    }
    else {
        await (0, heartbeat_1.upsertHeartbeat)(inFlightCount, "healthy");
    }
}
async function runWorkerLoop() {
    const { pollIntervalMs } = config_1.config.worker;
    const workerId = (0, heartbeat_1.getWorkerId)();
    (0, logger_1.setLogContext)({ workerId });
    logger_1.log.info(`Worker version ${WORKER_VERSION} starting`, { version: WORKER_VERSION, workerId, pollIntervalMs, batchSize: config_1.config.worker.batchSize });
    // Check WORKER_MODE - external worker only runs when mode is 'external'
    const workerMode = process.env.WORKER_MODE || 'legacy';
    if (workerMode !== 'external') {
        logger_1.log.info(`External worker disabled (WORKER_MODE=${workerMode}, requires 'external')`, { workerMode });
        logger_1.log.info("External worker will sleep indefinitely until WORKER_MODE=external");
        // Sleep indefinitely - don't exit so container stays up for monitoring
        while (!isShuttingDown) {
            await (0, backoff_1.sleep)(60000); // Check every minute if shutdown requested
        }
        return;
    }
    logger_1.log.info(`External worker enabled (WORKER_MODE=${workerMode})`, { workerMode });
    const pool = (0, db_1.getPool)();
    await pool.query("SELECT 1");
    logger_1.log.info("Database connection verified");
    (0, heartbeat_1.startHeartbeat)(() => inFlightMessages.length, sendHeartbeatWithStatus);
    let pollCount = 0;
    while (!isShuttingDown) {
        try {
            pollCount++;
            const messages = await (0, claim_1.claimMessages)();
            if (messages.length === 0) {
                logger_1.log.info("Poll attempt - no messages", { pollCount, nextPollMs: pollIntervalMs });
                await (0, backoff_1.sleep)(pollIntervalMs);
                continue;
            }
            inFlightMessages = messages.map((m) => m.messageSid);
            const results = await Promise.allSettled(messages.map((msg) => (0, processor_1.processMessage)(msg)));
            let successCount = 0;
            let failCount = 0;
            for (const result of results) {
                if (result.status === "fulfilled") {
                    const processResult = result.value;
                    if (processResult.success) {
                        successCount++;
                        (0, heartbeat_1.incrementJobsProcessed)();
                    }
                    else {
                        failCount++;
                        if (processResult.isHardFailure) {
                            recordHardFailure(processResult.errorMessage);
                        }
                    }
                }
                else {
                    failCount++;
                    const errorStr = String(result.reason);
                    if (errorStr.includes("429") || errorStr.includes("5") || errorStr.includes("timeout")) {
                        recordHardFailure(errorStr);
                    }
                }
            }
            logger_1.log.info("Batch complete", {
                total: messages.length,
                success: successCount,
                failed: failCount,
                recentHardFailures: getRecentHardFailureCount(),
                degraded: isDegraded(),
            });
            inFlightMessages = [];
        }
        catch (err) {
            logger_1.log.error("Worker loop error", { error: String(err) });
            recordHardFailure(String(err));
            await (0, backoff_1.sleep)(pollIntervalMs);
        }
    }
    logger_1.log.info("Worker loop exited");
}
async function gracefulShutdown(signal) {
    if (isShuttingDown) {
        logger_1.log.warn("Shutdown already in progress");
        return;
    }
    logger_1.log.info(`Received ${signal}, initiating graceful shutdown`);
    isShuttingDown = true;
    (0, heartbeat_1.stopHeartbeat)();
    if (inFlightMessages.length > 0) {
        logger_1.log.info(`Requeuing ${inFlightMessages.length} in-flight messages`);
        try {
            await (0, claim_1.requeueForShutdown)(inFlightMessages);
        }
        catch (err) {
            logger_1.log.error("Failed to requeue messages", { error: String(err) });
        }
    }
    try {
        await (0, db_1.closePool)();
    }
    catch (err) {
        logger_1.log.error("Error closing database pool", { error: String(err) });
    }
    logger_1.log.info("Shutdown complete");
    process.exit(0);
}
async function main() {
    try {
        (0, config_1.validateConfig)();
        logger_1.log.info("Configuration validated");
    }
    catch (err) {
        logger_1.log.error("Configuration error", { error: String(err) });
        process.exit(1);
    }
    process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
    process.on("SIGINT", () => gracefulShutdown("SIGINT"));
    process.on("uncaughtException", (err) => {
        logger_1.log.error("Uncaught exception", { error: err.message, stack: err.stack });
        gracefulShutdown("uncaughtException");
    });
    process.on("unhandledRejection", (reason) => {
        logger_1.log.error("Unhandled rejection", { reason: String(reason) });
    });
    try {
        await runWorkerLoop();
    }
    catch (err) {
        logger_1.log.error("Fatal worker error", { error: String(err) });
        await gracefulShutdown("fatal_error");
    }
}
main();
//# sourceMappingURL=index.js.map