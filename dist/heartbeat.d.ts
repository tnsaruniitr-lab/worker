export declare function getWorkerId(): string;
export declare function incrementJobsProcessed(): void;
export declare function getJobsProcessedTotal(): number;
export declare function upsertHeartbeat(jobsInFlight: number, status?: "healthy" | "degraded", lastError?: string): Promise<void>;
export declare function startHeartbeat(getInFlightCount: () => number, customHeartbeatFn?: () => Promise<void>): void;
export declare function stopHeartbeat(): void;
export declare function sendDegradedHeartbeat(jobsInFlight: number, error: string): Promise<void>;
//# sourceMappingURL=heartbeat.d.ts.map