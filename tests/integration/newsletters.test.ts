import type { InjectOptions } from 'fastify'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { fakeNewsletterClient, NEWSLETTER_JID, newsletterMetadata } from '../helpers/fake-newsletter'
import { ADMIN_KEY, buildTestApp, createInstance, type TestApp } from '../helpers/test-app'

const mediaFakes = vi.hoisted(() => {
  function fakeResolvedMedia() {
    return {
      path: '/tmp/fake-channel-media',
      mimetype: 'image/png',
      fileName: 'image.png',
      cleanup: vi.fn(async () => undefined),
    }
  }
  const media = fakeResolvedMedia()
  async function fakeResolveMedia(_input: unknown, _env: unknown) {
    return media
  }
  async function fakeSaveUpload(stream: AsyncIterable<Uint8Array>, _options: unknown) {
    for await (const _chunk of stream) {
      /* Consume the named fake upload. */
    }
    return media
  }
  return { media, resolve: vi.fn(fakeResolveMedia), upload: vi.fn(fakeSaveUpload) }
})
vi.mock('~/media/fetch', async (original) => ({
  ...(await original<typeof import('~/media/fetch')>()),
  resolveMediaToFile: mediaFakes.resolve,
  saveUploadStreamToFile: mediaFakes.upload,
}))

describe('Newsletters REST area', () => {
  let ctx: TestApp
  let apiKey = ''
  const wa = fakeNewsletterClient()
  const { newsletter } = wa
  const channel = `/v1/newsletters/${NEWSLETTER_JID}`
  const request = (method: InjectOptions['method'], url: string, payload?: InjectOptions['payload']) =>
    ctx.app.inject({ method, url, headers: { 'x-api-key': apiKey }, payload })

  beforeAll(async () => {
    ctx = await buildTestApp()
    apiKey = (await createInstance(ctx.app, 'channels')).apiKey
    vi.spyOn(ctx.manager, 'requireRegisteredClient').mockReturnValue(wa as never)
  })
  beforeEach(() => vi.clearAllMocks())
  afterAll(async () => {
    await ctx.app.close()
  })

  it('lists followed channels, recommendations and invite metadata through static paths', async () => {
    expect((await request('GET', '/v1/newsletters')).json()).toEqual({ newsletters: [newsletterMetadata] })
    expect((await request('GET', '/v1/newsletters/recommended?limit=3')).json()).toEqual({
      newsletters: [newsletterMetadata],
    })
    expect(newsletter.fetchRecommended).toHaveBeenCalledWith({ limit: 3 })
    expect((await request('GET', '/v1/newsletters/by-invite/CODE')).json()).toEqual(newsletterMetadata)
    expect(newsletter.fetchByInvite).toHaveBeenCalledWith('CODE')
    expect((await request('GET', channel)).json()).toEqual(newsletterMetadata)
    expect(newsletter.fetch).toHaveBeenCalledWith(NEWSLETTER_JID)
  })
  it('maps directory query and cursor and returns public pagination', async () => {
    const res = await request('GET', '/v1/newsletters/search?q=updates&limit=4&cursor=page1')
    expect(res.statusCode).toBe(200)
    expect(newsletter.searchDirectory).toHaveBeenCalledWith({ searchText: 'updates', limit: 4, startCursor: 'page1' })
    expect(res.json()).toEqual({ results: [newsletterMetadata], pageInfo: { hasNextPage: true, endCursor: 'next' } })
  })
  it('serializes both upstream read envelopes and forwards ranges', async () => {
    for (const [suffix, method] of [
      ['messages', 'fetchMessages'],
      ['updates', 'fetchMessageUpdates'],
    ] as const) {
      const res = await request(
        'GET',
        `${channel}/${suffix}?count=5&before=20&after=2${suffix === 'updates' ? '&since=100' : ''}`,
      )
      expect(res.statusCode).toBe(200)
      expect(res.json()).toEqual({
        name: 'iq',
        attributes: { type: 'result' },
        children: [{ name: 'messages', attributes: {}, bytesBase64: 'AQID' }],
      })
      expect(newsletter[method]).toHaveBeenCalledWith({
        newsletterJid: NEWSLETTER_JID,
        count: 5,
        before: 20,
        after: 2,
        ...(suffix === 'updates' ? { since: 100 } : {}),
      })
    }
  })
  it('follows and unfollows independently from live subscription', async () => {
    for (const action of ['follow', 'unfollow'] as const) {
      expect((await request('POST', `${channel}/${action}`)).json()).toEqual({ ok: true })
      expect(newsletter[action]).toHaveBeenCalledWith(NEWSLETTER_JID)
    }
    expect(newsletter.subscribeLiveUpdates).not.toHaveBeenCalled()
    expect((await request('POST', `${channel}/live-updates`)).json()).toEqual({ durationSeconds: 120 })
    expect(newsletter.subscribeLiveUpdates).toHaveBeenCalledWith(NEWSLETTER_JID)
  })
  it('mutes follower or admin activity', async () => {
    expect((await request('POST', `${channel}/mute`, { muted: true, type: 'admin' })).statusCode).toBe(200)
    expect(newsletter.mute).toHaveBeenCalledWith({ newsletterJid: NEWSLETTER_JID, mute: true, type: 'admin' })
  })
  it('reacts and removes reactions using the server id', async () => {
    for (const reaction of ['🔥', '']) {
      expect((await request('POST', `${channel}/messages/42/react`, { reaction })).json()).toEqual({
        stanzaId: 'REACTION01',
      })
      expect(newsletter.react).toHaveBeenLastCalledWith({
        newsletterJid: NEWSLETTER_JID,
        parentMessageServerId: 42,
        reactionCode: reaction,
        revoke: reaction === '',
      })
    }
  })
  it('votes with binary option hashes and sends view receipts', async () => {
    const option = Buffer.alloc(32, 7)
    expect(
      (await request('POST', `${channel}/messages/42/vote`, { options: [option.toString('base64')] })).statusCode,
    ).toBe(200)
    expect(newsletter.votePoll).toHaveBeenCalledWith({
      newsletterJid: NEWSLETTER_JID,
      parentMessageServerId: 42,
      votes: [option],
    })
    expect((await request('POST', `${channel}/messages/42/view`)).statusCode).toBe(200)
    expect(newsletter.sendViewReceipt).toHaveBeenCalledWith({ newsletterJid: NEWSLETTER_JID, itemServerIds: [42] })
  })
  it('creates and updates channel metadata with binary pictures and removal', async () => {
    const picture = Buffer.from('jpeg')
    expect(
      (
        await request('POST', '/v1/newsletters', {
          name: 'New',
          description: 'News',
          picture: picture.toString('base64'),
        })
      ).json(),
    ).toEqual(newsletterMetadata)
    expect(newsletter.create).toHaveBeenCalledWith({ name: 'New', description: 'News', picture })
    expect(
      (
        await request('PATCH', channel, {
          name: 'Renamed',
          description: '',
          picture: null,
          reactionCodesSetting: 'ALL',
        })
      ).statusCode,
    ).toBe(200)
    expect(newsletter.update).toHaveBeenCalledWith(NEWSLETTER_JID, {
      name: 'Renamed',
      description: '',
      picture: null,
      reactionCodesSetting: 'ALL',
    })
  })
  it('gets admin capabilities, followers and pending invites', async () => {
    expect((await request('GET', `${channel}/admin`)).json()).toEqual({
      adminCount: 2,
      adminProfile: { name: 'Admin' },
      capabilities: ['ADMIN_PROFILE'],
    })
    expect(newsletter.fetchAdminInfo).toHaveBeenCalledWith(NEWSLETTER_JID)
    expect(newsletter.fetchAdminCapabilities).toHaveBeenCalledWith(NEWSLETTER_JID)
    expect((await request('GET', `${channel}/followers?count=2`)).json()).toMatchObject({
      followers: [{ id: '111@lid' }],
    })
    expect(newsletter.fetchFollowers).toHaveBeenCalledWith(NEWSLETTER_JID, { count: 2 })
    expect((await request('GET', `${channel}/pending-invites`)).json()).toEqual({ users: ['111@lid'] })
    expect(newsletter.fetchPendingInvites).toHaveBeenCalledWith(NEWSLETTER_JID)
  })
  it('invites an admin after resolving a username', async () => {
    const res = await request('POST', `${channel}/admins/invite`, { user: '@channeladmin' })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ inviteId: 'INVITE01', expirationTime: 300 })
    expect(wa.profile.resolveUsername).toHaveBeenCalledWith({ username: '@channeladmin' })
    expect(newsletter.createAdminInvite).toHaveBeenCalledWith({ newsletterJid: NEWSLETTER_JID, userJid: '111@lid' })
  })
  it('accepts, revokes and demotes admins and transfers ownership', async () => {
    expect((await request('POST', `${channel}/admins/invite/accept`)).json()).toEqual({ ok: true })
    expect(newsletter.acceptAdminInvite).toHaveBeenCalledWith(NEWSLETTER_JID)
    for (const [path, method] of [
      ['admins/invite/revoke', 'revokeAdminInvite'],
      ['admins/demote', 'demoteAdmin'],
      ['owner', 'changeOwner'],
    ] as const) {
      expect((await request('POST', `${channel}/${path}`, { user: '111@lid' })).json()).toEqual({ ok: true })
      expect(newsletter[method]).toHaveBeenCalledWith({ newsletterJid: NEWSLETTER_JID, userJid: '111@lid' })
    }
  })
  it('publishes through newsletter.send and edits/revokes using the publishing id', async () => {
    const res = await request('POST', `${channel}/messages`, { type: 'text', text: 'News' })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ id: 'CHANNEL01', attempts: 1, ack: { timestamp: '100', refreshLid: false } })
    expect(newsletter.send).toHaveBeenCalledWith(NEWSLETTER_JID, { type: 'text', text: 'News' })
    expect(
      (await request('PATCH', `${channel}/messages/CHANNEL01`, { type: 'text', text: 'Updated' })).statusCode,
    ).toBe(200)
    expect(newsletter.editMessage).toHaveBeenCalledWith(NEWSLETTER_JID, 'CHANNEL01', { type: 'text', text: 'Updated' })
    expect((await request('DELETE', `${channel}/messages/CHANNEL01`)).json()).toEqual({ stanzaId: 'REVOKE01' })
    expect(newsletter.revoke).toHaveBeenCalledWith({ newsletterJid: NEWSLETTER_JID, originalMessageId: 'CHANNEL01' })
  })
  it.each(['image', 'video', 'audio', 'document'])(
    'publishes %s from the existing base64 media helper',
    async (type) => {
      expect(
        (
          await request('POST', `${channel}/messages`, {
            type,
            mediaBase64: 'AQID',
            caption: 'News',
            ptt: true,
            fileName: 'report.bin',
          })
        ).statusCode,
      ).toBe(200)
      expect(mediaFakes.resolve).toHaveBeenCalledWith(
        expect.objectContaining({ mediaBase64: 'AQID' }),
        expect.anything(),
      )
      expect(newsletter.send).toHaveBeenCalledWith(
        NEWSLETTER_JID,
        expect.objectContaining({ type, media: mediaFakes.media.path, fileName: 'report.bin' }),
      )
      expect(mediaFakes.media.cleanup).toHaveBeenCalled()
    },
  )
  it('edits media from a URL and cleans up after an upstream failure', async () => {
    newsletter.editMessage.mockRejectedValueOnce(new Error('upload failed'))
    const res = await request('PATCH', `${channel}/messages/CHANNEL01`, {
      type: 'image',
      mediaUrl: 'https://cdn.example.com/a.png',
    })
    expect(res.statusCode).toBe(500)
    expect(mediaFakes.resolve).toHaveBeenCalledWith(
      expect.objectContaining({ mediaUrl: 'https://cdn.example.com/a.png' }),
      expect.anything(),
    )
    expect(mediaFakes.media.cleanup).toHaveBeenCalled()
  })
  it('accepts multipart media and cleans uploaded files even on validation failure', async () => {
    for (const type of ['image', 'invalid']) {
      const res = await ctx.app.inject({
        method: 'POST',
        url: `${channel}/messages`,
        headers: { 'x-api-key': apiKey, 'content-type': 'multipart/form-data; boundary=channel' },
        payload: `--channel\r\nContent-Disposition: form-data; name="type"\r\n\r\n${type}\r\n--channel\r\nContent-Disposition: form-data; name="file"; filename="photo.png"\r\nContent-Type: image/png\r\n\r\nimage bytes\r\n--channel--\r\n`,
      })
      expect(res.statusCode).toBe(type === 'image' ? 200 : 400)
    }
    expect(mediaFakes.upload).toHaveBeenCalledTimes(2)
    expect(mediaFakes.media.cleanup.mock.calls.length).toBeGreaterThanOrEqual(2)
  })
  it('deletes a channel', async () => {
    expect((await request('DELETE', channel)).json()).toEqual({ ok: true })
    expect(newsletter.delete).toHaveBeenCalledWith(NEWSLETTER_JID)
  })
  it('exports all operations with a Newsletters tag and usable multipart schemas', () => {
    const doc = ctx.app.swagger()
    const operations = Object.entries(doc.paths ?? {}).filter(([path]) => path.startsWith('/v1/newsletters'))
    const count = operations.reduce(
      (sum, [, item]) =>
        sum + Object.keys(item ?? {}).filter((key) => ['get', 'post', 'patch', 'delete'].includes(key)).length,
      0,
    )
    expect(count).toBe(28)
    for (const [, item] of operations) {
      for (const operation of Object.values(item ?? {})) {
        expect(operation).toMatchObject({ tags: ['Newsletters'] })
      }
    }
    const json = JSON.parse(JSON.stringify(doc))
    for (const [path, method] of [
      ['/v1/newsletters/{jid}/messages', 'post'],
      ['/v1/newsletters/{jid}/messages/{messageId}', 'patch'],
    ] as const) {
      const body = json.paths[path][method].requestBody.content
      expect(body['multipart/form-data'].schema.properties.file.format).toBe('binary')
      expect(body['multipart/form-data'].schema.properties.type.enum).toEqual(['image', 'video', 'audio', 'document'])
      expect(body['multipart/form-data'].schema.required).toContain('type')
      expect(body['application/json'].schema.oneOf).toHaveLength(2)
    }
  })
  it('returns 404 for an absent metadata envelope and upstream missing channels', async () => {
    newsletter.fetch.mockResolvedValueOnce({ ...newsletterMetadata, jid: '' })
    expect((await request('GET', '/v1/newsletters/999@newsletter')).statusCode).toBe(404)
    newsletter.fetch.mockResolvedValueOnce({ ...newsletterMetadata, state: 'NON_EXISTING' })
    expect((await request('GET', '/v1/newsletters/999@newsletter')).statusCode).toBe(404)
    newsletter.follow.mockRejectedValueOnce(new Error('iq failed (404: item-not-found)'))
    expect((await request('POST', '/v1/newsletters/999@newsletter/follow')).statusCode).toBe(404)
  })
  it.each([
    ['POST', '/v1/newsletters', { name: '' }],
    ['PATCH', channel, {}],
    ['PATCH', channel, { name: '' }],
    ['POST', `${channel}/mute`, { muted: 'true' }],
    ['POST', `${channel}/admins/invite`, {}],
    ['POST', `${channel}/messages`, { type: 'text' }],
    ['POST', `${channel}/messages`, { type: 'image' }],
    ['POST', `${channel}/messages/42/vote`, { options: ['not a hash'] }],
    ['POST', `${channel}/messages/stanza/react`, { reaction: '🔥' }],
    ['POST', `${channel}/messages/9007199254740992/view`, undefined],
    ['GET', '/v1/newsletters/search?q=a&limit=0', undefined],
    ['GET', `${channel}/messages?count=101`, undefined],
    ['GET', '/v1/newsletters/person@s.whatsapp.net', undefined],
  ] as const)('rejects bad request %s %s', async (method, url, payload) => {
    expect((await request(method, url, payload)).statusCode).toBe(400)
  })
  it('requires an instance key and resolves the target only from that key', async () => {
    expect((await ctx.app.inject({ method: 'GET', url: '/v1/newsletters' })).statusCode).toBe(401)
    expect(
      (await ctx.app.inject({ method: 'GET', url: '/v1/newsletters', headers: { 'x-api-key': ADMIN_KEY } })).statusCode,
    ).toBe(403)
    expect((await request('GET', '/v1/instances/another/newsletters')).statusCode).toBe(404)
    const other = await createInstance(ctx.app, 'other-channels')
    const res = await ctx.app.inject({ method: 'GET', url: '/v1/newsletters', headers: { 'x-api-key': other.apiKey } })
    expect(res.statusCode).toBe(200)
    expect(ctx.manager.requireRegisteredClient).toHaveBeenLastCalledWith('other-channels')
    expect((await request('GET', '/v1/newsletters')).statusCode).toBe(200)
    expect(ctx.manager.requireRegisteredClient).toHaveBeenLastCalledWith('channels')
  })
})
