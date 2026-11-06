import { beforeAll, afterEach, describe, expect, it, vi } from 'vitest'
type BrowserMedia = { ready(): Promise<void>; setMuted(value: boolean): void; stop(): void }
let RemoteCallMedia: new (options: {
  callId?: string
  prefs: typeof prefs
  onError: (message: string) => void
  onStats: (stats: unknown) => void
}) => BrowserMedia
beforeAll(async () => {
  // Keep the browser DOM type graph out of the server's no-DOM tsconfig.
  const browserModule = '../../dashboard/src/voip/remote-call-media'
  const loaded = (await import(browserModule)) as { RemoteCallMedia: typeof RemoteCallMedia }
  RemoteCallMedia = loaded.RemoteCallMedia
})

const fake = vi.hoisted(() => ({
  order: [] as string[],
  handlers: null as { onMediaMessage: (callId: string, encoded: string) => void } | null,
  onFrame: null as ((frame: { close: () => void }, ssrc: number) => void) | null,
  unsubscribe: vi.fn(),
  audioStop: vi.fn(async () => undefined),
  sink: null as { pushCapture: (samples: Float32Array) => void } | null,
}))
vi.mock('../../dashboard/src/voip/voip-socket', () => ({
  voipSocket: {
    mlowRed: true,
    subscribe: (handlers: typeof fake.handlers) => {
      fake.order.push('listen')
      fake.handlers = handlers
      return fake.unsubscribe
    },
    sendMediaEvent: vi.fn(),
  },
}))
vi.mock('../../dashboard/node_modules/@zapo-js/voip-media/dist/esm/web/index.js', () => ({
  webMediaHost: {},
  WaWebCallAudio: {
    start: (sink: typeof fake.sink) => {
      fake.order.push('audio gesture')
      fake.sink = sink
      return Promise.resolve({ stop: fake.audioStop, setOutput: vi.fn() })
    },
  },
  WaWebCallVideoReceiver: class FakeVideoReceiver {
    constructor(options: { onFrame: NonNullable<typeof fake.onFrame> }) {
      fake.onFrame = options.onFrame
    }
    close = vi.fn()
  },
  WaWebCallVideoSender: class FakeVideoSender {},
}))

const prefs = {
  micId: '',
  speakerId: '',
  cameraId: '',
  noiseFilter: true,
  browserNoiseSuppression: true,
  echoCancellation: true,
  autoGainControl: true,
  micGain: 1,
}
afterEach(() => {
  vi.unstubAllGlobals()
  vi.clearAllMocks()
  fake.order.length = 0
})

describe('browser remote media lifecycle', () => {
  it('attaches the listener and opens audio before the first await, then stops once with real upstream stats', async () => {
    vi.stubGlobal('window', { isSecureContext: true })
    const onStats = vi.fn()
    const media = new RemoteCallMedia({ callId: 'BROWSER1', prefs, onError: vi.fn(), onStats })
    expect(fake.order).toEqual(['listen', 'audio gesture'])
    await media.ready()
    media.setMuted(true)
    const pcm = new Float32Array([1, -1])
    fake.sink?.pushCapture(pcm)
    expect(pcm).toEqual(new Float32Array([0, 0]))
    media.stop()
    media.stop()
    await Promise.resolve()
    expect(fake.unsubscribe).toHaveBeenCalledOnce()
    expect(fake.audioStop).toHaveBeenCalledOnce()
    expect(onStats).toHaveBeenCalledOnce()
    expect(onStats.mock.calls[0]?.[0]).toMatchObject({ audioSent: 0, srtpErrors: 0, decodeErrors: 0 })
  })
  it('closes inbound VideoFrames even before a canvas exists', () => {
    vi.stubGlobal('VideoDecoder', class FakeVideoDecoder {})
    vi.stubGlobal('window', { isSecureContext: true })
    const media = new RemoteCallMedia({ prefs, onError: vi.fn(), onStats: vi.fn() })
    const frame = { close: vi.fn() }
    fake.onFrame?.(frame, 1)
    expect(frame.close).toHaveBeenCalledOnce()
    media.stop()
  })
  it('requires a secure context before acquiring resources', () => {
    vi.stubGlobal('window', { isSecureContext: false })
    expect(() => new RemoteCallMedia({ prefs, onError: vi.fn(), onStats: vi.fn() })).toThrow('HTTPS')
    expect(fake.order).toEqual([])
  })
})
