import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type pg from 'pg'
import { getLogger } from '~/lib/logger'

const __dirname = dirname(fileURLToPath(import.meta.url))

type MigrateLogger = ReturnType<typeof getLogger>

/** Indexes auth / hot paths depend on. Missing them is a warning, not a crash. */
const CRITICAL_INDEXES = ['instances_api_key_hash_idx'] as const

export async function migrate(pool: pg.Pool): Promise<void> {
  const log = getLogger({ component: 'migrate' })
  const { sql, source } = await loadSchema()
  if (source === 'inline') {
    log.warn(
      { source },
      'schema.sql not found on disk — applying embedded INLINE_SCHEMA fallback (keep it in sync with src/db/schema.sql)',
    )
  } else {
    log.info({ source }, 'applying schema from disk')
  }
  await pool.query(sql)
  await assertCriticalIndexes(pool, log)
  log.info({ source }, 'database schema ensured')
}

/** Prefer schema.sql on disk (source of truth); fall back to the embedded copy. */
async function loadSchema(): Promise<{ sql: string; source: string }> {
  const candidates = [
    join(__dirname, 'schema.sql'),
    join(__dirname, '../src/db/schema.sql'),
    join(process.cwd(), 'src/db/schema.sql'),
  ]
  for (const path of candidates) {
    try {
      return { sql: await readFile(path, 'utf8'), source: path }
    } catch {
      // try next candidate
    }
  }
  return { sql: INLINE_SCHEMA, source: 'inline' }
}

async function assertCriticalIndexes(pool: pg.Pool, log: MigrateLogger): Promise<void> {
  const { rows } = await pool.query<{ indexname: string }>(
    'SELECT indexname FROM pg_indexes WHERE indexname = ANY($1)',
    [CRITICAL_INDEXES],
  )
  const present = new Set(rows.map((r) => r.indexname))
  const missing = CRITICAL_INDEXES.filter((name) => !present.has(name))
  if (missing.length > 0) {
    log.warn({ missing }, 'critical indexes missing after migrate — instance auth lookups may fail or be slow')
  }
}

/**
 * Fallback when schema.sql is not on disk (production image should COPY it).
 * MUST mirror src/db/schema.sql exactly — tables, columns, and every index.
 */
const INLINE_SCHEMA = `
CREATE TABLE IF NOT EXISTS instances (
  name TEXT PRIMARY KEY,
  api_key_hash TEXT NOT NULL,
  webhook_url TEXT,
  webhook_events TEXT[] NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'created',
  me_jid TEXT,
  pair_phone TEXT,
  last_qr TEXT,
  last_qr_at TIMESTAMPTZ,
  config JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- Retrofit columns on a pre-existing instances table (CREATE above is a no-op then).
-- api_key_hash must be added BEFORE its unique index below; nullable so legacy rows
-- survive and re-key via POST .../keys/rotate.
ALTER TABLE instances ADD COLUMN IF NOT EXISTS api_key_hash TEXT;
ALTER TABLE instances ADD COLUMN IF NOT EXISTS config JSONB NOT NULL DEFAULT '{}'::jsonb;
-- Drop the legacy plaintext key column: its NOT NULL constraint would reject
-- inserts that only populate api_key_hash.
ALTER TABLE instances DROP COLUMN IF EXISTS api_key;
CREATE UNIQUE INDEX IF NOT EXISTS instances_api_key_hash_idx ON instances (api_key_hash);
CREATE INDEX IF NOT EXISTS instances_status_idx ON instances (status);

CREATE TABLE IF NOT EXISTS instance_webhooks (
  id TEXT PRIMARY KEY,
  instance_name TEXT NOT NULL REFERENCES instances(name) ON DELETE CASCADE,
  url TEXT NOT NULL,
  events TEXT[] NOT NULL DEFAULT '{}',
  hmac_key TEXT,
  retries_policy TEXT NOT NULL DEFAULT 'exponential',
  retries_delay_seconds INT NOT NULL DEFAULT 2,
  retries_attempts INT NOT NULL DEFAULT 5,
  custom_headers JSONB NOT NULL DEFAULT '[]'::jsonb,
  enabled BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS instance_webhooks_instance_idx ON instance_webhooks (instance_name);

CREATE TABLE IF NOT EXISTS app_messages (
  instance_name TEXT NOT NULL REFERENCES instances(name) ON DELETE CASCADE,
  message_id TEXT NOT NULL,
  chat_jid TEXT NOT NULL,
  sender_jid TEXT,
  participant_jid TEXT,
  from_me BOOLEAN NOT NULL DEFAULT false,
  timestamp_ms BIGINT,
  ack INT NOT NULL DEFAULT 0,
  type TEXT NOT NULL DEFAULT 'unknown',
  body TEXT,
  caption TEXT,
  media_url TEXT,
  media_mime TEXT,
  media_filename TEXT,
  media_storage_key TEXT,
  has_media BOOLEAN NOT NULL DEFAULT false,
  is_deleted BOOLEAN NOT NULL DEFAULT false,
  is_edited BOOLEAN NOT NULL DEFAULT false,
  starred BOOLEAN NOT NULL DEFAULT false,
  push_name TEXT,
  source TEXT NOT NULL DEFAULT 'live',
  raw JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (instance_name, message_id)
);
CREATE INDEX IF NOT EXISTS app_messages_chat_ts_idx
  ON app_messages (instance_name, chat_jid, timestamp_ms DESC);
CREATE INDEX IF NOT EXISTS app_messages_ts_idx
  ON app_messages (instance_name, timestamp_ms DESC);
CREATE INDEX IF NOT EXISTS app_messages_metrics_idx
  ON app_messages (instance_name, from_me, timestamp_ms DESC)
  WHERE timestamp_ms IS NOT NULL;

CREATE TABLE IF NOT EXISTS app_chats (
  instance_name TEXT NOT NULL REFERENCES instances(name) ON DELETE CASCADE,
  chat_jid TEXT NOT NULL,
  name TEXT,
  is_group BOOLEAN NOT NULL DEFAULT false,
  unread_count INT NOT NULL DEFAULT 0,
  archived BOOLEAN NOT NULL DEFAULT false,
  pinned INT NOT NULL DEFAULT 0,
  mute_end_ms BIGINT,
  marked_as_unread BOOLEAN NOT NULL DEFAULT false,
  last_message_id TEXT,
  last_message_preview TEXT,
  last_message_ts BIGINT,
  raw JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (instance_name, chat_jid)
);
CREATE INDEX IF NOT EXISTS app_chats_last_ts_idx
  ON app_chats (instance_name, last_message_ts DESC NULLS LAST);

CREATE TABLE IF NOT EXISTS app_contacts (
  instance_name TEXT NOT NULL REFERENCES instances(name) ON DELETE CASCADE,
  jid TEXT NOT NULL,
  display_name TEXT,
  push_name TEXT,
  lid TEXT,
  phone_number TEXT,
  profile_picture_url TEXT,
  blocked BOOLEAN NOT NULL DEFAULT false,
  last_updated_ms BIGINT,
  raw JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (instance_name, jid)
);
CREATE INDEX IF NOT EXISTS app_contacts_phone_idx ON app_contacts (instance_name, phone_number);

CREATE TABLE IF NOT EXISTS contact_avatars (
  instance_name TEXT NOT NULL REFERENCES instances(name) ON DELETE CASCADE,
  jid TEXT NOT NULL,
  pic_type TEXT NOT NULL DEFAULT 'preview',
  status TEXT NOT NULL DEFAULT 'ok',
  storage_key TEXT,
  sha256 TEXT,
  wa_picture_id TEXT,
  mime_type TEXT,
  size_bytes BIGINT,
  last_checked_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_fetched_at TIMESTAMPTZ,
  reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (instance_name, jid, pic_type)
);
CREATE INDEX IF NOT EXISTS contact_avatars_checked_idx
  ON contact_avatars (instance_name, last_checked_at);

CREATE TABLE IF NOT EXISTS processed_events (
  instance_name TEXT NOT NULL REFERENCES instances(name) ON DELETE CASCADE,
  event_key TEXT NOT NULL,
  event_type TEXT NOT NULL,
  processed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (instance_name, event_key)
);
CREATE INDEX IF NOT EXISTS processed_events_at_idx ON processed_events (processed_at);

CREATE TABLE IF NOT EXISTS webhook_outbox (
  id TEXT PRIMARY KEY,
  instance_name TEXT NOT NULL REFERENCES instances(name) ON DELETE CASCADE,
  webhook_id TEXT,
  event TEXT NOT NULL,
  event_id TEXT NOT NULL,
  payload JSONB NOT NULL,
  url TEXT NOT NULL,
  hmac_key TEXT,
  custom_headers JSONB NOT NULL DEFAULT '[]'::jsonb,
  attempts INT NOT NULL DEFAULT 0,
  max_attempts INT NOT NULL DEFAULT 5,
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_error TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS webhook_outbox_pending_idx
  ON webhook_outbox (status, next_attempt_at)
  WHERE status = 'pending';

CREATE TABLE IF NOT EXISTS media_objects (
  id TEXT PRIMARY KEY,
  instance_name TEXT NOT NULL REFERENCES instances(name) ON DELETE CASCADE,
  message_id TEXT,
  chat_jid TEXT,
  storage_key TEXT NOT NULL,
  url TEXT,
  mime_type TEXT,
  size_bytes BIGINT,
  sha256 TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS media_objects_instance_idx ON media_objects (instance_name, message_id);
CREATE INDEX IF NOT EXISTS media_objects_instance_created_idx
  ON media_objects (instance_name, created_at DESC);

CREATE TABLE IF NOT EXISTS app_labels (
  instance_name TEXT NOT NULL REFERENCES instances(name) ON DELETE CASCADE,
  label_id TEXT NOT NULL,
  name TEXT NOT NULL,
  color INT NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT true,
  predefined_id TEXT,
  raw JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (instance_name, label_id)
);

CREATE TABLE IF NOT EXISTS app_label_chats (
  instance_name TEXT NOT NULL,
  label_id TEXT NOT NULL,
  chat_jid TEXT NOT NULL,
  labeled BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (instance_name, label_id, chat_jid),
  FOREIGN KEY (instance_name, label_id) REFERENCES app_labels(instance_name, label_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS app_label_chats_chat_idx ON app_label_chats (instance_name, chat_jid);

CREATE TABLE IF NOT EXISTS lid_map (
  instance_name TEXT NOT NULL REFERENCES instances(name) ON DELETE CASCADE,
  lid TEXT NOT NULL,
  pn TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (instance_name, lid)
);
CREATE INDEX IF NOT EXISTS lid_map_pn_idx ON lid_map (instance_name, pn);

CREATE TABLE IF NOT EXISTS app_calls (
  instance_name TEXT NOT NULL REFERENCES instances(name) ON DELETE CASCADE,
  call_id TEXT NOT NULL,
  peer_jid TEXT,
  direction TEXT NOT NULL DEFAULT 'unknown',
  media_type TEXT NOT NULL DEFAULT 'audio',
  state TEXT,
  end_reason TEXT,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_at TIMESTAMPTZ,
  duration_secs INT,
  recording_enabled BOOLEAN NOT NULL DEFAULT false,
  recording_status TEXT NOT NULL DEFAULT 'none',
  recording_storage_key TEXT,
  recording_url TEXT,
  recording_mime TEXT,
  recording_bytes BIGINT,
  recording_error TEXT,
  raw JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (instance_name, call_id)
);
CREATE INDEX IF NOT EXISTS app_calls_started_idx ON app_calls (instance_name, started_at DESC);
CREATE INDEX IF NOT EXISTS app_calls_recording_idx
  ON app_calls (instance_name, recording_status)
  WHERE recording_status = 'ready';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'processed_events_instance_name_fkey') THEN
    DELETE FROM processed_events pe WHERE NOT EXISTS (SELECT 1 FROM instances i WHERE i.name = pe.instance_name);
    ALTER TABLE processed_events ADD CONSTRAINT processed_events_instance_name_fkey
      FOREIGN KEY (instance_name) REFERENCES instances(name) ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'webhook_outbox_instance_name_fkey') THEN
    DELETE FROM webhook_outbox wo WHERE NOT EXISTS (SELECT 1 FROM instances i WHERE i.name = wo.instance_name);
    ALTER TABLE webhook_outbox ADD CONSTRAINT webhook_outbox_instance_name_fkey
      FOREIGN KEY (instance_name) REFERENCES instances(name) ON DELETE CASCADE;
  END IF;
END $$;
`
