import { describe, expect, it } from 'vitest'
import type { Proto } from 'zapo-js'
import { decodeIncomingMessage } from '~/events/decode-message'
import { nativeFormResponseFixture } from '../helpers/interactive-fixtures'

function decode(message: Proto.IMessage) {
  return decodeIncomingMessage({ key: { id: 'I1', remoteJid: '5511999999999@s.whatsapp.net' }, message })
}
describe('interactive message decoding', () => {
  it('reads legacy buttons inside the caption wrapper', () => {
    expect(
      decode({
        documentWithCaptionMessage: {
          message: {
            buttonsMessage: {
              contentText: 'Choose',
              buttons: [{ buttonId: 'yes', buttonText: { displayText: 'Yes' }, type: 1 }],
            },
          },
        },
      }),
    ).toMatchObject({ type: 'buttons', body: 'Choose' })
  })
  it('reads legacy list and native single_select as list', () => {
    expect(
      decode({
        listMessage: {
          title: 'Menu',
          description: 'Choose',
          sections: [{ title: 'Shop', rows: [{ rowId: 'hat', title: 'Hat' }] }],
        },
      }),
    ).toMatchObject({ type: 'list', body: 'Menu · Choose' })
    expect(
      decode({
        interactiveMessage: {
          body: { text: 'Choose' },
          nativeFlowMessage: { buttons: [{ name: 'single_select', buttonParamsJson: '{"title":"Menu"}' }] },
        },
      }),
    ).toMatchObject({ type: 'list', body: 'Choose', interactive: { name: 'single_select', params: { title: 'Menu' } } })
  })
  it('reports native flow first button name and parses its JSON', () => {
    expect(
      decode({
        interactiveMessage: {
          body: { text: 'Open' },
          nativeFlowMessage: {
            buttons: [{ name: 'cta_url', buttonParamsJson: '{"url":"https://example.com"}' }, { name: 'quick_reply' }],
          },
        },
      }),
    ).toMatchObject({
      type: 'interactive',
      body: 'Open',
      interactive: { name: 'cta_url', params: { url: 'https://example.com' } },
    })
  })
  it('reads carousel body and card summaries', () => {
    expect(
      decode({
        interactiveMessage: {
          body: { text: 'Products' },
          carouselMessage: { messageVersion: 1, cards: [{ body: { text: 'Hat' } }, { body: { text: 'Shoes' } }] },
        },
      }),
    ).toMatchObject({ type: 'carousel', body: 'Products · Hat · Shoes', hasMedia: false })
  })
  it('summarizes product and order prices with currency and item count', () => {
    expect(
      decode({ productMessage: { product: { title: 'Hat', priceAmount1000: 49900, currencyCode: 'BRL' } } }),
    ).toMatchObject({
      type: 'product',
      body: 'Hat · 49.9 · BRL',
      interactive: { title: 'Hat', price: 49.9, currency: 'BRL' },
    })
    expect(
      decode({
        orderMessage: { orderTitle: 'Order #1', itemCount: 2, totalAmount1000: 99800, totalCurrencyCode: 'BRL' },
      }),
    ).toMatchObject({
      type: 'order',
      body: 'Order #1 · 2 items · 99.8 · BRL',
      interactive: { title: 'Order #1', items: 2, total: 99.8, currency: 'BRL' },
    })
  })
  it.each([
    ['buttons_response', { buttonsResponseMessage: { selectedButtonId: 'buy', selectedDisplayText: 'Buy' } }],
    ['list_response', { listResponseMessage: { title: 'Buy', singleSelectReply: { selectedRowId: 'buy' } } }],
    ['template_reply', { templateButtonReplyMessage: { selectedId: 'buy', selectedDisplayText: 'Buy' } }],
  ] as const)('reads %s ID and display text', (type, message) => {
    expect(decode(message)).toMatchObject({
      type,
      body: 'buy · Buy',
      interactive: { selectedId: 'buy', displayText: 'Buy' },
    })
  })
  it('exposes native flow response name and parsed params', () => {
    expect(
      decode({
        interactiveResponseMessage: {
          body: { text: 'Chosen' },
          nativeFlowResponseMessage: { name: 'single_select', paramsJson: '{"id":"hat","title":"Hat"}' },
        },
      }),
    ).toMatchObject({
      type: 'native_flow_response',
      body: 'Chosen · single_select · {"id":"hat","title":"Hat"}',
      interactive: { name: 'single_select', params: { id: 'hat', title: 'Hat' } },
    })
  })
  it('decodes nested phone-created form response string, every screen, sensitivity and quoted token', () => {
    const actual = decode(nativeFormResponseFixture())
    expect(actual).toMatchObject({
      type: 'native_form_response',
      interactive: {
        name: 'galaxy_message',
        flowId: 'flow-1',
        flowName: 'Registration',
        title: 'Customer registration',
        flowToken: 'token-1',
        fields: [
          {
            screen: 'CONTACT',
            type: 'TextInput',
            name: 'customer',
            label: 'Name',
            value: 'Test customer',
            sensitive: false,
          },
          {
            screen: 'CONTACT',
            type: 'TextInput',
            name: 'document',
            label: 'Document',
            value: 'test-doc',
            sensitive: true,
          },
          {
            screen: 'PREFERENCES',
            type: 'CheckboxGroup',
            name: 'choices',
            label: 'Choices',
            value: ['a', 'b'],
            sensitive: false,
          },
          { screen: 'PREFERENCES', type: 'OptIn', name: 'optIn', label: null, value: false, sensitive: false },
        ],
        answers: { customer: 'Test customer', document: 'test-doc', choices: ['a', 'b'], optIn: false },
      },
    })
    expect(actual?.body).toContain('Name: Test customer')
  })
  it('tolerates malformed JSON, incomplete forms and absent quoted tokens', () => {
    for (const paramsJson of ['invalid', 'null', '{"wa_flow_response_params":{"response_message":"bad"}}']) {
      const actual = decode({
        interactiveResponseMessage: { nativeFlowResponseMessage: { name: 'galaxy_message', paramsJson } },
      })
      expect(actual).toMatchObject({ type: 'native_form_response', interactive: { fields: [], answers: {} } })
      expect(actual?.interactive).not.toHaveProperty('flowToken')
    }
    expect(
      decode({
        interactiveResponseMessage: { nativeFlowResponseMessage: { name: 'quick_reply', paramsJson: '{broken' } },
      }),
    ).toMatchObject({ type: 'native_flow_response', interactive: { name: 'quick_reply', params: null } })
  })
  it('does not alter other existing message types or throw on empty payloads', () => {
    expect(decode({ conversation: 'Hi' })).toMatchObject({ type: 'text', body: 'Hi' })
    expect(decode({})).toMatchObject({ type: 'unknown', body: null })
  })
})
