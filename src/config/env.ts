import { z } from 'zod'

const boolFromString = z.union([z.boolean(), z.string()]).transform((v) => {
  if (typeof v === 'boolean') return v
  return ['1', 'true', 'yes', 'on'].includes(v.toLowerCase())
})

/** Well-known scaffold/placeholder admin keys that must never reach production. */
const WEAK_ADMIN_KEYS = new Set([
  'change-me-admin-key',
  'change-me',
  'changeme',
  'admin',
  'secret',
  'password',
  'default',
  'test',
])

const MIN_PROD_ADMIN_KEY_LENGTH = 20

/** Count distinct character classes (lower/upper/digit/symbol) present in a key. */
function charClassCount(value: string): number {
  return [/[a-z]/, /[A-Z]/, /[0-9]/, /[^a-zA-Z0-9]/].filter((re) => re.test(value)).length
}

/**
 * Reject weak ADMIN_API_KEY values in production. Placeholder values are public,
 * so we echo them; length/entropy failures report only metadata to avoid leaking a
 * real (if weak) secret.
 */
function assertStrongAdminKeyInProd(env: { NODE_ENV: string; ADMIN_API_KEY: string }, ctx: z.RefinementCtx): void {
  if (env.NODE_ENV !== 'production') return
  const key = env.ADMIN_API_KEY
  if (WEAK_ADMIN_KEYS.has(key.toLowerCase())) {
    ctx.addIssue({
      code: 'custom',
      path: ['ADMIN_API_KEY'],
      message: `ADMIN_API_KEY is a known placeholder ("${key}") — set a strong unique secret in production`,
    })
    return
  }
  if (key.length < MIN_PROD_ADMIN_KEY_LENGTH) {
    ctx.addIssue({
      code: 'custom',
      path: ['ADMIN_API_KEY'],
      message: `ADMIN_API_KEY must be at least ${MIN_PROD_ADMIN_KEY_LENGTH} characters in production (got ${key.length})`,
    })
  }
  if (charClassCount(key) < 2) {
    ctx.addIssue({
      code: 'custom',
      path: ['ADMIN_API_KEY'],
      message: 'ADMIN_API_KEY must mix at least two character types (letters, digits, symbols) in production',
    })
  }
}

const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
    HOST: z.string().default('0.0.0.0'),
    PORT: z.coerce.number().int().positive().default(3000),
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
    ADMIN_API_KEY: z.string().min(16, 'ADMIN_API_KEY must be at least 16 characters'),
    DATABASE_URL: z.string().url(),

    // Postgres pool tuning. Timeouts accept 0 to disable (wait indefinitely / no idle reap).
    DB_POOL_MAX: z.coerce.number().int().positive().default(20),
    DB_CONNECTION_TIMEOUT_MS: z.coerce.number().int().nonnegative().default(5000),
    DB_IDLE_TIMEOUT_MS: z.coerce.number().int().nonnegative().default(10_000),
    DB_STATEMENT_TIMEOUT_MS: z.coerce.number().int().nonnegative().default(30_000),

    AUTO_CONNECT_ON_BOOT: boolFromString.default(true),
    RECONNECT_MAX_ATTEMPTS: z.coerce.number().int().positive().default(10),
    WEBHOOK_TIMEOUT_MS: z.coerce.number().int().positive().default(5000),
    VOIP_MAX_CONCURRENT_CALLS: z.coerce.number().int().positive().default(10),
    VOIP_END_CALL_ON_WS_CLOSE: boolFromString.default(false),
    /**
     * Emit WhatsApp Web WAM (`w:stats`) telemetry via `@zapo-js/wam` for wire
     * parity / anti-fingerprinting. Off only when you explicitly want a quieter
     * headless footprint. Does not affect messaging, media, or VoIP APIs.
     */
    WAM_ENABLED: boolFromString.default(true),
    MEDIA_TMP_DIR: z.string().default('/tmp/zapo-rest-media'),

    // History sync on first pair / reconnect
    HISTORY_SYNC_ENABLED: boolFromString.default(true),
    HISTORY_REQUIRE_FULL_SYNC: boolFromString.default(false),
    // Auto-download inbound media into object storage
    MEDIA_AUTO_DOWNLOAD: boolFromString.default(true),

    // Redis (optional — degrades to in-memory when unset)
    REDIS_URL: z.string().optional(),

    /** Profile picture cache TTL (seconds). default 24h. 0 = disable cache. */
    PROFILE_PICTURE_CACHE_TTL_SECONDS: z.coerce.number().int().nonnegative().default(86_400),

    // Object storage: local  | s3 (works with MinIO / R2 / AWS S3)
    MEDIA_STORAGE: z.enum(['local', 's3']).default('local'),
    MEDIA_LOCAL_DIR: z.string().default('/tmp/zapo-rest-media/objects'),
    MEDIA_PUBLIC_BASE_URL: z.string().optional(),
    /**
     * Prefer 302 redirect to storage (presigned/public URL) for message media downloads.
     * Saves API bandwidth. Falls back to streaming through the API when no direct URL is possible.
     */
    MEDIA_REDIRECT_DOWNLOADS: boolFromString.default(true),
    /** Presigned GET TTL (seconds). Used for S3/MinIO redirects with original filename. */
    MEDIA_PRESIGN_TTL_SECONDS: z.coerce.number().int().positive().default(3600),

    S3_ENDPOINT: z.string().optional(),
    /** Public/browser-facing S3 endpoint for presigned URLs (e.g. http://localhost:19000). Defaults from S3_PUBLIC_URL origin. */
    S3_PRESIGN_ENDPOINT: z.string().optional(),
    S3_REGION: z.string().default('us-east-1'),
    S3_BUCKET: z.string().optional(),
    S3_ACCESS_KEY_ID: z.string().optional(),
    S3_SECRET_ACCESS_KEY: z.string().optional(),
    S3_FORCE_PATH_STYLE: boolFromString.default(true),
    S3_PUBLIC_URL: z.string().optional(),

    // Webhook worker
    WEBHOOK_WORKER_INTERVAL_MS: z.coerce.number().int().positive().default(2000),
    WEBHOOK_DEFAULT_ATTEMPTS: z.coerce.number().int().positive().default(5),

    /**
     * Comma-separated browser origins allowed by CORS (e.g. `https://app.example.com,http://localhost:5173`).
     * Use `*` to reflect any Origin.
     * When unset: development/test → allow any; production → CORS disabled (same-origin only).
     */
    CORS_ORIGINS: z.string().optional(),

    /**
     * App-level rate limit on `/v1/*`.
     * When unset: enabled only if `NODE_ENV=production`.
     * Set `true`/`false` to force.
     */
    RATE_LIMIT_ENABLED: boolFromString.optional(),
    /** Max requests per IP per time window for `/v1` (default 300). */
    RATE_LIMIT_MAX: z.coerce.number().int().positive().default(300),
    /** Rate limit window in milliseconds (default 60_000). */
    RATE_LIMIT_TIME_WINDOW_MS: z.coerce.number().int().positive().default(60_000),

    /**
     * Trust `X-Forwarded-*` from a reverse proxy (rate-limit / client IP).
     * Default true. Set false if the process is exposed directly (clients can spoof XFF).
     * Fastify also accepts a hop count via TRUST_PROXY_HOPS when trust is on.
     */
    TRUST_PROXY: boolFromString.default(true),
    /** When TRUST_PROXY is true: number of trusted proxy hops (default 1). */
    TRUST_PROXY_HOPS: z.coerce.number().int().positive().default(1),

    /** Max concurrent SSE connections process-wide (default 200). */
    SSE_MAX_CONNECTIONS: z.coerce.number().int().positive().default(200),
    /** Max concurrent SSE connections per API key / actor (default 10). */
    SSE_MAX_CONNECTIONS_PER_ACTOR: z.coerce.number().int().positive().default(10),

    /**
     * Debounce full mailbox import + LID reconcile after history_sync_chunk events (ms).
     * Each chunk still emits history.sync webhooks; bulk re-import coalesces.
     */
    HISTORY_IMPORT_DEBOUNCE_MS: z.coerce.number().int().nonnegative().default(30_000),

    /** Max concurrent inbound media downloads (live + history) process-wide. */
    MEDIA_DOWNLOAD_CONCURRENCY: z.coerce.number().int().positive().default(4),

    /** Max call PCM recording duration in seconds (default 2h). Further samples are dropped. */
    CALL_RECORDING_MAX_SECONDS: z.coerce.number().int().positive().default(7200),

    /** Speech-to-text transcription (Groq Whisper or OpenAI-compatible API). */
    STT_ENABLED: boolFromString.default(false),
    /** Base URL e.g. https://api.groq.com/openai */
    STT_API_URL: z.string().url().optional(),
    STT_API_KEY: z.string().optional(),
    /** Model name (defaults to whisper-large-v3 for Groq, whisper-1 for OpenAI). */
    STT_MODEL: z.string().optional(),
    /** Language hint for STT (ISO 639-1, e.g. pt, en, es). Omit for auto-detect. */
    STT_LANGUAGE: z.string().optional(),
    /** Sampling temperature (0–1). Default 0.5. */
    STT_TEMPERATURE: z.coerce.number().min(0).max(1).optional().default(0.5),
  })
  .superRefine(assertStrongAdminKeyInProd)

export type Env = z.infer<typeof envSchema>

let cached: Env | null = null

export function parseEnv(raw: NodeJS.ProcessEnv = process.env): Env {
  const result = envSchema.safeParse(raw)
  if (!result.success) {
    const details = result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')
    throw new Error(`Invalid environment: ${details}`)
  }
  cached = result.data
  return result.data
}

export function getEnv(): Env {
  if (!cached) {
    return parseEnv()
  }
  return cached
}

/** Test helper — clear cached env between tests */
export function resetEnvCache(): void {
  cached = null
}
