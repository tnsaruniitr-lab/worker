import { WhatsappInboundMessage } from "../db";
export interface AudioStoreResult {
    success: boolean;
    mediaBlobId: string | null;
    error?: string;
}
export declare function processAudioStore(message: WhatsappInboundMessage): Promise<AudioStoreResult>;
//# sourceMappingURL=audio-store.d.ts.map