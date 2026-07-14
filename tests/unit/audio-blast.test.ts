import { afterEach, describe, expect, it, vi } from 'vitest'
import { executeAudioBlast } from '~/voip/audio-blast'
import { createMockVoipBlastClient, mockFetchWav, silenceWav } from '../helpers/blast-mocks'
import { MemoryCallStore, MemoryMediaStorage } from '../helpers/memory-stores'

describe('executeAudioBlast', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('plays audio, records inbound, persists CallStore, and transcribes', async () => {
    mockFetchWav(silenceWav())
    const client = createMockVoipBlastClient({ callId: 'CALLBLAST1', answerDelayMs: 5 })
    const manager = {
      requireOpenClient: vi.fn(async () => client),
    }
    const mediaStorage = new MemoryMediaStorage()
    const calls = new MemoryCallStore()

    const result = await executeAudioBlast({
      // @ts-expect-error partial manager
      manager,
      instanceName: 'sales-1',
      to: '5511888888888',
      audioUrl: 'https://example.com/prompt.wav',
      responseTimeoutMs: 30,
      callTimeoutMs: 2000,
      recordResponse: true,
      maxCaptureSeconds: 5,
      mediaStorage: mediaStorage as never,
      calls: calls as never,
      stt: {
        enabled: true,
        apiUrl: 'https://api.groq.com/openai',
        apiKey: 'gsk_test',
        language: 'pt',
      },
    })

    expect(result.error).toBeUndefined()
    expect(result.callId).toBe('CALLBLAST1')
    expect(result.audioPlayed).toBe(true)
    expect(result.peerJid).toContain('@s.whatsapp.net')
    expect(result.transcription).toBe('olá teste')
    expect(result.recordingUrl).toBeTruthy()
    expect(client.voip.startCall).toHaveBeenCalled()
    expect(client.voip.feedLiveAudio).toHaveBeenCalled()
    expect(client.voip.endCall).toHaveBeenCalled()

    const row = await calls.get('sales-1', 'CALLBLAST1')
    expect(row?.recordingStatus).toBe('ready')
    expect(row?.recordingStorageKey).toBeTruthy()
    expect(mediaStorage.objects.size).toBeGreaterThanOrEqual(1)
  })

  it('returns call not answered without playing audio', async () => {
    mockFetchWav(silenceWav())
    const client = createMockVoipBlastClient({ callId: 'NOANSWER', neverAnswer: true })
    const manager = {
      requireOpenClient: vi.fn(async () => client),
    }

    const result = await executeAudioBlast({
      // @ts-expect-error partial
      manager,
      instanceName: 'sales-1',
      to: '5511888888888',
      audioUrl: 'https://example.com/prompt.wav',
      responseTimeoutMs: 10,
      callTimeoutMs: 40,
      recordResponse: true,
    })

    expect(result.audioPlayed).toBe(false)
    expect(result.error).toBe('call not answered')
    expect(result.transcription).toBeNull()
    expect(client.voip.feedLiveAudio).not.toHaveBeenCalled()
    expect(client.voip.endCall).toHaveBeenCalled()
  })

  it('rejects SSRF / private audioUrl before dialing', async () => {
    const client = createMockVoipBlastClient()
    const manager = {
      requireOpenClient: vi.fn(async () => client),
    }

    await expect(
      executeAudioBlast({
        // @ts-expect-error partial
        manager,
        instanceName: 'sales-1',
        to: '5511888888888',
        audioUrl: 'http://127.0.0.1/secret.wav',
        responseTimeoutMs: 10,
        callTimeoutMs: 50,
        recordResponse: false,
      }),
    ).rejects.toThrow(/scheme|blocked|private|localhost|SSRF|http/i)

    expect(client.voip.startCall).not.toHaveBeenCalled()
  })
})
