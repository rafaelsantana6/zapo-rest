/** zapo-rest event catalog for zapo-rest */
export const WEBHOOK_EVENTS = [
  'instance.qr',
  'instance.connection',
  'instance.paired',
  'instance.logged_out',
  'message',
  'message.any',
  /** Stage 2 after CAS store (stage 1 is `message` with mediaStage=meta) */
  'message.media.stored',
  'message.media.failed',
  'message.ack',
  'message.reaction',
  'message.revoked',
  'message.edited',
  'chat.update',
  'presence.update',
  'chatstate',
  'group.update',
  'call.incoming',
  'call.state',
  'call.ended',
  'history.sync',
  /** Group history bundle shared with this account after it joined. */
  'history.group',
  /** Own @handle changed on another device. */
  'profile.username',
  /** Contact/group avatar set/delete from WA picture notification */
  'contact.picture',
  // legacy aliases kept for backward compat
  'message.inbound',
] as const

export type WebhookEventName = (typeof WEBHOOK_EVENTS)[number] | string

export type RetryPolicy = 'linear' | 'exponential' | 'constant'

export type WebhookCustomHeader = { name: string; value: string }

export type WebhookConfigRecord = {
  id: string
  instanceName: string
  url: string
  events: string[]
  hmacKey: string | null
  retriesPolicy: RetryPolicy
  retriesDelaySeconds: number
  retriesAttempts: number
  customHeaders: WebhookCustomHeader[]
  enabled: boolean
  createdAt: Date
  updatedAt: Date
}

export type CreateWebhookInput = {
  url: string
  events?: string[]
  hmacKey?: string | null
  retries?: {
    policy?: RetryPolicy
    delaySeconds?: number
    attempts?: number
  }
  customHeaders?: WebhookCustomHeader[]
  enabled?: boolean
}

export type WebhookPayloadEnvelope = {
  id: string
  event: string
  instance: string
  timestamp: number
  engine: 'zapo'
  payload: unknown
}

/**
 * Public API shape — never re-echo the HMAC secret (write-only).
 * Clients set `hmac.key` on create/update; list/get only show `configured`.
 */
export function toPublicWebhook(w: WebhookConfigRecord) {
  return {
    id: w.id,
    url: w.url,
    events: w.events,
    hmac: w.hmacKey ? { configured: true as const } : null,
    retries: {
      policy: w.retriesPolicy,
      delaySeconds: w.retriesDelaySeconds,
      attempts: w.retriesAttempts,
    },
    customHeaders: w.customHeaders,
    enabled: w.enabled,
    createdAt: w.createdAt.toISOString(),
    updatedAt: w.updatedAt.toISOString(),
  }
}
