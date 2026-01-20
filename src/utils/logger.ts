export interface LogContext {
  workerId: string;
  traceId?: string;
  messageSid?: string;
  stage?: string;
}

let globalContext: LogContext = { workerId: "unknown" };

export function setLogContext(ctx: Partial<LogContext>): void {
  globalContext = { ...globalContext, ...ctx };
}

function formatLog(level: string, message: string, extra?: Record<string, unknown>): string {
  const timestamp = new Date().toISOString();
  const ctx = { ...globalContext, ...extra };
  const ctxStr = Object.entries(ctx)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => `${k}=${JSON.stringify(v)}`)
    .join(" ");
  return `${timestamp} [${level}] ${message} ${ctxStr}`.trim();
}

export const log = {
  info: (message: string, extra?: Record<string, unknown>) => {
    console.log(formatLog("INFO", message, extra));
  },
  warn: (message: string, extra?: Record<string, unknown>) => {
    console.warn(formatLog("WARN", message, extra));
  },
  error: (message: string, extra?: Record<string, unknown>) => {
    console.error(formatLog("ERROR", message, extra));
  },
  debug: (message: string, extra?: Record<string, unknown>) => {
    if (process.env.DEBUG) {
      console.log(formatLog("DEBUG", message, extra));
    }
  },
};
