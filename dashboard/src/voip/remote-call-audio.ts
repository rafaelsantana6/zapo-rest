import { WaWebCallAudio, type WaCallAudioSink } from '@zapo-js/voip-media/web'
import type { SoftphoneAudioPrefs } from './audio-settings'

const stopTracks = (stream: MediaStream | null) => {
  for (const track of stream?.getTracks() ?? []) track.stop()
}

/** Owns devices passed to the upstream adapter; it only releases devices it acquires itself. */
export class RemoteCallAudio {
  private readonly context: AudioContext
  private adapter: WaWebCallAudio | null = null
  private microphone: MediaStream | null = null
  private stopped = false
  private inputGeneration = 0
  private outputChange: Promise<void> = Promise.resolve()
  private readonly initialized: Promise<void>

  constructor(sink: WaCallAudioSink, prefs: SoftphoneAudioPrefs) {
    // Both resume and the selected microphone request start inside the click gesture.
    // Use the device rate, so Firefox can attach its microphone to the supplied context.
    this.context = new AudioContext()
    const resumed = this.context.resume()
    void resumed.catch(() => undefined)
    this.initialized = this.initialize(sink, prefs, resumed)
    void this.initialized.catch(() => this.stop())
  }

  private acquireMicrophone(prefs: SoftphoneAudioPrefs): Promise<MediaStream> {
    return navigator.mediaDevices.getUserMedia({
      audio: {
        ...(prefs.micId ? { deviceId: { exact: prefs.micId } } : {}),
        echoCancellation: prefs.echoCancellation,
        noiseSuppression: prefs.browserNoiseSuppression,
        autoGainControl: prefs.autoGainControl,
      },
    })
  }

  private async initialize(sink: WaCallAudioSink, prefs: SoftphoneAudioPrefs, resumed: Promise<void>): Promise<void> {
    const microphone = await this.acquireMicrophone(prefs)
    if (this.stopped) {
      stopTracks(microphone)
      throw new Error('Mídia encerrada')
    }
    this.microphone = microphone
    await resumed
    if (this.stopped) throw new Error('Mídia encerrada')
    await this.setOutput(prefs.speakerId)
    if (this.stopped) throw new Error('Mídia encerrada')
    // The context was resumed and capture requested synchronously in the gesture.
    // With supplied devices, the adapter only attaches its graph here.
    const adapter = await WaWebCallAudio.start(sink, { audioContext: this.context, microphone })
    if (this.stopped) {
      await adapter.stop()
      throw new Error('Mídia encerrada')
    }
    this.adapter = adapter
  }

  ready(): Promise<void> {
    return this.initialized
  }

  async setMicrophone(prefs: SoftphoneAudioPrefs): Promise<void> {
    const generation = ++this.inputGeneration
    const microphone = await this.acquireMicrophone(prefs)
    if (this.stopped || generation !== this.inputGeneration) {
      stopTracks(microphone)
      return
    }
    try {
      await this.initialized
      if (this.stopped || generation !== this.inputGeneration || !this.adapter) {
        stopTracks(microphone)
        return
      }
      this.adapter.setMicrophone(microphone)
      stopTracks(this.microphone)
      this.microphone = microphone
    } catch (error) {
      stopTracks(microphone)
      throw error
    }
  }

  setOutput(deviceId: string): Promise<void> {
    const change = this.outputChange
      .catch(() => undefined)
      .then(async () => {
        if (this.stopped) return
        const context = this.context as AudioContext & { setSinkId?: (id: string) => Promise<void> }
        if (!context.setSinkId) {
          if (deviceId) throw new Error('Navegador sem seleção de saída de áudio')
          return
        }
        try {
          await context.setSinkId(deviceId)
        } catch (error) {
          if (!this.stopped) throw error
        }
      })
    this.outputChange = change
    return change
  }

  stop(): void {
    if (this.stopped) return
    this.stopped = true
    this.inputGeneration++
    stopTracks(this.microphone)
    this.microphone = null
    void this.adapter?.stop().catch(() => undefined)
    this.adapter = null
    if (this.context.state !== 'closed') void this.context.close().catch(() => undefined)
  }
}
