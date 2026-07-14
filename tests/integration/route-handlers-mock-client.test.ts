import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { ADMIN_KEY, buildMockedWaApp, INSTANCE, INSTANCE_KEY, type MockWaApp } from '../helpers/mock-wa-app'

describe('route handlers with mocked WA client', () => {
  let ctx: MockWaApp
  const key = { 'x-api-key': INSTANCE_KEY }
  const admin = { 'x-api-key': ADMIN_KEY }

  beforeAll(async () => {
    ctx = await buildMockedWaApp()
  })

  afterAll(async () => {
    await ctx.app.close()
  })

  describe('messages', () => {
    it('POST text sends via client and stores message', async () => {
      const res = await ctx.app.inject({
        method: 'POST',
        url: `/v1/messages/text`,
        headers: key,
        payload: { to: '5511999999999', text: 'hello sprint c' },
      })
      expect(res.statusCode).toBe(200)
      const body = res.json() as { id: string }
      expect(body.id).toMatch(/^3EB0/)
      expect(ctx.client.message.send).toHaveBeenCalled()
      const stored = await ctx.messages.get(INSTANCE, body.id)
      expect(stored?.body).toBe('hello sprint c')
      expect(stored?.fromMe).toBe(true)
    })

    it('POST location / poll / react hit client', async () => {
      const loc = await ctx.app.inject({
        method: 'POST',
        url: `/v1/messages/location`,
        headers: key,
        payload: { to: '5511888888888', latitude: -23.5, longitude: -46.6, name: 'SP' },
      })
      expect(loc.statusCode).toBe(200)

      const poll = await ctx.app.inject({
        method: 'POST',
        url: `/v1/messages/poll`,
        headers: key,
        payload: { to: '5511888888888', name: 'lunch?', options: ['a', 'b'] },
      })
      expect(poll.statusCode).toBe(200)

      const react = await ctx.app.inject({
        method: 'POST',
        url: `/v1/messages/react`,
        headers: key,
        payload: { to: '5511888888888', messageId: 'MSGX', emoji: '👍' },
      })
      expect(react.statusCode).toBe(200)
      expect(ctx.client.message.send.mock.calls.length).toBeGreaterThanOrEqual(3)
    })
  })

  describe('chats', () => {
    it('lists and gets chats + messages from memory store', async () => {
      await ctx.chats.upsert({
        instanceName: INSTANCE,
        chatJid: '5511888888888@s.whatsapp.net',
        name: 'Cliente',
        lastMessagePreview: 'oi',
        lastMessageTs: Date.now(),
        unreadCount: 2,
      })
      await ctx.messages.upsert({
        instanceName: INSTANCE,
        messageId: 'CHATMSG1',
        chatJid: '5511888888888@s.whatsapp.net',
        fromMe: false,
        type: 'text',
        body: 'oi',
        timestampMs: Date.now(),
      })

      const list = await ctx.app.inject({
        method: 'GET',
        url: `/v1/chats`,
        headers: key,
      })
      expect(list.statusCode).toBe(200)
      expect((list.json() as { chats: unknown[] }).chats.length).toBeGreaterThanOrEqual(1)

      const one = await ctx.app.inject({
        method: 'GET',
        url: `/v1/chats/${encodeURIComponent('5511888888888@s.whatsapp.net')}`,
        headers: key,
      })
      expect(one.statusCode).toBe(200)

      const msgs = await ctx.app.inject({
        method: 'GET',
        url: `/v1/chats/${encodeURIComponent('5511888888888@s.whatsapp.net')}/messages`,
        headers: key,
      })
      expect(msgs.statusCode).toBe(200)
      const payload = msgs.json() as { messages: Array<{ id?: string; body?: string }> }
      expect(payload.messages.length).toBeGreaterThanOrEqual(1)
      expect(payload.messages.some((m) => m.body === 'oi')).toBe(true)
    })
  })

  describe('contacts', () => {
    it('lists contacts and builds local jid', async () => {
      await ctx.contacts.upsert({
        instanceName: INSTANCE,
        jid: '5511777777777@s.whatsapp.net',
        pushName: 'Zé',
      })
      const list = await ctx.app.inject({
        method: 'GET',
        url: `/v1/contacts`,
        headers: key,
      })
      expect(list.statusCode).toBe(200)
      expect((list.json() as { contacts: unknown[] }).contacts.length).toBeGreaterThanOrEqual(1)

      const jid = await ctx.app.inject({
        method: 'POST',
        url: `/v1/contacts/jid`,
        headers: key,
        payload: { numbers: ['11999999999'] },
      })
      expect(jid.statusCode).toBe(200)
    })

    it('check/resolve uses profile.getLidsByPhoneNumbers', async () => {
      const check = await ctx.app.inject({
        method: 'POST',
        url: `/v1/contacts/check`,
        headers: key,
        payload: { phones: ['5511999999999'] },
      })
      expect(check.statusCode).toBe(200)
      expect(ctx.client.profile.getLidsByPhoneNumbers).toHaveBeenCalled()

      const resolve = await ctx.app.inject({
        method: 'POST',
        url: `/v1/contacts/resolve`,
        headers: key,
        payload: { numbers: ['5511888888888'] },
      })
      expect(resolve.statusCode).toBe(200)
    })
  })

  describe('groups', () => {
    // Regression for P0-1: the handler must CALL client.group.queryAllGroups() and
    // return the resolved array. A missing `()` returned the bound method/Promise, so a
    // shape assert (array of group objects) is required — a status-200 check would not catch it.
    it('lists groups from client as an array of group objects', async () => {
      const res = await ctx.app.inject({
        method: 'GET',
        url: `/v1/groups`,
        headers: key,
      })
      expect(res.statusCode).toBe(200)
      const body = res.json() as { groups: Array<{ id?: string; subject?: string }> }
      expect(Array.isArray(body.groups)).toBe(true)
      expect(body.groups.length).toBeGreaterThanOrEqual(1)
      expect(body.groups[0]).toMatchObject({ id: '120363@g.us', subject: 'Test Group' })
      expect(ctx.client.group.queryAllGroups).toHaveBeenCalled()
    })
  })

  describe('blocklist', () => {
    // Regression for P0-2: the handler must CALL client.privacy.getBlocklist() and
    // return the resolved array under `blocklist`.
    it('returns blocklist from client as an array', async () => {
      const res = await ctx.app.inject({
        method: 'GET',
        url: `/v1/blocklist`,
        headers: key,
      })
      expect(res.statusCode).toBe(200)
      const body = res.json() as { blocklist: unknown[] }
      expect(Array.isArray(body.blocklist)).toBe(true)
      expect(body.blocklist).toContain('5511000000000@s.whatsapp.net')
      expect(ctx.client.privacy.getBlocklist).toHaveBeenCalled()
    })
  })

  describe('labels', () => {
    it('CRUD labels via store + chat.set on create', async () => {
      const create = await ctx.app.inject({
        method: 'POST',
        url: `/v1/labels`,
        headers: key,
        payload: { id: 'vip', name: 'VIP', color: 1 },
      })
      expect(create.statusCode).toBe(200)
      expect(ctx.client.chat.set).toHaveBeenCalled()

      const list = await ctx.app.inject({
        method: 'GET',
        url: `/v1/labels`,
        headers: key,
      })
      expect(list.statusCode).toBe(200)
      expect((list.json() as { labels: Array<{ id: string }> }).labels.some((l) => l.id === 'vip')).toBe(true)
    })
  })

  describe('lids', () => {
    it('lists and counts lid mappings', async () => {
      ctx.lids.seed({
        lid: '123@lid',
        pn: '5511999999999',
        displayName: 'A',
        pushName: 'A',
        source: 'app_contacts',
      })
      const list = await ctx.app.inject({
        method: 'GET',
        url: `/v1/lids`,
        headers: key,
      })
      expect(list.statusCode).toBe(200)
      expect((list.json() as { lids: unknown[] }).lids.length).toBe(1)

      const count = await ctx.app.inject({
        method: 'GET',
        url: `/v1/lids/count`,
        headers: key,
      })
      expect(count.statusCode).toBe(200)
      expect((count.json() as { count: number }).count).toBe(1)
    })
  })

  describe('presence', () => {
    it('sets presence and chatstate', async () => {
      const p = await ctx.app.inject({
        method: 'POST',
        url: `/v1/presence`,
        headers: key,
        payload: { type: 'available' },
      })
      expect(p.statusCode).toBe(200)
      expect(ctx.client.presence.send).toHaveBeenCalled()

      const cs = await ctx.app.inject({
        method: 'POST',
        url: `/v1/chats/5511888888888/chatstate`,
        headers: key,
        payload: { state: 'composing' },
      })
      expect(cs.statusCode).toBe(200)
      expect(ctx.client.presence.sendChatstate).toHaveBeenCalled()
    })
  })

  describe('messages edit/revoke/reply', () => {
    it('edit and revoke existing message', async () => {
      await ctx.messages.upsert({
        instanceName: INSTANCE,
        messageId: 'EDITME',
        chatJid: '5511888888888@s.whatsapp.net',
        fromMe: true,
        type: 'text',
        body: 'old',
      })
      const edit = await ctx.app.inject({
        method: 'POST',
        url: `/v1/messages/edit`,
        headers: key,
        payload: { to: '5511888888888', messageId: 'EDITME', text: 'new text' },
      })
      expect(edit.statusCode).toBe(200)
      expect((await ctx.messages.get(INSTANCE, 'EDITME'))?.body).toBe('new text')

      const rev = await ctx.app.inject({
        method: 'POST',
        url: `/v1/messages/revoke`,
        headers: key,
        payload: { to: '5511888888888', messageId: 'EDITME' },
      })
      expect(rev.statusCode).toBe(200)
    })

    it('reply quotes a message', async () => {
      const res = await ctx.app.inject({
        method: 'POST',
        url: `/v1/messages/reply`,
        headers: key,
        payload: {
          to: '5511888888888',
          text: 'replying',
          quotedMessageId: 'CHATMSG1',
        },
      })
      expect(res.statusCode).toBe(200)
    })
  })

  describe('chats mutations', () => {
    it('archive + mark read', async () => {
      const jid = encodeURIComponent('5511888888888@s.whatsapp.net')
      const arch = await ctx.app.inject({
        method: 'POST',
        url: `/v1/chats/${jid}/archive`,
        headers: key,
      })
      expect(arch.statusCode).toBe(200)

      const unarch = await ctx.app.inject({
        method: 'POST',
        url: `/v1/chats/${jid}/unarchive`,
        headers: key,
      })
      expect(unarch.statusCode).toBe(200)

      const read = await ctx.app.inject({
        method: 'POST',
        url: `/v1/chats/${jid}/messages/read`,
        headers: key,
        payload: { messageIds: ['CHATMSG1'] },
      })
      expect(read.statusCode).toBe(200)
      expect(ctx.client.message.sendReceipt).toHaveBeenCalled()
    })

    it('get single message by id', async () => {
      const res = await ctx.app.inject({
        method: 'GET',
        url: `/v1/chats/${encodeURIComponent('5511888888888@s.whatsapp.net')}/messages/CHATMSG1`,
        headers: key,
      })
      expect(res.statusCode).toBe(200)
    })
  })

  describe('privacy', () => {
    it('get and set privacy settings', async () => {
      const get = await ctx.app.inject({
        method: 'GET',
        url: `/v1/privacy`,
        headers: key,
      })
      expect(get.statusCode).toBe(200)
      expect(ctx.client.privacy.getPrivacySettings).toHaveBeenCalled()

      const set = await ctx.app.inject({
        method: 'POST',
        url: `/v1/privacy`,
        headers: key,
        payload: { setting: 'last', value: 'contacts' },
      })
      expect(set.statusCode).toBe(200)
    })
  })

  describe('auth scoping', () => {
    it('admin cannot call instance operational routes', async () => {
      const res = await ctx.app.inject({
        method: 'GET',
        url: `/v1/chats`,
        headers: admin,
      })
      expect(res.statusCode).toBe(403)
    })

    it('admin can list instances', async () => {
      const res = await ctx.app.inject({ method: 'GET', url: '/v1/instances', headers: admin })
      expect(res.statusCode).toBe(200)
    })
  })

  describe('profile name + image', () => {
    it('GET /profile aligns pushName/avatar with /v1/instance (bare JID for IQs)', async () => {
      // Device meJid must be stripped before getStatus / getProfilePicture
      ctx.client.getCredentials.mockReturnValue({
        meJid: '5511999888777:57@s.whatsapp.net',
        meDisplayName: 'Rafael Santana',
        // empty pushName — enrich should still use meDisplayName
        pushName: '',
      })
      ctx.client.profile.getStatus.mockResolvedValue({ status: 'Atendimento 9–18h' })
      ctx.client.profile.getProfilePicture.mockResolvedValue({
        id: 'pic1',
        url: 'https://mmg.whatsapp.net/ephemeral.jpg',
      } as { url: string })
      // Seed meJid on instance row so enrich can build avatar path
      await ctx.repo.updateStatus(INSTANCE, {
        meJid: '5511999888777:57@s.whatsapp.net',
        pushName: null,
      })

      const profileRes = await ctx.app.inject({
        method: 'GET',
        url: '/v1/profile',
        headers: key,
      })
      expect(profileRes.statusCode).toBe(200)
      const profileBody = profileRes.json() as {
        profile: {
          pushName: string | null
          avatarUrl: string | null
          status: string | null
          picture: { url?: string; id?: string } | null
          bareJid: string | null
          meJid: string | null
        }
      }
      expect(profileBody.profile.pushName).toBe('Rafael Santana')
      expect(profileBody.profile.bareJid).toBe('5511999888777@s.whatsapp.net')
      expect(profileBody.profile.status).toBe('Atendimento 9–18h')
      expect(profileBody.profile.picture).toBeTruthy()
      // IQ must use bare PN, not device JID
      expect(ctx.client.profile.getStatus).toHaveBeenCalledWith('5511999888777@s.whatsapp.net')
      expect(ctx.client.profile.getProfilePicture).toHaveBeenCalledWith('5511999888777@s.whatsapp.net', 'preview')

      const instRes = await ctx.app.inject({
        method: 'GET',
        url: '/v1/instance',
        headers: key,
      })
      expect(instRes.statusCode).toBe(200)
      const inst = (instRes.json() as { instance: { pushName: string | null; avatarUrl: string | null } }).instance
      // Same identity fields as instance get
      expect(profileBody.profile.pushName).toBe(inst.pushName)
      expect(profileBody.profile.avatarUrl).toBe(inst.avatarUrl)
      // picture.url prefers durable avatarUrl when present
      if (inst.avatarUrl) {
        expect(profileBody.profile.picture?.url).toBe(inst.avatarUrl)
      }
    })

    it('PUT /profile/name (short) sets push name on WhatsApp', async () => {
      const res = await ctx.app.inject({
        method: 'PUT',
        url: '/v1/profile/name',
        headers: key,
        payload: { name: 'Loja Sales' },
      })
      expect(res.statusCode).toBe(200)
      expect(res.json()).toMatchObject({ ok: true })
      expect(ctx.client.profile.setPushName).toHaveBeenCalledWith('Loja Sales')
    })

    it('PUT /instances/:name/profile/name accepts pushName alias', async () => {
      const res = await ctx.app.inject({
        method: 'PUT',
        url: `/v1/profile/name`,
        headers: key,
        payload: { pushName: 'Alias Name' },
      })
      expect(res.statusCode).toBe(200)
      expect(ctx.client.profile.setPushName).toHaveBeenCalledWith('Alias Name')
    })

    it('PUT /profile/image (short) sets avatar from base64', async () => {
      const jpegB64 = Buffer.from([0xff, 0xd8, 0xff, 0xd9, 0x00, 0x01]).toString('base64')
      const res = await ctx.app.inject({
        method: 'PUT',
        url: '/v1/profile/image',
        headers: key,
        payload: { mediaBase64: jpegB64, mimetype: 'image/jpeg' },
      })
      expect(res.statusCode).toBe(200)
      const body = res.json() as { ok: boolean; pictureId?: string }
      expect(body.ok).toBe(true)
      expect(body.pictureId).toBe('pic-id-1')
      expect(ctx.client.profile.setProfilePicture).toHaveBeenCalled()
      const calls = ctx.client.profile.setProfilePicture.mock.calls as unknown as unknown[][]
      const bytes = calls.at(-1)?.[0]
      expect(Buffer.isBuffer(bytes)).toBe(true)
      expect((bytes as Buffer).byteLength).toBeGreaterThan(0)
    })

    it('PUT /profile/picture is alias of /profile/image', async () => {
      const jpegB64 = Buffer.from([0xff, 0xd8, 0xff, 0xd9, 0x02]).toString('base64')
      const res = await ctx.app.inject({
        method: 'PUT',
        url: `/v1/profile/picture`,
        headers: key,
        payload: { mediaBase64: jpegB64 },
      })
      expect(res.statusCode).toBe(200)
      expect(ctx.client.profile.setProfilePicture).toHaveBeenCalled()
    })

    it('rejects image without media source', async () => {
      const res = await ctx.app.inject({
        method: 'PUT',
        url: '/v1/profile/image',
        headers: key,
        payload: {},
      })
      expect(res.statusCode).toBe(400)
    })

    it('DELETE /profile/image removes avatar', async () => {
      const res = await ctx.app.inject({
        method: 'DELETE',
        url: '/v1/profile/image',
        headers: key,
      })
      expect(res.statusCode).toBe(200)
      expect(ctx.client.profile.deleteProfilePicture).toHaveBeenCalled()
    })
  })
})
