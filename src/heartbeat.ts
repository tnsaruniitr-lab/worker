import { getPool } from "./db";
import { config } from "./config";
import { log } from "./utils/logger";

const HEARTBEAT_INTERVAL_MS = 30_000;
let heartbeatIntervalId: NodeJS.Timeout | null = null;
let jobsProcessedTotal = 0;

function generateWorkerId(): string {
  const hostname = process.env.HOSTNAME || process.env.HOST || "unknown";
  const bootTs = Date.now();
  const rand = Math.random().toString(36).substring(2, 6);
  return `external-${hostname}-${bootTs}-${rand}`;
}

const WORKER_ID = generateWorkerId();

export function getWorkerId(): string {
  return WORKER_ID;
}

export function incrementJobsProcessed(): void {
  jobsProcessedTotal++;
}

export function getJobsProcessedTotal(): number {
  return jobsProcessedTotal;
}

async function getQueueReadyNow(): Promise<number> {
  const pool = getPool();
  try {
    const result = await pool.query(`
      SELECT COUNT(*) as count
      FROM whatsapp_inbound_messages
      WHERE job_status = 'READY'
        AND (next_run_at IS NULL OR next_run_at::timestamptz <= NOW())
    `);
    return parseInt(result.rows[0]?.count || "0", 10);
  } catch (err) {
    log.warn("Failed to get queue count", { error: String(err) });
    return 0;
  }
}

export async function upsertHeartbeat(
  jobsInFlight: number,
  status: "healthy" | "degraded" = "healthy",
  lastError?: string
): Promise<void> {
  const pool = getPool();
  const queueReadyNow = await getQueueReadyNow();
  const version = process.env.WORKER_VERSION || "1.0.0";
  const hostname = process.env.HOSTNAME || process.env.HOST || "unknown";

  try {
    await pool.query(
      `
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
      `,
      [
        WORKER_ID,
        jobsInFlight,
        jobsProcessedTotal,
        queueReadyNow,
        status,
        lastError || null,
        version,
        hostname,
      ]
    );
    log.debug("Heartbeat sent", {
      workerId: WORKER_ID,
      jobsInFlight,
      jobsProcessedTotal,
      queueReadyNow,
      status,
    });
  } catch (err) {
    log.warn("Failed to send heartbeat", { error: String(err) });
  }
}

export function startHeartbeat(
  getInFlightCount: () => number,
  customHeartbeatFn?: () => Promise<void>
): void {
  log.info("Starting heartbeat", {
    workerId: WORKER_ID,
    intervalMs: HEARTBEAT_INTERVAL_MS,
  });

  if (customHeartbeatFn) {
    customHeartbeatFn();
  } else {
    upsertHeartbeat(getInFlightCount(), "healthy");
  }

  heartbeatIntervalId = setInterval(async () => {
    if (customHeartbeatFn) {
      await customHeartbeatFn();
    } else {
      await upsertHeartbeat(getInFlightCount(), "healthy");
    }
  }, HEARTBEAT_INTERVAL_MS);
}

export function stopHeartbeat(): void {
  if (heartbeatIntervalId) {
    clearInterval(heartbeatIntervalId);
    heartbeatIntervalId = null;
    log.info("Heartbeat stopped");
  }
}

export async function sendDegradedHeartbeat(
  jobsInFlight: number,
  error: string
): Promise<void> {
  await upsertHeartbeat(jobsInFlight, "degraded", error);
}
