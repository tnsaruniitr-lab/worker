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
    alerts: Array<{
        type: string;
        severity: string;
        description: string;
    }> | null;
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
export declare function completePendingDoc(payload: CompletePendingDocPayload, retries?: number): Promise<ApiResponse>;
//# sourceMappingURL=api-client.d.ts.map