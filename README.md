# Nurse Tour Worker

External worker for processing WhatsApp voice messages asynchronously. This worker can be deployed independently of the main Replit application for horizontal scaling.

## Features

- **Optimized Claim Query**: Includes self-healing for stuck PROCESSING messages
- **Deterministic Audio Keys**: Uses `audio/{agencyId}/{messageSid}.{ext}` pattern
- **Document Idempotency**: Uses `ON CONFLICT DO NOTHING` with `message_sid`
- **Graceful Shutdown**: Requeues in-flight messages on SIGTERM/SIGINT
- **Exponential Backoff**: 1m, 5m, 15m, 30m, 1hr retry schedule
- **Max Retry Cap**: Messages marked FAILED after 5 attempts

## Processing Stages

1. **RECEIVED** → Initial state
2. **AUDIO_STORED** → Audio downloaded from Twilio, stored in object storage
3. **TRANSCRIBED** → Audio transcribed via OpenAI Whisper
4. **ANALYZED** → Transcript analyzed via GPT-4
5. **DOC_CREATED** → Pending care documentation created
6. **COMPLETED** → All stages finished

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | Yes | PostgreSQL connection string |
| `OPENAI_API_KEY` | Yes | OpenAI API key for Whisper + GPT-4 |
| `TWILIO_ACCOUNT_SID` | Yes | Twilio Account SID |
| `TWILIO_AUTH_TOKEN` | Yes | Twilio Auth Token |
| `DEFAULT_OBJECT_STORAGE_BUCKET_ID` | No | GCS bucket ID for audio storage |
| `PRIVATE_OBJECT_DIR` | No | Private directory prefix (default: `.private`) |
| `WORKER_ID` | No | Unique worker identifier (auto-generated if not set) |
| `WORKER_BATCH_SIZE` | No | Messages to claim per batch (default: 5) |
| `WORKER_LOCK_DURATION_MINUTES` | No | Lock duration in minutes (default: 10) |
| `WORKER_POLL_INTERVAL_MS` | No | Poll interval in milliseconds (default: 5000) |
| `WORKER_MAX_RETRIES` | No | Max retry attempts before FAILED (default: 5) |

## Deployment Options

### Option 1: Railway

```bash
# 1. Create new Railway project
railway init

# 2. Link to this directory
cd worker

# 3. Deploy
railway up

# 4. Set environment variables in Railway dashboard
```

### Option 2: Second Replit

1. Create a new Replit with Node.js template
2. Copy the `worker/` folder contents
3. Set Secrets in the new Replit (same values as main app)
4. Run `npm install && npm start`

### Option 3: Docker / VM

```bash
# Build
cd worker
npm install
npm run build

# Run
node dist/index.js
```

## Database Migration

Before running the worker, ensure the database has the required columns:

```sql
-- v2.0 worker columns (if not already applied)
ALTER TABLE whatsapp_inbound_messages 
  ADD COLUMN IF NOT EXISTS locked_by TEXT,
  ADD COLUMN IF NOT EXISTS locked_until TEXT,
  ADD COLUMN IF NOT EXISTS next_attempt_at TEXT;

-- Idempotency column for pending docs
ALTER TABLE pending_care_documentations 
  ADD COLUMN IF NOT EXISTS message_sid TEXT;

-- Idempotency constraint
CREATE UNIQUE INDEX IF NOT EXISTS idx_pending_docs_message_idempotent 
  ON pending_care_documentations (agency_id, message_sid) 
  WHERE message_sid IS NOT NULL;

-- Claim index for performance
CREATE INDEX IF NOT EXISTS idx_whatsapp_messages_claim 
  ON whatsapp_inbound_messages (processing_status, locked_until, next_attempt_at, received_at)
  WHERE message_type = 'voice';
```

## Architecture

```
┌─────────────────────┐     ┌─────────────────────┐
│   Main Replit App   │     │   External Worker   │
│   (webhook + UI)    │     │   (this codebase)   │
└──────────┬──────────┘     └──────────┬──────────┘
           │                           │
           │ Writes READY messages     │ Claims & processes
           ▼                           ▼
    ┌──────────────────────────────────────┐
    │         PostgreSQL Database          │
    │     whatsapp_inbound_messages        │
    └──────────────────────────────────────┘
```

## Claim Query Logic

The worker claims messages that are:

1. **READY or RETRY** status, OR
2. **PROCESSING with expired lock** (self-healing for crashed workers)

AND:
- `message_type = 'voice'`
- `retry_count < max_retries`
- `next_attempt_at <= now()` (or NULL)

## Graceful Shutdown

On SIGTERM/SIGINT:
1. Stop claiming new messages
2. Requeue in-flight messages with `status = 'RETRY'` and `next_attempt_at = now + 1 minute`
3. Close database pool
4. Exit cleanly

## Monitoring

The worker logs structured JSON to stdout:

```
2025-01-19T10:30:00.000Z [INFO] Worker starting workerId="worker_123" pollIntervalMs=5000
2025-01-19T10:30:01.000Z [INFO] Claimed 3 messages workerId="worker_123"
2025-01-19T10:30:05.000Z [INFO] Stage TRANSCRIBED complete messageSid="SM123" stage="TRANSCRIBED"
```

Use `DEBUG=1` for verbose logging.

## Scaling

Multiple workers can run in parallel:

1. Each worker claims different messages (using `FOR UPDATE SKIP LOCKED`)
2. No coordination required between workers
3. Scale horizontally by adding more worker instances

Recommended setup:
- Start with 2-3 workers
- Monitor processing queue depth
- Add workers as needed
