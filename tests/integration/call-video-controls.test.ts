import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { InjectOptions } from 'fastify'
import { buildTestApp, createInstance, type TestApp } from '../helpers/test-app'

/** Named fake: one live call; upgrade answers `accepted`. */
function fakeVideoVoip() {
  const call = { callId: 'VID01', stateData: { state: 'active' } }
  return {
    getCall: vi.fn((id: string) => (id === call.callId ? call : null)),
    getCalls: vi.fn(() => [call]),
    requestVideoUpgrade: vi.fn(async (_callId: string) => 'accepted'),
    acceptVideoUpgrade: vi.fn(async (_callId: string) => undefined),
    rejectVideoUpgrade: vi.fn(async (_callId: string) => undefined),
    cancelVideoUpgrade: vi.fn(async (_callId: string) => undefined),
    setVideoEnabled: vi.fn(async (_callId: string, _enabled: boolean) => undefined),
    setScreenShare: vi.fn(async (_callId: string, _sharing: boolean) => undefined),
  }
}

describe('call video control routes', () => {
  let ctx: TestApp
  let apiKey = ''
  const voip = fakeVideoVoip()

  beforeAll(async () => {
    ctx = await buildTestApp()
    apiKey = (await createInstance(ctx.app, 'sales-video')).apiKey
    vi.spyOn(ctx.manager, 'requireRegisteredClient').mockReturnValue({ voip } as never)
  })

  beforeEach(() => vi.clearAllMocks())

  afterAll(async () => {
    await ctx.app.close()
  })

  const post = (url: string, payload?: InjectOptions['payload']) =>
    ctx.app.inject({ method: 'POST', url, headers: { 'x-api-key': apiKey }, payload: payload ?? {} })

  it('returns the upgrade handshake result', async () => {
    const res = await post('/v1/calls/vid01/video/upgrade')
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ ok: true, result: 'accepted' })
    expect(voip.requestVideoUpgrade).toHaveBeenCalledWith('VID01')
  })

  it.each([
    ['accept', 'acceptVideoUpgrade'],
    ['reject', 'rejectVideoUpgrade'],
    ['cancel', 'cancelVideoUpgrade'],
  ] as const)('maps video/upgrade/%s to %s', async (answer, method) => {
    expect((await post(`/v1/calls/VID01/video/upgrade/${answer}`)).statusCode).toBe(200)
    expect(voip[method]).toHaveBeenCalledWith('VID01')
  })

  it('maps the group camera on a 1:1 call to 409', async () => {
    voip.setVideoEnabled.mockRejectedValueOnce(new Error('not a group call'))
    expect((await post('/v1/calls/VID01/video', { enabled: true })).statusCode).toBe(409)
  })

  it('starts a screen share', async () => {
    expect((await post('/v1/calls/VID01/screen-share', { sharing: true })).statusCode).toBe(200)
    expect(voip.setScreenShare).toHaveBeenCalledWith('VID01', true)
  })

  it('maps a call that ended mid-request to 404', async () => {
    voip.setScreenShare.mockRejectedValueOnce(new Error('No call with id VID01'))
    expect((await post('/v1/calls/VID01/screen-share', { sharing: true })).statusCode).toBe(404)
  })

  it('returns 404 for an unknown call', async () => {
    expect((await post('/v1/calls/NOPE/video/upgrade')).statusCode).toBe(404)
  })
})
