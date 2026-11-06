import { Readable } from 'node:stream'
import { access } from 'node:fs/promises'
import type { InjectOptions } from 'fastify'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Proto } from 'zapo-js'
import {
  INTERACTIVE_TO as to,
  MEDIA_DESCRIPTOR,
  PIX_INPUT,
  PNG_BASE64,
  PRODUCT_INPUT,
} from '../helpers/interactive-fixtures'
import { ADMIN_KEY, buildTestApp, createInstance, type TestApp } from '../helpers/test-app'

function fakeInteractiveClient() {
  return {
    getCredentials: vi.fn(() => ({ meJid: '5511888888888:12@s.whatsapp.net', meLid: '999999999@lid' })),
    profile: {
      getLidsByPhoneNumbers: vi.fn(async (numbers: string[]) =>
        numbers.map((number) => ({ phoneJid: `${number}@s.whatsapp.net`, exists: true, status: 'in' })),
      ),
      resolveUsername: vi.fn(async () => ({ status: 'found', jid: '456@lid' })),
    },
    message: {
      send: vi.fn(async (_jid: string, _message: Proto.IMessage) => ({ id: 'INTERACTIVE-1' })),
      upload: vi.fn(async (source: Readable, options: { type: string; mimetype?: string }) => {
        const chunks: Buffer[] = []
        for await (const chunk of source) chunks.push(Buffer.from(chunk))
        expect(Buffer.concat(chunks).byteLength).toBeGreaterThan(0)
        return { ...MEDIA_DESCRIPTOR, mimetype: options.mimetype }
      }),
    },
  }
}

describe('interactive/business message routes', () => {
  let ctx: TestApp
  let apiKey: string
  const client = fakeInteractiveClient()
  const post = (path: string, payload: InjectOptions['payload'], key = apiKey) =>
    ctx.app.inject({ method: 'POST', url: `/v1/messages/${path}`, headers: { 'x-api-key': key }, payload })
  function sent(): Proto.IMessage {
    return client.message.send.mock.calls.at(-1)?.[1] ?? {}
  }
  function parameters(): unknown {
    return JSON.parse(sent().interactiveMessage?.nativeFlowMessage?.buttons?.[0]?.buttonParamsJson ?? 'null') as unknown
  }
  beforeAll(async () => {
    ctx = await buildTestApp()
    apiKey = (await createInstance(ctx.app, 'interactive')).apiKey
    vi.spyOn(ctx.manager, 'requireRegisteredClient').mockReturnValue(client as never)
    vi.spyOn(ctx.manager, 'tryGetClient').mockReturnValue(client as never)
  })
  beforeEach(() => {
    vi.clearAllMocks()
  })
  afterAll(async () => {
    await ctx.app.close()
  })

  it('sends wrapped legacy buttons with standard id/result response and resolved phone', async () => {
    const res = await post('buttons', { to, text: 'Choose', buttons: [{ id: 'yes', text: 'Yes' }] })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ id: 'INTERACTIVE-1', result: { id: 'INTERACTIVE-1' } })
    expect(client.message.send).toHaveBeenCalledWith(`${to}@s.whatsapp.net`, {
      documentWithCaptionMessage: {
        message: {
          buttonsMessage: {
            contentText: 'Choose',
            headerType: 1,
            buttons: [{ buttonId: 'yes', buttonText: { displayText: 'Yes' }, type: 1 }],
          },
        },
      },
    })
    expect(client.profile.getLidsByPhoneNumbers).toHaveBeenCalled()
  })
  it('sends native flow and catalog with the bare own PN, never LID/device', async () => {
    const res = await post('interactive', {
      to,
      body: 'Shop',
      header: 'Catalog',
      buttons: [{ type: 'catalog', productId: 'p1' }],
    })
    expect(res.statusCode).toBe(200)
    expect(parameters()).toEqual({ business_phone_number: '5511888888888', catalog_product_id: 'p1' })
    expect(sent().interactiveMessage?.header).toEqual({ title: 'Catalog', hasMediaAttachment: false })
  })
  it.each(['buttons', 'interactive'])('converts %s quick replies only in groups with groupSafe true', async (path) => {
    const input =
      path === 'buttons'
        ? { text: 'Choose', buttons: [{ text: 'Yes & ok' }] }
        : { body: 'Choose', buttons: [{ type: 'quick_reply', text: 'Yes & ok' }] }
    expect((await post(path, { to: '120363@g.us', ...input, groupSafe: true })).statusCode).toBe(200)
    expect(parameters()).toEqual({
      display_text: 'Yes & ok',
      url: 'https://wa.me/5511888888888?text=Yes%20%26%20ok',
      merchant_url: 'https://wa.me/5511888888888?text=Yes%20%26%20ok',
    })
    expect(client.message.send.mock.calls.at(-1)?.[0]).toBe('120363@g.us')
    expect((await post(path, { to: '120363@g.us', ...input })).statusCode).toBe(200)
    if (path === 'buttons') expect(sent().documentWithCaptionMessage).toBeDefined()
    else expect(sent().interactiveMessage?.nativeFlowMessage?.buttons?.[0]?.name).toBe('quick_reply')
    expect((await post(path, { to, ...input, groupSafe: true })).statusCode).toBe(200)
    if (path === 'buttons') expect(sent().documentWithCaptionMessage).toBeDefined()
    else expect(sent().interactiveMessage?.nativeFlowMessage?.buttons?.[0]?.name).toBe('quick_reply')
  })
  it('sends single_select and validates total row count', async () => {
    const payload = {
      to,
      body: 'Choose',
      buttonText: 'Menu',
      sections: [{ title: 'Products', rows: [{ title: 'Hat' }] }],
    }
    expect((await post('list', payload)).statusCode).toBe(200)
    expect(parameters()).toEqual({
      title: 'Menu',
      sections: [{ title: 'Products', rows: [{ header: '', title: 'Hat', description: '', id: 'row_1_1' }] }],
    })
    expect((await post('list', { ...payload, sections: [] })).statusCode).toBe(400)
  })
  it('uploads each carousel media through zapo and places the descriptors in headers', async () => {
    const cards = [1, 2].map((index) => ({
      media: { base64: PNG_BASE64 },
      title: `Card ${index}`,
      body: 'Hat',
      buttons: [{ type: 'url', text: 'Open', url: 'https://example.com' }],
    }))
    const res = await post('carousel', { to, body: 'Products', cards })
    expect(res.statusCode).toBe(200)
    expect(client.message.upload).toHaveBeenCalledTimes(2)
    expect(client.message.upload).toHaveBeenCalledWith(expect.any(Readable), { type: 'image', mimetype: 'image/png' })
    const carousel = sent().interactiveMessage?.carouselMessage
    expect(carousel?.messageVersion).toBe(1)
    expect(carousel?.cards?.[0]?.header).toEqual({
      title: 'Card 1',
      hasMediaAttachment: true,
      imageMessage: MEDIA_DESCRIPTOR,
    })
    expect(sent()).not.toHaveProperty('messageContextInfo')
  })
  it('uses video upload context for video carousel headers', async () => {
    // Minimal MP4 ftyp signature is enough for MIME detection; the upstream upload is fake.
    const video = Buffer.from('00000018667479706d703432000000006d70343269736f6d', 'hex').toString('base64')
    const card = {
      media: { base64: video },
      mediaType: 'video',
      body: 'Video',
      buttons: [{ type: 'call', text: 'Call', phoneNumber: '+5511999999999' }],
    }
    const res = await post('carousel', { to, body: 'Videos', cards: [card, card] })
    expect(res.statusCode).toBe(200)
    expect(client.message.upload).toHaveBeenCalledWith(expect.any(Readable), { type: 'video', mimetype: 'video/mp4' })
    expect(sent().interactiveMessage?.carouselMessage?.cards?.[0]?.header?.videoMessage?.mediaKey).toEqual(
      MEDIA_DESCRIPTOR.mediaKey,
    )
  })
  it('cleans temporary media and does not send after an upstream upload failure', async () => {
    client.message.upload.mockRejectedValueOnce(new Error('upload unavailable'))
    const card = { media: { base64: PNG_BASE64 }, body: 'Image', buttons: [{ type: 'quick_reply', text: 'Buy' }] }
    const res = await post('carousel', { to, body: 'Products', cards: [card, card] })
    expect(res.statusCode).toBe(500)
    expect(client.message.send).not.toHaveBeenCalled()
    const source = client.message.upload.mock.calls[0]?.[0] as Readable & { path: string }
    expect(source.destroyed).toBe(true)
    await expect(access(source.path)).rejects.toMatchObject({ code: 'ENOENT' })
  })
  it('rejects a MIME mismatch and blocked media URL before uploading or sending', async () => {
    const card = {
      media: { base64: PNG_BASE64 },
      mediaType: 'video',
      body: 'Video',
      buttons: [{ type: 'quick_reply', text: 'Buy' }],
    }
    expect((await post('carousel', { to, body: 'Products', cards: [card, card] })).statusCode).toBe(400)
    const blocked = { ...card, mediaType: 'image', media: { url: 'http://127.0.0.1/private' } }
    expect((await post('carousel', { to, body: 'Products', cards: [blocked, blocked] })).statusCode).toBe(400)
    expect(client.message.upload).not.toHaveBeenCalled()
    expect(client.message.send).not.toHaveBeenCalled()
  })
  it('returns generated UUID flowToken and preserves a supplied token', async () => {
    let res = await post('native-form', { to, flowId: 'flow-1', screen: 'CONTACT', data: { plan: 'free' } })
    expect(res.statusCode).toBe(200)
    const token = res.json().flowToken
    expect(token).toMatch(/^[0-9a-f-]{36}$/)
    expect(parameters()).toMatchObject({
      flow_id: 'flow-1',
      flow_token: token,
      form_type: 'template',
      flow_action_payload: { screen: 'CONTACT', data: { plan: 'free' } },
    })
    expect(sent().interactiveMessage?.nativeFlowMessage?.messageVersion).toBe(3)
    res = await post('native-form', { to, flowId: 'flow-1', flowToken: 'own-token' })
    expect(res.json().flowToken).toBe('own-token')
    expect(parameters()).toHaveProperty('flow_token', 'own-token')
  })
  it.each(['120363@g.us', 'status@broadcast'])('rejects native form recipient %s before send', async (recipient) => {
    expect((await post('native-form', { to: recipient, flowId: 'f' })).statusCode).toBe(400)
    expect(client.message.send).not.toHaveBeenCalled()
  })
  it('sends payment_info PIX and review_and_pay charge with integer money', async () => {
    expect((await post('pix', { ...PIX_INPUT, reference: 'PIX-1' })).statusCode).toBe(200)
    expect(sent().interactiveMessage?.nativeFlowMessage?.buttons?.[0]?.name).toBe('payment_info')
    expect(parameters()).toMatchObject({
      reference_id: 'PIX-1',
      payment_settings: [
        {
          type: 'pix_static_code',
          pix_static_code: { merchant_name: 'Shop', key: 'pix@example.com', key_type: 'EMAIL' },
        },
      ],
    })
    expect(
      (await post('charge', { ...PIX_INPUT, reference: 'R1', items: [{ name: 'Hat', amount: 49.9, quantity: 2 }] }))
        .statusCode,
    ).toBe(200)
    expect(sent().interactiveMessage?.nativeFlowMessage?.buttons?.[0]?.name).toBe('review_and_pay')
    expect(parameters()).toMatchObject({
      total_amount: { value: 9980, offset: 100 },
      order: {
        subtotal: { value: 9980, offset: 100 },
        items: [{ name: 'Hat', amount: { value: 4990, offset: 100 }, quantity: 2 }],
      },
    })
  })
  it('sends a product with the connected owner by default and uploads its optional image', async () => {
    expect((await post('product', { ...PRODUCT_INPUT, productImage: { base64: PNG_BASE64 } })).statusCode).toBe(200)
    expect(sent().productMessage).toMatchObject({
      businessOwnerJid: '5511888888888@s.whatsapp.net',
      product: { productId: '12345', priceAmount1000: 49900, productImage: MEDIA_DESCRIPTOR, productImageCount: 1 },
    })
    expect(client.message.upload).toHaveBeenCalledTimes(1)
    expect(
      (await post('product', { ...PRODUCT_INPUT, businessOwnerJid: '5511777777777:2@s.whatsapp.net' })).statusCode,
    ).toBe(200)
    expect(sent().productMessage?.businessOwnerJid).toBe('5511777777777@s.whatsapp.net')
  })
  it('resolves a username to LID without using it as business owner', async () => {
    expect(
      (await post('interactive', { to: '@customer', body: 'Shop', buttons: [{ type: 'catalog' }] })).statusCode,
    ).toBe(200)
    expect(client.message.send.mock.calls.at(-1)?.[0]).toBe('456@lid')
    expect(parameters()).toHaveProperty('business_phone_number', '5511888888888')
  })
  it('fails business/private CTAs clearly when only own LID is available', async () => {
    client.getCredentials.mockReturnValueOnce({ meJid: '999@lid', meLid: '999@lid' })
    expect((await post('interactive', { to, body: 'Shop', buttons: [{ type: 'catalog' }] })).statusCode).toBe(503)
    expect(client.message.send).not.toHaveBeenCalled()
  })
  it.each([
    ['buttons', { to, text: 'Choose', buttons: Array.from({ length: 4 }, () => ({ text: 'Yes' })) }],
    ['interactive', { to, body: 'Choose', buttons: [] }],
    ['list', { to, body: 'Choose', buttonText: 'Menu', sections: [] }],
    ['native-form', { to }],
    ['pix', { ...PIX_INPUT, key: 'bad-key' }],
    ['charge', { ...PIX_INPUT, reference: 'R', items: [{ name: 'Hat', amount: -1, quantity: 1 }] }],
    ['product', { ...PRODUCT_INPUT, businessOwnerJid: '123@lid' }],
    ['carousel', { to, body: 'Products', cards: [] }],
  ])('rejects invalid %s input before sending', async (path, payload) => {
    expect((await post(path, payload)).statusCode).toBe(400)
    expect(client.message.send).not.toHaveBeenCalled()
  })
  it('keeps instance-only authentication', async () => {
    expect((await post('buttons', { to, text: 'Choose', buttons: [{ text: 'Yes' }] }, ADMIN_KEY)).statusCode).toBe(403)
    expect(client.message.send).not.toHaveBeenCalled()
  })
  it.each([
    '!!!!',
    'data:image/png;base64,',
    'data:image/png,not-base64',
    'data:image/png;base64,!!!!',
    'abcde',
    'YQ=',
    'YQ===',
    'YW,Jj',
    Buffer.from('plain text').toString('base64'),
  ])('rejects invalid or unidentified media %s before upload/send', async (base64) => {
    const card = { media: { base64 }, body: 'Card', buttons: [{ type: 'quick_reply', text: 'Buy' }] }
    expect((await post('carousel', { to, body: 'Products', cards: [card, card] })).statusCode).toBe(400)
    expect((await post('product', { ...PRODUCT_INPUT, productImage: { base64 } })).statusCode).toBe(400)
    expect(client.message.upload).not.toHaveBeenCalled()
    expect(client.message.send).not.toHaveBeenCalled()
  })
  it('accepts valid padded/unpadded base64 and standard base64 data URIs', async () => {
    for (const base64 of [PNG_BASE64, PNG_BASE64.replace(/=+$/, ''), `data:image/png;base64,${PNG_BASE64}`]) {
      expect((await post('product', { ...PRODUCT_INPUT, productImage: { base64 } })).statusCode).toBe(200)
      expect(client.message.upload.mock.calls.at(-1)?.[1]).toEqual({ type: 'image', mimetype: 'image/png' })
    }
  })
  it.each(['buttons', 'interactive'])('rejects duplicate explicit IDs in %s before sending', async (path) => {
    const buttons = [
      { id: 'duplicate', text: 'A' },
      { id: 'duplicate', text: 'B' },
    ]
    const payload =
      path === 'buttons'
        ? { to, text: 'Choose', buttons }
        : { to, body: 'Choose', buttons: buttons.map((button) => ({ ...button, type: 'quick_reply' })) }
    expect((await post(path, payload)).statusCode).toBe(400)
    expect(client.message.send).not.toHaveBeenCalled()
  })

  it('rejects an empty media download even when its response declares an image MIME', async () => {
    async function emptyMediaDownload() {
      return new Response(new Uint8Array(), { headers: { 'content-type': 'image/png' } })
    }
    const download = vi.spyOn(globalThis, 'fetch').mockImplementationOnce(emptyMediaDownload)
    try {
      expect(
        (await post('product', { ...PRODUCT_INPUT, productImage: { url: 'https://8.8.8.8/image' } })).statusCode,
      ).toBe(400)
      expect(client.message.upload).not.toHaveBeenCalled()
      expect(client.message.send).not.toHaveBeenCalled()
    } finally {
      download.mockRestore()
    }
  })
  it('requires a caller-declared MIME for unknown content, ignoring a misleading download header', async () => {
    async function unrecognizedMediaDownload() {
      return new Response('plain text', { headers: { 'content-type': 'image/jpeg' } })
    }
    const download = vi.spyOn(globalThis, 'fetch').mockImplementationOnce(unrecognizedMediaDownload)
    try {
      expect(
        (await post('product', { ...PRODUCT_INPUT, productImage: { url: 'https://8.8.8.8/image' } })).statusCode,
      ).toBe(400)
      expect(client.message.upload).not.toHaveBeenCalled()
      expect(client.message.send).not.toHaveBeenCalled()
    } finally {
      download.mockRestore()
    }
  })
})
