import { WhatsappInboundMessage } from "../db";
import { CareDocumentationAnalysis } from "../services/openai";
export interface CreateDocResult {
    success: boolean;
    pendingDocId: string | null;
    error?: string;
}
export declare function processCreateDoc(message: WhatsappInboundMessage, analysis: CareDocumentationAnalysis): Promise<CreateDocResult>;
//# sourceMappingURL=create-doc.d.ts.map