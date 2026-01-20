import { WhatsappInboundMessage } from "../db";
import { CareDocumentationAnalysis } from "../services/openai";
export interface AnalyzeResult {
    success: boolean;
    analysis: CareDocumentationAnalysis | null;
    error?: string;
}
export declare function processAnalyze(message: WhatsappInboundMessage, transcriptText: string): Promise<AnalyzeResult>;
//# sourceMappingURL=analyze.d.ts.map