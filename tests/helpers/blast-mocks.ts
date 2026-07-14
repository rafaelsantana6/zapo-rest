import { EventEmitter } from 'node:events'
import { vi } from 'vitest'
import { encodeResponseWav, TARGET_SAMPLE_RATE } from '~/voip/audio-decode'

/** Minimal 16-bit mono PCM WAV at 16 kHz. */
export function makePcm16Wav(n: number, sampleRate = TARGET_SAMPLE_RATE): Buffer {
  const dataBytes = n * 2
  const buf = Buffer.alloc(44 + dataBytes)
  buf.write('RIFF', 0)
  buf.writeUInt32LE(36 + dataBytes, 4)
  buf.write('WAVE', 8)
  buf.write('fmt ', 12)
  buf.writeUInt32LE(16, 16)
  buf.writeUInt16LE(1, 20)
  buf.writeUInt16LE(1, 22)
  buf.writeUInt32LE(sampleRate, 24)
  buf.writeUInt32LE(sampleRate * 2, 28)
  buf.writeUInt16LE(2, 32)
  buf.writeUInt16LE(16, 34)
  buf.write('data', 36)
  buf.writeUInt32LE(dataBytes, 40)
  if (n > 0) buf.writeInt16LE(8_000, 44)
  return buf
}

export type MockVoipBlastClient = EventEmitter & {
  profile: {
    getLidsByPhoneNumbers: ReturnType<typeof vi.fn>
  }
  getCredentials: ReturnType<typeof vi.fn>
  voip: {
    startCall: ReturnType<typeof vi.fn>
    setExternalAudioMode: ReturnType<typeof vi.fn>
    endCall: ReturnType<typeof vi.fn>
    getCall: ReturnType<typeof vi.fn>
    getFeedWatermarksMs: ReturnType<typeof vi.fn>
    getLiveBufferMs: ReturnType<typeof vi.fn>
    feedLiveAudio: ReturnType<typeof vi.fn>
  }
}

/**
 * Mock WaClient + VoIP surface for audio blast tests.
 * Emits `voip_call_state` active shortly after startCall so waitForAnswer completes.
 */
export function createMockVoipBlastClient(opts?: {
  callId?: string
  answerDelayMs?: number
  neverAnswer?: boolean
}): MockVoipBlastClient {
  const callId = opts?.callId ?? 'BLASTCALL01'
  const emitter = new EventEmitter() as MockVoipBlastClient
  let liveBufferMs = 0
  let callState: { callId: string; stateData: { state: string }; isEnded: boolean } | null = null

  emitter.profile = {
    getLidsByPhoneNumbers: vi.fn(async (phones: string[]) =>
      phones.map((p) => ({
        phoneJid: `${p.replace(/\D/g, '')}@s.whatsapp.net`,
        lidJid: null as string | null,
        exists: true,
      })),
    ),
  }
  emitter.getCredentials = vi.fn(() => ({ meJid: '5511999999999:1@s.whatsapp.net' }))

  emitter.voip = {
    startCall: vi.fn(async () => {
      callState = { callId, stateData: { state: 'ringing' }, isEnded: false }
      if (!opts?.neverAnswer) {
        const delay = opts?.answerDelayMs ?? 5
        setTimeout(() => {
          callState = { callId, stateData: { state: 'active' }, isEnded: false }
          emitter.emit('voip_call_state', callState)
        }, delay)
      }
      return callId
    }),
    setExternalAudioMode: vi.fn(),
    endCall: vi.fn(async () => {
      if (callState) {
        callState = { ...callState, stateData: { state: 'ended' }, isEnded: true }
        emitter.emit('voip_call_ended', callState)
      }
    }),
    getCall: vi.fn(() => callState),
    getFeedWatermarksMs: vi.fn(() => ({ resumeMs: 50, pauseMs: 200 })),
    getLiveBufferMs: vi.fn(() => liveBufferMs),
    feedLiveAudio: vi.fn((_id: string, chunk: Float32Array) => {
      // simulate buffer filling then draining so feed loop progresses
      liveBufferMs = Math.min(250, liveBufferMs + (chunk.length / TARGET_SAMPLE_RATE) * 1000)
      // async drain
      setTimeout(() => {
        liveBufferMs = Math.max(0, liveBufferMs - 40)
      }, 0)
    }),
  }

  // After active, inject a bit of inbound PCM when capture listens
  const origOn = emitter.on.bind(emitter)
  emitter.on = ((event: string, fn: (...args: unknown[]) => void) => {
    origOn(event, fn)
    if (event === 'voip_call_inbound_audio') {
      // fire a small inbound chunk after answer window
      setTimeout(() => {
        fn({
          call: { callId },
          pcm: new Float32Array([0.1, 0.2, 0.1, 0]),
        })
      }, 20)
    }
    return emitter
  }) as typeof emitter.on

  return emitter
}

/** Mock fetch for a public WAV download (SSRF already passed for https://example.com). */
export function mockFetchWav(wav: Buffer = makePcm16Wav(320)): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string | URL, _init?: RequestInit) => {
      const url = String(input)
      if (url.includes('/v1/audio/transcriptions') || url.includes('transcriptions')) {
        return new Response(JSON.stringify({ text: 'olá teste', language: 'pt', duration: 1.2 }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      }
      // WAV download
      return new Response(wav, {
        status: 200,
        headers: { 'content-type': 'audio/wav', 'content-length': String(wav.length) },
      })
    }),
  )
}

export function silenceWav(): Buffer {
  return makePcm16Wav(160) // 10ms @ 16k
}

export { encodeResponseWav, TARGET_SAMPLE_RATE }
