import type { InjectOptions } from 'fastify'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { proto, type Proto, type WaSendMessageContent, type WaStoredMessageRecord } from 'zapo-js'
import * as mediaFetch from '~/media/fetch'
import { sanitizeRawForStorage } from '~/media/revive-raw'
import type { AppMessage, MessageStore } from '~/store/messages'
import { ADMIN_KEY, buildTestApp, createInstance, type TestApp } from '../helpers/test-app'

const GROUP = '120363000000000@g.us'
const AUTHOR = '222222222@lid'
const SECRET = new Uint8Array(32).fill(7)
const RESULT = { id: 'SENT', attempts: 1, ack: { refreshLid: false }, ackNode: { tag: 'ack', attrs: {} } }

function fakeMessageClient() {
  return {
    message: { send: vi.fn(async (_jid: string, _content: WaSendMessageContent, _options?: unknown) => RESULT) },
  }
}

class FakeMessageStore {
  rows = new Map<string, AppMessage>()
  get = vi.fn(async (_instance: string, id: string) => this.rows.get(id) ?? null)
  upsert = vi.fn(async (_input: unknown) => undefined)
  markEdited = vi.fn(async () => undefined)
  markDeleted = vi.fn(async () => undefined)
  add(id: string, fromMe: boolean, message: Proto.IMessage, remoteJid = GROUP) {
    this.rows.set(id, {
      messageId: id,
      chatJid: remoteJid,
      participantJid: AUTHOR,
      fromMe,
      raw: sanitizeRawForStorage({ key: { id, fromMe, remoteJid, participant: AUTHOR }, message }),
    } as AppMessage)
  }
}

function fakeMessageStores() {
  return {
    messages: { getById: vi.fn(async (_id: string): Promise<WaStoredMessageRecord | null> => null) },
    messageSecret: {
      get: vi.fn(async (_id: string): Promise<{ secret: Uint8Array; senderJid: string } | null> => null),
    },
  }
}

function fakeResolvedMedia() {
  let count = 0
  const cleanup = vi.fn(async () => undefined)
  return {
    cleanup,
    resolve: vi.fn(async (_source: mediaFetch.MediaSource) => ({
      path: `/tmp/fake-media-${++count}`,
      cleanup,
    })),
  }
}

describe('additional message send routes', () => {
  let ctx: TestApp
  let apiKey = ''
  const client = fakeMessageClient()
  const messages = new FakeMessageStore()
  const stores = fakeMessageStores()
  const media = fakeResolvedMedia()

  beforeAll(async () => {
    ctx = await buildTestApp({ messages: messages as unknown as MessageStore })
    apiKey = (await createInstance(ctx.app, 'message-types')).apiKey
    vi.spyOn(ctx.manager, 'requireRegisteredClient').mockReturnValue(client as never)
    vi.spyOn(ctx.manager, 'tryGetClient').mockReturnValue(null)
    vi.spyOn(ctx.manager, 'getMessageStores').mockReturnValue(stores as never)
    vi.spyOn(mediaFetch, 'resolveMediaToFile').mockImplementation(media.resolve)
  })
  beforeEach(() => {
    vi.clearAllMocks()
    messages.rows.clear()
    stores.messages.getById.mockResolvedValue(null)
    stores.messageSecret.get.mockResolvedValue(null)
    messages.add('POLL', false, {
      pollCreationMessageV3: { name: 'Lunch?' },
      messageContextInfo: { messageSecret: SECRET },
    })
    messages.add('EVENT', false, { eventMessage: { name: 'Sync' }, messageContextInfo: { messageSecret: SECRET } })
  })
  afterAll(async () => {
    vi.restoreAllMocks()
    await ctx.app.close()
  })

  const post = (path: string, payload: InjectOptions['payload']) =>
    ctx.app.inject({
      method: 'POST',
      url: `/v1/messages/${path}`,
      headers: { 'x-api-key': apiKey },
      payload,
    })

  it('maps ISO event times and every event option to typed content and projects the send', async () => {
    const fields = {
      name: 'Sync',
      description: 'Weekly',
      location: { latitude: -23, longitude: -46, name: 'HQ' },
      joinLink: 'https://meet.example.com/a',
      extraGuestsAllowed: true,
      isScheduleCall: true,
      isCanceled: false,
      hasReminder: true,
      reminderOffsetSec: 600,
      contextInfo: { expirationSeconds: 86400 },
    }
    const response = await post('event', {
      to: GROUP,
      ...fields,
      startTime: '2026-12-01T12:00:00-03:00',
      endTime: '2026-12-01T16:00:00Z',
    })
    expect(response.statusCode, response.body).toBe(200)
    expect(response.json()).toEqual({ id: RESULT.id, result: RESULT })
    expect(client.message.send).toHaveBeenCalledWith(GROUP, {
      type: 'event',
      ...fields,
      startTime: 1796137200,
      endTime: 1796140800,
    })
    expect(messages.upsert).toHaveBeenCalledWith(expect.objectContaining({ type: 'event', body: 'Sync', fromMe: true }))
  })

  it.each([
    { startTime: '2026-12-01T16:00:00Z', endTime: '2026-12-01T15:00:00Z' },
    { startTime: 'tomorrow' },
    { startTime: '2026-12-01T15:00:00' },
  ])('rejects invalid or reversed event dates: %j', async (dates) => {
    expect((await post('event', { to: GROUP, name: 'Sync', ...dates })).statusCode).toBe(400)
    expect(client.message.send).not.toHaveBeenCalled()
  })

  it.each(['going', 'not_going', 'maybe'])(
    'sends encrypted event response %s with the original author/secret',
    async (response) => {
      const result = await post('event/respond', { to: GROUP, eventMessageId: 'EVENT', response, extraGuestCount: 2 })
      expect(result.statusCode, result.body).toBe(200)
      expect(client.message.send).toHaveBeenCalledWith(GROUP, {
        type: 'event-response',
        response,
        extraGuestCount: 2,
        event: { id: 'EVENT', fromMe: false, participant: AUTHOR, authorJid: AUTHOR, messageSecret: SECRET },
      })
    },
  )

  it.each([
    ['24h', 86400],
    ['7d', 604800],
    ['30d', 2592000],
    [undefined, 86400],
  ] as const)('maps pin duration %s to %s seconds', async (duration, durationSecs) => {
    const result = await post('pin', { to: GROUP, messageId: 'EVENT', pinned: true, ...(duration ? { duration } : {}) })
    expect(result.statusCode, result.body).toBe(200)
    expect(client.message.send).toHaveBeenCalledWith(GROUP, {
      type: 'pin',
      durationSecs,
      target: { remoteJid: GROUP, id: 'EVENT', fromMe: false, participant: AUTHOR },
    })
  })

  it('unpins without a duration', async () => {
    expect((await post('pin', { to: GROUP, messageId: 'EVENT', pinned: false })).statusCode).toBe(200)
    expect(client.message.send).toHaveBeenCalledWith(GROUP, {
      type: 'unpin',
      target: { remoteJid: GROUP, id: 'EVENT', fromMe: false, participant: AUTHOR },
    })
  })

  it.each([
    ['keep', true],
    ['unkeep', false],
  ] as const)('sends %s with a stored target', async (type, kept) => {
    expect((await post('keep', { to: GROUP, messageId: 'EVENT', kept })).statusCode).toBe(200)
    expect(client.message.send).toHaveBeenCalledWith(GROUP, {
      type,
      target: { remoteJid: GROUP, id: 'EVENT', fromMe: false, participant: AUTHOR },
    })
  })

  it.each([true, false])('votes on a stored poll with fromMe=%s and the canonical cached author', async (fromMe) => {
    messages.add('POLL', fromMe, { pollCreationMessageV3: { name: 'Lunch?' } })
    stores.messageSecret.get.mockResolvedValue({ secret: SECRET, senderJid: AUTHOR })
    const response = await post('poll/vote', { to: GROUP, pollMessageId: 'POLL', options: ['Pizza'] })
    expect(response.statusCode, response.body).toBe(200)
    expect(client.message.send).toHaveBeenCalledWith(GROUP, {
      type: 'poll-vote',
      selectedOptionNames: ['Pizza'],
      poll: { id: 'POLL', fromMe, participant: AUTHOR, authorJid: AUTHOR, messageSecret: SECRET },
    })
  })

  it.each(['poll', 'event'])('targets our own %s when the projection holds only a publish result', async (kind) => {
    const id = kind.toUpperCase()
    messages.rows.set(id, {
      messageId: id,
      chatJid: GROUP,
      fromMe: true,
      type: kind,
      participantJid: null,
      raw: RESULT,
    } as AppMessage)
    stores.messageSecret.get.mockResolvedValue({ secret: SECRET, senderJid: AUTHOR })
    const response =
      kind === 'poll'
        ? await post('poll/vote', { to: GROUP, pollMessageId: id, options: ['Pizza'] })
        : await post('event/respond', { to: GROUP, eventMessageId: id, response: 'going' })
    expect(response.statusCode, response.body).toBe(200)
    expect(client.message.send).toHaveBeenCalledWith(
      GROUP,
      expect.objectContaining({
        [kind === 'poll' ? 'poll' : 'event']: {
          id,
          fromMe: true,
          participant: AUTHOR,
          authorJid: AUTHOR,
          messageSecret: SECRET,
        },
      }),
    )
  })

  it('loads an outbound poll from the session mailbox when only the publish result was projected', async () => {
    messages.rows.clear()
    stores.messages.getById.mockResolvedValue({
      id: 'POLL',
      threadJid: GROUP,
      fromMe: true,
      senderJid: AUTHOR,
      participantJid: AUTHOR,
      messageBytes: proto.Message.encode({
        pollCreationMessageV3: { name: 'Lunch?' },
        messageContextInfo: { messageSecret: SECRET },
      }).finish(),
    })
    expect((await post('poll/vote', { to: GROUP, pollMessageId: 'POLL', options: ['Pizza'] })).statusCode).toBe(200)
    expect(client.message.send).toHaveBeenCalledWith(GROUP, {
      type: 'poll-vote',
      selectedOptionNames: ['Pizza'],
      poll: { id: 'POLL', fromMe: true, participant: AUTHOR, authorJid: AUTHOR, messageSecret: SECRET },
    })
  })

  it.each([
    ['poll/vote', { to: GROUP, pollMessageId: 'POLL', options: [] }],
    ['pin', { to: GROUP, messageId: 'EVENT', pinned: true, duration: '2d' }],
    ['pin', { to: GROUP, messageId: 'EVENT', pinned: true, duration: null }],
    ['event/respond', { to: GROUP, eventMessageId: 'EVENT', response: 'yes' }],
    ['event/respond', { to: GROUP, eventMessageId: 'EVENT', response: 'going', extraGuestCount: -1 }],
    ['keep', { to: GROUP, messageId: 'EVENT', kept: 'yes' }],
  ])('rejects invalid %s body %j', async (path, payload) => {
    expect((await post(path, payload)).statusCode).toBe(400)
    expect(client.message.send).not.toHaveBeenCalled()
  })

  it('rejects targets from another chat', async () => {
    expect((await post('keep', { to: '999@g.us', messageId: 'EVENT', kept: true })).statusCode).toBe(400)
    expect(client.message.send).not.toHaveBeenCalled()
  })
  it('returns 404 for an unavailable original', async () => {
    expect((await post('pin', { to: GROUP, messageId: 'MISSING', pinned: true })).statusCode).toBe(404)
  })
  it('rejects voting on an event', async () => {
    expect((await post('poll/vote', { to: GROUP, pollMessageId: 'EVENT', options: ['Pizza'] })).statusCode).toBe(400)
  })
  it.each(['event', 'poll'])('returns 409 when the original %s has no secret', async (kind) => {
    const id = kind.toUpperCase()
    messages.add(
      id,
      false,
      kind === 'event' ? { eventMessage: { name: 'Sync' } } : { pollCreationMessageV3: { name: 'Q' } },
    )
    const response =
      kind === 'event'
        ? await post('event/respond', { to: GROUP, eventMessageId: id, response: 'going' })
        : await post('poll/vote', { to: GROUP, pollMessageId: id, options: ['Pizza'] })
    expect(response.statusCode).toBe(409)
    expect(client.message.send).not.toHaveBeenCalled()
  })

  it.each([{ mediaUrl: 'https://cdn.example.com/note.mp4' }, { mediaBase64: 'dmlkZW8=' }])(
    'sends PTV using the existing media resolver: %j',
    async (source) => {
      const response = await post('ptv', { to: GROUP, ...source })
      expect(response.statusCode, response.body).toBe(200)
      expect(client.message.send).toHaveBeenCalledWith(GROUP, {
        type: 'ptv',
        media: expect.any(String),
        mimetype: 'video/mp4',
        contextInfo: undefined,
      })
      expect(media.cleanup).toHaveBeenCalledOnce()
    },
  )
  it('cleans PTV media when send fails', async () => {
    client.message.send.mockRejectedValueOnce(new Error('send failed'))
    expect((await post('ptv', { to: GROUP, mediaBase64: 'dmlkZW8=' })).statusCode).toBe(500)
    expect(media.cleanup).toHaveBeenCalledOnce()
  })
  it('projects the resolved PTV MIME type', async () => {
    expect((await post('ptv', { to: GROUP, mediaBase64: 'dmlkZW8=', mimetype: 'video/webm' })).statusCode).toBe(200)
    expect(messages.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'ptv', mediaMime: 'video/webm', hasMedia: true }),
    )
  })
  it('accepts multipart PTV without caption', async () => {
    const response = await ctx.app.inject({
      method: 'POST',
      url: '/v1/messages/ptv',
      headers: {
        'x-api-key': apiKey,
        'content-type': 'multipart/form-data; boundary=ptv-test',
      },
      payload: Buffer.from(
        `--ptv-test\r\nContent-Disposition: form-data; name="to"\r\n\r\n${GROUP}\r\n--ptv-test\r\nContent-Disposition: form-data; name="file"; filename="note.mp4"\r\nContent-Type: video/mp4\r\n\r\nvideo\r\n--ptv-test--\r\n`,
      ),
    })
    expect(response.statusCode, response.body).toBe(200)
    expect(client.message.send).toHaveBeenCalledWith(GROUP, {
      type: 'ptv',
      media: expect.any(String),
      mimetype: 'video/mp4',
      contextInfo: undefined,
    })
  })
  it('rejects PTV captions and missing media', async () => {
    expect((await post('ptv', { to: GROUP, mediaBase64: 'dmlkZW8=', caption: 'no' })).statusCode).toBe(400)
    expect((await post('ptv', { to: GROUP })).statusCode).toBe(400)
  })
  it('cleans a multipart upload when schema validation rejects its caption', async () => {
    const saveUpload = mediaFetch.saveUploadStreamToFile
    const files: mediaFetch.ResolvedMedia[] = []
    async function captureUpload(...args: Parameters<typeof saveUpload>) {
      const file = await saveUpload(...args)
      const cleanup = vi.fn(file.cleanup)
      const captured = { ...file, cleanup }
      files.push(captured)
      return captured
    }
    vi.spyOn(mediaFetch, 'saveUploadStreamToFile').mockImplementationOnce(captureUpload)
    const response = await ctx.app.inject({
      method: 'POST',
      url: '/v1/messages/ptv',
      headers: {
        'x-api-key': apiKey,
        'content-type': 'multipart/form-data; boundary=ptv-invalid',
      },
      payload: Buffer.from(
        `--ptv-invalid\r\nContent-Disposition: form-data; name="to"\r\n\r\n${GROUP}\r\n--ptv-invalid\r\nContent-Disposition: form-data; name="caption"\r\n\r\ninvalid\r\n--ptv-invalid\r\nContent-Disposition: form-data; name="file"; filename="note.mp4"\r\nContent-Type: video/mp4\r\n\r\nvideo\r\n--ptv-invalid--\r\n`,
      ),
    })
    expect(response.statusCode, response.body).toBe(400)
    expect(files).toHaveLength(1)
    expect(files[0]?.cleanup).toHaveBeenCalledOnce()
    expect(client.message.send).not.toHaveBeenCalled()
  })

  const pack = () => ({
    to: GROUP,
    id: 'team-pack',
    name: 'Team',
    publisher: 'Example',
    stickers: [{ media: { url: 'https://cdn.example.com/hi.webp' }, fileName: 'hi.webp', emojis: ['👋'] }],
    trayIcon: { media: { base64: 'dHJheQ==' }, fileName: 'tray.png' },
    coverThumbnail: { base64: 'Y292ZXI=' },
  })

  it('maps pack id, media, emojis, tray icon and cover to the exact upstream shape', async () => {
    const response = await post('sticker-pack', pack())
    expect(response.statusCode, response.body).toBe(200)
    const paths = media.resolve.mock.results.map(() => expect.any(String))
    expect(client.message.send).toHaveBeenCalledWith(GROUP, {
      type: 'sticker-pack',
      stickerPackId: 'team-pack',
      name: 'Team',
      publisher: 'Example',
      stickers: [{ media: paths[0], fileName: 'hi.webp', emojis: ['👋'] }],
      trayIcon: { media: paths[1], fileName: 'tray.png' },
      coverThumbnail: paths[2],
      contextInfo: undefined,
    })
    expect(media.resolve).toHaveBeenNthCalledWith(
      1,
      { mediaUrl: 'https://cdn.example.com/hi.webp', mediaBase64: undefined },
      ctx.env,
    )
    expect(media.cleanup).toHaveBeenCalledTimes(3)
  })
  it('accepts 30 stickers and defaults omitted emojis to an empty array', async () => {
    const payload = {
      ...pack(),
      stickers: Array.from({ length: 30 }, (_, i) => ({
        media: { base64: 'c3RpY2tlcg==' },
        fileName: `${i}.webp`,
      })),
    }
    expect((await post('sticker-pack', payload)).statusCode).toBe(200)
    expect(client.message.send).toHaveBeenCalledWith(
      GROUP,
      expect.objectContaining({
        stickers: expect.arrayContaining([{ media: expect.any(String), fileName: '0.webp', emojis: [] }]),
      }),
    )
  })
  it('cleans all pack media when send fails', async () => {
    client.message.send.mockRejectedValueOnce(new Error('send failed'))
    expect((await post('sticker-pack', pack())).statusCode).toBe(500)
    expect(media.cleanup).toHaveBeenCalledTimes(3)
  })
  it('cleans already resolved files if a later download fails', async () => {
    media.resolve
      .mockResolvedValueOnce({ path: '/tmp/fake-first', cleanup: media.cleanup })
      .mockRejectedValueOnce(new Error('download failed'))
    expect((await post('sticker-pack', pack())).statusCode).toBe(500)
    expect(media.cleanup).toHaveBeenCalledOnce()
    expect(client.message.send).not.toHaveBeenCalled()
  })
  it.each(['count', 'duplicate', 'tray-collision', 'two-sources', 'local-path', 'accessibilityLabel'])(
    'rejects invalid sticker pack: %s',
    async (invalid) => {
      const payload = pack()
      const sticker = payload.stickers[0]
      if (!sticker) throw new Error('fake pack must contain a sticker')
      if (invalid === 'count')
        payload.stickers = Array.from({ length: 31 }, (_, i) => ({ ...sticker, fileName: `${i}.webp` }))
      if (invalid === 'duplicate') payload.stickers.push(sticker)
      if (invalid === 'tray-collision') payload.trayIcon.fileName = sticker.fileName
      if (invalid === 'two-sources') Object.assign(sticker.media, { base64: 'eA==' })
      if (invalid === 'local-path') Object.assign(sticker, { media: '/etc/passwd' })
      if (invalid === 'accessibilityLabel') Object.assign(sticker, { accessibilityLabel: 'hi' })
      expect((await post('sticker-pack', payload)).statusCode).toBe(400)
      expect(client.message.send).not.toHaveBeenCalled()
      expect(media.resolve).not.toHaveBeenCalled()
    },
  )

  it.each([
    ['reply', { text: 'Hi', quotedMessageId: 'ORIGINAL' }],
    ['image', { mediaBase64: 'eA==' }],
    ['video', { mediaBase64: 'eA==' }],
    ['audio', { mediaBase64: 'eA==' }],
    ['document', { mediaBase64: 'eA==' }],
    ['sticker', { mediaBase64: 'eA==' }],
    ['poll', { name: 'Lunch?', options: ['Pizza', 'Sushi'] }],
    ['edit', { messageId: 'ORIGINAL', text: 'Updated' }],
  ])('passes safe context on the existing %s typed route', async (path, fields) => {
    const contextInfo = { expirationSeconds: 3600, ephemeralSettingTimestamp: 1796137200 }
    expect((await post(path, { to: GROUP, ...fields, contextInfo })).statusCode).toBe(200)
    expect(client.message.send.mock.calls[0]?.[1]).toEqual(expect.objectContaining({ contextInfo }))
  })

  it.each([
    ['react', { messageId: 'ORIGINAL', emoji: '👍' }],
    ['revoke', { messageId: 'ORIGINAL' }],
  ])('passes safe context as send options on %s', async (path, fields) => {
    const contextInfo = { expirationSeconds: 3600 }
    expect((await post(path, { to: GROUP, ...fields, contextInfo })).statusCode).toBe(200)
    expect(client.message.send.mock.calls[0]?.[2]).toEqual({ contextInfo })
  })

  it('passes safe text context and rejects raw context fields', async () => {
    expect((await post('text', { to: GROUP, text: 'Hi', contextInfo: { expirationSeconds: 86400 } })).statusCode).toBe(
      200,
    )
    expect(client.message.send).toHaveBeenCalledWith(
      GROUP,
      { type: 'text', text: 'Hi', linkPreview: undefined, contextInfo: { expirationSeconds: 86400 } },
      { mentions: undefined },
    )
    expect(
      (await post('text', { to: GROUP, text: 'Hi', contextInfo: { raw: { messageSecret: 'no' } } })).statusCode,
    ).toBe(400)
  })

  it('rejects admin keys and unauthenticated requests', async () => {
    for (const headers of [{}, { 'x-api-key': ADMIN_KEY }]) {
      const response = await ctx.app.inject({
        method: 'POST',
        url: '/v1/messages/event',
        headers,
        payload: { to: GROUP, name: 'Sync', startTime: '2026-12-01T15:00:00Z' },
      })
      expect([401, 403]).toContain(response.statusCode)
    }
  })
})
