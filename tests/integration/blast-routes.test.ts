import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { mockFetchWav, silenceWav } from '../helpers/blast-mocks'
import { ADMIN_KEY, buildMockedWaApp, INSTANCE, INSTANCE_KEY, type MockWaApp } from '../helpers/mock-wa-app'

describe('blast + STT routes (integration)', () => {
  let ctx: MockWaApp
  const key = { 'x-api-key': INSTANCE_KEY }

  beforeAll(async () => {
    mockFetchWav(silenceWav())
    ctx = await buildMockedWaApp({
      withVoip: true,
      env: {
        STT_ENABLED: true,
        STT_API_URL: 'https://api.groq.com/openai',
        STT_API_KEY: 'gsk_test',
        STT_MODEL: 'whisper-large-v3',
        STT_LANGUAGE: 'pt',
      },
    })
  })

  afterAll(async () => {
    await ctx.app.close()
    vi.unstubAllGlobals()
  })

  afterEach(() => {
    // re-stub fetch after each test in case unstubbed
    mockFetchWav(silenceWav())
  })

  it('rejects unauthenticated blast', async () => {
    const res = await ctx.app.inject({
      method: 'POST',
      url: `/v1/instances/${INSTANCE}/calls/blast`,
      payload: { to: '5511999999999', audioUrl: 'https://example.com/a.wav' },
    })
    expect(res.statusCode).toBe(401)
  })

  it('validates body (missing to / audioUrl)', async () => {
    const res = await ctx.app.inject({
      method: 'POST',
      url: `/v1/instances/${INSTANCE}/calls/blast`,
      headers: key,
      payload: { to: '5511999999999' },
    })
    expect(res.statusCode).toBe(400)
  })

  it('POST /calls/blast happy path with STT', async () => {
    const res = await ctx.app.inject({
      method: 'POST',
      url: `/v1/instances/${INSTANCE}/calls/blast`,
      headers: key,
      payload: {
        to: '5511888888888',
        audioUrl: 'https://example.com/prompt.wav',
        responseTimeoutMs: 30,
        callTimeoutMs: 3000,
        recordResponse: true,
        transcribe: true,
        sttLanguage: 'pt',
      },
    })
    expect(res.statusCode).toBe(200)
    const body = res.json() as {
      callId: string
      audioPlayed: boolean
      transcription: string | null
      recordingUrl: string | null
      error?: string
    }
    expect(body.error).toBeUndefined()
    expect(body.audioPlayed).toBe(true)
    expect(body.callId).toBeTruthy()
    expect(body.transcription).toBe('olá teste')
    expect(body.recordingUrl).toBeTruthy()

    const row = await ctx.calls.get(INSTANCE, body.callId)
    expect(row?.recordingStatus).toBe('ready')
    expect(row?.recordingStorageKey).toBeTruthy()
  })

  it('POST /calls/:id/transcribe uses stored recording', async () => {
    // seed a ready recording
    await ctx.calls.upsertStart({
      instanceName: INSTANCE,
      callId: 'EXISTING1',
      peerJid: '5511888888888@s.whatsapp.net',
      direction: 'outgoing',
      recordingEnabled: true,
    })
    const wav = silenceWav()
    const stored = await ctx.mediaStorage.put(INSTANCE, wav, {
      mimeType: 'audio/wav',
      filename: 'exist.wav',
      messageId: 'exist-1',
    })
    await ctx.calls.setRecordingResult(INSTANCE, 'EXISTING1', {
      status: 'ready',
      storageKey: stored.storageKey,
      url: `/v1/instances/${INSTANCE}/calls/EXISTING1/recording`,
      mime: 'audio/wav',
      bytes: stored.sizeBytes,
    })

    const res = await ctx.app.inject({
      method: 'POST',
      url: `/v1/instances/${INSTANCE}/calls/EXISTING1/transcribe`,
      headers: key,
    })
    expect(res.statusCode).toBe(200)
    const body = res.json() as { text: string; callId: string }
    expect(body.callId).toBe('EXISTING1')
    expect(body.text).toBe('olá teste')
  })

  it('transcribe returns 400 when no recording', async () => {
    await ctx.calls.upsertStart({
      instanceName: INSTANCE,
      callId: 'NOREC',
      recordingEnabled: false,
    })
    const res = await ctx.app.inject({
      method: 'POST',
      url: `/v1/instances/${INSTANCE}/calls/NOREC/transcribe`,
      headers: key,
    })
    expect(res.statusCode).toBe(400)
  })

  it('transcribe returns 404 for unknown call', async () => {
    const res = await ctx.app.inject({
      method: 'POST',
      url: `/v1/instances/${INSTANCE}/calls/missing-call/transcribe`,
      headers: key,
    })
    expect(res.statusCode).toBe(404)
  })

  it('forbids other instance key on blast', async () => {
    // seed second instance with different key
    ctx.repo.seed({ name: 'other', apiKey: 'zr_other_key_min16xx', status: 'open' })
    const res = await ctx.app.inject({
      method: 'POST',
      url: `/v1/instances/${INSTANCE}/calls/blast`,
      headers: { 'x-api-key': 'zr_other_key_min16xx' },
      payload: {
        to: '5511888888888',
        audioUrl: 'https://example.com/prompt.wav',
      },
    })
    expect([403, 401]).toContain(res.statusCode)
  })

  it('admin key can blast any instance', async () => {
    const res = await ctx.app.inject({
      method: 'POST',
      url: `/v1/instances/${INSTANCE}/calls/blast`,
      headers: { 'x-api-key': ADMIN_KEY },
      payload: {
        to: '5511888888888',
        audioUrl: 'https://example.com/prompt.wav',
        responseTimeoutMs: 20,
        callTimeoutMs: 2000,
        recordResponse: false,
        transcribe: false,
      },
    })
    expect(res.statusCode).toBe(200)
    expect((res.json() as { audioPlayed: boolean }).audioPlayed).toBe(true)
  })
})

describe('blast routes without STT configured', () => {
  let ctx: MockWaApp

  beforeAll(async () => {
    mockFetchWav(silenceWav())
    ctx = await buildMockedWaApp({
      withVoip: true,
      env: { STT_ENABLED: false },
    })
  })

  afterAll(async () => {
    await ctx.app.close()
    vi.unstubAllGlobals()
  })

  it('transcribe returns 503 when STT disabled', async () => {
    const res = await ctx.app.inject({
      method: 'POST',
      url: `/v1/instances/${INSTANCE}/calls/some/transcribe`,
      headers: { 'x-api-key': INSTANCE_KEY },
    })
    expect(res.statusCode).toBe(503)
  })

  it('blast still works without STT (transcription null)', async () => {
    mockFetchWav(silenceWav())
    const res = await ctx.app.inject({
      method: 'POST',
      url: `/v1/instances/${INSTANCE}/calls/blast`,
      headers: { 'x-api-key': INSTANCE_KEY },
      payload: {
        to: '5511888888888',
        audioUrl: 'https://example.com/prompt.wav',
        responseTimeoutMs: 20,
        callTimeoutMs: 2000,
        recordResponse: true,
      },
    })
    expect(res.statusCode).toBe(200)
    const body = res.json() as { transcription: string | null; audioPlayed: boolean }
    expect(body.audioPlayed).toBe(true)
    expect(body.transcription).toBeNull()
  })
})
