"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.completePendingDoc = completePendingDoc;
const crypto_1 = __importDefault(require("crypto"));
const logger_1 = require("../utils/logger");
const REPLIT_API_URL = process.env.REPLIT_API_URL || "";
const EXTERNAL_API_KEY = process.env.EXTERNAL_API_KEY || "";
const EXTERNAL_API_SECRET = process.env.EXTERNAL_API_SECRET || "";
function generateSignature(method, path, timestamp) {
    const signaturePayload = `${method}:${path}:${timestamp}:${EXTERNAL_API_KEY}`;
    return crypto_1.default
        .createHmac("sha256", EXTERNAL_API_SECRET)
        .update(signaturePayload)
        .digest("hex");
}
async function completePendingDoc(payload, retries = 5) {
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
            logger_1.log.info("Calling server endpoint", {
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
            const contentType = response.headers.get("content-type") || "";
            if (!contentType.includes("application/json")) {
                const textBody = await response.text();
                logger_1.log.warn("Server returned non-JSON response (likely restarting)", {
                    status: response.status,
                    contentType,
                    bodyPreview: textBody.substring(0, 200),
                    attempt,
                });
                if (attempt < retries) {
                    const delay = Math.min(2000 * Math.pow(2, attempt - 1), 15000);
                    logger_1.log.info("Waiting for server to become available", { delay, attempt });
                    await new Promise((resolve) => setTimeout(resolve, delay));
                    continue;
                }
                throw new Error(`Server not returning JSON after ${retries} attempts (server may be restarting)`);
            }
            const data = await response.json();
            if (response.ok) {
                logger_1.log.info("Server endpoint success", {
                    pendingDocId: payload.pendingDocId,
                    messageSid: payload.messageSid,
                });
                return data;
            }
            if (response.status >= 400 && response.status < 500) {
                logger_1.log.error("Server endpoint client error (no retry)", {
                    status: response.status,
                    message: data.message,
                    errors: data.errors,
                });
                return data;
            }
            logger_1.log.warn("Server endpoint error, will retry", {
                status: response.status,
                attempt,
                message: data.message,
            });
        }
        catch (err) {
            const errorMsg = err instanceof Error ? err.message : String(err);
            logger_1.log.warn("Server endpoint network error", {
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
//# sourceMappingURL=api-client.js.map