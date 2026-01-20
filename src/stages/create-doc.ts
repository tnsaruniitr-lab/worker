import { getPool, WhatsappInboundMessage, extractPatientIdFromBody, lookupAgencyByPatientId, getActiveCareSessionByPhone, lookupAgencyByPatientQrCode, CareSession } from "../db";
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
  const { messageSid, fromNumber, profileName, body, agencyId: messageAgencyId } = message;
  const pool = getPool();

  // Look up active care session first - needed for both agency resolution and placeholder update
  const session = await getActiveCareSessionByPhone(fromNumber);

  // Resolve agency_id using fallback chain:
  // 1. Use message.agencyId if valid (not 'unknown')
  // 2. Use active care session -> patient QR -> agencyId
  // 3. Extract patient ID from body -> lookup patients table
  // 4. Use analysis patientId -> lookup patients table
  let resolvedAgencyId: string | null = null;
  
  // First try: use pre-populated agencyId from message (if not 'unknown')
  if (messageAgencyId && messageAgencyId !== 'unknown') {
    resolvedAgencyId = messageAgencyId;
    log.info("Resolved agency from message row", { messageSid, agencyId: resolvedAgencyId });
  }
  
  // Second try: use session's patient QR for agency
  if (!resolvedAgencyId && session) {
    const sessionAgencyId = await lookupAgencyByPatientQrCode(session.patientId);
    if (sessionAgencyId) {
      resolvedAgencyId = sessionAgencyId;
      log.info("Resolved agency from care session", { messageSid, sessionId: session.id, patientId: session.patientId, agencyId: resolvedAgencyId });
    } else {
      log.warn("Session found but no agency in patient QR", { messageSid, sessionId: session.id, patientId: session.patientId });
    }
  }
  
  // Third try: extract patient ID from message body and lookup agency
  if (!resolvedAgencyId) {
    const patientIdFromBody = extractPatientIdFromBody(body);
    if (patientIdFromBody) {
      resolvedAgencyId = await lookupAgencyByPatientId(patientIdFromBody);
      if (resolvedAgencyId) {
        log.info("Resolved agency from body patient lookup", { messageSid, patientId: patientIdFromBody, agencyId: resolvedAgencyId });
      }
    }
  }
  
  // Fourth try: use analysis result patientId
  if (!resolvedAgencyId && analysis.patientId) {
    resolvedAgencyId = await lookupAgencyByPatientId(analysis.patientId);
    if (resolvedAgencyId) {
      log.info("Resolved agency from analysis patientId", { messageSid, patientId: analysis.patientId, agencyId: resolvedAgencyId });
    }
  }
  
  // If still no agency, skip creating doc (can't satisfy FK constraint)
  if (!resolvedAgencyId) {
    log.error("Cannot resolve agency_id for message", { 
      messageSid, 
      messageAgencyId,
      fromNumber,
      analysisPatientId: analysis.patientId 
    });
    return { success: false, pendingDocId: null, error: "Cannot resolve agency_id - patient not found" };
  }

  try {
    // If session has a pendingDocId, UPDATE the existing placeholder (mirrors internal flow)
    // Otherwise, create a new document
    if (session?.pendingDocId) {
      // Check if this message was already processed (idempotency by message_sid + agency_id)
      const existingCheck = await pool.query(
        `SELECT id FROM pending_care_documentations WHERE message_sid = $1 AND agency_id = $2`,
        [messageSid, resolvedAgencyId]
      );
      if (existingCheck.rows.length > 0) {
        log.info("Document already exists for message (idempotent skip)", { messageSid, pendingDocId: existingCheck.rows[0].id });
        return { success: true, pendingDocId: existingCheck.rows[0].id };
      }

      // Check if placeholder was already updated with THIS message (idempotency)
      const placeholderCheck = await pool.query(
        `SELECT id, message_sid FROM pending_care_documentations WHERE id = $1`,
        [session.pendingDocId]
      );
      if (placeholderCheck.rows.length > 0 && placeholderCheck.rows[0].message_sid === messageSid) {
        // Same message already processed - idempotent skip
        log.info("Placeholder already updated with this message (idempotent skip)", { 
          messageSid, 
          pendingDocId: session.pendingDocId 
        });
        return { success: true, pendingDocId: session.pendingDocId };
      }

      // Update the existing placeholder with full content (mirrors internal flow)
      // Explicitly set patient_id and patient_name from session to ensure completeness
      const updateQuery = `
        UPDATE pending_care_documentations
        SET 
          raw_content = $1,
          translated_content_de = $2,
          translated_content_en = $3,
          translated_content_ar = $4,
          translated_content_tr = $5,
          original_language = $6,
          kh_codes = $7,
          structured_data = $8,
          alerts = $9,
          status = 'pending',
          message_sid = $10,
          sender_whatsapp_number = $11,
          phone_number = $12,
          service_date = $13,
          agency_id = $14,
          patient_id = COALESCE($16, patient_id),
          patient_name = COALESCE($17, patient_name)
        WHERE id = $15
        RETURNING id
      `;

      const updateResult = await pool.query(updateQuery, [
        analysis.rawContent,
        analysis.translations.de || null,
        analysis.translations.en || null,
        analysis.translations.ar || null,
        analysis.translations.tr || null,
        analysis.originalLanguage,
        analysis.khCodes,
        JSON.stringify(analysis.structuredData),
        JSON.stringify(analysis.alerts),
        messageSid,
        fromNumber.replace("whatsapp:", ""),
        fromNumber,
        analysis.serviceDate,
        resolvedAgencyId,
        session.pendingDocId,
        session.patientId || null,
        session.patientName || null,
      ]);

      if (updateResult.rows.length > 0) {
        log.info("Updated existing placeholder doc", { 
          messageSid, 
          pendingDocId: session.pendingDocId,
          patientId: session.patientId,
          patientName: session.patientName,
          agencyId: resolvedAgencyId
        });
        return { success: true, pendingDocId: session.pendingDocId };
      } else {
        log.warn("Placeholder doc not found, falling back to insert", { messageSid, pendingDocId: session.pendingDocId });
      }
    }

    // Fallback: create a new document (no session or placeholder not found)
    const pendingDocId = `pd_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    // Use session's patient info if available, otherwise fall back to analysis
    const patientId = session?.patientId || analysis.patientId;
    const patientName = session?.patientName || analysis.patientName;

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
        translated_content_ar,
        translated_content_tr,
        original_language,
        kh_codes,
        structured_data,
        alerts,
        status,
        agency_id,
        message_sid,
        created_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, NOW())
      ON CONFLICT (agency_id, message_sid) WHERE message_sid IS NOT NULL
      DO NOTHING
      RETURNING id
    `;

    const result = await pool.query(insertQuery, [
      pendingDocId,
      fromNumber,
      patientId,
      patientName,
      analysis.serviceDate,
      analysis.rawContent,
      analysis.translations.de || null,
      analysis.translations.en || null,
      analysis.translations.ar || null,
      analysis.translations.tr || null,
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

    log.info("Create doc stage complete (new doc)", { messageSid, pendingDocId, patientId, patientName });
    return { success: true, pendingDocId };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    log.error("Create doc stage failed", { messageSid, error: errorMsg });
    return { success: false, pendingDocId: null, error: errorMsg };
  }
}
