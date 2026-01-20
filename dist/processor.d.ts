import { WhatsappInboundMessage } from "./db";
export type ProcessResult = {
    success: boolean;
    isHardFailure: boolean;
    errorMessage?: string;
};
export declare function processMessage(message: WhatsappInboundMessage): Promise<ProcessResult>;
//# sourceMappingURL=processor.d.ts.map