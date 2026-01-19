import { getPool, WhatsappInboundMessage } from "../db";
import { CareDocumentationAnalysis } from "../services/openai";
import { log } from "../utils/logger";

export interface CreateDocResult {
  success: boolean;
  pendingDocId: string | null;
  error?: string;
}

export async function processCreateDoc(
  message: WhatsappInboundMessage,
  analysis: CareDocumentationAnalysis
): Promise<CreateDocResult> {
  const { messageSid, fromNumber, agencyId, profileName } = message;
  const pool = getPool();

  try {
    const pendingDocId = `pd_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    const insertQuery = `
      INSERT INTO pending_care_documentations (
        id,
        phone_number,
        patient_id,
        patient_name,
        service_date,
        raw_content,
        translated_content_de,
        translated_content_en,
        original_language,
        kh_codes,
        structured_data,
        alerts,
        status,
        agency_id,
        message_sid,
        created_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, NOW())
      ON CONFLICT (agency_id, message_sid) WHERE message_sid IS NOT NULL
      DO NOTHING
      RETURNING id
    `;

    const result = await pool.query(insertQuery, [
      pendingDocId,
      fromNumber,
      analysis.patientId,
      analysis.patientName,
      analysis.serviceDate,
      analysis.rawContent,
      analysis.translations.de || null,
      analysis.translations.en || null,
      analysis.originalLanguage,
      analysis.khCodes,
      JSON.stringify(analysis.structuredData),
      JSON.stringify(analysis.alerts),
      "pending",
      agencyId,
      messageSid,
    ]);

    if (result.rows.length === 0) {
      log.info("Document already exists (idempotent skip)", { messageSid, agencyId });
      const existingQuery = `
        SELECT id FROM pending_care_documentations 
        WHERE agency_id = $1 AND message_sid = $2
      `;
      const existing = await pool.query(existingQuery, [agencyId, messageSid]);
      return { success: true, pendingDocId: existing.rows[0]?.id || null };
    }

    log.info("Create doc stage complete", { messageSid, pendingDocId });
    return { success: true, pendingDocId };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    log.error("Create doc stage failed", { messageSid, error: errorMsg });
    return { success: false, pendingDocId: null, error: errorMsg };
  }
}
