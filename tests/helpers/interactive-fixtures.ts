import type { Proto } from 'zapo-js'

export const INTERACTIVE_TO = '5511999999999'
export const PIX_INPUT = { to: INTERACTIVE_TO, merchantName: 'Shop', key: 'pix@example.com' }
export const PRODUCT_INPUT = {
  to: INTERACTIVE_TO,
  productId: '12345',
  title: 'Hat',
  description: 'One size',
  currencyCode: 'BRL',
  priceAmount1000: 49900,
}
export const PNG_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a3XkAAAAASUVORK5CYII='
export const MEDIA_DESCRIPTOR = {
  url: 'https://mmg.whatsapp.net/image',
  directPath: '/v/image',
  mediaKey: new Uint8Array(32).fill(1),
  fileSha256: new Uint8Array(32).fill(2),
  fileEncSha256: new Uint8Array(32).fill(3),
  fileLength: 68,
  mediaKeyTimestamp: 1700000000,
  mimetype: 'image/png',
}
export function nativeFormResponseFixture(): Proto.IMessage {
  return {
    interactiveResponseMessage: {
      body: { text: 'Form submitted' },
      nativeFlowResponseMessage: {
        name: 'galaxy_message',
        version: 3,
        paramsJson: JSON.stringify({
          wa_flow_response_params: {
            flow_id: 'flow-1',
            flow_name: 'Registration',
            title: 'Customer registration',
            response_message: JSON.stringify({
              screens: [
                {
                  id: 'CONTACT',
                  components: [
                    { type: 'TextInput', name: 'customer', label: 'Name', value: 'Test customer', isSensitive: false },
                    { type: 'TextInput', name: 'document', label: 'Document', value: 'test-doc', isSensitive: true },
                  ],
                },
                {
                  id: 'PREFERENCES',
                  components: [
                    { type: 'CheckboxGroup', name: 'choices', label: 'Choices', value: ['a', 'b'], isSensitive: false },
                    { type: 'OptIn', name: 'optIn', value: false },
                  ],
                },
              ],
            }),
          },
        }),
      },
      contextInfo: {
        stanzaId: 'FORM-1',
        quotedMessage: {
          documentWithCaptionMessage: {
            message: {
              interactiveMessage: {
                nativeFlowMessage: {
                  buttons: [
                    {
                      name: 'galaxy_message',
                      buttonParamsJson: JSON.stringify({ flow_token: 'token-1', flow_id: 'flow-1' }),
                    },
                  ],
                  messageVersion: 3,
                },
              },
            },
          },
        },
      },
    },
  }
}
