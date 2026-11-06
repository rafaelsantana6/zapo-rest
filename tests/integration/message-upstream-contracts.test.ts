import { mkdtemp, readdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import sharp from 'sharp'
import type { Proto, WaSendMessageContent, WaSendMessageOptions } from 'zapo-js'
import {
  buildMediaMessageContent,
  fakeDispatchOptions,
  fakeMediaOptions,
  FakeMediaTransfer,
  WaMessageDispatchCoordinator,
} from '../helpers/zapo-message-internals'
import { buildTestApp, createInstance, type TestApp } from '../helpers/test-app'

const GROUP = '120363000000000@g.us'
const PEER = '222222222@lid'
const RESULT = { id: 'CONTRACT', attempts: 1, ack: { refreshLid: false }, ackNode: { tag: 'ack', attrs: {} } }

describe('real upstream message builder and context pipeline', () => {
  let ctx: TestApp
  let apiKey = ''
  let pngBase64 = ''
  let mediaDir = ''
  let lastMessage: Proto.IMessage | undefined
  const transfer = new FakeMediaTransfer()
  const mediaOptions = fakeMediaOptions(transfer)

  async function sendWithRealBuilder(jid: string, content: WaSendMessageContent) {
    lastMessage = (await buildMediaMessageContent(mediaOptions, content, { to: jid })).message
    return RESULT
  }
  const client = { message: { send: vi.fn(sendWithRealBuilder) } }

  beforeAll(async () => {
    pngBase64 = (
      await sharp({ create: { width: 32, height: 16, channels: 4, background: '#ff000080' } })
        .png()
        .toBuffer()
    ).toString('base64')
    ctx = await buildTestApp()
    mediaDir = await mkdtemp(join(tmpdir(), 'zapo-message-contract-'))
    ctx.env.MEDIA_TMP_DIR = mediaDir
    apiKey = (await createInstance(ctx.app, 'upstream-contracts')).apiKey
    vi.spyOn(ctx.manager, 'requireRegisteredClient').mockReturnValue(client as never)
    vi.spyOn(ctx.manager, 'tryGetClient').mockReturnValue(null)
  })
  afterAll(async () => {
    vi.restoreAllMocks()
    await ctx.app.close()
    await rm(mediaDir, { recursive: true, force: true })
  })

  it.each([false, true])(
    'builds a real sticker pack with explicit cover=%s and JPEG thumbnail upload',
    async (explicitCover) => {
      transfer.uploads.length = 0
      const response = await ctx.app.inject({
        method: 'POST',
        url: '/v1/messages/sticker-pack',
        headers: { 'x-api-key': apiKey },
        payload: {
          to: GROUP,
          id: 'team',
          name: 'Team',
          publisher: 'Example',
          stickers: [{ fileName: 'hi.webp', media: { base64: pngBase64 } }],
          trayIcon: { fileName: 'tray.png', media: { base64: pngBase64 } },
          ...(explicitCover ? { coverThumbnail: { base64: pngBase64 } } : {}),
        },
      })
      expect(response.statusCode, response.body).toBe(200)
      expect(lastMessage?.stickerPackMessage).toMatchObject({
        stickerPackId: 'team',
        thumbnailWidth: 252,
        thumbnailHeight: 252,
        thumbnailDirectPath: '/upload',
      })
      expect(transfer.uploads.map((upload) => upload.contentType).sort()).toEqual(['application/zip', 'image/jpeg'])
      const content = client.message.send.mock.calls.at(-1)?.[1]
      if (
        typeof content !== 'object' ||
        !('type' in content) ||
        content.type !== 'sticker-pack' ||
        !(content.coverThumbnail instanceof Uint8Array)
      )
        throw new Error('missing generated JPEG cover')
      expect(await sharp(Buffer.from(content.coverThumbnail)).metadata()).toMatchObject({
        format: 'jpeg',
        width: 252,
        height: 252,
      })
    },
  )

  it('rejects a pack exceeding the cumulative budget and removes files already downloaded', async () => {
    const previousLimit = ctx.env.MEDIA_UPLOAD_MAX_BYTES
    const previousCalls = client.message.send.mock.calls.length
    ctx.env.MEDIA_UPLOAD_MAX_BYTES = Buffer.from(pngBase64, 'base64').byteLength * 2 - 1
    try {
      const response = await ctx.app.inject({
        method: 'POST',
        url: '/v1/messages/sticker-pack',
        headers: { 'x-api-key': apiKey },
        payload: {
          to: GROUP,
          id: 'team',
          name: 'Team',
          publisher: 'Example',
          stickers: [{ fileName: 'hi.webp', media: { base64: pngBase64 } }],
          trayIcon: { fileName: 'tray.png', media: { base64: pngBase64 } },
        },
      })
      expect(response.statusCode, response.body).toBe(400)
      expect(client.message.send).toHaveBeenCalledTimes(previousCalls)
      expect(await readdir(mediaDir)).toEqual([])
    } finally {
      ctx.env.MEDIA_UPLOAD_MAX_BYTES = previousLimit
    }
  })

  it.each([GROUP, PEER])('honors explicit expiration in the real dispatcher for %s', async (to) => {
    const stopBeforeEncryption = new Error('fake stop before Signal encryption')
    async function sendWithRealDispatcher(jid: string, content: WaSendMessageContent, options?: WaSendMessageOptions) {
      const dispatch = new WaMessageDispatchCoordinator(
        fakeDispatchOptions((event) => {
          lastMessage = event.message
        }, stopBeforeEncryption),
      )
      try {
        await dispatch.sendMessage(jid, content, { ...options, id: RESULT.id })
      } catch (error) {
        if (error !== stopBeforeEncryption) throw error
      }
      return RESULT
    }
    client.message.send.mockImplementationOnce(sendWithRealDispatcher)
    const response = await ctx.app.inject({
      method: 'POST',
      url: '/v1/messages/text',
      headers: { 'x-api-key': apiKey },
      payload: {
        to,
        text: 'Temporary',
        contextInfo: { expirationSeconds: 3600, ephemeralSettingTimestamp: 1796137200 },
      },
    })
    expect(response.statusCode, response.body).toBe(200)
    expect(lastMessage?.extendedTextMessage?.contextInfo).toMatchObject({
      expiration: 3600,
      ephemeralSettingTimestamp: 1796137200,
    })
  })
})
