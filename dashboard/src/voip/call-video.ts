/**
 * Live video bridge for the softphone (WebCodecs, no WebRTC):
 * - Source (camera or screen) → VideoEncoder (H.264 Constrained Baseline, Annex-B) → WS binary
 * - WS binary → one VideoDecoder + canvas per remote sender (stream id; several on a group call)
 *
 * The encoder runs whether or not a camera opens, and draws whatever source is current: a
 * camera that fails still leaves screen share and the peer's video working, and switching
 * camera or sharing the screen only swaps the source.
 *
 * The voip plugin asks the phone for a key frame (PLI/FIR) until one arrives, but our own
 * encoder never hears the phone's requests, so a lost packet spoils our video until our next
 * IDR. Settings below come from the call harness (`tests/e2e/video-call-quality.test.ts`):
 * vs. 600 kbps / 2 s GOP they cut Wi-Fi freezes 1.8 s → 0.8 s and keep 15 fps on a 450 kbps
 * uplink that used to show nothing.
 */

import { avcCodecFromAnnexB, decodeWireFrame, encodeWireFrame, type WireVideoFrame } from './video-frame'

const WIDTH = 480
const HEIGHT = 360
const FPS = 15
const BITRATE = 350_000
const KEY_FRAME_INTERVAL = FPS
/** Skip capture ticks when the socket or encoder is behind — stale video is worse than dropped video. */
const MAX_WS_BUFFERED = 1_000_000
const MAX_ENCODE_QUEUE = 2
const ENCODER_CODEC = 'avc1.42E01F'

export type OutboundVideoStats = {
  /** What the encoder is drawing right now. */
  source: 'camera' | 'screen' | 'none'
  cameraLabel: string | null
  framesEncoded: number
  /** Frames handed to the socket (or, in a camera test, encoded without one). */
  framesSent: number
  lastError: string | null
}

export type CallVideoHandles = {
  setCameraEnabled: (enabled: boolean) => void
  /** Switch to another camera mid-call; rejects (keeping the current one) when it cannot open. */
  setCamera: (deviceId: string) => Promise<void>
  /** Real device id of the camera in use, or null. */
  currentCameraId: () => string | null
  /** Encode the screen instead of the camera; resolves false when the user cancels the picker. */
  setScreenShare: (sharing: boolean) => Promise<boolean>
  /** Frames rendered from the peer since start. */
  getRemoteFrames: () => number
  getOutboundStats: () => OutboundVideoStats
  stop: () => void
}

export function isVideoCallSupported(): boolean {
  return typeof window !== 'undefined' && 'VideoEncoder' in window && 'VideoDecoder' in window
}

/** getUserMedia / getDisplayMedia error → message an operator can act on. */
export function describeMediaError(err: unknown, what: 'câmera' | 'tela'): string {
  const name = err instanceof DOMException ? err.name : ''
  if (name === 'NotAllowedError') return `Permissão de ${what} negada — libere no cadeado da barra de endereço`
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return `Nenhuma ${what} encontrada com essa seleção`
  if (name === 'NotReadableError') return `A ${what} está em uso por outro app ou indisponível`
  if (name === 'SecurityError' || !window.isSecureContext) return `A ${what} exige HTTPS ou localhost`
  return `${what} indisponível: ${err instanceof Error ? err.message : String(err)}`
}

export async function openCamera(deviceId?: string): Promise<MediaStream> {
  return navigator.mediaDevices.getUserMedia({
    video: {
      ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
      width: { ideal: WIDTH },
      height: { ideal: HEIGHT },
      frameRate: { ideal: FPS },
    },
  })
}

export async function startCallVideo(opts: {
  ws: WebSocket
  localVideo: HTMLVideoElement
  /** One canvas per remote sender is appended here. */
  remoteContainer: HTMLElement
  /** Camera to open; empty = browser default. */
  cameraId?: string
  onError?: (err: Error) => void
  /** Screen share ended from the browser's own "Stop sharing" bar. */
  onScreenShareEnded?: () => void
}): Promise<CallVideoHandles> {
  const { ws, localVideo, remoteContainer, onError, onScreenShareEnded } = opts
  if (!isVideoCallSupported()) throw new Error('Navegador sem WebCodecs (use Chrome/Edge recente) — vídeo indisponível')

  const report = (err: unknown) => onError?.(err instanceof Error ? err : new Error(String(err)))

  // Receive first: peer key frames arriving during the camera prompt must not be lost,
  // and a denied camera still shows the peer.
  const receiver = createReceivers(remoteContainer, report)
  const onMessage = (ev: MessageEvent) => {
    if (ev.data instanceof ArrayBuffer) receiver.push(ev.data)
    else if (typeof ev.data === 'string') receiver.control(ev.data)
  }
  ws.addEventListener('message', onMessage)

  const outbound = await createOutbound({
    localVideo,
    send: (key, ts, data) => {
      if (ws.readyState !== WebSocket.OPEN) return false
      ws.send(encodeWireFrame(key, ts, data))
      return true
    },
    backlogged: () => ws.bufferedAmount > MAX_WS_BUFFERED,
    report,
    onScreenShareEnded,
  }).catch((err: unknown) => {
    report(err)
    return null
  })
  // A camera that does not open is reported, but the call keeps receiving (and can share the screen)
  await outbound?.selectCamera(opts.cameraId).catch((err: unknown) => {
    report(new Error(`${describeMediaError(err, 'câmera')} — só recebendo vídeo`))
  })

  let stopped = false
  return {
    setCameraEnabled: (enabled) => outbound?.setEnabled(enabled),
    setCamera: (deviceId) => outbound?.selectCamera(deviceId) ?? Promise.reject(new Error('codificador indisponível')),
    currentCameraId: () => outbound?.currentCameraId() ?? null,
    setScreenShare: (sharing) => outbound?.setScreenShare(sharing) ?? Promise.resolve(false),
    getRemoteFrames: receiver.frameCount,
    getOutboundStats: () =>
      outbound?.stats() ?? {
        source: 'none',
        cameraLabel: null,
        framesEncoded: 0,
        framesSent: 0,
        lastError: 'codificador H.264 indisponível',
      },
    stop: () => {
      if (stopped) return
      stopped = true
      ws.removeEventListener('message', onMessage)
      receiver.stop()
      outbound?.stop()
    },
  }
}

/**
 * Camera check outside a call: opens `deviceId`, previews it in `video`, and runs the same
 * H.264 encoder the call uses, without sending anything. Read `stats()` to see frames encode.
 */
export async function startCameraTest(video: HTMLVideoElement, deviceId?: string) {
  if (!isVideoCallSupported()) throw new Error('Navegador sem WebCodecs (use Chrome/Edge recente)')
  let lastError: string | null = null
  const outbound = await createOutbound({
    localVideo: video,
    send: () => true,
    backlogged: () => false,
    report: (err) => {
      lastError = err instanceof Error ? err.message : String(err)
    },
  })
  try {
    await outbound.selectCamera(deviceId)
  } catch (err) {
    outbound.stop()
    throw new Error(describeMediaError(err, 'câmera'))
  }
  return {
    stats: (): OutboundVideoStats & { width: number; height: number } => ({
      ...outbound.stats(),
      lastError: outbound.stats().lastError ?? lastError,
      width: video.videoWidth,
      height: video.videoHeight,
    }),
    stop: () => outbound.stop(),
  }
}

type OutboundOpts = {
  localVideo: HTMLVideoElement
  /** Hand one access unit on; false when nothing could take it. */
  send: (keyFrame: boolean, timestampUs: number, data: Uint8Array) => boolean
  backlogged: () => boolean
  report: (err: unknown) => void
  onScreenShareEnded?: () => void
}

/** Encoder + swappable source (camera / screen) previewed in `localVideo`. */
async function createOutbound(opts: OutboundOpts) {
  const { localVideo, report, onScreenShareEnded } = opts
  let camera: MediaStream | null = null
  let screen: MediaStream | null = null
  /** What the user asked for, kept apart from the tracks so a camera opened later obeys it. */
  let cameraEnabled = true
  let pickingScreen = false
  let stopped = false
  let lastError: string | null = null
  const fail = (err: unknown) => {
    lastError = err instanceof Error ? err.message : String(err)
    report(err)
  }
  const sender = await createSender(localVideo, opts.send, opts.backlogged, fail)

  const stopStream = (stream: MediaStream | null) => {
    for (const t of stream?.getTracks() ?? []) t.stop()
  }
  // The encoder draws whatever <video> shows: swap its source, and restart on an IDR
  const show = (stream: MediaStream | null) => {
    localVideo.srcObject = stream
    localVideo.muted = true
    if (stream) void localVideo.play().catch(() => undefined)
    // Screen always sends; camera only while it is on (an off track would send black frames)
    sender.setEnabled(stream === screen ? true : cameraEnabled)
    sender.forceKeyFrame()
  }
  const leaveScreen = () => {
    stopStream(screen)
    screen = null
    show(camera)
  }

  /** A saved camera id goes stale (site data cleared, USB camera unplugged): fall back to the default. */
  const openPreferred = async (deviceId?: string) => {
    try {
      return await openCamera(deviceId)
    } catch (err) {
      const name = err instanceof DOMException ? err.name : ''
      if (deviceId && (name === 'OverconstrainedError' || name === 'NotFoundError')) return openCamera()
      throw err
    }
  }

  return {
    /** Opens `deviceId` first and only then drops the old camera, so a failed switch keeps video. */
    selectCamera: async (deviceId?: string) => {
      const next = await openPreferred(deviceId)
      // Stopped (call ended, test cancelled) while the camera was opening: do not leave it on
      if (stopped) {
        stopStream(next)
        return
      }
      for (const t of next.getVideoTracks()) t.enabled = cameraEnabled
      stopStream(camera)
      camera = next
      lastError = null
      if (!screen) show(camera)
    },
    /** Device id of the camera in use (the browser's default resolves to a real one). */
    currentCameraId: () => camera?.getVideoTracks()[0]?.getSettings().deviceId ?? null,
    setEnabled: (enabled: boolean) => {
      cameraEnabled = enabled
      for (const t of camera?.getVideoTracks() ?? []) t.enabled = enabled
      if (!screen) sender.setEnabled(enabled)
    },
    setScreenShare: async (sharing: boolean): Promise<boolean> => {
      if (!sharing) {
        if (screen) leaveScreen()
        return true
      }
      // One picker at a time
      if (screen || pickingScreen) return Boolean(screen)
      pickingScreen = true
      let picked: MediaStream
      try {
        picked = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: { ideal: FPS } }, audio: false })
      } catch (err) {
        // Cancelling the picker is not an error worth showing
        if (!(err instanceof DOMException && err.name === 'NotAllowedError'))
          fail(new Error(describeMediaError(err, 'tela')))
        return false
      } finally {
        pickingScreen = false
      }
      if (stopped) {
        stopStream(picked)
        return false
      }
      screen = picked
      picked.getVideoTracks()[0]?.addEventListener('ended', () => {
        if (screen !== picked) return
        leaveScreen()
        onScreenShareEnded?.()
      })
      show(screen)
      return true
    },
    stats: (): OutboundVideoStats => ({
      source: screen ? 'screen' : camera ? 'camera' : 'none',
      cameraLabel: camera?.getVideoTracks()[0]?.label || null,
      ...sender.counters(),
      lastError: lastError ?? sender.failure(),
    }),
    stop: () => {
      stopped = true
      sender.stop()
      stopStream(camera)
      stopStream(screen)
      camera = null
      screen = null
      localVideo.srcObject = null
    },
  }
}

async function createSender(
  source: HTMLVideoElement,
  send: OutboundOpts['send'],
  backlogged: () => boolean,
  report: (err: unknown) => void,
) {
  const config: VideoEncoderConfig = {
    codec: ENCODER_CODEC,
    width: WIDTH,
    height: HEIGHT,
    bitrate: BITRATE,
    framerate: FPS,
    // Flat rate: a phone's jitter buffer / weak uplink copes worse with bursts than with softer frames
    bitrateMode: 'constant',
    latencyMode: 'realtime',
    avc: { format: 'annexb' },
  }
  // Some encoders (e.g. certain hardware H.264) reject CBR — keep video working with VBR
  if (!(await VideoEncoder.isConfigSupported(config)).supported) config.bitrateMode = 'variable'
  const support = await VideoEncoder.isConfigSupported(config)
  if (!support.supported) throw new Error(`Codificador H.264 indisponível neste navegador (${ENCODER_CODEC})`)

  let framesEncoded = 0
  let framesSent = 0
  let frameIndex = 0
  let enabled = true
  let stopped = false
  /** Encoder errors in a row; past a few the encoder is given up and the status line says so. */
  let failures = 0
  const MAX_FAILURES = 3

  // A failed encoder is closed for good: build a fresh one, restarting on a key frame
  const build = (): VideoEncoder => {
    const next = new VideoEncoder({
      output: (chunk) => {
        failures = 0
        framesEncoded += 1
        const data = new Uint8Array(chunk.byteLength)
        chunk.copyTo(data)
        if (send(chunk.type === 'key', chunk.timestamp, data)) framesSent += 1
      },
      error: (err) => {
        failures += 1
        report(err)
        if (!stopped && failures < MAX_FAILURES) {
          encoder = build()
          frameIndex = 0
        }
      },
    })
    next.configure(config)
    return next
  }
  let encoder = build()

  const startedAt = performance.now()
  // Canvas pins the encoded size — camera / screen resolution may differ from WIDTH×HEIGHT
  const canvas = new OffscreenCanvas(WIDTH, HEIGHT)
  const ctx = canvas.getContext('2d')

  const tick = setInterval(() => {
    if (!enabled || !ctx || encoder.state !== 'configured') return
    if (source.readyState < HTMLMediaElement.HAVE_CURRENT_DATA || !source.videoWidth) return
    if (backlogged() || encoder.encodeQueueSize > MAX_ENCODE_QUEUE) return
    // Letterbox: a 16:9 screen must not be stretched into 4:3
    const scale = Math.min(WIDTH / source.videoWidth, HEIGHT / source.videoHeight)
    const w = Math.round(source.videoWidth * scale)
    const h = Math.round(source.videoHeight * scale)
    ctx.fillStyle = '#000'
    ctx.fillRect(0, 0, WIDTH, HEIGHT)
    ctx.drawImage(source, (WIDTH - w) / 2, (HEIGHT - h) / 2, w, h)
    const frame = new VideoFrame(canvas, { timestamp: Math.round((performance.now() - startedAt) * 1000) })
    try {
      encoder.encode(frame, { keyFrame: frameIndex % KEY_FRAME_INTERVAL === 0 })
      frameIndex += 1
    } catch (err) {
      report(err)
    } finally {
      frame.close()
    }
  }, 1000 / FPS)

  return {
    setEnabled: (next: boolean) => {
      // Resume with an IDR so the peer's decoder resyncs immediately
      if (next && !enabled) frameIndex = 0
      enabled = next
    },
    forceKeyFrame: () => {
      frameIndex = 0
    },
    counters: () => ({ framesEncoded, framesSent }),
    /** Set once the encoder failed too often to rebuild. */
    failure: () => (failures >= MAX_FAILURES ? 'codificador de vídeo parou — reabra a chamada' : null),
    stop: () => {
      stopped = true
      clearInterval(tick)
      if (encoder.state !== 'closed') encoder.close()
    },
  }
}

/** Decoders keyed by stream id; each sender gets its own canvas in `container`. */
function createReceivers(container: HTMLElement, report: (err: unknown) => void) {
  const streams = new Map<number, ReturnType<typeof createReceiver>>()
  const labels = new Map<number, string>()

  const streamFor = (id: number) => {
    const known = streams.get(id)
    if (known) return known
    const canvas = document.createElement('canvas')
    canvas.className = 'softphone-video-remote'
    const label = labels.get(id)
    if (label) canvas.title = label
    container.appendChild(canvas)
    const created = createReceiver(canvas, report)
    streams.set(id, created)
    return created
  }

  return {
    push: (buf: ArrayBuffer) => {
      const frame = decodeWireFrame(buf)
      if (frame) streamFor(frame.streamId).push(frame)
    },
    /** `stream` names a sender before its first frame; `stream_end` retires it (left, switched device). */
    control: (text: string) => {
      try {
        const msg = JSON.parse(text) as { op?: string; streamId?: number; participantJid?: string | null }
        if (typeof msg.streamId !== 'number') return
        if (msg.op === 'stream' && msg.participantJid) labels.set(msg.streamId, msg.participantJid)
        if (msg.op === 'stream_end') {
          const gone = streams.get(msg.streamId)
          gone?.stop()
          gone?.canvas.remove()
          streams.delete(msg.streamId)
          labels.delete(msg.streamId)
        }
      } catch {
        /* not ours */
      }
    },
    frameCount: () => [...streams.values()].reduce((n, s) => n + s.frameCount(), 0),
    stop: () => {
      for (const s of streams.values()) {
        s.stop()
        s.canvas.remove()
      }
      streams.clear()
    },
  }
}

function createReceiver(canvas: HTMLCanvasElement, report: (err: unknown) => void) {
  const ctx = canvas.getContext('2d')
  let decoder: VideoDecoder | null = null
  let frames = 0

  const reset = () => {
    if (decoder && decoder.state !== 'closed') decoder.close()
    decoder = null
  }

  const configure = (codec: string) => {
    const next = new VideoDecoder({
      output: (frame) => {
        if (canvas.width !== frame.displayWidth || canvas.height !== frame.displayHeight) {
          canvas.width = frame.displayWidth
          canvas.height = frame.displayHeight
        }
        ctx?.drawImage(frame, 0, 0)
        frame.close()
        frames += 1
      },
      error: (err) => {
        report(err)
        // Wait for the next key frame and rebuild
        reset()
      },
    })
    next.configure({ codec, optimizeForLatency: true })
    decoder = next
  }

  return {
    canvas,
    push: (frame: WireVideoFrame) => {
      if (!decoder) {
        if (!frame.keyFrame) return
        configure(avcCodecFromAnnexB(frame.data) ?? ENCODER_CODEC)
      }
      try {
        decoder?.decode(
          new EncodedVideoChunk({
            type: frame.keyFrame ? 'key' : 'delta',
            timestamp: frame.timestampUs,
            data: frame.data,
          }),
        )
      } catch (err) {
        report(err)
        reset()
      }
    },
    frameCount: () => frames,
    stop: reset,
  }
}
