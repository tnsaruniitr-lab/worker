import { getPool, WhatsappInboundMessage, extractPatientIdFromBody, lookupAgencyByPatientId } from "../db";
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
  const { messageSid, fromNumber, profileName, body } = message;
  const pool = getPool();

  // Resolve agency_id: parse patient ID from body -> lookup patient -> get agency
  let resolvedAgencyId: string | null = null;
  
  // First try: extract patient ID from message body and lookup agency
  const patientIdFromBody = extractPatientIdFromBody(body);
  if (patientIdFromBody) {
    resolvedAgencyId = await lookupAgencyByPatientId(patientIdFromBody);
    if (resolvedAgencyId) {
      log.info("Resolved agency from patient lookup", { messageSid, patientId: patientIdFromBody, agencyId: resolvedAgencyId });
    }
  }
  
  // Second try: use analysis result patientId if body parsing failed
  if (!resolvedAgencyId && analysis.patientId) {
    resolvedAgencyId = await lookupAgencyByPatientId(analysis.patientId);
    if (resolvedAgencyId) {
      log.info("Resolved agency from analysis patientId", { messageSid, patientId: analysis.patientId, agencyId: resolvedAgencyId });
    }
  }
  
  // If still no agency, skip creating doc (can't satisfy FK constraint)
  if (!resolvedAgencyId) {
    log.error("Cannot resolve agency_id for message", { messageSid, patientIdFromBody, analysisPatientId: analysis.patientId });
    return { success: false, pendingDocId: null, error: "Cannot resolve agency_id - patient not found" };
  }

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
      resolvedAgencyId,
      messageSid,
    ]);

    if (result.rows.length === 0) {
      log.info("Document already exists (idempotent skip)", { messageSid, agencyId: resolvedAgencyId });
      const existingQuery = `
        SELECT id FROM pending_care_documentations 
        WHERE agency_id = $1 AND message_sid = $2
      `;
      const existing = await pool.query(existingQuery, [resolvedAgencyId, messageSid]);
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
