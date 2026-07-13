import { ulid } from 'ulid'
import type { Env } from '~/config/env'
import { realtimeBus } from '~/events/bus'
import type { InstanceRecord } from '~/instances/types'
import { getLogger } from '~/lib/logger'
import { assertPublicUrl } from '~/lib/ssrf-guard'
import type { CacheClient } from '~/redis/client'
import { cacheKey } from '~/redis/client'
import type { WebhookOutbox } from './outbox'
import { type WebhookConfigRepo, webhookMatchesEvent } from './repo'
import type { WebhookEventName, WebhookPayloadEnvelope } from './types'

export type WebhookEvent =
  | 'instance.qr'
  | 'instance.connection'
  | 'instance.paired'
  | 'instance.logged_out'
  | 'message.inbound'
  | 'message'
  | 'message.any'
  | 'message.media.stored'
  | 'message.media.failed'
  | 'message.ack'
  | 'message.reaction'
  | 'message.revoked'
  | 'message.edited'
  | 'chat.update'
  | 'presence.update'
  | 'chatstate'
  | 'group.update'
  | 'call.incoming'
  | 'call.state'
  | 'call.ended'
  | 'history.sync'
  | string

export type WebhookPayload = {
  event: WebhookEvent
  instance: string
  timestamp: string
  data: unknown
}

export type WebhookDispatcherDeps = {
  env: Pick<Env, 'WEBHOOK_TIMEOUT_MS' | 'WEBHOOK_DEFAULT_ATTEMPTS' | 'NODE_ENV'>
  webhookRepo?: WebhookConfigRepo
  outbox?: WebhookOutbox
  cache?: CacheClient
}

export class WebhookDispatcher {
  private readonly log = getLogger({ component: 'webhook' })
  private readonly env: Pick<Env, 'WEBHOOK_TIMEOUT_MS'> & {
    WEBHOOK_DEFAULT_ATTEMPTS?: number
    NODE_ENV?: Env['NODE_ENV']
  }
  private readonly allowHttp: boolean
  private readonly webhookRepo?: WebhookConfigRepo
  private readonly outbox?: WebhookOutbox
  private readonly cache?: CacheClient

  constructor(deps: WebhookDispatcherDeps | Pick<Env, 'WEBHOOK_TIMEOUT_MS'>) {
    // backward-compat: old constructor took env directly
    if ('env' in deps) {
      this.env = deps.env
      this.webhookRepo = deps.webhookRepo
      this.outbox = deps.outbox
      this.cache = deps.cache
    } else {
      this.env = deps
    }
    // Injected env wins; fall back to process env for the backward-compat path.
    this.allowHttp = (this.env.NODE_ENV ?? process.env.NODE_ENV) !== 'production'
  }

  /**
   * Emit event to realtime bus + configured webhooks (multi-URL multi-config).
   * Also honors legacy single webhook_url on the instance row.
   */
  async emit(instance: InstanceRecord, event: WebhookEventName, data: unknown): Promise<void> {
    const eventId = ulid()
    const sanitized = sanitizeForWebhook(data)
    const timestamp = new Date().toISOString()

    // Realtime (dashboard SSE GET /v1/events)
    realtimeBus.emitInstance({
      instance: instance.name,
      event,
      eventId,
      timestamp,
      data: sanitized,
    })

    // Redis pub/sub for multi-process (optional) — never fail emit on redis flap
    if (this.cache?.kind === 'redis') {
      try {
        await this.cache.publish(cacheKey('events', instance.name), {
          event,
          eventId,
          timestamp,
          data: sanitized,
        })
      } catch (err) {
        this.log.debug({ err, event, instance: instance.name }, 'redis publish skipped')
      }
    }

    const envelope: WebhookPayloadEnvelope = {
      id: eventId,
      event,
      instance: instance.name,
      timestamp: Date.now(),
      engine: 'zapo',
      payload: sanitized,
    }

    // Multi-webhook configs
    if (this.webhookRepo && this.outbox) {
      const matching = await this.webhookRepo.matching(instance.name, event)
      for (const wh of matching) {
        await this.outbox.enqueue(instance.name, wh, envelope)
      }
    }

    // Legacy single webhook on instance row (same filter rules as multi-config)
    if (instance.webhookUrl) {
      const allowed = instance.webhookEvents ?? []
      if (webhookMatchesEvent(allowed, event)) {
        if (this.outbox) {
          await this.outbox.enqueue(instance.name, null, envelope, {
            url: instance.webhookUrl,
            maxAttempts: this.env.WEBHOOK_DEFAULT_ATTEMPTS ?? 5,
          })
        } else {
          // fallback direct fire (tests / early boot)
          await this.fireDirect(instance.webhookUrl, envelope)
        }
      }
    }
  }

  private async fireDirect(url: string, envelope: WebhookPayloadEnvelope): Promise<void> {
    try {
      await assertPublicUrl(url, { allowHttp: this.allowHttp })
    } catch (err) {
      this.log.warn({ err, event: envelope.event }, 'webhook url blocked (non-public destination)')
      return
    }

    try {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), this.env.WEBHOOK_TIMEOUT_MS)
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(envelope),
        redirect: 'error',
        signal: controller.signal,
      })
      clearTimeout(timer)
      if (!res.ok) {
        this.log.warn({ status: res.status, event: envelope.event }, 'webhook non-2xx')
      }
    } catch (err) {
      this.log.warn({ err, event: envelope.event }, 'webhook delivery failed')
    }
  }
}

/** Drop huge binary fields from webhook payloads */
export function sanitizeForWebhook(data: unknown): unknown {
  if (data === null || data === undefined) return data
  if (typeof data !== 'object') return data
  if (Array.isArray(data)) return data.map(sanitizeForWebhook)
  if (data instanceof Uint8Array || Buffer.isBuffer(data)) {
    return { _type: 'binary', length: data.byteLength }
  }
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(data as Record<string, unknown>)) {
    if (k === 'rawNode' || k === 'messageBytes') continue
    out[k] = sanitizeForWebhook(v)
  }
  return out
}
