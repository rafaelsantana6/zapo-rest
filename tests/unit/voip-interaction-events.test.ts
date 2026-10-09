import { EventEmitter } from 'node:events'
import type pg from 'pg'
import { describe, expect, it, vi } from 'vitest'
import { parseEnv, resetEnvCache } from '~/config/env'
import { InstanceManager } from '~/instances/manager'
import type { WebhookDispatcher } from '~/webhooks/dispatcher'
import { MemoryInstanceRepo } from '../helpers/memory-repo'

/** Named fake: records webhook emits instead of delivering them. */
function recordingWebhooks() {
  return { emit: vi.fn(async (_row: unknown, _event: string, _data: unknown) => undefined) }
}

async function wiredManager() {
  resetEnvCache()
  const repo = new MemoryInstanceRepo()
  repo.seed({ name: 'sales-1', apiKey: 'zr_test', status: 'open' })
  const webhooks = recordingWebhooks()
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
  wire.call(manager, 'sales-1', { client, reconnectAttempt: 0, reconnectTimer: null, disposed: false })
  return { client, webhooks }
}

const call = { callId: 'C1', peerJid: '5511888888888@s.whatsapp.net', stateData: { state: 'active' } }

describe('VoIP peer interaction events', () => {
  it('emits call.peer_mute with the call snapshot', async () => {
    const { client, webhooks } = await wiredManager()
    client.emit('voip_call_peer_mute', { call, muted: true })
    await vi.waitFor(() => expect(webhooks.emit).toHaveBeenCalled())
    const [, event, data] = webhooks.emit.mock.calls[0] ?? []
    expect(event).toBe('call.peer_mute')
    expect(data).toMatchObject({ muted: true, call: { callId: 'C1', state: 'active' } })
  })

  it('emits call.hand_raise with the participant', async () => {
    const { client, webhooks } = await wiredManager()
    client.emit('voip_call_hand_raise', { call, participantJid: '5511888888888:2@s.whatsapp.net', raised: true })
    await vi.waitFor(() => expect(webhooks.emit).toHaveBeenCalled())
    expect(webhooks.emit.mock.calls[0]?.[1]).toBe('call.hand_raise')
    expect(webhooks.emit.mock.calls[0]?.[2]).toMatchObject({
      participantJid: '5511888888888:2@s.whatsapp.net',
      raised: true,
    })
  })

  it('emits call.reaction with the glyph only (no bigint transaction id)', async () => {
    const { client, webhooks } = await wiredManager()
    client.emit('voip_call_reaction', { call, reaction: { transactionId: 7n, reaction: '🎉' } })
    await vi.waitFor(() => expect(webhooks.emit).toHaveBeenCalled())
    const data = webhooks.emit.mock.calls[0]?.[2] as Record<string, unknown>
    expect(webhooks.emit.mock.calls[0]?.[1]).toBe('call.reaction')
    expect(data.reaction).toBe('🎉')
    expect(() => JSON.stringify(data)).not.toThrow()
  })
})
