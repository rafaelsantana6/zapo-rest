import { describe, expect, it } from 'vitest'
import type { Proto } from 'zapo-js'
import {
  SendButtonsBodySchema,
  SendInteractiveBodySchema,
  SendListBodySchema,
  SendCarouselBodySchema,
} from '~/http/interactive-schemas'
import { buildButtons } from '~/messages/interactive/buttons'
import { buildInteractive } from '~/messages/interactive/interactive'
import { buildList } from '~/messages/interactive/list'
import { buildCarousel } from '~/messages/interactive/carousel'
import { INTERACTIVE_TO as to, MEDIA_DESCRIPTOR } from '../helpers/interactive-fixtures'

function nativeIds(message: Proto.IMessage): unknown[] {
  return (message.interactiveMessage?.nativeFlowMessage?.buttons ?? []).map(
    (button) => JSON.parse(button.buttonParamsJson ?? '{}').id as unknown,
  )
}
const mixedButtons = [{ id: 'button_2', text: 'First' }, { text: 'Second' }]
describe('interactive reply ID collisions', () => {
  it('reserves explicit legacy button IDs before generating missing IDs', () => {
    const message = buildButtons(SendButtonsBodySchema.parse({ to, text: 'Choose', buttons: mixedButtons }))
    expect(
      message.documentWithCaptionMessage?.message?.buttonsMessage?.buttons?.map((button) => button.buttonId),
    ).toEqual(['button_2', 'button_2_2'])
  })
  it('reserves explicit native quick-reply IDs, including later explicit IDs', () => {
    const input = SendInteractiveBodySchema.parse({
      to,
      body: 'Choose',
      buttons: [
        { type: 'quick_reply', text: 'First' },
        { type: 'quick_reply', text: 'Second', id: 'button_1' },
        { type: 'quick_reply', text: 'Third', id: 'button_1_2' },
      ],
    })
    expect(nativeIds(buildInteractive(input))).toEqual(['button_1_3', 'button_1', 'button_1_2'])
  })
  it('keeps converted group quick replies free of reply IDs', () => {
    const message = buildButtons(
      SendButtonsBodySchema.parse({ to, text: 'Choose', buttons: mixedButtons, groupSafe: true }),
      { isGroup: true, ownPhone: to },
    )
    expect(nativeIds(message)).toEqual([undefined, undefined])
  })
  it('reserves row IDs across all sections', () => {
    const input = SendListBodySchema.parse({
      to,
      body: 'Choose',
      buttonText: 'Menu',
      sections: [
        { title: 'One', rows: [{ title: 'First' }, { title: 'Second', id: 'row_2_1' }] },
        { title: 'Two', rows: [{ title: 'Third' }] },
      ],
    })
    const button = buildList(input).interactiveMessage?.nativeFlowMessage?.buttons?.[0]
    expect(JSON.parse(button?.buttonParamsJson ?? '{}').sections).toEqual([
      {
        title: 'One',
        rows: [
          { header: '', title: 'First', description: '', id: 'row_1_1' },
          { header: '', title: 'Second', description: '', id: 'row_2_1' },
        ],
      },
      { title: 'Two', rows: [{ header: '', title: 'Third', description: '', id: 'row_2_1_2' }] },
    ])
  })
  it('allocates distinct quick-reply IDs across carousel cards', () => {
    const card = {
      media: { url: 'https://example.com/image' },
      body: 'Card',
      buttons: [{ type: 'quick_reply', text: 'Buy' }],
    }
    const input = SendCarouselBodySchema.parse({
      to,
      body: 'Products',
      cards: [card, { ...card, buttons: [{ type: 'quick_reply', text: 'Buy', id: 'button_1' }] }],
    })
    const cards =
      buildCarousel(input, [{ imageMessage: MEDIA_DESCRIPTOR }, { imageMessage: MEDIA_DESCRIPTOR }]).interactiveMessage
        ?.carouselMessage?.cards ?? []
    expect(cards.map((card) => nativeIds({ interactiveMessage: card }))).toEqual([['button_1_2'], ['button_1']])
  })
  it('rejects duplicate explicit IDs on legacy and native buttons', () => {
    const buttons = [
      { id: 'duplicate', text: 'A' },
      { id: 'duplicate', text: 'B' },
    ]
    expect(SendButtonsBodySchema.safeParse({ to, text: 'Choose', buttons }).success).toBe(false)
    expect(
      SendInteractiveBodySchema.safeParse({
        to,
        body: 'Choose',
        buttons: buttons.map((button) => ({ type: 'quick_reply', ...button })),
      }).success,
    ).toBe(false)
  })
  it('rejects duplicate explicit row IDs across sections and reply IDs across cards', () => {
    const section = { title: 'Section', rows: [{ id: 'duplicate', title: 'Row' }] }
    expect(
      SendListBodySchema.safeParse({ to, body: 'Choose', buttonText: 'Menu', sections: [section, section] }).success,
    ).toBe(false)
    const card = {
      media: { url: 'https://example.com/image' },
      body: 'Card',
      buttons: [{ type: 'quick_reply', text: 'Buy', id: 'duplicate' }],
    }
    expect(SendCarouselBodySchema.safeParse({ to, body: 'Products', cards: [card, card] }).success).toBe(false)
  })
})
