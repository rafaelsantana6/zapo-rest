import { z } from 'zod'

const Text = z.string().trim().min(1)
const To = Text.meta({ description: 'Phone, JID or @username, resolved like /messages/text', example: '5511999999999' })
const Footer = Text.max(60).optional()
const ButtonText = Text.max(20)
const Id = Text.max(256).optional()
const HttpUrl = z.url({ protocol: /^https?$/ })
const GroupSafe = z.boolean().optional().meta({
  description: 'In groups, turn quick replies into private wa.me links to the connected phone. Default false.',
})

export const InteractiveButtonSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('quick_reply'), id: Id, text: ButtonText }),
  z.object({ type: z.literal('url'), text: ButtonText, url: HttpUrl, webview: z.boolean().optional() }),
  z.object({ type: z.literal('copy'), text: ButtonText, code: Text.max(256) }),
  z.object({ type: z.literal('call'), text: ButtonText, phoneNumber: Text.regex(/^\+?[1-9]\d{6,14}$/) }),
  z.object({ type: z.literal('catalog'), productId: Text.optional() }),
])
const Buttons = z.array(InteractiveButtonSchema).min(1).max(3)

export const SendButtonsBodySchema = z
  .object({
    to: To,
    text: Text.max(1024),
    footer: Footer,
    groupSafe: GroupSafe,
    buttons: z
      .array(z.object({ id: Id, text: ButtonText }))
      .min(1)
      .max(3),
  })
  .meta({
    description:
      'Legacy response buttons (1–3). Quick replies are visible to the whole group unless groupSafe is true.',
    example: { to: '5511999999999', text: 'Continue?', buttons: [{ id: 'yes', text: 'Yes' }] },
  })

export const SendInteractiveBodySchema = z
  .object({
    to: To,
    body: Text.max(1024),
    footer: Footer,
    header: Text.max(60).optional(),
    buttons: Buttons,
    groupSafe: GroupSafe,
  })
  .meta({
    description:
      'Native-flow quick reply, URL/webview, copy, call or catalog CTA (1–3). Catalog uses the connected PN, never LID.',
    example: {
      to: '5511999999999',
      body: 'Visit us',
      buttons: [{ type: 'url', text: 'Open', url: 'https://example.com' }],
    },
  })

export const SendListBodySchema = z
  .object({
    to: To,
    body: Text.max(1024),
    footer: Footer,
    buttonText: Text.max(20),
    sections: z
      .array(
        z.object({
          title: Text.max(24),
          rows: z
            .array(z.object({ id: Id, title: Text.max(24), description: Text.max(72).optional() }))
            .min(1)
            .max(10),
        }),
      )
      .min(1)
      .max(10),
  })
  .refine((input) => input.sections.reduce((count, section) => count + section.rows.length, 0) <= 10, {
    path: ['sections'],
    message: 'At most 10 rows across all sections',
  })
  .meta({
    description:
      'single_select native flow: 1–10 sections, 1–10 rows in total; generated row IDs include section and row indexes.',
    example: {
      to: '5511999999999',
      body: 'Choose',
      buttonText: 'Menu',
      sections: [{ title: 'Products', rows: [{ id: 'hat', title: 'Hat' }] }],
    },
  })

export const InteractiveMediaSchema = z
  .union([
    z.object({ url: HttpUrl, base64: z.never().optional(), mimetype: Text.optional() }),
    z.object({ base64: Text, url: z.never().optional(), mimetype: Text.optional() }),
  ])
  .meta({
    description: 'Exactly one HTTP(S) url or base64 (data URI accepted). Download limits and SSRF protection apply.',
  })

export const SendCarouselBodySchema = z
  .object({
    to: To,
    body: Text.max(1024),
    cards: z
      .array(
        z.object({
          media: InteractiveMediaSchema,
          mediaType: z.enum(['image', 'video']).default('image'),
          title: Text.max(60).optional(),
          body: Text.max(1024),
          buttons: Buttons,
        }),
      )
      .min(2)
      .max(10),
  })
  .meta({
    description:
      'Carousel with 2–10 image/video cards, each with 1–3 native-flow buttons. Media is encrypted/uploaded by zapo-js before sending. The 1.11 addon resolver ignores carousel cards; device delivery/rendering needs verification and may require an upstream fix. Include a URL CTA before catalog on mobile cards.',
    example: {
      to: '5511999999999',
      body: 'Products',
      cards: [1, 2].map((n) => ({
        media: { url: `https://example.com/${n}.jpg` },
        body: `Product ${n}`,
        buttons: [{ type: 'url', text: 'Open', url: 'https://example.com' }],
      })),
    },
  })

export const SendNativeFormBodySchema = z
  .object({
    to: To,
    flowId: Text,
    body: Text.max(1024).optional(),
    cta: Text.max(30).default('Open form'),
    formType: Text.default('template'),
    screen: Text.optional(),
    data: z.record(z.string(), z.json()).optional(),
    flowToken: Text.optional(),
  })
  .meta({
    description:
      'Business app form created on the phone (galaxy_message, version 3). Direct chats only. Returns supplied flowToken or a generated UUID.',
    example: { to: '5511999999999', flowId: '1615193897066865', body: 'Please fill in the form' },
  })

export const PixKeyTypeSchema = z.enum(['EMAIL', 'PHONE', 'CPF', 'CNPJ', 'EVP'])
const pixPatterns = {
  EMAIL: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
  PHONE: /^\+[1-9]\d{7,14}$/,
  CPF: /^\d{11}$/,
  CNPJ: /^\d{14}$/,
  EVP: /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
}
export function inferPixKeyType(key: string): z.infer<typeof PixKeyTypeSchema> | undefined {
  return PixKeyTypeSchema.options.find((type) => pixPatterns[type].test(key))
}
const PixFields = {
  key: Text.max(254),
  keyType: PixKeyTypeSchema.optional(),
  merchantName: Text.max(100),
  body: Text.max(1024).optional(),
  footer: Footer,
}
function validPix(input: { key: string; keyType?: z.infer<typeof PixKeyTypeSchema> }): boolean {
  return input.keyType ? pixPatterns[input.keyType].test(input.key) : inferPixKeyType(input.key) !== undefined
}
export const SendPixBodySchema = z
  .object({ to: To, ...PixFields, reference: Text.optional() })
  .refine(validPix, {
    path: ['key'],
    message: 'Invalid PIX key format; use EMAIL, E.164 PHONE (+country), 11-digit CPF, 14-digit CNPJ or UUID EVP',
  })
  .meta({
    description:
      'Static PIX key card (payment_info). keyType inferred when absent; digits-only 11/14 are CPF/CNPJ. Shape validation only, no bank verification.',
    example: { to: '5511999999999', merchantName: 'Shop', key: 'pix@example.com' },
  })

const Amount = z
  .number()
  .min(0)
  .max(1_000_000_000)
  .refine((n) => Math.abs(n * 100 - Math.round(n * 100)) < 0.00001, 'Use at most two decimal places')
export const SendChargeBodySchema = z
  .object({
    to: To,
    ...PixFields,
    reference: Text,
    items: z
      .array(z.object({ name: Text, amount: Amount, quantity: z.number().int().min(1).max(10000) }))
      .min(1)
      .max(100),
    subtotal: Amount.optional(),
    total: Amount.optional(),
    discount: Amount.default(0),
    shipping: Amount.default(0),
    tax: Amount.default(0),
  })
  .superRefine((input, ctx) => {
    const subtotal = input.items.reduce((sum, item) => sum + Math.round(item.amount * 100) * item.quantity, 0)
    const total =
      subtotal - Math.round(input.discount * 100) + Math.round(input.shipping * 100) + Math.round(input.tax * 100)
    if (!validPix(input)) ctx.addIssue({ code: 'custom', path: ['key'], message: 'Invalid PIX key format or keyType' })
    if (input.subtotal !== undefined && Math.round(input.subtotal * 100) !== subtotal)
      ctx.addIssue({ code: 'custom', path: ['subtotal'], message: 'Subtotal must equal sum of item amount × quantity' })
    if (total <= 0 || total > 100_000_000_000 || (input.total !== undefined && Math.round(input.total * 100) !== total))
      ctx.addIssue({
        code: 'custom',
        path: ['total'],
        message: 'Total must be positive and equal subtotal - discount + shipping + tax (maximum 1000000000)',
      })
  })
  .meta({
    description:
      'review_and_pay charge. BRL amounts in major units (two decimal places); converted to integer cents with offset 100. Totals computed; supplied totals must match.',
    example: {
      to: '5511999999999',
      merchantName: 'Shop',
      key: 'pix@example.com',
      reference: 'ORDER-1',
      items: [{ name: 'Hat', amount: 49.9, quantity: 1 }],
    },
  })

export const SendProductBodySchema = z
  .object({
    to: To,
    productId: Text,
    title: Text,
    description: z.string(),
    currencyCode: Text.regex(/^[A-Z]{3}$/),
    priceAmount1000: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    salePriceAmount1000: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).optional(),
    retailerId: Text.optional(),
    url: HttpUrl.optional(),
    productImage: InteractiveMediaSchema.optional(),
    productImageCount: z.number().int().positive().optional(),
    businessOwnerJid: Text.regex(/^\d+(?::\d+)?@s\.whatsapp\.net$/).optional(),
  })
  .meta({
    description:
      'Native product card. Only renders for a REAL product in that business catalog. Owner defaults to connected PN. Prices use thousandths (49900 = BRL 49.90); optional productImage is uploaded first.',
    example: {
      to: '5511999999999',
      productId: '12345',
      title: 'Hat',
      description: 'One size',
      currencyCode: 'BRL',
      priceAmount1000: 49900,
    },
  })

export type InteractiveButton = z.infer<typeof InteractiveButtonSchema>
export type InteractiveMedia = z.infer<typeof InteractiveMediaSchema>
