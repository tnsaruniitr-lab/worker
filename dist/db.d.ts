import { Pool } from "pg";
export declare function getPool(): Pool;
export declare function closePool(): Promise<void>;
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
export declare function extractPatientIdFromBody(body: string | null): string | null;
export declare function lookupAgencyByPatientId(patientId: string): Promise<string | null>;
export interface CareSession {
    id: string;
    phoneNumber: string;
    patientId: string;
    patientName: string;
    expiresAt: string;
    pendingDocId: string | null;
}
export declare function getActiveCareSessionByPhone(phoneNumber: string): Promise<CareSession | null>;
export declare function lookupAgencyByPatientQrCode(patientId: string): Promise<string | null>;
//# sourceMappingURL=db.d.ts.map