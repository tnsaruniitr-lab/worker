export declare const config: {
    database: {
        url: string;
    };
    openai: {
        apiKey: string;
    };
    twilio: {
        accountSid: string;
        authToken: string;
    };
    objectStorage: {
        bucketId: string;
        privateDir: string;
    };
    worker: {
        id: string;
        batchSize: number;
        lockDurationMinutes: number;
        pollIntervalMs: number;
        maxRetries: number;
    };
    api: {
        replitUrl: string;
        externalApiKey: string;
        externalApiSecret: string;
    };
};
export declare function validateConfig(): void;
//# sourceMappingURL=config.d.ts.map