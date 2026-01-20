const BACKOFF_BASE_MS = 60_000;
const JITTER_MAX_MS = 30_000;
const MAX_ATTEMPTS = 5;

export function calculateBackoffMs(attemptCount: number): number {
  const baseDelay = BACKOFF_BASE_MS * Math.pow(2, attemptCount);
  const jitter = Math.floor(Math.random() * JITTER_MAX_MS);
  return baseDelay + jitter;
}

export function calculateNextRunAt(attemptCount: number): string {
  const delayMs = calculateBackoffMs(attemptCount);
  const nextRun = new Date(Date.now() + delayMs);
  return nextRun.toISOString();
}

export function shouldMarkFailed(attemptCount: number): boolean {
  return attemptCount >= MAX_ATTEMPTS;
}

export function getMaxAttempts(): number {
  return MAX_ATTEMPTS;
}

export async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
