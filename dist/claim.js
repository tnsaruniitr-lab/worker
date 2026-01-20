"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.claimMessages = claimMessages;
exports.releaseMessage = releaseMessage;
exports.completeMessage = completeMessage;
exports.updateMessageStage = updateMessageStage;
exports.updateMessageAudioStored = updateMessageAudioStored;
exports.updateMessageTranscribed = updateMessageTranscribed;
exports.updateMessageAnalyzed = updateMessageAnalyzed;
exports.requeueForShutdown = requeueForShutdown;
const db_1 = require("./db");
const config_1 = require("./config");
const logger_1 = require("./utils/logger");
const backoff_1 = require("./utils/backoff");
const heartbeat_1 = require("./heartbeat");
async function claimMessages() {
    const pool = (0, db_1.getPool)();
    const workerId = (0, heartbeat_1.getWorkerId)();
    const { batchSize } = config_1.config.worker;
    const now = new Date().toISOString();
    const claimQuery = `
    WITH claimable AS (
      SELECT message_sid 
      FROM whatsapp_inbound_messages
      WHERE job_status = 'READY'
        AND (next_run_at IS NULL OR next_run_at::timestamptz <= $1::timestamptz)
        AND message_type = 'voice'
      ORDER BY (next_run_at IS NULL) DESC, next_run_at ASC NULLS LAST, received_at ASC
      LIMIT $2
      FOR UPDATE SKIP LOCKED
    )
    UPDATE whatsapp_inbound_messages
    SET 
      job_status = 'PROCESSING',
      worker_id = $3,
      processing_started_at = NOW(),
      last_heartbeat_at = NOW(),
      attempt_count = COALESCE(attempt_count, 0) + 1,
      current_stage = COALESCE(current_stage, 'RECEIVED'),
      failed_reason = NULL,
      failed_stage = NULL
    WHERE message_sid IN (SELECT message_sid FROM claimable)
    RETURNING 
      message_sid as "messageSid",
      from_number as "fromNumber",
      agency_id as "agencyId",
      message_type as "messageType",
      media_url as "mediaUrl",
      media_blob_id as "mediaBlobId",
      current_stage as "currentStage",
      job_status as "jobStatus",
      transcript_text as "transcriptText",
      analysis_json as "analysisJson",
      failed_stage as "failedStage",
      failed_reason as "failedReason",
      attempt_count as "attemptCount",
      worker_id as "workerId",
      next_run_at as "nextRunAt",
      received_at as "receivedAt",
      body,
      profile_name as "profileName"
  `;
    try {
        const result = await pool.query(claimQuery, [now, batchSize, workerId]);
        if (result.rows.length > 0) {
            logger_1.log.info(`Claimed ${result.rows.length} messages`, { workerId });
        }
        return result.rows;
    }
    catch (err) {
        logger_1.log.error("Failed to claim messages", { error: String(err) });
        return [];
    }
}
async function releaseMessage(messageSid, status, reason, failedStage) {
    const pool = (0, db_1.getPool)();
    const workerId = (0, heartbeat_1.getWorkerId)();
    const getAttemptQuery = `
    SELECT attempt_count FROM whatsapp_inbound_messages 
    WHERE message_sid = $1 AND worker_id = $2 AND job_status = 'PROCESSING'
  `;
    const attemptResult = await pool.query(getAttemptQuery, [messageSid, workerId]);
    if (attemptResult.rows.length === 0) {
        logger_1.log.warn("Ownership lost, cannot release message", { messageSid, workerId });
        return false;
    }
    const attemptCount = attemptResult.rows[0]?.attempt_count || 1;
    let finalStatus = status;
    if (status === "RETRY" && (0, backoff_1.shouldMarkFailed)(attemptCount)) {
        finalStatus = "FAILED";
        logger_1.log.warn("Max attempts reached, marking as FAILED", { messageSid, attemptCount });
    }
    const nextRunAt = finalStatus === "RETRY" ? (0, backoff_1.calculateNextRunAt)(attemptCount) : null;
    const newJobStatus = finalStatus === "FAILED" ? "FAILED" : "READY";
    const releaseQuery = `
    UPDATE whatsapp_inbound_messages
    SET 
      job_status = $1,
      worker_id = NULL,
      next_run_at = $2,
      failed_reason = $3,
      failed_stage = $4
    WHERE message_sid = $5 
      AND worker_id = $6 
      AND job_status = 'PROCESSING'
  `;
    const result = await pool.query(releaseQuery, [
        newJobStatus,
        nextRunAt,
        reason,
        failedStage || null,
        messageSid,
        workerId,
    ]);
    if (result.rowCount === 0) {
        logger_1.log.warn("Ownership lost during release", { messageSid, workerId });
        return false;
    }
    logger_1.log.info("Released message", {
        messageSid,
        status: newJobStatus,
        attemptCount,
        nextRunAt,
    });
    return true;
}
async function completeMessage(messageSid) {
    const pool = (0, db_1.getPool)();
    const workerId = (0, heartbeat_1.getWorkerId)();
    const completeQuery = `
    UPDATE whatsapp_inbound_messages
    SET 
      job_status = 'DONE',
      current_stage = 'COMPLETED',
      worker_id = NULL,
      next_run_at = NULL,
      processed_at = NOW()
    WHERE message_sid = $1 
      AND worker_id = $2 
      AND job_status = 'PROCESSING'
  `;
    const result = await pool.query(completeQuery, [messageSid, workerId]);
    if (result.rowCount === 0) {
        logger_1.log.warn("Ownership lost during complete", { messageSid, workerId });
        return false;
    }
    logger_1.log.info("Message completed", { messageSid });
    return true;
}
async function updateMessageStage(messageSid, stage) {
    const pool = (0, db_1.getPool)();
    const workerId = (0, heartbeat_1.getWorkerId)();
    const updateQuery = `
    UPDATE whatsapp_inbound_messages
    SET current_stage = $1, last_heartbeat_at = NOW()
    WHERE message_sid = $2 
      AND worker_id = $3 
      AND job_status = 'PROCESSING'
  `;
    const result = await pool.query(updateQuery, [stage, messageSid, workerId]);
    return (result.rowCount ?? 0) > 0;
}
async function updateMessageAudioStored(messageSid, mediaBlobId) {
    const pool = (0, db_1.getPool)();
    const workerId = (0, heartbeat_1.getWorkerId)();
    const updateQuery = `
    UPDATE whatsapp_inbound_messages
    SET media_blob_id = $1, current_stage = 'AUDIO_STORED', last_heartbeat_at = NOW()
    WHERE message_sid = $2 
      AND worker_id = $3 
      AND job_status = 'PROCESSING'
  `;
    const result = await pool.query(updateQuery, [mediaBlobId, messageSid, workerId]);
    return (result.rowCount ?? 0) > 0;
}
async function updateMessageTranscribed(messageSid, transcriptText) {
    const pool = (0, db_1.getPool)();
    const workerId = (0, heartbeat_1.getWorkerId)();
    const updateQuery = `
    UPDATE whatsapp_inbound_messages
    SET transcript_text = $1, current_stage = 'TRANSCRIBED', last_heartbeat_at = NOW()
    WHERE message_sid = $2 
      AND worker_id = $3 
      AND job_status = 'PROCESSING'
  `;
    const result = await pool.query(updateQuery, [transcriptText, messageSid, workerId]);
    return (result.rowCount ?? 0) > 0;
}
async function updateMessageAnalyzed(messageSid, analysis) {
    const pool = (0, db_1.getPool)();
    const workerId = (0, heartbeat_1.getWorkerId)();
    const updateQuery = `
    UPDATE whatsapp_inbound_messages
    SET analysis_json = $1, current_stage = 'ANALYZED', last_heartbeat_at = NOW()
    WHERE message_sid = $2 
      AND worker_id = $3 
      AND job_status = 'PROCESSING'
  `;
    const result = await pool.query(updateQuery, [JSON.stringify(analysis), messageSid, workerId]);
    return (result.rowCount ?? 0) > 0;
}
async function requeueForShutdown(messageSids) {
    if (messageSids.length === 0)
        return;
    const pool = (0, db_1.getPool)();
    const workerId = (0, heartbeat_1.getWorkerId)();
    const nextRunAt = new Date(Date.now() + 60 * 1000).toISOString();
    const requeueQuery = `
    UPDATE whatsapp_inbound_messages
    SET 
      job_status = 'READY',
      worker_id = NULL,
      next_run_at = $1,
      failed_reason = 'shutdown_requeue'
    WHERE message_sid = ANY($2::text[])
      AND worker_id = $3
      AND job_status = 'PROCESSING'
  `;
    const result = await pool.query(requeueQuery, [nextRunAt, messageSids, workerId]);
    logger_1.log.info(`Requeued ${result.rowCount} messages for shutdown`, { messageSids });
}
//# sourceMappingURL=claim.js.map