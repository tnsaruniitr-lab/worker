export interface LogContext {
    workerId: string;
    traceId?: string;
    messageSid?: string;
    stage?: string;
}
export declare function setLogContext(ctx: Partial<LogContext>): void;
export declare const log: {
    info: (message: string, extra?: Record<string, unknown>) => void;
    warn: (message: string, extra?: Record<string, unknown>) => void;
    error: (message: string, extra?: Record<string, unknown>) => void;
    debug: (message: string, extra?: Record<string, unknown>) => void;
};
//# sourceMappingURL=logger.d.ts.map