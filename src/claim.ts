import { getPool, WhatsappInboundMessage } from "./db";
import { config } from "./config";
import { log } from "./utils/logger";
import { calculateNextAttemptAt } from "./utils/backoff";

export async function claimMessages(): Promise<WhatsappInboundMessage[]> {
  const pool = getPool();
  const { id: workerId, batchSize, lockDurationMinutes, maxRetries } = config.worker;
  
  const now = new Date().toISOString();
  const lockUntil = new Date(Date.now() + lockDurationMinutes * 60 * 1000).toISOString();

  const claimQuery = `
    WITH claimable AS (
      SELECT message_sid 
      FROM whatsapp_inbound_messages
      WHERE (
        -- Ready for first attempt
        processing_status IN ('READY', 'RETRY')
        -- OR stuck in PROCESSING with expired lock (self-healing)
        OR (processing_status = 'PROCESSING' AND locked_until < $1)
      )
        AND message_type = 'voice'
        AND (current_stage IN ('RECEIVED', 'AUDIO_STORED', 'TRANSCRIBED', 'ANALYZED') OR current_stage IS NULL)
        AND (next_attempt_at IS NULL OR next_attempt_at <= $1)
        AND retry_count < $2
      ORDER BY received_at ASC
      LIMIT $3
      FOR UPDATE SKIP LOCKED
    )
    UPDATE whatsapp_inbound_messages
    SET 
      processing_status = 'PROCESSING',
      locked_by = $4,
      locked_until = $5
    WHERE message_sid IN (SELECT message_sid FROM claimable)
    RETURNING 
      message_sid as "messageSid",
      from_number as "fromNumber",
      agency_id as "agencyId",
      message_type as "messageType",
      media_url as "mediaUrl",
      media_blob_id as "mediaBlobId",
      current_stage as "currentStage",
      processing_status as "processingStatus",
      transcript_text as "transcriptText",
      analysis_json as "analysisJson",
      failed_stage as "failedStage",
      failed_reason as "failedReason",
      retry_count as "retryCount",
      locked_by as "lockedBy",
      locked_until as "lockedUntil",
      next_attempt_at as "nextAttemptAt",
      received_at as "receivedAt",
      body,
      profile_name as "profileName"
  `;

  try {
    const result = await pool.query(claimQuery, [
      now,
      maxRetries,
      batchSize,
      workerId,
      lockUntil,
    ]);

    if (result.rows.length > 0) {
      log.info(`Claimed ${result.rows.length} messages`, { workerId });
    }

    return result.rows as WhatsappInboundMessage[];
  } catch (err) {
    log.error("Failed to claim messages", { error: String(err) });
    return [];
  }
}

export async function releaseMessage(messageSid: string, status: "RETRY" | "FAILED", reason: string): Promise<void> {
  const pool = getPool();
  const { maxRetries } = config.worker;

  const getRetryCountQuery = `
    SELECT retry_count FROM whatsapp_inbound_messages WHERE message_sid = $1
  `;
  const retryResult = await pool.query(getRetryCountQuery, [messageSid]);
  const currentRetryCount = retryResult.rows[0]?.retry_count || 0;
  const newRetryCount = currentRetryCount + 1;

  if (status === "RETRY" && newRetryCount >= maxRetries) {
    status = "FAILED";
    log.warn(`Message exceeded max retries, marking as FAILED`, { messageSid, retryCount: newRetryCount });
  }

  const nextAttemptAt = status === "RETRY" ? calculateNextAttemptAt(newRetryCount) : null;

  const releaseQuery = `
    UPDATE whatsapp_inbound_messages
    SET 
      processing_status = $1,
      locked_by = NULL,
      locked_until = NULL,
      next_attempt_at = $2,
      retry_count = $3,
      failed_reason = $4
    WHERE message_sid = $5
  `;

  await pool.query(releaseQuery, [status, nextAttemptAt, newRetryCount, reason, messageSid]);
  log.info(`Released message`, { messageSid, status, retryCount: newRetryCount, nextAttemptAt });
}

export async function completeMessage(messageSid: string): Promise<void> {
  const pool = getPool();

  const completeQuery = `
    UPDATE whatsapp_inbound_messages
    SET 
      processing_status = 'DONE',
      current_stage = 'COMPLETED',
      status = 'completed',
      processed_at = NOW(),
      locked_by = NULL,
      locked_until = NULL
    WHERE message_sid = $1
  `;

  await pool.query(completeQuery, [messageSid]);
  log.info(`Message completed`, { messageSid });
}

export async function updateMessageStage(messageSid: string, stage: string): Promise<void> {
  const pool = getPool();

  const updateQuery = `
    UPDATE whatsapp_inbound_messages
    SET current_stage = $1
    WHERE message_sid = $2
  `;

  await pool.query(updateQuery, [stage, messageSid]);
}

export async function updateMessageAudioStored(messageSid: string, mediaBlobId: string): Promise<void> {
  const pool = getPool();

  const updateQuery = `
    UPDATE whatsapp_inbound_messages
    SET media_blob_id = $1, current_stage = 'AUDIO_STORED'
    WHERE message_sid = $2
  `;

  await pool.query(updateQuery, [mediaBlobId, messageSid]);
}

export async function updateMessageTranscribed(messageSid: string, transcriptText: string): Promise<void> {
  const pool = getPool();

  const updateQuery = `
    UPDATE whatsapp_inbound_messages
    SET transcript_text = $1, current_stage = 'TRANSCRIBED'
    WHERE message_sid = $2
  `;

  await pool.query(updateQuery, [transcriptText, messageSid]);
}

export async function updateMessageAnalyzed(messageSid: string, analysis: Record<string, unknown>): Promise<void> {
  const pool = getPool();

  const updateQuery = `
    UPDATE whatsapp_inbound_messages
    SET analysis_json = $1, current_stage = 'ANALYZED'
    WHERE message_sid = $2
  `;

  await pool.query(updateQuery, [JSON.stringify(analysis), messageSid]);
}

export async function requeueForShutdown(messageSids: string[]): Promise<void> {
  if (messageSids.length === 0) return;

  const pool = getPool();
  const nextAttemptAt = new Date(Date.now() + 60 * 1000).toISOString();

  const requeueQuery = `
    UPDATE whatsapp_inbound_messages
    SET 
      processing_status = 'RETRY',
      locked_by = NULL,
      locked_until = NULL,
      next_attempt_at = $1,
      failed_reason = 'shutdown_requeue'
    WHERE message_sid = ANY($2::text[])
  `;

  await pool.query(requeueQuery, [nextAttemptAt, messageSids]);
  log.info(`Requeued ${messageSids.length} messages for shutdown`, { messageSids });
}
