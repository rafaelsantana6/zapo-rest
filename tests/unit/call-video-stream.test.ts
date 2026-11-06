/**
 * attachCallVideoStream — H.264 bridge without real WebRTC (named fakes for socket + voip client).
 */
import { EventEmitter } from 'node:events'
import { describe, expect, it, vi } from 'vitest'
import { attachCallVideoStream, VIDEO_MAX_BUFFERED_BYTES } from '~/voip/call-video-stream'
import { decodeVideoFrame, encodeVideoFrame } from '~/voip/video-frame'
import { makeEnv } from '../helpers/fixtures'

const ADMIN_KEY = 'test-admin-api-key-min-16'
const env = makeEnv()
const IDR = new Uint8Array([0, 0, 0, 1, 0x65, 0xaa])
const DELTA = new Uint8Array([0, 0, 0, 1, 0x41, 0xbb])

class FakeVideoSocket extends EventEmitter {
  readonly OPEN = 1
  readyState = 1
  bufferedAmount = 0
  readonly sent: (string | Buffer)[] = []
  readonly closes: { code?: number; reason?: string }[] = []

  send(data: string | Buffer) {
    this.sent.push(data)
  }

  close(code?: number, reason?: string) {
    this.closes.push({ code, reason })
    this.readyState = 3
  }

  json() {
    return this.sent.filter((d): d is string => typeof d === 'string').map((d) => JSON.parse(d))
  }

  binary() {
    return this.sent.filter((d): d is Buffer => Buffer.isBuffer(d))
  }
}

class FakeVoipClient extends EventEmitter {
  readonly feedLiveVideo = vi.fn((_id: string, _data: Uint8Array, _ts: number) => 1)
  readonly voip: Record<string, unknown>

  constructor(calls: Record<string, unknown>[]) {
    super()
    this.voip = {
      getCall: (id: string) => calls.find((c) => c.callId === id) ?? null,
      getCalls: () => calls,
      feedLiveVideo: this.feedLiveVideo,
    }
  }
}

function videoCall(overrides: Record<string, unknown> = {}) {
  return {
    callId: 'Vid1',
    mediaType: 'video',
    stateData: { state: 'active', videoOff: false },
    ...overrides,
  }
}

async function attach(client: FakeVoipClient, callId = 'vid1') {
  const socket = new FakeVideoSocket()
  await attachCallVideoStream({
    // @ts-expect-error fake socket
    socket,
    // @ts-expect-error fake manager
    manager: { getClient: () => client },
    env,
    instanceName: 'sales-1',
    callId,
    apiKey: ADMIN_KEY,
    // @ts-expect-error admin key never hits the repo
    instanceRepo: { getByApiKey: vi.fn(async () => null) },
  })
  return socket
}

describe('attachCallVideoStream', () => {
  it('opens on an audio call, which can turn into video mid-call', async () => {
    const socket = await attach(
      new FakeVoipClient([videoCall({ mediaType: 'audio', stateData: { state: 'active', videoOff: true } })]),
    )
    expect(socket.closes).toEqual([])
    expect(socket.json()[0]).toMatchObject({ op: 'ready', mediaType: 'audio' })
  })

  it('closes 4404 when the call is unknown', async () => {
    const socket = await attach(new FakeVoipClient([]))
    expect(socket.closes[0]?.code).toBe(4404)
  })

  it('sends ready with codec + resolved callId (case-insensitive)', async () => {
    const socket = await attach(new FakeVoipClient([videoCall()]))
    expect(socket.json()[0]).toMatchObject({
      op: 'ready',
      callId: 'Vid1',
      codec: 'h264',
      format: 'annexb',
      headerBytes: 12,
      videoOff: false,
    })
  })

  it('feeds client frames into feedLiveVideo and ignores bad headers', async () => {
    const client = new FakeVoipClient([videoCall()])
    const socket = await attach(client)

    socket.emit('message', encodeVideoFrame({ keyFrame: true, timestampUs: 66_000, data: IDR }), true)
    socket.emit('message', Buffer.from([7, 7, 7]), true)

    expect(client.feedLiveVideo).toHaveBeenCalledTimes(1)
    const [id, data, ts] = client.feedLiveVideo.mock.calls[0] ?? []
    expect(id).toBe('Vid1')
    expect(Array.from(data ?? [])).toEqual(Array.from(IDR))
    expect(ts).toBe(66_000)
  })

  it('forwards peer frames with a clock starting at 0', async () => {
    const client = new FakeVoipClient([videoCall()])
    const socket = await attach(client)

    client.emit('voip_call_inbound_video', {
      call: { callId: 'Vid1' },
      frame: { timestamp: 500_000, keyFrame: true, data: IDR },
    })
    client.emit('voip_call_inbound_video', {
      call: { callId: 'Vid1' },
      frame: { timestamp: 503_000, keyFrame: false, data: DELTA },
    })
    client.emit('voip_call_inbound_video', {
      call: { callId: 'Other' },
      frame: { timestamp: 1, keyFrame: true, data: IDR },
    })

    const frames = socket.binary().map((b) => decodeVideoFrame(b))
    expect(frames.map((f) => [f?.keyFrame, f?.timestampUs])).toEqual([
      [true, 0],
      [false, 33_333],
    ])
  })

  it('gives each group sender its own stream, announced before its first frame', async () => {
    const client = new FakeVoipClient([videoCall({ groupJid: '1203@g.us' })])
    const socket = await attach(client)
    const emit = (ssrc: number, participantJid: string, keyFrame: boolean, timestamp: number) =>
      client.emit('voip_call_inbound_video', {
        call: { callId: 'Vid1' },
        participantJid,
        frame: { ssrc, timestamp, keyFrame, data: keyFrame ? IDR : DELTA },
      })

    emit(111, 'a:1@lid', true, 90_000)
    emit(222, 'b:1@lid', false, 5) // b has not sent a key frame yet: dropped
    emit(222, 'b:1@lid', true, 3005)
    emit(111, 'a:1@lid', false, 93_000)

    expect(socket.json().filter((m) => m.op === 'stream')).toEqual([
      { op: 'stream', callId: 'Vid1', streamId: 0, ssrc: 111, participantJid: 'a:1@lid' },
      { op: 'stream', callId: 'Vid1', streamId: 1, ssrc: 222, participantJid: 'b:1@lid' },
    ])
    const frames = socket.binary().map((b) => decodeVideoFrame(b))
    // Each stream runs its own clock from 0
    expect(frames.map((f) => [f?.streamId, f?.keyFrame, f?.timestampUs])).toEqual([
      [0, true, 0],
      [1, true, 0],
      [0, false, 33_333],
    ])
  })

  it('retires a group sender that left, and never reuses its stream id', async () => {
    const client = new FakeVoipClient([videoCall({ groupJid: '1203@g.us' })])
    const socket = await attach(client)
    const frame = (ssrc: number, participantJid: string) =>
      client.emit('voip_call_inbound_video', {
        call: { callId: 'Vid1' },
        participantJid,
        frame: { ssrc, timestamp: 1, keyFrame: true, data: IDR },
      })

    frame(111, '111:2@lid')
    frame(222, '222:1@lid')
    client.emit('voip_call_participants_changed', {
      call: { callId: 'Vid1' },
      diff: { removed: [{ jid: '111@lid' }], switched: [], devicesRemoved: [] },
    })
    frame(333, '111:3@lid') // came back on another device

    const control = socket.json().filter((m) => m.op === 'stream' || m.op === 'stream_end')
    expect(control.map((m) => [m.op, m.streamId])).toEqual([
      ['stream', 0],
      ['stream', 1],
      ['stream_end', 0],
      ['stream', 2],
    ])
  })

  it('replaces the stream when a 1:1 peer switches SSRC', async () => {
    const client = new FakeVoipClient([videoCall()])
    const socket = await attach(client)
    for (const ssrc of [10, 20]) {
      client.emit('voip_call_inbound_video', {
        call: { callId: 'Vid1' },
        frame: { ssrc, timestamp: 1, keyFrame: true, data: IDR },
      })
    }
    const control = socket.json().filter((m) => m.op === 'stream' || m.op === 'stream_end')
    expect(control.map((m) => [m.op, m.streamId])).toEqual([
      ['stream', 0],
      ['stream_end', 0],
      ['stream', 1],
    ])
  })

  it('reports an audio call that upgraded as video', async () => {
    const socket = await attach(
      new FakeVoipClient([videoCall({ mediaType: 'audio', stateData: { state: 'active', videoOff: false } })]),
    )
    expect(socket.json()[0]).toMatchObject({ op: 'ready', mediaType: 'video' })
  })

  it('drops delta frames while the socket lags, resuming on the next key frame', async () => {
    const client = new FakeVoipClient([videoCall()])
    const socket = await attach(client)
    const emit = (keyFrame: boolean, timestamp: number) =>
      client.emit('voip_call_inbound_video', {
        call: { callId: 'Vid1' },
        frame: { timestamp, keyFrame, data: keyFrame ? IDR : DELTA },
      })

    socket.bufferedAmount = VIDEO_MAX_BUFFERED_BYTES + 1
    emit(false, 0)
    emit(true, 1500) // even key frames wait while over the cap
    socket.bufferedAmount = 0
    emit(false, 3000) // still waiting for IDR
    emit(true, 6000)
    emit(false, 9000)

    expect(socket.binary().map((b) => decodeVideoFrame(b)?.keyFrame)).toEqual([true, false])
  })

  it('attaches no listeners when the client hung up during auth', async () => {
    const client = new FakeVoipClient([videoCall()])
    const socket = new FakeVideoSocket()
    socket.readyState = 3
    await attachCallVideoStream({
      // @ts-expect-error fake socket
      socket,
      // @ts-expect-error fake manager
      manager: { getClient: () => client },
      env,
      instanceName: 'sales-1',
      callId: 'Vid1',
      apiKey: ADMIN_KEY,
      // @ts-expect-error admin key never hits the repo
      instanceRepo: { getByApiKey: vi.fn(async () => null) },
    })
    expect(client.listenerCount('voip_call_inbound_video')).toBe(0)
    expect(socket.sent).toHaveLength(0)
  })

  it('pushes peer videoOff on state and unsubscribes on close', async () => {
    const client = new FakeVoipClient([videoCall()])
    const socket = await attach(client)

    client.emit('voip_call_state', { callId: 'Vid1', isActive: true, stateData: { state: 'active', videoOff: true } })
    expect(socket.json().at(-1)).toMatchObject({ op: 'state', videoOff: true, isActive: true })

    socket.emit('close')
    expect(client.listenerCount('voip_call_inbound_video')).toBe(0)
    expect(client.listenerCount('voip_call_state')).toBe(0)
    expect(client.listenerCount('voip_call_ended')).toBe(0)
  })

  it('sends ended and closes when the call ends', async () => {
    const client = new FakeVoipClient([videoCall()])
    const socket = await attach(client)
    client.emit('voip_call_ended', { callId: 'Vid1' })
    expect(socket.json().at(-1)).toMatchObject({ op: 'ended', callId: 'Vid1' })
    expect(socket.closes[0]?.code).toBe(1000)
  })
})
