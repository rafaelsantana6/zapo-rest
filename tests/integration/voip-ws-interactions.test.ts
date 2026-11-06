import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import type { WebSocket } from 'ws'
import { realtimeBus } from '~/events/bus'
import { buildTestApp, createInstance, type TestApp } from '../helpers/test-app'

const INSTANCE = 'sales-ws'

/** Named fake: one active call; reactions are refused while `reactionReady` is false. */
function fakeVoipSurface() {
  const call = { callId: 'CALL1', stateData: { state: 'active' } }
  const surface = {
    reactionReady: true,
    getCall: vi.fn((id: string) => (id === call.callId ? call : null)),
    getCalls: vi.fn(() => [call]),
    setHandRaised: vi.fn(async (_callId: string, _raised: boolean) => undefined),
    sendReaction: vi.fn((_callId: string, _reaction: string) => surface.reactionReady),
    leaveCall: vi.fn(async (_callId: string) => undefined),
    joinCall: vi.fn(async (_callId: string) => undefined),
    requestParticipantMute: vi.fn(async (_callId: string, _jid: string) => undefined),
  }
  return surface
}

/** Collects JSON frames and resolves the first one matching `pred`. */
function frameCollector() {
  const seen: Record<string, unknown>[] = []
  const listen = (ws: WebSocket) => ws.on('message', (raw) => seen.push(JSON.parse(String(raw))))
  const next = (pred: (f: Record<string, unknown>) => boolean) =>
    vi.waitFor(() => {
      const hit = seen.find(pred)
      if (!hit) throw new Error('frame not seen yet')
      return hit
    })
  return { listen, next }
}

describe('VoIP control WS: hand + reaction', () => {
  let ctx: TestApp
  let ws: WebSocket
  const { listen, next } = frameCollector()
  const voip = fakeVoipSurface()

  beforeAll(async () => {
    ctx = await buildTestApp()
    const { apiKey } = await createInstance(ctx.app, INSTANCE)
    vi.spyOn(ctx.manager, 'requireRegisteredClient').mockReturnValue({ voip } as never)
    // Listen before the upgrade completes: the server pushes `ready` right away.
    ws = await ctx.app.injectWS(`/v1/voip?apiKey=${apiKey}`, {}, { onInit: listen })
    await next((f) => f.op === 'ready')
  })

  afterAll(async () => {
    ws.terminate()
    await ctx.app.close()
  })

  it('acks call:hand and announces the hand', async () => {
    ws.send(JSON.stringify({ op: 'call:hand', id: 'h1', callId: 'call1', raised: true }))
    const ack = await next((f) => f.id === 'h1')
    expect(ack).toMatchObject({ op: 'ack', ok: true, data: { callId: 'CALL1', raised: true } })
    expect(voip.setHandRaised).toHaveBeenCalledWith('CALL1', true)
  })

  it('rejects call:hand without a boolean', async () => {
    ws.send(JSON.stringify({ op: 'call:hand', id: 'h2', callId: 'CALL1', raised: 'yes' }))
    expect(await next((f) => f.id === 'h2')).toMatchObject({ ok: false, code: 'INVALID_PAYLOAD' })
  })

  it('reports CALL_NOT_READY when the reaction channel is closed', async () => {
    voip.reactionReady = false
    ws.send(JSON.stringify({ op: 'call:reaction', id: 'r1', callId: 'CALL1', reaction: '👍' }))
    expect(await next((f) => f.id === 'r1')).toMatchObject({ ok: false, code: 'CALL_NOT_READY' })
    voip.reactionReady = true
  })

  it('forwards call.hand_raise from the bus as call:hand_raise', async () => {
    realtimeBus.emitInstance({
      instance: INSTANCE,
      event: 'call.hand_raise',
      eventId: 'E1',
      timestamp: new Date().toISOString(),
      data: { call: { callId: 'CALL1' }, participantJid: 'p@s.whatsapp.net', raised: true, op: 'spoof' },
    })
    const frame = await next((f) => f.eventId === 'E1')
    expect(frame).toMatchObject({ op: 'call:hand_raise', participantJid: 'p@s.whatsapp.net', raised: true })
  })

  it('acks call:leave and call:mute_participant on the resolved call', async () => {
    ws.send(JSON.stringify({ op: 'call:leave', id: 'l1', callId: 'call1' }))
    expect(await next((f) => f.id === 'l1')).toMatchObject({ ok: true, data: { callId: 'CALL1' } })
    expect(voip.leaveCall).toHaveBeenCalledWith('CALL1')
    ws.send(JSON.stringify({ op: 'call:mute_participant', id: 'm1', callId: 'CALL1', participant: '111@lid' }))
    expect(await next((f) => f.id === 'm1')).toMatchObject({ ok: true, data: { participant: '111@lid' } })
    expect(voip.requestParticipantMute).toHaveBeenCalledWith('CALL1', '111@lid')
  })

  it('reports a failed call:join as CALL_FAILED', async () => {
    voip.joinCall.mockRejectedValueOnce(new Error('no joinable call'))
    ws.send(JSON.stringify({ op: 'call:join', id: 'j1', callId: 'GONE' }))
    expect(await next((f) => f.id === 'j1')).toMatchObject({ ok: false, code: 'CALL_FAILED' })
  })
  it.each([
    ['call.error', 'call:error'],
    ['call.audio_finished', 'call:audio_finished'],
  ])('forwards %s on the instance control socket', async (event, op) => {
    realtimeBus.emitInstance({
      instance: INSTANCE,
      event,
      eventId: event,
      timestamp: new Date().toISOString(),
      data: { call: null, error: { message: 'Call failed', code: 'VOIP_CALL_ERROR' } },
    })
    expect(await next((f) => f.eventId === event)).toMatchObject({ op, call: null })
  })
})
