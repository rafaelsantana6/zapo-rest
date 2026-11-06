import { EventEmitter } from 'node:events'
import type pg from 'pg'
import { describe, expect, it, vi } from 'vitest'
import type { WaGroupEvent } from 'zapo-js'
import { parseEnv, resetEnvCache } from '~/config/env'
import { InstanceManager } from '~/instances/manager'
import type { WebhookDispatcher } from '~/webhooks/dispatcher'
import { MemoryInstanceRepo } from '../helpers/memory-repo'

/** Named fake: captures group webhook payloads without external delivery. */
function recordingGroupWebhooks() {
  return { emit: vi.fn(async (_row: unknown, _event: string, _data: unknown) => undefined) }
}

async function wiredGroupManager() {
  resetEnvCache()
  const repo = new MemoryInstanceRepo()
  repo.seed({ name: 'membership', apiKey: 'zr_test', status: 'open' })
  const webhooks = recordingGroupWebhooks()
  const manager = new InstanceManager({
    env: parseEnv(),
    pool: { query: async () => ({ rows: [], rowCount: 0 }) } as unknown as pg.Pool,
    // @ts-expect-error memory repo
    repo,
    webhooks: webhooks as unknown as WebhookDispatcher,
    dryRun: true,
  })
  const client = new EventEmitter()
  const wire = (manager as unknown as { wireEvents: (name: string, session: unknown) => void }).wireEvents
  wire.call(manager, 'membership', { client, reconnectAttempt: 0, reconnectTimer: null, disposed: false })
  return { client, webhooks }
}

function groupEvent(action: WaGroupEvent['action']): WaGroupEvent {
  return {
    action,
    groupJid: '120363000000000000@g.us',
    authorJid: '111@lid',
    timestampSeconds: 1793966400,
    rawNode: { tag: 'notification', attrs: {} },
    rawActionNode: { tag: action, attrs: {} },
  }
}

describe('group membership notifications', () => {
  it('emits a single join request with a type and requester JID', async () => {
    const { client, webhooks } = await wiredGroupManager()
    const event = { ...groupEvent('membership_approval_request'), requestMethod: 'invite_link' }
    client.emit('group', event)
    await vi.waitFor(() => expect(webhooks.emit).toHaveBeenCalled())
    expect(webhooks.emit.mock.calls[0]?.[1]).toBe('group.update')
    expect(webhooks.emit.mock.calls[0]?.[2]).toEqual({
      ...event,
      type: 'membership_approval_request',
      requesterJid: '111@lid',
    })
  })

  it('forwards every created request, including its alternate phone and username', async () => {
    const { client, webhooks } = await wiredGroupManager()
    const requests = [
      { jid: '111@lid', phoneJid: '5511999999999@s.whatsapp.net', username: 'someone' },
      { jid: '222@lid' },
    ]
    const event = { ...groupEvent('created_membership_requests'), membershipRequests: requests }
    client.emit('group', event)
    await vi.waitFor(() => expect(webhooks.emit).toHaveBeenCalled())
    expect(webhooks.emit.mock.calls[0]?.[1]).toBe('group.update')
    expect(webhooks.emit.mock.calls[0]?.[2]).toEqual({ ...event, type: 'created_membership_requests', requests })
  })

  it('forwards revoked identities from upstream participants', async () => {
    const { client, webhooks } = await wiredGroupManager()
    const event = { ...groupEvent('revoked_membership_requests'), participants: [{ jid: '111@lid' }] }
    client.emit('group', event)
    await vi.waitFor(() => expect(webhooks.emit).toHaveBeenCalled())
    expect(webhooks.emit.mock.calls[0]?.[2]).toEqual({
      ...event,
      type: 'revoked_membership_requests',
      requests: [{ jid: '111@lid' }],
    })
  })

  it('does not invent a requester when upstream omits its identity', async () => {
    const { client, webhooks } = await wiredGroupManager()
    client.emit('group', { ...groupEvent('membership_approval_request'), authorJid: undefined })
    await vi.waitFor(() => expect(webhooks.emit).toHaveBeenCalled())
    const payload = JSON.parse(JSON.stringify(webhooks.emit.mock.calls[0]?.[2]))
    expect(payload.type).toBe('membership_approval_request')
    expect(payload).not.toHaveProperty('requesterJid')
  })

  it('preserves unrelated group payloads', async () => {
    const { client, webhooks } = await wiredGroupManager()
    const event = { ...groupEvent('subject'), subject: 'New subject' }
    client.emit('group', event)
    await vi.waitFor(() => expect(webhooks.emit).toHaveBeenCalled())
    expect(webhooks.emit.mock.calls[0]?.[2]).toEqual(event)
  })
})
