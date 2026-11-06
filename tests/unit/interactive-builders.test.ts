import { pathToFileURL } from 'node:url'
import { describe, expect, it } from 'vitest'
import { proto, type Proto } from 'zapo-js'
import {
  SendButtonsBodySchema,
  SendCarouselBodySchema,
  SendChargeBodySchema,
  SendInteractiveBodySchema,
  SendListBodySchema,
  SendNativeFormBodySchema,
  SendPixBodySchema,
  SendProductBodySchema,
  inferPixKeyType,
} from '~/http/interactive-schemas'
import { buildButtons } from '~/messages/interactive/buttons'
import { buildCarousel } from '~/messages/interactive/carousel'
import { buildCharge } from '~/messages/interactive/charge'
import { buildInteractive } from '~/messages/interactive/interactive'
import { buildList } from '~/messages/interactive/list'
import { buildNativeForm } from '~/messages/interactive/native-form'
import { buildPix } from '~/messages/interactive/pix'
import { buildProduct } from '~/messages/interactive/product'
import {
  INTERACTIVE_TO as to,
  MEDIA_DESCRIPTOR as image,
  PIX_INPUT,
  PRODUCT_INPUT,
} from '../helpers/interactive-fixtures'

function params(message: Proto.IMessage, index = 0): unknown {
  return JSON.parse(
    message.interactiveMessage?.nativeFlowMessage?.buttons?.[index]?.buttonParamsJson ?? 'null',
  ) as unknown
}
function flow(
  buttons: { name: string; buttonParamsJson: string }[],
  body?: string,
  footer?: string,
  messageVersion = 1,
): Proto.IMessage {
  return {
    interactiveMessage: {
      ...(body === undefined ? {} : { body: { text: body } }),
      ...(footer === undefined ? {} : { footer: { text: footer } }),
      nativeFlowMessage: { buttons, messageParamsJson: '', messageVersion },
    },
  }
}
function button(name: string, parameters: object) {
  return { name, buttonParamsJson: JSON.stringify(parameters) }
}

// Pin the installed upstream delivery behavior, not a project-owned replica.
const encoder = (await import(
  pathToFileURL(`${process.cwd()}/node_modules/zapo-js/dist/esm/message/encode/content.js`).href
)) as { resolveButtonAddonKind(message: Proto.IMessage): string }
const transport = (await import(
  pathToFileURL(`${process.cwd()}/node_modules/zapo-js/dist/esm/transport/node/builders/message.js`).href
)) as { buildButtonAddonNode(kind: string): unknown }

describe('interactive raw proto builders', () => {
  it('wraps legacy response buttons in documentWithCaptionMessage with EMPTY header', () => {
    const actual = buildButtons(
      SendButtonsBodySchema.parse({
        to,
        text: 'Continue?',
        footer: 'Shop',
        buttons: [{ id: 'yes', text: 'Yes' }, { text: 'No' }],
      }),
    )
    expect(actual).toEqual({
      documentWithCaptionMessage: {
        message: {
          buttonsMessage: {
            contentText: 'Continue?',
            footerText: 'Shop',
            headerType: proto.Message.ButtonsMessage.HeaderType.EMPTY,
            buttons: [
              { buttonId: 'yes', buttonText: { displayText: 'Yes' }, type: 1 },
              { buttonId: 'button_2', buttonText: { displayText: 'No' }, type: 1 },
            ],
          },
        },
      },
    })
    expect(encoder.resolveButtonAddonKind(actual)).toBe('interactive')
  })
  it('builds native quick reply, webview URL and copy with exact JSON', () => {
    const actual = buildInteractive(
      SendInteractiveBodySchema.parse({
        to,
        body: 'Choose',
        footer: 'Shop',
        header: 'Menu',
        buttons: [
          { type: 'quick_reply', text: 'Yes' },
          { type: 'url', text: 'Open', url: 'https://example.com', webview: true },
          { type: 'copy', text: 'Copy', code: 'PROMO' },
        ],
      }),
    )
    const expected = flow(
      [
        button('quick_reply', { display_text: 'Yes', id: 'button_1' }),
        button('cta_url', {
          display_text: 'Open',
          url: 'https://example.com',
          merchant_url: 'https://example.com',
          webview_presentation: 'full',
          webview_interaction: true,
        }),
        button('cta_copy', { display_text: 'Copy', copy_code: 'PROMO', id: 'PROMO' }),
      ],
      'Choose',
      'Shop',
    )
    if (expected.interactiveMessage) expected.interactiveMessage.header = { title: 'Menu', hasMediaAttachment: false }
    expect(actual).toEqual(expected)
    expect(params(actual)).toEqual({ display_text: 'Yes', id: 'button_1' })
    expect(params(actual, 1)).toHaveProperty('webview_interaction', true)
    expect(params(actual, 2)).toEqual({ display_text: 'Copy', copy_code: 'PROMO', id: 'PROMO' })
  })
  it('builds call and catalog buttons using only an account PN', () => {
    const actual = buildInteractive(
      SendInteractiveBodySchema.parse({
        to,
        body: 'Shop',
        buttons: [
          { type: 'call', text: 'Call', phoneNumber: '+5511999999999' },
          { type: 'catalog', productId: '12345' },
          { type: 'url', text: 'Open', url: 'https://example.com' },
        ],
      }),
      { ownPhone: to },
    )
    expect(actual).toEqual(
      flow(
        [
          button('cta_call', { display_text: 'Call', phone_number: '+5511999999999' }),
          button('cta_catalog', { business_phone_number: to, catalog_product_id: '12345' }),
          button('cta_url', { display_text: 'Open', url: 'https://example.com', merchant_url: 'https://example.com' }),
        ],
        'Shop',
      ),
    )
    expect(params(actual, 1)).toEqual({ business_phone_number: to, catalog_product_id: '12345' })
    expect(() =>
      buildInteractive(SendInteractiveBodySchema.parse({ to, body: 'Shop', buttons: [{ type: 'catalog' }] }), {
        ownPhone: '123@lid',
      }),
    ).toThrow('PN required')
  })
  it('only converts group quick replies when explicitly groupSafe', () => {
    const input = SendButtonsBodySchema.parse({
      to,
      text: 'Choose',
      groupSafe: true,
      buttons: [{ text: 'Hello & yes' }],
    })
    const actual = buildButtons(input, { isGroup: true, ownPhone: to })
    const url = `https://wa.me/${to}?text=Hello%20%26%20yes`
    expect(actual).toEqual(flow([button('cta_url', { display_text: 'Hello & yes', url, merchant_url: url })], 'Choose'))
    expect(params(actual)).toHaveProperty('url', url)
    expect(buildButtons(input).documentWithCaptionMessage).toBeDefined()
    expect(buildButtons({ ...input, groupSafe: false }, { isGroup: true }).documentWithCaptionMessage).toBeDefined()
  })
  it('builds single_select with globally distinct default IDs and empty wire fields', () => {
    const actual = buildList(
      SendListBodySchema.parse({
        to,
        body: 'Choose',
        footer: 'Shop',
        buttonText: 'Menu',
        sections: [
          { title: 'One', rows: [{ title: 'A' }] },
          { title: 'Two', rows: [{ title: 'B', description: 'Description', id: 'b' }] },
        ],
      }),
    )
    const payload = {
      title: 'Menu',
      sections: [
        { title: 'One', rows: [{ header: '', title: 'A', description: '', id: 'row_1_1' }] },
        { title: 'Two', rows: [{ header: '', title: 'B', description: 'Description', id: 'b' }] },
      ],
    }
    expect(actual).toEqual(flow([button('single_select', payload)], 'Choose', 'Shop'))
    expect(params(actual)).toEqual(payload)
  })
  it('places uploaded image/video descriptors in carousel headers', () => {
    const input = SendCarouselBodySchema.parse({
      to,
      body: 'Products',
      cards: [
        {
          media: { url: 'https://example.com/a' },
          title: 'A',
          body: 'One',
          buttons: [{ type: 'quick_reply', text: 'Buy', id: 'buy' }],
        },
        { media: { base64: 'YQ==' }, mediaType: 'video', body: 'Two', buttons: [{ type: 'catalog' }] },
      ],
    })
    const actual = buildCarousel(
      input,
      [{ imageMessage: image }, { videoMessage: { ...image, mimetype: 'video/mp4' } }],
      { ownPhone: to },
    )
    expect(actual).toEqual({
      interactiveMessage: {
        body: { text: 'Products' },
        carouselMessage: {
          messageVersion: 1,
          cards: [
            {
              header: { title: 'A', hasMediaAttachment: true, imageMessage: image },
              body: { text: 'One' },
              nativeFlowMessage: {
                buttons: [button('quick_reply', { display_text: 'Buy', id: 'buy' })],
                messageParamsJson: '',
                messageVersion: 1,
              },
            },
            {
              header: { hasMediaAttachment: true, videoMessage: { ...image, mimetype: 'video/mp4' } },
              body: { text: 'Two' },
              nativeFlowMessage: {
                buttons: [button('cta_catalog', { business_phone_number: to })],
                messageParamsJson: '',
                messageVersion: 1,
              },
            },
          ],
        },
      },
    })
    expect(
      JSON.parse(
        actual.interactiveMessage?.carouselMessage?.cards?.[1]?.nativeFlowMessage?.buttons?.[0]?.buttonParamsJson ??
          '{}',
      ),
    ).toEqual({ business_phone_number: to })
    expect(encoder.resolveButtonAddonKind(actual)).toBeNull()
    expect(() => buildCarousel(input, [])).toThrow('uploaded media')
  })
  it('builds phone-created form v3 and pins galaxy_message to upstream mixed v9', () => {
    const actual = buildNativeForm(
      SendNativeFormBodySchema.parse({
        to,
        flowId: 'flow-1',
        body: 'Register',
        screen: 'CONTACT',
        data: { plan: 'free' },
      }),
      'token-1',
    )
    const payload = {
      flow_action: 'navigate',
      flow_message_version: '4',
      flow_cta: 'Open form',
      form_type: 'template',
      flow_id: 'flow-1',
      flow_token: 'token-1',
      flow_action_payload: { screen: 'CONTACT', data: { plan: 'free' } },
    }
    expect(actual).toEqual(flow([button('galaxy_message', payload)], 'Register', undefined, 3))
    expect(params(actual)).toEqual(payload)
    const kind = encoder.resolveButtonAddonKind(actual)
    expect(kind).toBe('interactive')
    expect(transport.buildButtonAddonNode(kind)).toMatchObject({
      tag: 'biz',
      content: [
        {
          tag: 'interactive',
          attrs: { type: 'native_flow', v: '1' },
          content: [{ tag: 'native_flow', attrs: { name: 'mixed', v: '9' } }],
        },
      ],
    })
    const minimal = buildNativeForm(SendNativeFormBodySchema.parse({ to, flowId: 'f' }), 't')
    expect(params(minimal)).not.toHaveProperty('flow_action_payload')
  })
  it('builds PIX payment_info with exact static-code order shell', () => {
    const actual = buildPix(SendPixBodySchema.parse(PIX_INPUT), 'PIX-1')
    const zero = { value: 0, offset: 100 }
    const payload = {
      currency: 'BRL',
      total_amount: zero,
      reference_id: 'PIX-1',
      type: 'physical-goods',
      order: {
        status: 'pending',
        subtotal: zero,
        order_type: 'ORDER',
        items: [{ name: '', amount: zero, quantity: 0, sale_amount: zero }],
      },
      payment_settings: [
        {
          type: 'pix_static_code',
          pix_static_code: { merchant_name: 'Shop', key: 'pix@example.com', key_type: 'EMAIL' },
        },
      ],
      share_payment_status: false,
      is_soft_deleted: false,
      referral: 'chat_attachment',
    }
    expect(actual).toEqual(flow([button('payment_info', payload)]))
    expect(params(actual)).toEqual(payload)
    expect(encoder.resolveButtonAddonKind(actual)).toBe('payment_info')
  })
  it.each([
    ['a@example.com', 'EMAIL'],
    ['+5511999999999', 'PHONE'],
    ['12345678901', 'CPF'],
    ['12345678901234', 'CNPJ'],
    ['123e4567-e89b-42d3-a456-426614174000', 'EVP'],
  ])('infers PIX key %s as %s', (key, type) => {
    expect(inferPixKeyType(key)).toBe(type)
    expect(SendPixBodySchema.safeParse({ ...PIX_INPUT, key, keyType: type }).success).toBe(true)
  })
  it('computes cent offsets and checks charge totals without floating point drift', () => {
    const actual = buildCharge(
      SendChargeBodySchema.parse({
        ...PIX_INPUT,
        reference: 'ORDER-1',
        body: 'Invoice',
        footer: 'Thank you',
        items: [
          { name: 'Hat', amount: 49.9, quantity: 2 },
          { name: 'Fee', amount: 0.1, quantity: 3 },
        ],
        subtotal: 100.1,
        discount: 5,
        shipping: 2,
        tax: 1,
        total: 98.1,
      }),
    )
    const payload = {
      currency: 'BRL',
      reference_id: 'ORDER-1',
      type: 'physical-goods',
      total_amount: { value: 9810, offset: 100 },
      payment_settings: [
        {
          type: 'pix_static_code',
          pix_static_code: { merchant_name: 'Shop', key: 'pix@example.com', key_type: 'EMAIL' },
        },
      ],
      order: {
        status: 'payment_requested',
        subtotal: { value: 10010, offset: 100 },
        order_type: 'ORDER',
        items: [
          { name: 'Hat', amount: { value: 4990, offset: 100 }, quantity: 2 },
          { name: 'Fee', amount: { value: 10, offset: 100 }, quantity: 3 },
        ],
        discount: { value: 500, offset: 100 },
        shipping: { value: 200, offset: 100 },
        tax: { value: 100, offset: 100 },
      },
    }
    expect(actual).toEqual(flow([button('review_and_pay', payload)], 'Invoice', 'Thank you'))
    expect(params(actual)).toEqual(payload)
    expect(encoder.resolveButtonAddonKind(actual)).toBe('order_details')
  })
  it('builds product thousandth prices and uploaded image descriptor', () => {
    const actual = buildProduct(
      SendProductBodySchema.parse({
        ...PRODUCT_INPUT,
        salePriceAmount1000: 39900,
        retailerId: 'hat-1',
        url: 'https://example.com/hat',
      }),
      `${to}@s.whatsapp.net`,
      image,
    )
    expect(actual).toEqual({
      productMessage: {
        businessOwnerJid: `${to}@s.whatsapp.net`,
        product: {
          productId: '12345',
          title: 'Hat',
          description: 'One size',
          currencyCode: 'BRL',
          priceAmount1000: 49900,
          salePriceAmount1000: 39900,
          retailerId: 'hat-1',
          url: 'https://example.com/hat',
          productImage: image,
          productImageCount: 1,
        },
      },
    })
    expect(proto.Message.decode(proto.Message.encode(actual).finish()).productMessage?.product?.title).toBe('Hat')
    expect(actual).not.toHaveProperty('messageContextInfo')
  })
})

describe('interactive send validation', () => {
  it('rejects too many/empty response and native buttons', () => {
    for (const buttons of [[], Array.from({ length: 4 }, () => ({ text: 'Yes' }))]) {
      expect(SendButtonsBodySchema.safeParse({ to, text: 'Choose', buttons }).success).toBe(false)
      expect(
        SendInteractiveBodySchema.safeParse({
          to,
          body: 'Choose',
          buttons: buttons.map((button) => ({ ...button, type: 'quick_reply' })),
        }).success,
      ).toBe(false)
    }
  })
  it('rejects empty sections, empty rows and more than 10 total rows', () => {
    for (const sections of [
      [],
      [{ title: 'Empty', rows: [] }],
      Array.from({ length: 2 }, () => ({
        title: 'Section',
        rows: Array.from({ length: 6 }, () => ({ title: 'Row' })),
      })),
    ])
      expect(SendListBodySchema.safeParse({ to, body: 'Choose', buttonText: 'Menu', sections }).success).toBe(false)
  })
  it('rejects missing flowId, invalid PIX formats and mismatched type', () => {
    expect(SendNativeFormBodySchema.safeParse({ to }).success).toBe(false)
    for (const key of ['', 'not-a-key', '123', 'invalid@', '5511999999999'])
      expect(SendPixBodySchema.safeParse({ ...PIX_INPUT, key }).success).toBe(false)
    expect(SendPixBodySchema.safeParse({ ...PIX_INPUT, keyType: 'CPF' }).success).toBe(false)
  })
  it('rejects bad totals, fractions of cents, and non-positive quantities', () => {
    const input = { ...PIX_INPUT, reference: 'R', items: [{ name: 'Hat', amount: 10, quantity: 1 }] }
    for (const extra of [
      { total: 1 },
      { subtotal: 2 },
      { discount: 20 },
      { items: [{ name: 'Hat', amount: 1.001, quantity: 1 }] },
      { items: [{ name: 'Hat', amount: 10, quantity: 0 }] },
    ])
      expect(SendChargeBodySchema.safeParse({ ...input, ...extra }).success).toBe(false)
  })
  it('rejects carousels outside 2–10 cards and ambiguous media', () => {
    const card = {
      media: { url: 'https://example.com/a' },
      body: 'Hat',
      buttons: [{ type: 'quick_reply', text: 'Buy' }],
    }
    for (const count of [0, 1, 11])
      expect(
        SendCarouselBodySchema.safeParse({ to, body: 'Products', cards: Array.from({ length: count }, () => card) })
          .success,
      ).toBe(false)
    expect(
      SendCarouselBodySchema.safeParse({
        to,
        body: 'Products',
        cards: [card, { ...card, media: { url: 'https://example.com/a', base64: 'YQ==' } }],
      }).success,
    ).toBe(false)
  })
  it('rejects LID product owner, negative product prices and non-http CTAs', () => {
    expect(SendProductBodySchema.safeParse({ ...PRODUCT_INPUT, businessOwnerJid: '123@lid' }).success).toBe(false)
    expect(SendProductBodySchema.safeParse({ ...PRODUCT_INPUT, priceAmount1000: -1 }).success).toBe(false)
    expect(
      SendInteractiveBodySchema.safeParse({
        to,
        body: 'Open',
        buttons: [{ type: 'url', text: 'Open', url: 'javascript:alert(1)' }],
      }).success,
    ).toBe(false)
  })
})
