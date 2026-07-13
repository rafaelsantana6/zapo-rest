import type pg from 'pg'
import { ulid } from 'ulid'
import type { CreateWebhookInput, RetryPolicy, WebhookConfigRecord, WebhookCustomHeader } from './types'

type Row = {
  id: string
  instance_name: string
  url: string
  events: string[] | null
  hmac_key: string | null
  retries_policy: string
  retries_delay_seconds: number
  retries_attempts: number
  custom_headers: WebhookCustomHeader[] | unknown
  enabled: boolean
  created_at: Date
  updated_at: Date
}

function mapRow(row: Row): WebhookConfigRecord {
  const headers = Array.isArray(row.custom_headers) ? (row.custom_headers as WebhookCustomHeader[]) : []
  return {
    id: row.id,
    instanceName: row.instance_name,
    url: row.url,
    events: row.events ?? [],
    hmacKey: row.hmac_key,
    retriesPolicy: (row.retries_policy as RetryPolicy) ?? 'exponential',
    retriesDelaySeconds: row.retries_delay_seconds,
    retriesAttempts: row.retries_attempts,
    customHeaders: headers,
    enabled: row.enabled,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

/** Short-lived per-instance cache so high-frequency events don't hit the DB. */
type WebhookCacheEntry = { records: WebhookConfigRecord[]; expiresAt: number }
const WEBHOOK_CACHE_TTL_MS = 5000

export class WebhookConfigRepo {
  private readonly cache = new Map<string, WebhookCacheEntry>()

  constructor(
    private readonly pool: pg.Pool,
    private readonly cacheTtlMs = WEBHOOK_CACHE_TTL_MS,
  ) {}

  /**
   * List an instance's webhooks, served from a short-lived in-memory cache.
   * Every mutator invalidates the entry, so a read after a write is always
   * fresh; absent mutations the entry refreshes at most once per `cacheTtlMs`.
   * This keeps the per-event dispatch path (matching → list) from issuing a
   * SELECT for every presence/chatstate/message event.
   */
  async list(instanceName: string): Promise<WebhookConfigRecord[]> {
    const cached = this.cache.get(instanceName)
    if (cached && cached.expiresAt > Date.now()) return cached.records

    const { rows } = await this.pool.query<Row>(
      `SELECT * FROM instance_webhooks WHERE instance_name = $1 ORDER BY created_at ASC`,
      [instanceName],
    )
    const records = rows.map(mapRow)
    this.cache.set(instanceName, { records, expiresAt: Date.now() + this.cacheTtlMs })
    return records
  }

  private invalidate(instanceName: string): void {
    this.cache.delete(instanceName)
  }

  async get(instanceName: string, id: string): Promise<WebhookConfigRecord | null> {
    const { rows } = await this.pool.query<Row>(
      `SELECT * FROM instance_webhooks WHERE instance_name = $1 AND id = $2`,
      [instanceName, id],
    )
    return rows[0] ? mapRow(rows[0]) : null
  }

  async create(instanceName: string, input: CreateWebhookInput): Promise<WebhookConfigRecord> {
    const id = ulid()
    const { rows } = await this.pool.query<Row>(
      `INSERT INTO instance_webhooks (
        id, instance_name, url, events, hmac_key,
        retries_policy, retries_delay_seconds, retries_attempts,
        custom_headers, enabled
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10)
      RETURNING *`,
      [
        id,
        instanceName,
        input.url,
        input.events ?? [],
        input.hmacKey ?? null,
        input.retries?.policy ?? 'exponential',
        input.retries?.delaySeconds ?? 2,
        input.retries?.attempts ?? 5,
        JSON.stringify(input.customHeaders ?? []),
        input.enabled ?? true,
      ],
    )
    const row = rows[0]
    if (!row) throw new Error('upsert returned no row')
    this.invalidate(instanceName)
    return mapRow(row)
  }

  async update(
    instanceName: string,
    id: string,
    input: Partial<CreateWebhookInput>,
  ): Promise<WebhookConfigRecord | null> {
    const current = await this.get(instanceName, id)
    if (!current) return null

    const { rows } = await this.pool.query<Row>(
      `UPDATE instance_webhooks SET
        url = $3,
        events = $4,
        hmac_key = $5,
        retries_policy = $6,
        retries_delay_seconds = $7,
        retries_attempts = $8,
        custom_headers = $9::jsonb,
        enabled = $10,
        updated_at = now()
       WHERE instance_name = $1 AND id = $2
       RETURNING *`,
      [
        instanceName,
        id,
        input.url ?? current.url,
        input.events ?? current.events,
        input.hmacKey !== undefined ? input.hmacKey : current.hmacKey,
        input.retries?.policy ?? current.retriesPolicy,
        input.retries?.delaySeconds ?? current.retriesDelaySeconds,
        input.retries?.attempts ?? current.retriesAttempts,
        JSON.stringify(input.customHeaders ?? current.customHeaders),
        input.enabled ?? current.enabled,
      ],
    )
    this.invalidate(instanceName)
    return rows[0] ? mapRow(rows[0]) : null
  }

  async delete(instanceName: string, id: string): Promise<boolean> {
    const res = await this.pool.query(`DELETE FROM instance_webhooks WHERE instance_name = $1 AND id = $2`, [
      instanceName,
      id,
    ])
    this.invalidate(instanceName)
    return (res.rowCount ?? 0) > 0
  }

  /** Enabled webhooks that match the event (empty events = all). */
  async matching(instanceName: string, event: string): Promise<WebhookConfigRecord[]> {
    const all = await this.list(instanceName)
    return all.filter((w) => w.enabled && webhookMatchesEvent(w.events, event))
  }
}

/**
 * Whether a webhook's event filter includes `event`.
 * - empty list → all events
 * - `*` → all events
 * - exact name → that event
 * - `message.any` → only events whose name starts with `message` (not calls/presence/etc.)
 * - `message` → also media stage-2 (`message.media.stored` / `message.media.failed`)
 *   so subscribers that only list `message` still get the permanent storage URL
 */
export function webhookMatchesEvent(events: string[], event: string): boolean {
  if (events.length === 0) return true
  if (events.includes('*')) return true
  if (events.includes(event)) return true
  if (events.includes('message.any') && event.startsWith('message')) return true
  // Two-stage media: stage-1 is `message` (mediaStage=meta); stage-2 is media.*
  if (events.includes('message') && (event === 'message.media.stored' || event === 'message.media.failed')) {
    return true
  }
  return false
}
