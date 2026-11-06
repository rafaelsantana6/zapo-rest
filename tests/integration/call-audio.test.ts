import { access, readFile } from 'node:fs/promises'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { buildTestApp, createInstance, type TestApp } from '../helpers/test-app'

/** Named fake: eagerly reads the file, like upstream's ffmpeg decoder. */
function fakeAudioVoip() {
  const call = { callId: 'AUDIO1', stateData: { state: 'active' } }
  return {
    getCall: vi.fn((id: string) => (id === call.callId ? call : null)),
    getCalls: vi.fn(() => [call]),
    loadAudio: vi.fn(async (_id: string, path: string) => {
      await readFile(path)
    }),
    setExternalAudioMode: vi.fn(),
  }
}

describe('load call audio', () => {
  let ctx: TestApp
  let apiKey: string
  const voip = fakeAudioVoip()
  beforeAll(async () => {
    ctx = await buildTestApp()
    apiKey = (await createInstance(ctx.app, 'audio-playback')).apiKey
    vi.spyOn(ctx.manager, 'requireRegisteredClient').mockReturnValue({ voip } as never)
  })
  beforeEach(() => vi.clearAllMocks())
  afterAll(async () => {
    await ctx.app.close()
  })
  const post = (payload: Record<string, unknown>, callId = 'audio1') =>
    ctx.app.inject({
      method: 'POST',
      url: `/v1/calls/${callId}/audio`,
      headers: { 'x-api-key': apiKey },
      payload,
    })

  it('loads a temporary base64 file, selects playback and removes the file', async () => {
    const res = await post({ mediaBase64: Buffer.from('fake audio').toString('base64') })
    expect(res.statusCode).toBe(200)
    expect(voip.loadAudio.mock.calls[0]?.[0]).toBe('AUDIO1')
    expect(voip.setExternalAudioMode).toHaveBeenCalledWith('AUDIO1', false)
    await expect(access(voip.loadAudio.mock.calls[0]?.[1] ?? '')).rejects.toThrow()
  })
  it('accepts multipart using the shared media helpers', async () => {
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/v1/calls/AUDIO1/audio',
      headers: {
        'x-api-key': apiKey,
        'content-type': 'multipart/form-data; boundary=test-audio',
      },
      payload:
        '--test-audio\r\nContent-Disposition: form-data; name="file"; filename="test.wav"\r\nContent-Type: audio/wav\r\n\r\nfake audio\r\n--test-audio--\r\n',
    })
    expect(res.statusCode).toBe(200)
    await expect(access(voip.loadAudio.mock.calls[0]?.[1] ?? '')).rejects.toThrow()
  })
  it('returns 503 when upstream cannot find ffmpeg and removes the file', async () => {
    voip.loadAudio.mockRejectedValueOnce(new Error('ffmpeg not found on PATH (install ffmpeg to load audio files)'))
    const res = await post({ mediaBase64: 'YXVkaW8=' })
    expect(res.statusCode).toBe(503)
    expect(res.json().error.message).toContain('ffmpeg')
    expect(voip.setExternalAudioMode).not.toHaveBeenCalled()
    await expect(access(voip.loadAudio.mock.calls[0]?.[1] ?? '')).rejects.toThrow()
  })
  it('returns 400 for undecodable audio and removes the file', async () => {
    voip.loadAudio.mockRejectedValueOnce(new Error('ffmpeg exited with code 1: private path'))
    expect((await post({ mediaBase64: 'YXVkaW8=' })).statusCode).toBe(400)
    await expect(access(voip.loadAudio.mock.calls[0]?.[1] ?? '')).rejects.toThrow()
  })
  it('requires a media source', async () => {
    expect((await post({})).statusCode).toBe(400)
  })
  it('rejects private URL downloads', async () => {
    expect((await post({ mediaUrl: 'http://127.0.0.1/audio.wav' })).statusCode).toBe(400)
    expect(voip.loadAudio).not.toHaveBeenCalled()
  })
  it('returns 404 for unknown calls', async () => {
    expect((await post({ mediaBase64: 'YQ==' }, 'missing')).statusCode).toBe(404)
  })
  it('requires authentication', async () => {
    expect((await ctx.app.inject({ method: 'POST', url: '/v1/calls/AUDIO1/audio', payload: {} })).statusCode).toBe(401)
  })
})
