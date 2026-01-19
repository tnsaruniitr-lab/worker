import { Pool } from "pg";
import { config } from "./config";

let pool: Pool | null = null;

export function getPool(): Pool {
  if (!pool) {
    pool = new Pool({
      connectionString: config.database.url,
      max: 10,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 10000,
    });

    pool.on("error", (err) => {
      console.error("Unexpected database pool error:", err);
    });
  }
  return pool;
}

export async function closePool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
    console.log("Database pool closed");
  }
}

export interface WhatsappInboundMessage {
  messageSid: string;
  fromNumber: string;
  agencyId: string;
  messageType: string;
  mediaUrl: string | null;
  mediaBlobId: string | null;
  currentStage: string | null;
  processingStatus: string | null;
  transcriptText: string | null;
  analysisJson: Record<string, unknown> | null;
  failedStage: string | null;
  failedReason: string | null;
  retryCount: number;
  lockedBy: string | null;
  lockedUntil: string | null;
  nextAttemptAt: string | null;
  receivedAt: string;
  body: string | null;
  profileName: string | null;
}
