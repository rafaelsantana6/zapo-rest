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

describe('VoIP video events (voip 1.4)', () => {
  it('emits call.video_state flagging an upgrade request', async () => {
    const { client, webhooks } = await wiredManager()
    client.emit('voip_call_peer_video_state', { call, change: { state: 11, transactionId: 1 } })
    await vi.waitFor(() => expect(webhooks.emit).toHaveBeenCalled())
    expect(webhooks.emit.mock.calls[0]?.[1]).toBe('call.video_state')
    expect(webhooks.emit.mock.calls[0]?.[2]).toMatchObject({
      state: 11,
      stateName: 'upgrade_request_v2',
      upgradeRequested: true,
    })
  })

  it('does not flag a group upgrade request as answerable', async () => {
    const { client, webhooks } = await wiredManager()
    client.emit('voip_call_peer_video_state', { call, change: { state: 3 } })
    await vi.waitFor(() => expect(webhooks.emit).toHaveBeenCalled())
    expect(webhooks.emit.mock.calls[0]?.[2]).toMatchObject({ stateName: 'upgrade_request', upgradeRequested: false })
  })

  it('emits call.screen_share with its size', async () => {
    const { client, webhooks } = await wiredManager()
    client.emit('voip_call_screen_share', {
      call,
      participantJid: '111:2@lid',
      share: { state: 1, screenWidth: 1280, screenHeight: 720 },
    })
    await vi.waitFor(() => expect(webhooks.emit).toHaveBeenCalled())
    expect(webhooks.emit.mock.calls[0]?.[2]).toMatchObject({
      participantJid: '111:2@lid',
      sharing: true,
      stateName: 'started',
      screenWidth: 1280,
    })
  })
})

describe('VoIP failures and playback completion', () => {
  it('sanitizes call.error without guessing call identity', async () => {
    const { client, webhooks } = await wiredManager()
    client.emit(
      'voip_call_error',
      Object.assign(new Error('SRTP_KEY=private-secret'), { code: 'private-secret', key: 'private-secret' }),
    )
    await vi.waitFor(() => expect(webhooks.emit).toHaveBeenCalled())
    const [, event, payload] = webhooks.emit.mock.calls[0] ?? []
    expect(event).toBe('call.error')
    expect(payload).toMatchObject({ call: null, error: { code: 'VOIP_CALL_ERROR' } })
    expect(JSON.stringify(payload)).not.toContain('private-secret')
    expect(payload).not.toHaveProperty('stack')
  })

  it('emits call.audio_finished with the call snapshot', async () => {
    const { client, webhooks } = await wiredManager()
    client.emit('voip_call_outbound_audio_finished', call)
    await vi.waitFor(() => expect(webhooks.emit).toHaveBeenCalled())
    expect(webhooks.emit.mock.calls[0]?.[1]).toBe('call.audio_finished')
    expect(webhooks.emit.mock.calls[0]?.[2]).toMatchObject({ call: { callId: 'C1' } })
  })
})
