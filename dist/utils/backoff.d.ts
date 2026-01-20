export declare function calculateBackoffMs(attemptCount: number): number;
export declare function calculateNextRunAt(attemptCount: number): string;
export declare function shouldMarkFailed(attemptCount: number): boolean;
export declare function getMaxAttempts(): number;
export declare function sleep(ms: number): Promise<void>;
//# sourceMappingURL=backoff.d.ts.map