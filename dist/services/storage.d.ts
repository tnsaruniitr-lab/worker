export declare function getDeterministicAudioKey(agencyId: string, messageSid: string, extension: string): string;
export declare function checkAudioExists(objectKey: string): Promise<boolean>;
export declare function uploadAudio(audioBuffer: Buffer, agencyId: string, messageSid: string, contentType: string): Promise<string>;
export declare function downloadAudio(objectKey: string): Promise<Buffer>;
//# sourceMappingURL=storage.d.ts.map