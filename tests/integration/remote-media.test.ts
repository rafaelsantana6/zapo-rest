import { EventEmitter } from 'node:events'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import type { WebSocket } from 'ws'
import { realtimeBus } from '~/events/bus'
import {
  decodeCallMediaMessage,
  encodeCallMediaEvent,
  type CallMediaMessage,
  type CallMediaEvent,
} from '~/voip/media-wire'
import { setClientMediaMode } from '~/voip/media-mode'
import { buildTestApp, createInstance, type TestApp } from '../helpers/test-app'

const logs = vi.hoisted(() => ({ trace: vi.fn(), debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }))
vi.mock('~/lib/logger', () => ({ getLogger: () => logs }))

function privatePlan(token: string): CallMediaMessage {
  const material = { masterKey: new Uint8Array([1, 2, 3]), masterSalt: new Uint8Array([4, 5]) }
  return {
    v: 1,
    callId: 'SAME-ID',
    seq: 2,
    full: true,
    plan: {
      keys: { epoch: 1, send: material, recv: material },
      relays: {
        endpoints: [{ ip: '203.0.113.1', port: 3478, relayId: 1, token, key: token, rawToken: new Uint8Array([8, 9]) }],
      },
    },
  }
}
/** Named upstream fake: each instance owns a distinct plan, even with equal call ids. */
function fakeRemoteClient(token: string) {
  const call = { callId: 'SAME-ID', stateData: { state: 'active' } }
  const message = privatePlan(token)
  const client = Object.assign(new EventEmitter(), {
    voip: {
      getCall: (id: string) => (id === call.callId ? call : null),
      getCalls: () => [call],
      setExternalAudioMode: vi.fn(),
      media: {
        snapshot: vi.fn((id: string) => (id === call.callId ? message : null)),
        handleEvent: vi.fn((_event: CallMediaEvent) => undefined),
      },
    },
  })
  setClientMediaMode(client, 'remote')
  return { client, call, message }
}
function collector() {
  const seen: Record<string, unknown>[] = []
  return {
    seen,
    listen: (ws: WebSocket) => ws.on('message', (raw) => seen.push(JSON.parse(String(raw)))),
    next: (predicate: (frame: Record<string, unknown>) => boolean) =>
      vi.waitFor(() => {
        const frame = seen.find(predicate)
        if (!frame) throw new Error('No matching frame')
        return frame
      }),
  }
}

describe('private remote media control transport', () => {
  let ctx: TestApp
  let ws: WebSocket
  let otherWs: WebSocket
  let apiKey = ''
  const first = fakeRemoteClient('FIRST-SECRET')
  const other = fakeRemoteClient('OTHER-SECRET')
  const frames = collector()
  const otherFrames = collector()
  beforeAll(async () => {
    ctx = await buildTestApp()
    ctx.env.VOIP_MEDIA_MODE = 'remote'
    apiKey = (await createInstance(ctx.app, 'remote-first')).apiKey
    const otherKey = (await createInstance(ctx.app, 'remote-other')).apiKey
    const getClient = (name: string) => (name === 'remote-first' ? first.client : other.client) as never
    vi.spyOn(ctx.manager, 'getClient').mockImplementation(getClient)
    vi.spyOn(ctx.manager, 'requireRegisteredClient').mockImplementation(getClient)
    ws = await ctx.app.injectWS(`/v1/voip?apiKey=${apiKey}`, {}, { onInit: frames.listen })
    otherWs = await ctx.app.injectWS(`/v1/voip?apiKey=${otherKey}`, {}, { onInit: otherFrames.listen })
    await frames.next((f) => f.op === 'call:media')
    await otherFrames.next((f) => f.op === 'call:media')
  })
  afterAll(async () => {
    ws?.terminate()
    otherWs?.terminate()
    await ctx.app.close()
  })

  it('sends late-join snapshots with the real binary wire codec to the owning instance only', () => {
    const plan = frames.seen.find((f) => f.op === 'call:media')
    expect(decodeCallMediaMessage(String(plan?.message))).toEqual(first.message)
    expect(JSON.stringify(frames.seen)).not.toContain('OTHER-SECRET')
    expect(JSON.stringify(otherFrames.seen)).not.toContain('FIRST-SECRET')
    expect(frames.seen.find((f) => f.op === 'ready')).toMatchObject({ mediaMode: 'remote' })
  })
  it('rejects cross-instance attach and keeps the original private binding', async () => {
    ws.send(JSON.stringify({ op: 'instance:attach', id: 'cross-attach', instance: 'remote-other' }))
    expect(await frames.next((f) => f.id === 'cross-attach')).toMatchObject({ ok: false })
    other.client.emit('voip_call_media', { call: other.call, message: other.message })
    ws.send(JSON.stringify({ op: 'ping', id: 'barrier' }))
    await frames.next((f) => f.id === 'barrier')
    expect(JSON.stringify(frames.seen)).not.toContain('OTHER-SECRET')
  })
  it('answers resync with a fresh snapshot', async () => {
    const count = frames.seen.filter((f) => f.op === 'call:media').length
    ws.send(
      JSON.stringify({
        op: 'call:media_event',
        id: 'resync',
        callId: 'SAME-ID',
        event: encodeCallMediaEvent({ v: 1, callId: 'SAME-ID', event: { type: 'resync', lastSeq: 0 } }),
      }),
    )
    expect(await frames.next((f) => f.id === 'resync')).toMatchObject({ ok: true })
    expect(frames.seen.filter((f) => f.op === 'call:media')).toHaveLength(count + 1)
    expect(first.client.voip.media.snapshot).toHaveBeenLastCalledWith('SAME-ID')
  })
  it('round-trips bigint host events and forwards relay_lost unchanged to upstream', async () => {
    const reaction: CallMediaEvent = {
      v: 1,
      callId: 'SAME-ID',
      event: { type: 'reaction', reaction: { reaction: '👍', transactionId: 77n } },
    }
    for (const [id, event] of [
      ['reaction', reaction],
      ['lost', { v: 1, callId: 'SAME-ID', event: { type: 'relay_lost', reason: 'all legs lost' } }],
    ] as const) {
      ws.send(JSON.stringify({ op: 'call:media_event', id, callId: 'SAME-ID', event: encodeCallMediaEvent(event) }))
      expect(await frames.next((f) => f.id === id)).toMatchObject({ ok: true })
      expect(first.client.voip.media.handleEvent).toHaveBeenLastCalledWith(event)
    }
    expect(other.client.voip.media.handleEvent).not.toHaveBeenCalled()
  })
  it.each([
    ['unknown-call', 'UNKNOWN', encodeCallMediaEvent({ v: 1, callId: 'UNKNOWN', event: { type: 'active' } })],
    ['mismatch', 'SAME-ID', encodeCallMediaEvent({ v: 1, callId: 'UNKNOWN', event: { type: 'active' } })],
    ['malformed', 'SAME-ID', '{"private":"DO-NOT-LOG"'],
  ])('rejects %s without logging its payload', async (id, callId, event) => {
    const count = first.client.voip.media.handleEvent.mock.calls.length
    ws.send(JSON.stringify({ op: 'call:media_event', id, callId, event }))
    expect(await frames.next((f) => f.id === id)).toMatchObject({ ok: false, code: 'INVALID_MEDIA_EVENT' })
    expect(first.client.voip.media.handleEvent).toHaveBeenCalledTimes(count)
    expect(JSON.stringify(Object.values(logs).map((log) => log.mock.calls))).not.toContain('DO-NOT-LOG')
  })
  it('never sends a private plan to the manager event bus, webhooks or logs', async () => {
    const webhooks = { emit: vi.fn() }
    const wired = ctx.manager as unknown as {
      wireEvents(name: string, session: unknown): void
      opts: { webhooks: unknown }
    }
    const original = wired.opts.webhooks
    wired.opts.webhooks = webhooks
    const leakClient = fakeRemoteClient('LEAK-SENTINEL')
    wired.wireEvents('remote-first', {
      client: leakClient.client,
      reconnectAttempt: 0,
      reconnectTimer: null,
      disposed: false,
    })
    const bus = vi.spyOn(realtimeBus, 'emitInstance')
    leakClient.client.emit('voip_call_media', { call: leakClient.call, message: leakClient.message })
    leakClient.client.emit('voip_call_participant_audio', {
      call: leakClient.call,
      participantJid: 'p@lid',
      pcm: new Float32Array([1]),
    })
    await new Promise<void>((resolve) => setImmediate(resolve))
    expect(bus).not.toHaveBeenCalled()
    expect(webhooks.emit).not.toHaveBeenCalled()
    expect(JSON.stringify(Object.values(logs).map((log) => log.mock.calls))).not.toContain('LEAK-SENTINEL')
    wired.opts.webhooks = original
    bus.mockRestore()
  })
  it('returns clear 409s for server-owned media features', async () => {
    for (const [url, payload] of [
      ['/v1/calls/SAME-ID/audio', { mediaBase64: 'YQ==' }],
      ['/v1/calls/blast', { to: '5511888888888', audioUrl: 'https://example.com/a.wav' }],
      ['/v1/calls/SAME-ID/transcribe', {}],
    ] as const) {
      const res = await ctx.app.inject({ method: 'POST', url, headers: { 'x-api-key': apiKey }, payload })
      expect(res.statusCode).toBe(409)
      expect(res.json().error.message).toContain('remote media mode')
    }
    const res = await ctx.app.inject({
      method: 'PUT',
      url: '/v1/settings/call-recording',
      headers: { 'x-api-key': apiKey },
      payload: { enabled: true },
    })
    expect(res.statusCode).toBe(409)
  })
  it.each(['stream', 'video'])('closes the local %s socket with 4409 in remote mode', async (path) => {
    const mediaWs = await ctx.app.injectWS(`/v1/calls/SAME-ID/${path}?apiKey=${apiKey}`)
    const closed = await new Promise<{ code: number; reason: string }>((resolve) =>
      mediaWs.once('close', (code, reason) => resolve({ code, reason: String(reason) })),
    )
    expect(closed).toMatchObject({ code: 4409, reason: expect.stringContaining('remote media mode') })
  })

  it('binds a client that connects after the control socket attached', async () => {
    const late = fakeRemoteClient('LATE-SECRET')
    const lateFrames = collector()
    const lateKey = (await createInstance(ctx.app, 'remote-late')).apiKey
    let available = false
    vi.mocked(ctx.manager.getClient).mockImplementation((name) => {
      if (name === 'remote-late') {
        if (!available) throw new Error('Not connected')
        return late.client as never
      }
      return (name === 'remote-first' ? first.client : other.client) as never
    })
    const lateWs = await ctx.app.injectWS(`/v1/voip?apiKey=${lateKey}`, {}, { onInit: lateFrames.listen })
    try {
      await lateFrames.next((f) => f.op === 'ready')
      expect(late.client.listenerCount('voip_call_media')).toBe(0)
      available = true
      lateWs.send(
        JSON.stringify({
          op: 'call:media_event',
          id: 'late-resync',
          callId: 'SAME-ID',
          event: encodeCallMediaEvent({ v: 1, callId: 'SAME-ID', event: { type: 'resync', lastSeq: null } }),
        }),
      )
      expect(await lateFrames.next((f) => f.id === 'late-resync')).toMatchObject({ ok: true })
      expect(decodeCallMediaMessage(String((await lateFrames.next((f) => f.op === 'call:media')).message))).toEqual(
        late.message,
      )
      expect(JSON.stringify(frames.seen)).not.toContain('LATE-SECRET')
    } finally {
      lateWs.terminate()
    }
  })

  it('rejects invalid keys before upgrade and never gives admin sockets a plan', async () => {
    await expect(ctx.app.injectWS('/v1/voip?apiKey=invalid-private-key')).rejects.toThrow('401')
    const adminFrames = collector()
    const adminWs = await ctx.app.injectWS(
      `/v1/voip?apiKey=${ctx.env.ADMIN_API_KEY}`,
      {},
      { onInit: adminFrames.listen },
    )
    await adminFrames.next((f) => f.op === 'error')
    expect(adminFrames.seen.some((f) => f.op === 'call:media')).toBe(false)
    adminWs.terminate()
  })

  it('relays live plan changes only to the owning socket, without logging them', async () => {
    const changed = { ...first.message, seq: 3 }
    first.client.emit('voip_call_media', { call: first.call, message: changed })
    const frame = await frames.next((f) => f.op === 'call:media' && decodeCallMediaMessage(String(f.message)).seq === 3)
    expect(decodeCallMediaMessage(String(frame.message))).toEqual(changed)
    expect(JSON.stringify(otherFrames.seen)).not.toContain('FIRST-SECRET')
    expect(JSON.stringify(Object.values(logs).map((log) => log.mock.calls))).not.toContain('FIRST-SECRET')
  })
  it('removes the plan listener when the socket closes', async () => {
    ws.terminate()
    await vi.waitFor(() => expect(first.client.listenerCount('voip_call_media')).toBe(0))
  })
})
