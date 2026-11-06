import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { InjectOptions } from 'fastify'
import { buildTestApp, createInstance, type TestApp } from '../helpers/test-app'

/** Named fake: one live group call; unknown numbers have no LID. */
function fakeGroupVoipClient() {
  const call = { callId: 'GROUP01', groupJid: '120363000000000000@g.us', stateData: { state: 'active' } }
  const voip = {
    getCall: vi.fn((id: string) => (id === call.callId ? call : null)),
    getCalls: vi.fn(() => [call]),
    startCall: vi.fn(async (_opts: unknown) => 'NEWGROUP'),
    setExternalAudioMode: vi.fn(),
    leaveCall: vi.fn(async (_callId: string) => undefined),
    joinCall: vi.fn(async (_callId: string) => undefined),
    requestParticipantMute: vi.fn(async (_callId: string, _jid: string) => undefined),
  }
  const profile = {
    getLidsByPhoneNumbers: vi.fn(async (jids: string[]) =>
      jids.map((phoneJid) => ({ phoneJid, lidJid: null, exists: false, status: 'out' })),
    ),
  }
  return { voip, profile }
}

describe('group call routes', () => {
  let ctx: TestApp
  let apiKey = ''
  const client = fakeGroupVoipClient()
  const { voip } = client

  beforeAll(async () => {
    ctx = await buildTestApp()
    apiKey = (await createInstance(ctx.app, 'sales-group')).apiKey
    vi.spyOn(ctx.manager, 'requireRegisteredClient').mockReturnValue(client as never)
  })

  beforeEach(() => vi.clearAllMocks())

  afterAll(async () => {
    await ctx.app.close()
  })

  const post = (url: string, payload?: InjectOptions['payload']) =>
    ctx.app.inject({ method: 'POST', url, headers: { 'x-api-key': apiKey }, payload: payload ?? {} })

  it('places a group call ringing the participant LIDs', async () => {
    const res = await post('/v1/calls', { groupId: '120363000000000000', participants: ['111@lid', '222@lid'] })
    expect(res.statusCode).toBe(200)
    expect(voip.startCall).toHaveBeenCalledWith({
      groupJid: '120363000000000000@g.us',
      participants: [{ jid: '111@lid' }, { jid: '222@lid' }],
    })
    expect(res.json()).toMatchObject({ callId: 'NEWGROUP', groupJid: '120363000000000000@g.us' })
  })

  it('returns 400 listing participants without a LID', async () => {
    const res = await post('/v1/calls', { groupId: '120363000000000000@g.us', participants: ['5511999999999'] })
    expect(res.statusCode).toBe(400)
    expect(res.json().error.details).toEqual({ missing: ['5511999999999'] })
    expect(voip.startCall).not.toHaveBeenCalled()
  })

  it('rejects mixing `to` with a group', async () => {
    const res = await post('/v1/calls', { to: '5511999999999', groupId: '120363000000000000@g.us' })
    expect(res.statusCode).toBe(400)
  })

  it('leaves a group call matched case-insensitively', async () => {
    expect((await post('/v1/calls/group01/leave')).statusCode).toBe(200)
    expect(voip.leaveCall).toHaveBeenCalledWith('GROUP01')
  })

  it('maps leaving a 1:1 call to 409', async () => {
    voip.leaveCall.mockRejectedValueOnce(new Error('not a group call'))
    expect((await post('/v1/calls/GROUP01/leave')).statusCode).toBe(409)
  })

  it('returns 404 when leaving an unknown call', async () => {
    expect((await post('/v1/calls/NOPE/leave')).statusCode).toBe(404)
  })

  it('joins a call not in the live list by its id', async () => {
    expect((await post('/v1/calls/MISSED01/join')).statusCode).toBe(200)
    expect(voip.joinCall).toHaveBeenCalledWith('MISSED01')
  })

  it('maps a call that is not joinable to 409', async () => {
    voip.joinCall.mockRejectedValueOnce(new Error('no joinable call'))
    expect((await post('/v1/calls/MISSED02/join')).statusCode).toBe(409)
  })

  it('asks a participant to mute', async () => {
    const res = await post('/v1/calls/GROUP01/participants/mute', { participant: '111@lid' })
    expect(res.statusCode).toBe(200)
    expect(voip.requestParticipantMute).toHaveBeenCalledWith('GROUP01', '111@lid')
  })
})
