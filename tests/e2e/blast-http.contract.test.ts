/**
 * HTTP contract e2e for audio blast / STT — full Fastify stack with mocked VoIP
 * (no real WhatsApp). Complements unit + integration with OpenAPI-shaped payloads.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { mockFetchWav, silenceWav } from '../helpers/blast-mocks'
import { ADMIN_KEY, buildMockedWaApp, INSTANCE, INSTANCE_KEY, type MockWaApp } from '../helpers/mock-wa-app'

describe('e2e HTTP contract: blast + transcribe', () => {
  let ctx: MockWaApp

  beforeAll(async () => {
    mockFetchWav(silenceWav())
    ctx = await buildMockedWaApp({
      withVoip: true,
      env: {
        STT_ENABLED: true,
        STT_API_URL: 'https://api.groq.com/openai',
        STT_API_KEY: 'gsk_e2e_test',
        STT_LANGUAGE: 'pt',
      },
    })
  }, 30_000)

  afterAll(async () => {
    await ctx.app.close()
    vi.unstubAllGlobals()
  })

  it('blast response matches public contract fields', async () => {
    const res = await ctx.app.inject({
      method: 'POST',
      url: `/v1/instances/${INSTANCE}/calls/blast`,
      headers: { 'x-api-key': INSTANCE_KEY, 'content-type': 'application/json' },
      payload: {
        to: '5511999999999',
        audioUrl: 'https://example.com/ivr.wav',
        responseTimeoutMs: 40,
        callTimeoutMs: 5000,
        recordResponse: true,
        transcribe: true,
        sttLanguage: 'pt',
      },
    })
    expect(res.statusCode).toBe(200)
    const body = res.json() as Record<string, unknown>
    for (const k of [
      'callId',
      'peerJid',
      'audioPlayed',
      'recordingUrl',
      'responseDurationMs',
      'totalDurationMs',
      'transcription',
    ]) {
      expect(body).toHaveProperty(k)
    }
    expect(typeof body.callId).toBe('string')
    expect(body.audioPlayed).toBe(true)
    expect(typeof body.totalDurationMs).toBe('number')
    expect((body.totalDurationMs as number) > 0).toBe(true)
    expect(body.transcription).toBe('olá teste')
  })

  it('transcribe contract after blast-linked recording', async () => {
    const blast = await ctx.app.inject({
      method: 'POST',
      url: `/v1/instances/${INSTANCE}/calls/blast`,
      headers: { 'x-api-key': ADMIN_KEY },
      payload: {
        to: '5511888888888',
        audioUrl: 'https://example.com/p.wav',
        responseTimeoutMs: 30,
        callTimeoutMs: 3000,
        recordResponse: true,
        transcribe: false,
      },
    })
    expect(blast.statusCode).toBe(200)
    const { callId } = blast.json() as { callId: string }

    const res = await ctx.app.inject({
      method: 'POST',
      url: `/v1/instances/${INSTANCE}/calls/${callId}/transcribe`,
      headers: { 'x-api-key': INSTANCE_KEY },
    })
    expect(res.statusCode).toBe(200)
    const body = res.json() as { text: string; language: string | null; durationSecs: number | null; callId: string }
    expect(body.callId).toBe(callId)
    expect(typeof body.text).toBe('string')
    expect(body.text.length).toBeGreaterThan(0)
    expect(body).toHaveProperty('language')
    expect(body).toHaveProperty('durationSecs')
  })

  it('GET recording streams WAV after blast', async () => {
    const blast = await ctx.app.inject({
      method: 'POST',
      url: `/v1/instances/${INSTANCE}/calls/blast`,
      headers: { 'x-api-key': INSTANCE_KEY },
      payload: {
        to: '5511777777777',
        audioUrl: 'https://example.com/r.wav',
        responseTimeoutMs: 25,
        callTimeoutMs: 3000,
        recordResponse: true,
        transcribe: false,
      },
    })
    const { callId, recordingUrl } = blast.json() as { callId: string; recordingUrl: string | null }
    expect(recordingUrl).toBeTruthy()

    const rec = await ctx.app.inject({
      method: 'GET',
      url: `/v1/instances/${INSTANCE}/calls/${callId}/recording`,
      headers: { 'x-api-key': INSTANCE_KEY },
    })
    expect(rec.statusCode).toBe(200)
    expect(rec.headers['content-type']).toMatch(/audio\/wav|application\/octet-stream/)
    expect(rec.rawPayload.byteLength).toBeGreaterThan(44)
    expect(rec.rawPayload.subarray(0, 4).toString('ascii')).toBe('RIFF')
  })
})
