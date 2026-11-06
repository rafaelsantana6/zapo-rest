import { EventEmitter } from 'node:events'
import type pg from 'pg'
import { describe, expect, it, vi } from 'vitest'
import type { WaIncomingNewsletterMessageUpdateEvent } from 'zapo-js'
import { parseEnv, resetEnvCache } from '~/config/env'
import { realtimeBus } from '~/events/bus'
import { InstanceManager } from '~/instances/manager'
import { WebhookDispatcher } from '~/webhooks/dispatcher'
import { WEBHOOK_EVENTS } from '~/webhooks/types'
import { NEWSLETTER_JID } from '../helpers/fake-newsletter'
import { MemoryInstanceRepo } from '../helpers/memory-repo'

/** Named pool fake: no database access is needed for wireEvents. */
function fakeNewsletterPool() {
  return { query: async () => ({ rows: [], rowCount: 0 }) } as unknown as pg.Pool
}
/** Named fake uses the real dispatcher's SSE path and records calls before delivery. */
function recordingNewsletterWebhooks() {
  const webhooks = new WebhookDispatcher({ env: parseEnv() })
  const emit = vi.spyOn(webhooks, 'emit')
  return { webhooks, emit }
}
async function wiredNewsletterManager() {
  resetEnvCache()
  const repo = new MemoryInstanceRepo()
  repo.seed({ name: 'channels', apiKey: 'zr_channels', status: 'open' })
  const { webhooks, emit } = recordingNewsletterWebhooks()
  const manager = new InstanceManager({
    env: parseEnv(),
    pool: fakeNewsletterPool(),
    // @ts-expect-error memory repo
    repo,
    webhooks,
    dryRun: true,
  })
  const client = new EventEmitter()
  const wire = (manager as unknown as { wireEvents: (name: string, session: unknown) => void }).wireEvents
  wire.call(manager, 'channels', { client, reconnectAttempt: 0, reconnectTimer: null, disposed: false })
  return { client, emit }
}

describe('newsletter events through InstanceManager.wireEvents', () => {
  it('emits newsletter.update through webhooks and SSE with a serialized payload', async () => {
    const { client, emit } = await wiredNewsletterManager()
    const seen: unknown[] = []
    const unsubscribe = realtimeBus.onInstance('channels', (event) => seen.push(event))
    try {
      client.emit('newsletter', {
        newsletterJid: NEWSLETTER_JID,
        action: 'subscribers_count_change',
        details: { count: 3n, nested: { raw: true } },
        rawNode: { tag: 'notification', attrs: {} },
      })
      await vi.waitFor(() => expect(emit).toHaveBeenCalledTimes(1))
      expect(emit.mock.calls[0]?.slice(1)).toEqual([
        'newsletter.update',
        { jid: NEWSLETTER_JID, action: 'subscribers_count_change', details: { count: '3' } },
      ])
      expect(seen).toMatchObject([
        { event: 'newsletter.update', data: { jid: NEWSLETTER_JID, details: { count: '3' } } },
      ])
      expect(WEBHOOK_EVENTS).toContain('newsletter.update')
    } finally {
      unsubscribe()
    }
  })
  it.each([
    {
      kind: 'edit',
      plaintext: new Uint8Array([1]),
      message: { imageMessage: { caption: 'New', fileLength: 9007199254740993n, mimetype: 'image/jpeg' } },
    },
    { kind: 'poll_vote', isSender: true, votes: [{ optionHash: new Uint8Array(32), count: 1 }] },
    { kind: 'revoke' },
    { kind: 'counters', views: 5 },
    { kind: 'reaction', isSender: false, revoked: true, reactions: [] },
  ] as const)('emits newsletter.message_update for $kind without raw protobuf or bigint', async (update) => {
    const { client, emit } = await wiredNewsletterManager()
    const seen: unknown[] = []
    const unsubscribe = realtimeBus.onInstance('channels', (event) => seen.push(event))
    try {
      client.emit('newsletter_message_update', {
        chatJid: NEWSLETTER_JID,
        parentMessageServerId: 42,
        timestampSeconds: 100,
        update,
        rawNode: { tag: 'message', attrs: {} },
      })
      await vi.waitFor(() => expect(emit).toHaveBeenCalledTimes(1))
      expect(emit.mock.calls[0]?.[1]).toBe('newsletter.message_update')
      expect(emit.mock.calls[0]?.[2]).toMatchObject({
        jid: NEWSLETTER_JID,
        serverId: 42,
        timestampSeconds: 100,
        update: { kind: update.kind },
      })
      const json = JSON.stringify(seen)
      expect(json).not.toMatch(/rawNode|plaintext|fileLength/)
      expect(seen).toMatchObject([{ event: 'newsletter.message_update' }])
      expect(WEBHOOK_EVENTS).toContain('newsletter.message_update')
    } finally {
      unsubscribe()
    }
  })
  it('keeps channel messages out of the legacy inbound event fallback', async () => {
    const { client, emit } = await wiredNewsletterManager()
    client.emit('message', { key: { remoteJid: NEWSLETTER_JID, id: 'S1' }, message: { conversation: 'Channel' } })
    // A queued channel update proves the preceding message handler finished.
    client.emit('newsletter_message_update', {
      chatJid: NEWSLETTER_JID,
      rawNode: { tag: 'message', attrs: {} },
      update: { kind: 'revoke' },
    } satisfies WaIncomingNewsletterMessageUpdateEvent)
    await vi.waitFor(() => expect(emit).toHaveBeenCalledTimes(1))
    expect(emit.mock.calls[0]?.[1]).toBe('newsletter.message_update')
  })
})
