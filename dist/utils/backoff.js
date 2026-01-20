"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.calculateBackoffMs = calculateBackoffMs;
exports.calculateNextRunAt = calculateNextRunAt;
exports.shouldMarkFailed = shouldMarkFailed;
exports.getMaxAttempts = getMaxAttempts;
exports.sleep = sleep;
const BACKOFF_BASE_MS = 60_000;
const JITTER_MAX_MS = 30_000;
const MAX_ATTEMPTS = 5;
function calculateBackoffMs(attemptCount) {
    const baseDelay = BACKOFF_BASE_MS * Math.pow(2, attemptCount);
    const jitter = Math.floor(Math.random() * JITTER_MAX_MS);
    return baseDelay + jitter;
}
function calculateNextRunAt(attemptCount) {
    const delayMs = calculateBackoffMs(attemptCount);
    const nextRun = new Date(Date.now() + delayMs);
    return nextRun.toISOString();
}
function shouldMarkFailed(attemptCount) {
    return attemptCount >= MAX_ATTEMPTS;
}
function getMaxAttempts() {
    return MAX_ATTEMPTS;
}
async function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
//# sourceMappingURL=backoff.js.map