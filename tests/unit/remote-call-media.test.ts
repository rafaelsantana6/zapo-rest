import { beforeAll, beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
type VideoHandles = { setScreenShare(value: boolean): Promise<boolean>; stop(): void }
type BrowserMedia = {
  ready(): Promise<void>
  setMuted(value: boolean): void
  setSpeakerId(id: string): Promise<void>
  stop(): void
  openVideo(local: unknown, container: unknown, onEnded: () => void): Promise<VideoHandles>
}
let RemoteCallMedia: new (options: {
  muted?: boolean
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
  setOutput: vi.fn(async (_id: string): Promise<void> => undefined),
  openCamera: vi.fn(),
  startSender: vi.fn(),
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
vi.mock('../../dashboard/src/voip/remote-call-audio', () => ({
  RemoteCallAudio: class FakeRemoteCallAudio {
    constructor(sink: typeof fake.sink) {
      fake.order.push('audio gesture')
      fake.sink = sink
    }
    ready() {
      return Promise.resolve()
    }
    setOutput = fake.setOutput
    stop() {
      void fake.audioStop()
    }
  },
}))
vi.mock('../../dashboard/src/voip/call-video', () => ({ openCamera: fake.openCamera }))
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
  WaWebCallVideoSender: { start: fake.startSender },
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
function fakeVideoStream() {
  const track = {
    stop: vi.fn(),
    enabled: true,
    label: 'Fake camera',
    onended: null,
    getSettings: () => ({ deviceId: 'camera' }),
  }
  return { track, getTracks: () => [track], getVideoTracks: () => [track] }
}
function fakeVideoSender() {
  return {
    replaceTrack: vi.fn(async (): Promise<void> => undefined),
    stop: vi.fn(async () => undefined),
    stats: { framesEncoded: 1, framesSent: 1 },
  }
}
function pending<T>() {
  let resolve: ((value: T) => void) | undefined
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve: (value: T) => resolve?.(value) }
}
beforeEach(() => {
  fake.openCamera.mockResolvedValue(fakeVideoStream())
  fake.startSender.mockResolvedValue(fakeVideoSender())
  fake.sink = null
  fake.onFrame = null
})
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

  it('starts muted before the first capture block when mute was retained by the softphone', async () => {
    vi.stubGlobal('window', { isSecureContext: true })
    const media = new RemoteCallMedia({ callId: 'MUTED', muted: true, prefs, onError: vi.fn(), onStats: vi.fn() })
    const pcm = new Float32Array([0.8, -0.5])
    fake.sink?.pushCapture(pcm)
    try {
      expect(pcm).toEqual(new Float32Array([0, 0]))
    } finally {
      media.stop()
    }
    await Promise.resolve()
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
  it.each(['replace', 'start'])('releases screen capture if hangup happens during sender %s', async (operation) => {
    vi.stubGlobal('window', { isSecureContext: true })
    vi.stubGlobal('VideoDecoder', class FakeVideoDecoder {})
    const screen = fakeVideoStream()
    vi.stubGlobal('navigator', { mediaDevices: { getDisplayMedia: vi.fn(async () => screen) } })
    const sender = fakeVideoSender()
    fake.startSender.mockResolvedValue(sender)
    if (operation === 'start') fake.openCamera.mockRejectedValueOnce(new Error('No camera'))
    const media = new RemoteCallMedia({ callId: 'SCREEN', prefs, onError: vi.fn(), onStats: vi.fn() })
    const preview = { srcObject: null, play: async () => undefined }
    const handles = await media.openVideo(preview, { append: vi.fn() }, vi.fn())
    const delayed = pending<ReturnType<typeof fakeVideoSender> | undefined>()
    if (operation === 'replace') sender.replaceTrack.mockReturnValueOnce(delayed.promise as Promise<void>)
    else fake.startSender.mockReturnValueOnce(delayed.promise)
    const sharing = handles.setScreenShare(true)
    await vi.waitFor(() => expect(operation === 'replace' ? sender.replaceTrack : fake.startSender).toHaveBeenCalled())
    media.stop()
    delayed.resolve(operation === 'start' ? sender : undefined)
    expect(await sharing).toBe(false)
    expect(screen.track.stop).toHaveBeenCalledOnce()
    expect(sender.stop).toHaveBeenCalledOnce()
    expect(preview.srcObject).not.toBe(screen)
  })

  it('applies the responsive remote-video class and closes rendered frames', async () => {
    vi.stubGlobal('window', { isSecureContext: true })
    vi.stubGlobal('VideoDecoder', class FakeVideoDecoder {})
    const canvas = { className: '', setAttribute: vi.fn(), getContext: () => ({ drawImage: vi.fn() }) }
    vi.stubGlobal('document', { createElement: () => canvas })
    const media = new RemoteCallMedia({ callId: 'VIDEO', prefs, onError: vi.fn(), onStats: vi.fn() })
    await media.openVideo({ srcObject: null, play: async () => undefined }, { append: vi.fn() }, vi.fn())
    const frame = { close: vi.fn(), displayWidth: 1920, displayHeight: 1080 }
    fake.onFrame?.(frame, 1)
    expect(canvas.className).toBe('softphone-video-remote')
    expect(frame.close).toHaveBeenCalledOnce()
    // Canvas removal is part of hangup cleanup.
    Object.assign(canvas, { remove: vi.fn() })
    media.stop()
  })

  it('reports output errors instead of rejecting the UI fire-and-forget operation', async () => {
    vi.stubGlobal('window', { isSecureContext: true })
    const onError = vi.fn()
    const media = new RemoteCallMedia({ prefs, onError, onStats: vi.fn() })
    fake.setOutput.mockRejectedValueOnce(new Error('Output denied'))
    await expect(media.setSpeakerId('unavailable')).resolves.toBeUndefined()
    expect(onError).toHaveBeenCalledWith(expect.stringContaining('saída de áudio'))
    media.stop()
  })
})
