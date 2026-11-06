import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { buildTestApp, createInstance, type TestApp } from '../helpers/test-app'

function fakeGroupModesClient() {
  const metadata = {
    jid: '120363000000000000@g.us',
    subject: 'Modes',
    participants: [],
    memberAddMode: 'admin_add',
    memberLinkMode: 'admin_link',
    memberShareGroupHistoryMode: 'admin_share',
  }
  return {
    group: {
      setMemberAddMode: vi.fn(async (_jid: string, _mode: string) => undefined),
      setMemberLinkMode: vi.fn(async (_jid: string, _mode: string) => undefined),
      setMemberShareGroupHistoryMode: vi.fn(async (_jid: string, _mode: string) => undefined),
      queryGroupMetadata: vi.fn(async (_jid: string) => metadata),
      queryAllGroups: vi.fn(async () => [metadata]),
      setSetting: vi.fn(async (_jid: string, _setting: string, _enabled: boolean) => undefined),
    },
  }
}

const settings = [
  { setting: 'member-add-mode', method: 'setMemberAddMode', modes: ['admin_add', 'all_member_add'] },
  { setting: 'member-link-mode', method: 'setMemberLinkMode', modes: ['admin_link', 'all_member_link'] },
  {
    setting: 'history-share-mode',
    method: 'setMemberShareGroupHistoryMode',
    modes: ['admin_share', 'all_member_share'],
  },
] as const

describe('group member modes', () => {
  let ctx: TestApp
  let apiKey: string
  const client = fakeGroupModesClient()
  const groupId = '120363000000000000'
  const jid = `${groupId}@g.us`
  const put = (setting: string, payload: object, id = groupId) =>
    ctx.app.inject({
      method: 'PUT',
      url: `/v1/groups/${id}/settings/${setting}`,
      headers: { 'x-api-key': apiKey },
      payload,
    })

  beforeAll(async () => {
    ctx = await buildTestApp()
    apiKey = (await createInstance(ctx.app, 'group-modes')).apiKey
    vi.spyOn(ctx.manager, 'requireRegisteredClient').mockReturnValue(client as never)
  })
  beforeEach(() => vi.clearAllMocks())
  afterAll(async () => {
    await ctx.app.close()
  })

  for (const { setting, method, modes } of settings) {
    describe(setting, () => {
      it.each(modes)('writes %s using the normalized group JID', async (mode) => {
        const res = await put(setting, { mode })
        expect(res.statusCode).toBe(200)
        expect(res.json()).toEqual({ ok: true, mode })
        expect(client.group[method]).toHaveBeenCalledExactlyOnceWith(jid, mode)
      })
      it('preserves a full group JID', async () => {
        expect((await put(setting, { mode: modes[0] }, jid)).statusCode).toBe(200)
        expect(client.group[method]).toHaveBeenCalledExactlyOnceWith(jid, modes[0])
      })
      it('rejects an unknown mode with the accepted values', async () => {
        const res = await put(setting, { mode: 'unknown' })
        expect(res.statusCode).toBe(400)
        for (const mode of modes) expect(res.body).toContain(mode)
        expect(client.group[method]).not.toHaveBeenCalled()
      })
      it('requires mode instead of the boolean setting body', async () => {
        expect((await put(setting, { enabled: true })).statusCode).toBe(400)
        expect(client.group[method]).not.toHaveBeenCalled()
      })
      it('maps an unknown group to 404', async () => {
        client.group[method].mockRejectedValueOnce(new Error(`group.${method} iq failed (404: item-not-found)`))
        const res = await put(setting, { mode: modes[0] }, '999')
        expect(res.statusCode).toBe(404)
        expect(res.json().error.code).toBe('WA_NOT_FOUND')
        expect(client.group[method]).toHaveBeenCalledWith('999@g.us', modes[0])
      })
      it.each([401, 403])('maps WhatsApp admin denial %s to 403', async (code) => {
        client.group[method].mockRejectedValueOnce(new Error(`group.${method} iq failed (${code}: not-authorized)`))
        const res = await put(setting, { mode: modes[0] })
        expect(res.statusCode).toBe(403)
        expect(res.json().error.code).toBe('WA_NOT_AUTHORIZED')
      })
    })
  }

  it.each(['', `/${groupId}`])('exposes normalized metadata on GET /groups%s', async (suffix) => {
    const res = await ctx.app.inject({ method: 'GET', url: `/v1/groups${suffix}`, headers: { 'x-api-key': apiKey } })
    expect(res.statusCode).toBe(200)
    const group = suffix ? res.json().group : res.json().groups[0]
    expect(group).toMatchObject({
      jid,
      subject: 'Modes',
      participants: [],
      memberAddMode: 'admin_add',
      memberLinkMode: 'admin_link',
      historyShareMode: 'admin_share',
    })
    if (suffix) expect(client.group.queryGroupMetadata).toHaveBeenCalledWith(jid)
  })

  it('keeps the existing boolean settings route', async () => {
    expect((await put('announcement', { enabled: true })).statusCode).toBe(200)
    expect(client.group.setSetting).toHaveBeenCalledWith(jid, 'announcement', true)
  })
})
