import {
  decodeCallMediaMessage,
  encodeCallMediaEvent,
  WaCallMediaReceiver,
  type WaCallMediaStats,
} from '@zapo-js/voip-media'
import { WaWebCallAudio, WaWebCallVideoReceiver, WaWebCallVideoSender, webMediaHost } from '@zapo-js/voip-media/web'
import type { SoftphoneAudioPrefs } from './audio-settings'
import type { CallAudioHandles } from './call-audio'
import { openCamera, type CallVideoHandles } from './call-video'
import { voipSocket } from './voip-socket'

/** One browser-owned media session. Construct in the dial/answer gesture, before any await. */
export class RemoteCallMedia implements CallAudioHandles {
  private receiver: WaCallMediaReceiver | null = null
  private starting: Promise<void> = Promise.resolve()
  private stopped = false
  private muted = false
  private micLevel = 0
  private callId: string | null = null
  private readonly unsubscribe: () => void
  private readonly audio: Promise<WaWebCallAudio>
  private readonly video: WaWebCallVideoReceiver | null
  private videoContainer: HTMLElement | null = null
  private readonly canvases = new Map<number, HTMLCanvasElement>()
  private sender: WaWebCallVideoSender | null = null
  private camera: MediaStream | null = null
  private screen: MediaStream | null = null
  private sourceVersion = 0

  constructor(
    private readonly options: {
      callId?: string
      prefs: SoftphoneAudioPrefs
      onError: (message: string) => void
      onStats: (stats: WaCallMediaStats) => void
    },
  ) {
    if (!window.isSecureContext) throw new Error('Mídia no navegador exige HTTPS ou localhost')
    this.video =
      typeof VideoDecoder === 'function'
        ? new WaWebCallVideoReceiver({
            hardwareAcceleration: 'prefer-software',
            onFrame: (frame, ssrc) => {
              try {
                if (this.stopped || !this.videoContainer) return
                let canvas = this.canvases.get(ssrc)
                if (!canvas) {
                  if (this.canvases.size >= 4) {
                    const oldest = this.canvases.keys().next().value
                    if (oldest !== undefined) {
                      this.canvases.get(oldest)?.remove()
                      this.canvases.delete(oldest)
                    }
                  }
                  canvas = document.createElement('canvas')
                  canvas.setAttribute('aria-label', 'Vídeo remoto')
                  this.videoContainer.append(canvas)
                  this.canvases.set(ssrc, canvas)
                }
                canvas.width = frame.displayWidth
                canvas.height = frame.displayHeight
                canvas.getContext('2d')?.drawImage(frame, 0, 0)
              } finally {
                frame.close()
              }
            },
            onError: () => options.onError('Falha no decoder de vídeo remoto; aguardando quadro chave'),
          })
        : null
    // Must precede audio/WASM initialization: plans can arrive while either awaits permission.
    this.unsubscribe = voipSocket.subscribe({
      onMediaMessage: (callId, encoded) => {
        if (this.stopped || (this.callId && this.callId !== callId)) return
        try {
          const message = decodeCallMediaMessage(encoded)
          if (message.callId !== callId) return
          this.bind(callId)
          void this.starting
            .then(() => (this.stopped ? undefined : this.receiver?.receive(message)))
            .catch(() => options.onError('Falha ao aplicar plano de mídia remoto'))
        } catch {
          options.onError('Plano de mídia remoto inválido')
        }
      },
      onConnection: (state) => {
        if (state === 'connected' && this.callId && this.receiver) this.resync()
      },
    })
    // The adapter creates and resumes AudioContext synchronously inside the click gesture.
    this.audio = WaWebCallAudio.start(
      {
        pushCapture: (samples, at) => {
          this.micLevel = Math.sqrt(
            samples.reduce((sum, sample) => sum + sample * sample, 0) / Math.max(1, samples.length),
          )
          if (this.muted) samples.fill(0)
          // Plane consumes synchronously; no reusable buffer reference is retained.
          this.receiver?.plane.pushCapture(samples, at)
        },
        pullPlayout: (out) => {
          if (!this.receiver || this.stopped) {
            out.fill(0)
            return 0
          }
          return this.receiver.plane.pullPlayout(out)
        },
      },
      { output: options.prefs.speakerId },
    )
    void this.audio
      .then((audio) => {
        if (this.stopped) void audio.stop()
      })
      .catch(() => {
        options.onError('Não foi possível abrir microfone/saída no navegador; verifique permissões e HTTPS')
        this.stop()
      })
    if (options.callId) this.bind(options.callId)
  }

  bind(callId: string): void {
    if (this.stopped || this.callId === callId) return
    if (this.callId) throw new Error('A mídia já pertence a outra chamada')
    this.callId = callId
    this.receiver = new WaCallMediaReceiver({
      ...webMediaHost,
      callId,
      mlowRed: voipSocket.mlowRed,
      send: (event) => voipSocket.sendMediaEvent(callId, encodeCallMediaEvent(event)),
      onInboundVideo: (frame) => this.video?.push(frame),
    })
    this.starting = this.receiver.start()
    void this.starting.catch(() => this.options.onError('Não foi possível carregar o codec MLow no navegador'))
    this.resync()
  }
  private resync() {
    if (this.callId)
      voipSocket.sendMediaEvent(
        this.callId,
        encodeCallMediaEvent({ v: 1, callId: this.callId, event: { type: 'resync', lastSeq: null } }),
      )
  }
  async ready(): Promise<void> {
    await this.audio
    await this.starting
    if (this.stopped) throw new Error('Mídia encerrada')
  }
  getMicLevel = () => this.micLevel
  setMuted = (muted: boolean) => {
    this.muted = muted
  }
  setPrefs = (_prefs: SoftphoneAudioPrefs) => {
    /* Browser echo cancellation/AGC owns remote audio processing. */
  }
  setSpeakerId = async (deviceId: string) => {
    await (await this.audio).setOutput(deviceId)
  }
  pushRemotePcm = (_buffer: ArrayBuffer) => {
    /* Remote media never uses server PCM. */
  }

  async openVideo(
    localVideo: HTMLVideoElement,
    container: HTMLElement,
    onScreenEnded: () => void,
  ): Promise<CallVideoHandles> {
    if (!this.video) throw new Error('Navegador sem WebCodecs; chamada segue só com áudio')
    if (!this.receiver || this.stopped) throw new Error('Mídia remota indisponível')
    const plane = this.receiver.plane
    this.videoContainer = container
    let cameraEnabled = true
    const setCamera = async (deviceId?: string) => {
      const generation = ++this.sourceVersion
      const camera = await openCamera(deviceId)
      if (this.stopped || generation !== this.sourceVersion) {
        camera.getTracks().forEach((t) => {
          t.stop()
        })
        return
      }
      const track = camera.getVideoTracks()[0]
      if (!track) {
        camera.getTracks().forEach((t) => {
          t.stop()
        })
        throw new Error('Câmera sem faixa de vídeo')
      }
      try {
        if (this.sender) await this.sender.replaceTrack(track)
        else
          this.sender = await WaWebCallVideoSender.start(plane, track, {
            bitrate: 350_000,
            keyFrameIntervalMs: 1000,
            frameRate: 15,
            onError: () => this.options.onError('Falha no encoder de vídeo do navegador'),
          })
      } catch (error) {
        camera.getTracks().forEach((t) => {
          t.stop()
        })
        throw error
      }
      if (this.stopped || generation !== this.sourceVersion) {
        await this.sender?.stop()
        camera.getTracks().forEach((t) => {
          t.stop()
        })
        return
      }
      this.camera?.getTracks().forEach((t) => {
        t.stop()
      })
      this.camera = camera
      track.enabled = cameraEnabled
      localVideo.srcObject = camera
      void localVideo.play().catch(() => undefined)
    }
    // Camera denial still leaves inbound video and screen sharing available.
    await setCamera(this.options.prefs.cameraId).catch(() =>
      this.options.onError('Câmera indisponível; áudio e vídeo recebido continuam ativos'),
    )
    const share = async (sharing: boolean): Promise<boolean> => {
      if (this.stopped) return false
      if (!sharing) {
        const cameraTrack = this.camera?.getVideoTracks()[0]
        if (cameraTrack) await this.sender?.replaceTrack(cameraTrack)
        this.screen?.getTracks().forEach((t) => {
          t.stop()
        })
        this.screen = null
        localVideo.srcObject = this.camera
        return true
      }
      // getDisplayMedia must be invoked before any await in the share-button gesture.
      const screen = await navigator.mediaDevices.getDisplayMedia({ video: true })
      if (this.stopped) {
        screen.getTracks().forEach((t) => {
          t.stop()
        })
        return false
      }
      const track = screen.getVideoTracks()[0]
      if (!track) {
        screen.getTracks().forEach((t) => {
          t.stop()
        })
        return false
      }
      try {
        if (this.sender) await this.sender.replaceTrack(track)
        else
          this.sender = await WaWebCallVideoSender.start(plane, track, {
            bitrate: 350_000,
            keyFrameIntervalMs: 1000,
          })
      } catch (error) {
        screen.getTracks().forEach((t) => {
          t.stop()
        })
        throw error
      }
      this.screen = screen
      localVideo.srcObject = screen
      track.onended = () => {
        if (!this.stopped) {
          void share(false)
          onScreenEnded()
        }
      }
      return true
    }
    return {
      setCameraEnabled: (enabled) => {
        cameraEnabled = enabled
        this.camera?.getVideoTracks().forEach((t) => {
          t.enabled = enabled
        })
      },
      setCamera: (id) => setCamera(id),
      currentCameraId: () => this.camera?.getVideoTracks()[0]?.getSettings().deviceId ?? null,
      setScreenShare: (sharing) => share(sharing).catch(() => false),
      getRemoteFrames: () => this.video?.stats.framesDecoded ?? 0,
      getOutboundStats: () => ({
        source: this.screen ? 'screen' : this.camera ? 'camera' : 'none',
        cameraLabel: this.camera?.getVideoTracks()[0]?.label ?? null,
        framesEncoded: this.sender?.stats.framesEncoded ?? 0,
        framesSent: this.sender?.stats.framesSent ?? 0,
        lastError: null,
      }),
      stop: () => this.stopVideo(),
    }
  }
  private stopVideo() {
    this.sourceVersion++
    void this.sender?.stop()
    this.sender = null
    this.screen?.getTracks().forEach((t) => {
      t.stop()
    })
    this.camera?.getTracks().forEach((t) => {
      t.stop()
    })
    this.screen = null
    this.camera = null
    this.videoContainer = null
    for (const canvas of this.canvases.values()) canvas.remove()
    this.canvases.clear()
  }
  stop = () => {
    if (this.stopped) return
    this.stopped = true
    this.unsubscribe()
    this.stopVideo()
    this.video?.close()
    void this.audio.then((audio) => audio.stop()).catch(() => undefined)
    const stats = this.receiver?.stop()
    if (stats) {
      console.info('Remote call media stats', stats)
      this.options.onStats(stats)
    }
    const receiver = this.receiver
    void this.starting.then(() => receiver?.stop()).catch(() => undefined)
    this.receiver = null
  }
}
