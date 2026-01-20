import crypto from "crypto";
import { log } from "../utils/logger";

const REPLIT_API_URL = process.env.REPLIT_API_URL || "";
const EXTERNAL_API_KEY = process.env.EXTERNAL_API_KEY || "";
const EXTERNAL_API_SECRET = process.env.EXTERNAL_API_SECRET || "";

export interface CompletePendingDocPayload {
  pendingDocId?: string;
  messageSid: string;
  agencyId: string;
  patientId: string | null;
  patientName: string | null;
  serviceDate: string;
  rawContent: string;
  phoneNumber?: string;
  translations: {
    de: string | null;
    en: string | null;
    ar: string | null;
    tr: string | null;
  };
  originalLanguage: string;
  khCodes: string[];
  alerts: Array<{ type: string; severity: string; description: string }> | null;
  structuredData: Record<string, unknown>;
  senderWhatsappNumber: string;
  senderProfileName: string | null;
  workerId?: string;
}

export interface ApiResponse {
  success: boolean;
  pendingDocId?: string;
  message?: string;
  errors?: unknown[];
}

function generateSignature(method: string, path: string, timestamp: string): string {
  const signaturePayload = `${method}:${path}:${timestamp}:${EXTERNAL_API_KEY}`;
  return crypto
    .createHmac("sha256", EXTERNAL_API_SECRET)
    .update(signaturePayload)
    .digest("hex");
}

export async function completePendingDoc(
  payload: CompletePendingDocPayload,
  retries = 3
): Promise<ApiResponse> {
  if (!REPLIT_API_URL) {
    throw new Error("REPLIT_API_URL not configured");
  }
  if (!EXTERNAL_API_KEY || !EXTERNAL_API_SECRET) {
    throw new Error("EXTERNAL_API_KEY or EXTERNAL_API_SECRET not configured");
  }

  const path = "/api/external/complete-pending-doc";
  const url = `${REPLIT_API_URL}${path}`;
  const method = "POST";

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const timestamp = Date.now().toString();
      const signature = generateSignature(method, path, timestamp);

      log.info("Calling server endpoint", {
        url,
        attempt,
        pendingDocId: payload.pendingDocId,
        messageSid: payload.messageSid,
      });

      const response = await fetch(url, {
        method,
        headers: {
          "Content-Type": "application/json",
          "x-api-key": EXTERNAL_API_KEY,
          "x-timestamp": timestamp,
          "x-signature": signature,
        },
        body: JSON.stringify(payload),
      });

      const data = await response.json() as ApiResponse;

      if (response.ok) {
        log.info("Server endpoint success", {
          pendingDocId: payload.pendingDocId,
          messageSid: payload.messageSid,
        });
        return data;
      }

      if (response.status >= 400 && response.status < 500) {
        log.error("Server endpoint client error (no retry)", {
          status: response.status,
          message: data.message,
          errors: data.errors,
        });
        return data;
      }

      log.warn("Server endpoint error, will retry", {
        status: response.status,
        attempt,
        message: data.message,
      });
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      log.warn("Server endpoint network error", {
        attempt,
        error: errorMsg,
      });

      if (attempt === retries) {
        throw new Error(`Failed to call server after ${retries} attempts: ${errorMsg}`);
      }
    }

    const delay = Math.min(1000 * Math.pow(2, attempt - 1), 10000);
    await new Promise((resolve) => setTimeout(resolve, delay));
  }

  throw new Error("Unexpected: exhausted retries without returning");
}
