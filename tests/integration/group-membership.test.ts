import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { WaMembershipRequest } from 'zapo-js'
import { ADMIN_KEY, buildTestApp, createInstance, type TestApp } from '../helpers/test-app'

const GROUP = '120363000000000000@g.us'
const REQUEST: WaMembershipRequest = {
  jid: '111@lid',
  requestor: '111@lid',
  requestorPhone: '5511999999999@s.whatsapp.net',
  requestorUsername: 'requester',
  parentGroupJid: '120363111111111111@g.us',
  requestTime: 1793966400,
  requestMethod: 'invite_link',
}

/** Named fake: one group with pending requests and a WA-confirmed phone number. */
function fakeMembershipClient() {
  const requireGroup = (jid: string) => {
    if (jid !== GROUP) throw new Error('group.membershipRequests iq failed (404: item-not-found)')
  }
  const act = async (jid: string, _participants: readonly string[]) => requireGroup(jid)
  const group = {
    queryMembershipApprovalRequests: vi.fn(async (jid: string) => {
      requireGroup(jid)
      return [REQUEST]
    }),
    approveMembershipRequests: vi.fn(act),
    rejectMembershipRequests: vi.fn(act),
    cancelMembershipRequests: vi.fn(act),
    setSetting: vi.fn(async (_jid: string, _setting: string, _enabled: boolean) => undefined),
  }
  const profile = {
    getLidsByPhoneNumbers: vi.fn(async (_phones: string[]) => [
      { phoneJid: '5511999999999@s.whatsapp.net', lidJid: '111@lid', exists: true, status: 'in' },
    ]),
  }
  return { group, profile }
}

const ACTIONS = [
  ['approve', 'approveMembershipRequests'],
  ['reject', 'rejectMembershipRequests'],
  ['cancel', 'cancelMembershipRequests'],
] as const

describe('group membership request routes', () => {
  let ctx: TestApp
  let apiKey: string
  const client = fakeMembershipClient()
  const base = '/v1/groups/120363000000000000/membership-requests'

  beforeAll(async () => {
    ctx = await buildTestApp()
    apiKey = (await createInstance(ctx.app, 'membership')).apiKey
    vi.spyOn(ctx.manager, 'requireRegisteredClient').mockReturnValue(client as never)
  })
  beforeEach(() => vi.clearAllMocks())
  afterAll(async () => ctx.app.close())

  const get = (url = base, key = apiKey) => ctx.app.inject({ url, headers: { 'x-api-key': key } })
  const post = (action: string, participants = ['5511999999999', '222@lid'], url = base) =>
    ctx.app.inject({
      method: 'POST',
      url: `${url}/${action}`,
      headers: { 'x-api-key': apiKey },
      payload: { participants },
    })

  it('lists requests with ISO timestamps and optional upstream metadata', async () => {
    const res = await get()
    expect(res.statusCode).toBe(200)
    expect(client.group.queryMembershipApprovalRequests).toHaveBeenCalledWith(GROUP)
    expect(res.json()).toEqual({
      requests: [
        {
          jid: '111@lid',
          phoneNumber: REQUEST.requestorPhone,
          requestedAt: '2026-11-06T12:00:00.000Z',
          method: 'invite_link',
          requestor: '111@lid',
          requestorUsername: 'requester',
          parentGroupJid: REQUEST.parentGroupJid,
        },
      ],
    })
  })

  it('preserves a full group JID and an empty pending list', async () => {
    client.group.queryMembershipApprovalRequests.mockResolvedValueOnce([])
    const res = await get(`/v1/groups/${GROUP}/membership-requests`)
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ requests: [] })
    expect(client.group.queryMembershipApprovalRequests).toHaveBeenCalledWith(GROUP)
  })

  it.each(ACTIONS)('%s resolves phones and preserves LIDs', async (action, method) => {
    const res = await post(action)
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ ok: true })
    expect(client.group[method]).toHaveBeenCalledWith(GROUP, ['5511999999999@s.whatsapp.net', '222@lid'])
    expect(client.profile.getLidsByPhoneNumbers).toHaveBeenCalledTimes(1)
  })

  it.each(ACTIONS)('%s rejects an empty list', async (action, method) => {
    expect((await post(action, [])).statusCode).toBe(400)
    expect(client.group[method]).not.toHaveBeenCalled()
  })

  it.each(ACTIONS)('%s rejects blank participants', async (action, method) => {
    expect((await post(action, [' '])).statusCode).toBe(400)
    expect(client.group[method]).not.toHaveBeenCalled()
  })

  it('returns 404 for an unknown group on list', async () => {
    expect((await get('/v1/groups/999/membership-requests')).statusCode).toBe(404)
  })

  it.each(ACTIONS)('%s returns 404 for an unknown group', async (action) => {
    expect((await post(action, ['111@lid'], '/v1/groups/999/membership-requests')).statusCode).toBe(404)
  })

  it('maps a list admin error to 403 with the upstream message', async () => {
    const message = 'group.membershipRequests iq failed (403: not-authorized)'
    client.group.queryMembershipApprovalRequests.mockRejectedValueOnce(new Error(message))
    const res = await get()
    expect(res.statusCode).toBe(403)
    expect(res.json().error).toMatchObject({ code: 'FORBIDDEN', message })
  })

  it.each(ACTIONS)('%s maps an admin error to 403', async (action, method) => {
    const message = `group.membershipRequests.${action} iq failed (403: not-authorized)`
    client.group[method].mockRejectedValueOnce(new Error(message))
    const res = await post(action, ['111@lid'])
    expect(res.statusCode).toBe(403)
    expect(res.json().error.message).toBe(message)
  })

  it.each(ACTIONS)('%s maps approval mode off to 409', async (action, method) => {
    const message = `group.membershipRequests.${action} iq failed (409: conflict)`
    client.group[method].mockRejectedValueOnce(new Error(message))
    const res = await post(action, ['111@lid'])
    expect(res.statusCode).toBe(409)
    expect(res.json().error.message).toBe(message)
  })

  it('maps a mode-disabled message to 409 on list', async () => {
    const message = 'membership approval mode is disabled'
    client.group.queryMembershipApprovalRequests.mockRejectedValueOnce(new Error(message))
    const res = await get()
    expect(res.statusCode).toBe(409)
    expect(res.json().error.message).toBe(message)
  })

  it('keeps membership approval mode settable through the existing route', async () => {
    const res = await ctx.app.inject({
      method: 'PUT',
      url: `/v1/groups/${GROUP}/settings/membership_approval_mode`,
      headers: { 'x-api-key': apiKey },
      payload: { enabled: true },
    })
    expect(res.statusCode).toBe(200)
    expect(client.group.setSetting).toHaveBeenCalledWith(GROUP, 'membership_approval_mode', true)
  })

  it('requires authentication and rejects the admin key for session operations', async () => {
    expect((await ctx.app.inject({ url: base })).statusCode).toBe(401)
    expect((await get(base, ADMIN_KEY)).statusCode).toBe(403)
    expect(client.group.queryMembershipApprovalRequests).not.toHaveBeenCalled()
  })
})
