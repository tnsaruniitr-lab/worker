import { WhatsappInboundMessage } from "./db";
export declare function claimMessages(): Promise<WhatsappInboundMessage[]>;
export declare function releaseMessage(messageSid: string, status: "RETRY" | "FAILED", reason: string, failedStage?: string): Promise<boolean>;
export declare function completeMessage(messageSid: string): Promise<boolean>;
export declare function updateMessageStage(messageSid: string, stage: string): Promise<boolean>;
export declare function updateMessageAudioStored(messageSid: string, mediaBlobId: string): Promise<boolean>;
export declare function updateMessageTranscribed(messageSid: string, transcriptText: string): Promise<boolean>;
export declare function updateMessageAnalyzed(messageSid: string, analysis: Record<string, unknown>): Promise<boolean>;
export declare function requeueForShutdown(messageSids: string[]): Promise<void>;
//# sourceMappingURL=claim.d.ts.map