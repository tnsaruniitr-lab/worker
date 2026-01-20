"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getWorkerId = getWorkerId;
exports.incrementJobsProcessed = incrementJobsProcessed;
exports.getJobsProcessedTotal = getJobsProcessedTotal;
exports.upsertHeartbeat = upsertHeartbeat;
exports.startHeartbeat = startHeartbeat;
exports.stopHeartbeat = stopHeartbeat;
exports.sendDegradedHeartbeat = sendDegradedHeartbeat;
const db_1 = require("./db");
const logger_1 = require("./utils/logger");
const HEARTBEAT_INTERVAL_MS = 30_000;
let heartbeatIntervalId = null;
let jobsProcessedTotal = 0;
function generateWorkerId() {
    const hostname = process.env.HOSTNAME || process.env.HOST || "unknown";
    const bootTs = Date.now();
    const rand = Math.random().toString(36).substring(2, 6);
    return `external-${hostname}-${bootTs}-${rand}`;
}
const WORKER_ID = generateWorkerId();
function getWorkerId() {
    return WORKER_ID;
}
function incrementJobsProcessed() {
    jobsProcessedTotal++;
}
function getJobsProcessedTotal() {
    return jobsProcessedTotal;
}
async function getQueueReadyNow() {
    const pool = (0, db_1.getPool)();
    try {
        const result = await pool.query(`
      SELECT COUNT(*) as count
      FROM whatsapp_inbound_messages
      WHERE job_status = 'READY'
        AND (next_run_at IS NULL OR next_run_at::timestamptz <= NOW())
    `);
        return parseInt(result.rows[0]?.count || "0", 10);
    }
    catch (err) {
        logger_1.log.warn("Failed to get queue count", { error: String(err) });
        return 0;
    }
}
async function upsertHeartbeat(jobsInFlight, status = "healthy", lastError) {
    const pool = (0, db_1.getPool)();
    const queueReadyNow = await getQueueReadyNow();
    const version = process.env.WORKER_VERSION || "1.0.0";
    const hostname = process.env.HOSTNAME || process.env.HOST || "unknown";
    try {
        await pool.query(`
      INSERT INTO worker_heartbeats (
        worker_id, kind, last_seen_at, started_at, updated_at,
        jobs_in_flight, jobs_processed_total, queue_ready_now,
        current_status, last_error, version, hostname
      ) VALUES (
        $1, 'external', NOW(), NOW(), NOW(),
        $2, $3, $4,
        $5, $6, $7, $8
      )
      ON CONFLICT (worker_id) DO UPDATE SET
        last_seen_at = NOW(),
        updated_at = NOW(),
        jobs_in_flight = $2,
        jobs_processed_total = $3,
        queue_ready_now = $4,
        current_status = $5,
        last_error = CASE WHEN $5 = 'degraded' THEN $6 ELSE worker_heartbeats.last_error END,
        version = $7,
        hostname = $8
      `, [
            WORKER_ID,
            jobsInFlight,
            jobsProcessedTotal,
            queueReadyNow,
            status,
            lastError || null,
            version,
            hostname,
        ]);
        logger_1.log.info("Heartbeat sent", {
            workerId: WORKER_ID,
            jobsInFlight,
            jobsProcessedTotal,
            queueReadyNow,
            status,
        });
    }
    catch (err) {
        logger_1.log.warn("Failed to send heartbeat", { error: String(err) });
    }
}
function startHeartbeat(getInFlightCount, customHeartbeatFn) {
    logger_1.log.info("Starting heartbeat", {
        workerId: WORKER_ID,
        intervalMs: HEARTBEAT_INTERVAL_MS,
    });
    if (customHeartbeatFn) {
        customHeartbeatFn();
    }
    else {
        upsertHeartbeat(getInFlightCount(), "healthy");
    }
    heartbeatIntervalId = setInterval(async () => {
        if (customHeartbeatFn) {
            await customHeartbeatFn();
        }
        else {
            await upsertHeartbeat(getInFlightCount(), "healthy");
        }
    }, HEARTBEAT_INTERVAL_MS);
}
function stopHeartbeat() {
    if (heartbeatIntervalId) {
        clearInterval(heartbeatIntervalId);
        heartbeatIntervalId = null;
        logger_1.log.info("Heartbeat stopped");
    }
}
async function sendDegradedHeartbeat(jobsInFlight, error) {
    await upsertHeartbeat(jobsInFlight, "degraded", error);
}
//# sourceMappingURL=heartbeat.js.map