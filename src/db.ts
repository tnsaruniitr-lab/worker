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
  jobStatus: string | null;
  transcriptText: string | null;
  analysisJson: Record<string, unknown> | null;
  failedStage: string | null;
  failedReason: string | null;
  attemptCount: number;
  workerId: string | null;
  nextRunAt: string | null;
  receivedAt: string;
  body: string | null;
  profileName: string | null;
}

// Parse patient ID from QR code message body
// Pattern: "Pflegedokumentation für [Name] (ID: [PatientID])"
const QR_MESSAGE_PATTERN = /\(ID:\s*([^)]+)\)/i;

export function extractPatientIdFromBody(body: string | null): string | null {
  if (!body) return null;
  const match = body.match(QR_MESSAGE_PATTERN);
  return match ? match[1].trim() : null;
}

// Look up agency_id from patients table by patient_id
export async function lookupAgencyByPatientId(patientId: string): Promise<string | null> {
  const pool = getPool();
  try {
    const result = await pool.query(
      `SELECT agency_id FROM patients WHERE patient_id = $1 LIMIT 1`,
      [patientId]
    );
    return result.rows[0]?.agency_id || null;
  } catch (err) {
    console.error("Failed to lookup agency by patient ID:", err);
    return null;
  }
}
