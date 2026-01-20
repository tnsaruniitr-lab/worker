"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getPool = getPool;
exports.closePool = closePool;
exports.extractPatientIdFromBody = extractPatientIdFromBody;
exports.lookupAgencyByPatientId = lookupAgencyByPatientId;
exports.getActiveCareSessionByPhone = getActiveCareSessionByPhone;
exports.lookupAgencyByPatientQrCode = lookupAgencyByPatientQrCode;
const pg_1 = require("pg");
const config_1 = require("./config");
let pool = null;
function getPool() {
    if (!pool) {
        pool = new pg_1.Pool({
            connectionString: config_1.config.database.url,
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
async function closePool() {
    if (pool) {
        await pool.end();
        pool = null;
        console.log("Database pool closed");
    }
}
// Parse patient ID from QR code message body
// Pattern: "Pflegedokumentation für [Name] (ID: [PatientID])"
const QR_MESSAGE_PATTERN = /\(ID:\s*([^)]+)\)/i;
function extractPatientIdFromBody(body) {
    if (!body)
        return null;
    const match = body.match(QR_MESSAGE_PATTERN);
    return match ? match[1].trim() : null;
}
// Look up agency_id from patients table by patient_id
async function lookupAgencyByPatientId(patientId) {
    const pool = getPool();
    try {
        const result = await pool.query(`SELECT agency_id FROM patients WHERE patient_id = $1 LIMIT 1`, [patientId]);
        return result.rows[0]?.agency_id || null;
    }
    catch (err) {
        console.error("Failed to lookup agency by patient ID:", err);
        return null;
    }
}
async function getActiveCareSessionByPhone(phoneNumber) {
    const pool = getPool();
    try {
        const result = await pool.query(`SELECT id, phone_number, patient_id, patient_name, expires_at, pending_doc_id
       FROM whatsapp_care_sessions
       WHERE phone_number = $1
         AND expires_at::timestamptz > NOW()
       ORDER BY created_at DESC
       LIMIT 1`, [phoneNumber]);
        if (result.rows.length === 0)
            return null;
        const row = result.rows[0];
        return {
            id: row.id,
            phoneNumber: row.phone_number,
            patientId: row.patient_id,
            patientName: row.patient_name,
            expiresAt: row.expires_at,
            pendingDocId: row.pending_doc_id || null,
        };
    }
    catch (err) {
        console.error("Failed to lookup care session by phone:", err);
        return null;
    }
}
// Look up agency_id from patient_qr_codes table by patient_id
async function lookupAgencyByPatientQrCode(patientId) {
    const pool = getPool();
    try {
        const result = await pool.query(`SELECT agency_id FROM patient_qr_codes WHERE patient_id = $1 LIMIT 1`, [patientId]);
        return result.rows[0]?.agency_id || null;
    }
    catch (err) {
        console.error("Failed to lookup agency by patient QR code:", err);
        return null;
    }
}
//# sourceMappingURL=db.js.map