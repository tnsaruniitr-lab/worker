"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.log = void 0;
exports.setLogContext = setLogContext;
let globalContext = { workerId: "unknown" };
function setLogContext(ctx) {
    globalContext = { ...globalContext, ...ctx };
}
function formatLog(level, message, extra) {
    const timestamp = new Date().toISOString();
    const ctx = { ...globalContext, ...extra };
    const ctxStr = Object.entries(ctx)
        .filter(([, v]) => v !== undefined)
        .map(([k, v]) => `${k}=${JSON.stringify(v)}`)
        .join(" ");
    return `${timestamp} [${level}] ${message} ${ctxStr}`.trim();
}
exports.log = {
    info: (message, extra) => {
        console.log(formatLog("INFO", message, extra));
    },
    warn: (message, extra) => {
        console.warn(formatLog("WARN", message, extra));
    },
    error: (message, extra) => {
        console.error(formatLog("ERROR", message, extra));
    },
    debug: (message, extra) => {
        if (process.env.DEBUG) {
            console.log(formatLog("DEBUG", message, extra));
        }
    },
};
//# sourceMappingURL=logger.js.map