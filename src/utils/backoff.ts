const BACKOFF_SCHEDULE_MINUTES = [1, 5, 15, 30, 60];

export function getBackoffDelayMinutes(retryCount: number): number {
  const index = Math.min(retryCount, BACKOFF_SCHEDULE_MINUTES.length - 1);
  return BACKOFF_SCHEDULE_MINUTES[index];
}

export function calculateNextAttemptAt(retryCount: number): string {
  const delayMinutes = getBackoffDelayMinutes(retryCount);
  const nextAttempt = new Date(Date.now() + delayMinutes * 60 * 1000);
  return nextAttempt.toISOString();
}

export function shouldGiveUp(retryCount: number, maxRetries: number): boolean {
  return retryCount >= maxRetries;
}

export async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
