import { WhatsappInboundMessage } from "../db";
export interface TranscribeResult {
    success: boolean;
    transcriptText: string | null;
    error?: string;
}
export declare function processTranscribe(message: WhatsappInboundMessage, mediaBlobId: string | null): Promise<TranscribeResult>;
//# sourceMappingURL=transcribe.d.ts.map