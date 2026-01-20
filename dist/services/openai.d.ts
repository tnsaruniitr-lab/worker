import OpenAI from "openai";
export declare function getOpenAIClient(): OpenAI;
export declare function transcribeAudio(audioBuffer: Buffer, language?: string): Promise<string>;
export interface CareDocumentationAnalysis {
    patientId: string;
    patientName: string;
    serviceDate: string;
    rawContent: string;
    khCodes: string[];
    structuredData: Record<string, unknown>;
    alerts: Array<{
        type: string;
        severity: string;
        description: string;
    }>;
    originalLanguage: string;
    translations: {
        de?: string;
        en?: string;
        tr?: string;
        ar?: string;
    };
}
export declare function analyzeTranscript(transcriptText: string, agencyId: string): Promise<CareDocumentationAnalysis | null>;
//# sourceMappingURL=openai.d.ts.map