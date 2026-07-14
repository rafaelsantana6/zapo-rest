import { afterEach, describe, expect, it, vi } from 'vitest'
import { transcribeAudio } from '~/voip/audio-transcribe'

describe('transcribeAudio', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('posts multipart to OpenAI-compatible path and returns text', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toBe('https://api.groq.com/openai/v1/audio/transcriptions')
      expect(init?.method).toBe('POST')
      const headers = init?.headers as Record<string, string>
      expect(headers.Authorization).toBe('Bearer gsk_test')
      expect(init?.body).toBeInstanceOf(FormData)
      return new Response(JSON.stringify({ text: 'hello world', language: 'en', duration: 2.5 }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await transcribeAudio({
      apiUrl: 'https://api.groq.com/openai',
      apiKey: 'gsk_test',
      model: 'whisper-large-v3',
      language: 'en',
      audioBytes: Buffer.from('fake-wav'),
      filename: 'call.wav',
    })

    expect(result).toEqual({ text: 'hello world', language: 'en', durationSecs: 2.5 })
    expect(fetchMock).toHaveBeenCalledOnce()
  })

  it('joins trailing slash base URL without double slash issues', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      expect(String(input)).toBe('https://api.example.com/openai/v1/audio/transcriptions')
      return new Response(JSON.stringify({ text: 'ok' }), { status: 200 })
    })
    vi.stubGlobal('fetch', fetchMock)

    await transcribeAudio({
      apiUrl: 'https://api.example.com/openai/',
      apiKey: 'k',
      audioBytes: Buffer.from('x'),
    })
  })

  it('throws on non-OK STT response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('rate limited', { status: 429 })),
    )
    await expect(
      transcribeAudio({
        apiUrl: 'https://api.groq.com/openai',
        apiKey: 'k',
        audioBytes: Buffer.from('x'),
      }),
    ).rejects.toThrow(/STT API returned 429/)
  })
})
