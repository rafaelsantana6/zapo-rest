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

  it('forwards the announcing device on call.peer_mute (voip 1.4)', async () => {
    const { client, webhooks } = await wiredManager()
    client.emit('voip_call_peer_mute', { call, muted: false, participantJid: '5511888888888:3@s.whatsapp.net' })
    await vi.waitFor(() => expect(webhooks.emit).toHaveBeenCalled())
    expect(webhooks.emit.mock.calls[0]?.[2]).toMatchObject({
      muted: false,
      participantJid: '5511888888888:3@s.whatsapp.net',
    })
  })

  it('emits instance.pairing_required with forceManual', async () => {
    const { client, webhooks } = await wiredManager()
    client.emit('auth_pairing_required', { forceManual: true })
    await vi.waitFor(() => expect(webhooks.emit).toHaveBeenCalled())
    expect(webhooks.emit.mock.calls[0]?.[1]).toBe('instance.pairing_required')
    expect(webhooks.emit.mock.calls[0]?.[2]).toEqual({ forceManual: true })
  })
})

describe('VoIP group call events (voip 1.4)', () => {
  it('emits call.participants_changed without key internals', async () => {
    const { client, webhooks } = await wiredManager()
    const joined = { jid: '111@lid', devices: ['111:2@lid'], state: 'connected', devicePids: { '111:2@lid': 0 } }
    client.emit('voip_call_participants_changed', {
      call,
      diff: {
        added: [joined],
        removed: [{ jid: '222@lid', participant: { jid: '222@lid', devices: [] }, cause: 'departed' }],
        switched: [],
        devicesAdded: [],
        devicesRemoved: [],
        rekeyRequired: true,
        rekeyReason: 'participant_added',
      },
    })
    await vi.waitFor(() => expect(webhooks.emit).toHaveBeenCalled())
    const [, event, data] = webhooks.emit.mock.calls[0] ?? []
    expect(event).toBe('call.participants_changed')
    expect(data).toMatchObject({
      added: [{ jid: '111@lid', devices: ['111:2@lid'], state: 'connected' }],
      removed: [{ jid: '222@lid', cause: 'departed' }],
    })
    expect(data).not.toHaveProperty('rekeyRequired')
  })

  it('emits call.mute_requested with a decoded flag', async () => {
    const { client, webhooks } = await wiredManager()
    client.emit('voip_call_mute_requested', { call, participantJid: '111:2@lid', requestState: '1' })
    await vi.waitFor(() => expect(webhooks.emit).toHaveBeenCalled())
    expect(webhooks.emit.mock.calls[0]?.[1]).toBe('call.mute_requested')
    expect(webhooks.emit.mock.calls[0]?.[2]).toMatchObject({ participantJid: '111:2@lid', muted: true })
  })

  it('emits call.participant_media', async () => {
    const { client, webhooks } = await wiredManager()
    client.emit('voip_call_participant_media', { call, participantJid: '111:2@lid', receiving: false })
    await vi.waitFor(() => expect(webhooks.emit).toHaveBeenCalled())
    expect(webhooks.emit.mock.calls[0]?.[1]).toBe('call.participant_media')
    expect(webhooks.emit.mock.calls[0]?.[2]).toMatchObject({ participantJid: '111:2@lid', receiving: false })
  })
})
