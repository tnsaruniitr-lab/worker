export const config = {
  database: {
    url: process.env.DATABASE_URL || "",
  },
  openai: {
    apiKey: process.env.OPENAI_API_KEY || "",
  },
  twilio: {
    accountSid: process.env.TWILIO_ACCOUNT_SID || "",
    authToken: process.env.TWILIO_AUTH_TOKEN || "",
  },
  objectStorage: {
    bucketId: process.env.DEFAULT_OBJECT_STORAGE_BUCKET_ID || "",
    privateDir: process.env.PRIVATE_OBJECT_DIR || ".private",
  },
  worker: {
    id: process.env.WORKER_ID || `worker_${process.pid}_${Date.now()}`,
    batchSize: parseInt(process.env.WORKER_BATCH_SIZE || "5", 10),
    lockDurationMinutes: parseInt(process.env.WORKER_LOCK_DURATION_MINUTES || "10", 10),
    pollIntervalMs: parseInt(process.env.WORKER_POLL_INTERVAL_MS || "5000", 10),
    maxRetries: parseInt(process.env.WORKER_MAX_RETRIES || "5", 10),
  },
};

export function validateConfig(): void {
  const required = [
    ["DATABASE_URL", config.database.url],
    ["OPENAI_API_KEY", config.openai.apiKey],
    ["TWILIO_ACCOUNT_SID", config.twilio.accountSid],
    ["TWILIO_AUTH_TOKEN", config.twilio.authToken],
  ];

  const missing = required.filter(([, value]) => !value).map(([name]) => name);

  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(", ")}`);
  }
}
