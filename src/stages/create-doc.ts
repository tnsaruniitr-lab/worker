import { getPool, WhatsappInboundMessage, extractPatientIdFromBody, lookupAgencyByPatientId, getActiveCareSessionByPhone, lookupAgencyByPatientQrCode, CareSession } from "../db";
import { CareDocumentationAnalysis } from "../services/openai";
import { completePendingDoc, CompletePendingDocPayload } from "../services/api-client";
import { config } from "../config";
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

  const session = await getActiveCareSessionByPhone(fromNumber);

  let resolvedAgencyId: string | null = null;
  
  if (messageAgencyId && messageAgencyId !== 'unknown') {
    resolvedAgencyId = messageAgencyId;
    log.info("Resolved agency from message row", { messageSid, agencyId: resolvedAgencyId });
  }
  
  if (!resolvedAgencyId && session) {
    const sessionAgencyId = await lookupAgencyByPatientQrCode(session.patientId);
    if (sessionAgencyId) {
      resolvedAgencyId = sessionAgencyId;
      log.info("Resolved agency from care session", { messageSid, sessionId: session.id, patientId: session.patientId, agencyId: resolvedAgencyId });
    } else {
      log.warn("Session found but no agency in patient QR", { messageSid, sessionId: session.id, patientId: session.patientId });
    }
  }
  
  if (!resolvedAgencyId) {
    const patientIdFromBody = extractPatientIdFromBody(body);
    if (patientIdFromBody) {
      resolvedAgencyId = await lookupAgencyByPatientId(patientIdFromBody);
      if (resolvedAgencyId) {
        log.info("Resolved agency from body patient lookup", { messageSid, patientId: patientIdFromBody, agencyId: resolvedAgencyId });
      }
    }
  }
  
  if (!resolvedAgencyId && analysis.patientId) {
    resolvedAgencyId = await lookupAgencyByPatientId(analysis.patientId);
    if (resolvedAgencyId) {
      log.info("Resolved agency from analysis patientId", { messageSid, patientId: analysis.patientId, agencyId: resolvedAgencyId });
    }
  }
  
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
    // Check idempotency if we have a pendingDocId
    if (session?.pendingDocId) {
      const existingCheck = await pool.query(
        `SELECT id, message_sid FROM pending_care_documentations WHERE id = $1`,
        [session.pendingDocId]
      );
      
      if (existingCheck.rows.length > 0 && existingCheck.rows[0].message_sid === messageSid) {
        log.info("Placeholder already updated with this message (idempotent skip)", { 
          messageSid, 
          pendingDocId: session.pendingDocId 
        });
        return { success: true, pendingDocId: session.pendingDocId };
      }
    }

    // Use session info if available, otherwise fall back to analysis
    const patientId = session?.patientId || analysis.patientId || null;
    const patientName = session?.patientName || analysis.patientName || null;

    const payload: CompletePendingDocPayload = {
      pendingDocId: session?.pendingDocId || undefined,
      messageSid,
      agencyId: resolvedAgencyId,
      patientId,
      patientName,
      serviceDate: analysis.serviceDate,
      rawContent: analysis.rawContent,
      phoneNumber: fromNumber,
      translations: {
        de: analysis.translations.de || null,
        en: analysis.translations.en || null,
        ar: analysis.translations.ar || null,
        tr: analysis.translations.tr || null,
      },
      originalLanguage: analysis.originalLanguage,
      khCodes: analysis.khCodes,
      alerts: analysis.alerts.length > 0 ? analysis.alerts : null,
      structuredData: analysis.structuredData,
      senderWhatsappNumber: fromNumber.replace("whatsapp:", ""),
      senderProfileName: profileName || null,
      workerId: config.worker.id,
    };

    log.info("Calling server endpoint to complete pending doc", {
      messageSid,
      pendingDocId: session?.pendingDocId || 'NEW',
      patientId,
      agencyId: resolvedAgencyId,
    });

    const response = await completePendingDoc(payload);

    if (response.success) {
      log.info("Server endpoint completed pending doc", {
        messageSid,
        pendingDocId: response.pendingDocId || session?.pendingDocId || null,
        patientId,
        patientName,
      });
      return { success: true, pendingDocId: response.pendingDocId || session?.pendingDocId || null };
    } else {
      log.error("Server endpoint failed to complete pending doc", {
        messageSid,
        pendingDocId: session?.pendingDocId || null,
        message: response.message,
        errors: response.errors,
      });
      return { success: false, pendingDocId: null, error: response.message || "Server endpoint failed" };
    }
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    log.error("Create doc stage failed", { messageSid, error: errorMsg });
    return { success: false, pendingDocId: null, error: errorMsg };
  }
}
