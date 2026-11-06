import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { InjectOptions } from 'fastify'
import { buildTestApp, createInstance, type TestApp } from '../helpers/test-app'

/** Named fake: one live call, hand/reaction calls recorded. */
function fakeVoipSurface(liveCall: { callId: string; stateData: { state: string } }) {
  return {
    getCall: vi.fn((id: string) => (id === liveCall.callId ? liveCall : null)),
    getCalls: vi.fn(() => [liveCall]),
    setHandRaised: vi.fn(async (_callId: string, _raised: boolean) => undefined),
    sendReaction: vi.fn((_callId: string, _reaction: string) => true),
  }
}

describe('call hand + reaction routes', () => {
  let ctx: TestApp
  let apiKey = ''
  const voip = fakeVoipSurface({ callId: 'ABCDEF0123', stateData: { state: 'active' } })

  beforeAll(async () => {
    ctx = await buildTestApp()
    apiKey = (await createInstance(ctx.app, 'sales-call')).apiKey
    vi.spyOn(ctx.manager, 'requireRegisteredClient').mockReturnValue({ voip } as never)
  })

  beforeEach(() => {
    voip.setHandRaised.mockClear()
    voip.sendReaction.mockClear()
  })

  afterAll(async () => {
    await ctx.app.close()
  })

  const post = (url: string, payload: InjectOptions['payload']) =>
    ctx.app.inject({ method: 'POST', url, headers: { 'x-api-key': apiKey }, payload })

  it('raises the hand on a call matched case-insensitively', async () => {
    const res = await post('/v1/calls/abcdef0123/hand', { raised: true })
    expect(res.statusCode).toBe(200)
    expect(voip.setHandRaised).toHaveBeenCalledWith('ABCDEF0123', true)
  })

  it('returns 404 for an unknown call', async () => {
    const res = await post('/v1/calls/NOPE/hand', { raised: false })
    expect(res.statusCode).toBe(404)
    expect(voip.setHandRaised).not.toHaveBeenCalled()
  })

  it('maps a failed hand announcement to 503', async () => {
    voip.setHandRaised.mockRejectedValueOnce(new Error('send failed'))
    const res = await post('/v1/calls/ABCDEF0123/hand', { raised: true })
    expect(res.statusCode).toBe(503)
  })

  it('sends a trimmed emoji reaction', async () => {
    const res = await post('/v1/calls/ABCDEF0123/reaction', { reaction: ' 👍 ' })
    expect(res.statusCode).toBe(200)
    expect(voip.sendReaction).toHaveBeenCalledWith('ABCDEF0123', '👍')
  })

  it('returns 409 when the reaction channel is not open yet', async () => {
    voip.sendReaction.mockReturnValueOnce(false)
    const res = await post('/v1/calls/ABCDEF0123/reaction', { reaction: '🎉' })
    expect(res.statusCode).toBe(409)
  })

  it('rejects an empty reaction', async () => {
    const res = await post('/v1/calls/ABCDEF0123/reaction', { reaction: '   ' })
    expect(res.statusCode).toBe(400)
    expect(voip.sendReaction).not.toHaveBeenCalled()
  })
})
