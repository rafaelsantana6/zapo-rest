import type { Proto } from 'zapo-js'
import type { InteractiveButton } from '~/http/interactive-schemas'
import { reserveReplyIds, type ReplyIdAllocator } from './reply-ids'

export type ButtonContext = { ownPhone?: string; isGroup?: boolean; groupSafe?: boolean }
export function nativeButton(
  name: string,
  params: object,
): Proto.Message.InteractiveMessage.NativeFlowMessage.INativeFlowButton {
  return { name, buttonParamsJson: JSON.stringify(params) }
}
export function nativeFlow(
  body: string | undefined,
  buttons: Proto.Message.InteractiveMessage.NativeFlowMessage.INativeFlowButton[],
  footer?: string,
  version = 1,
): Proto.IMessage {
  return {
    interactiveMessage: {
      ...(body !== undefined ? { body: { text: body } } : {}),
      ...(footer !== undefined ? { footer: { text: footer } } : {}),
      nativeFlowMessage: { buttons, messageParamsJson: '', messageVersion: version },
    },
  }
}
function requireOwnPhone(context: ButtonContext): string {
  if (!context.ownPhone || !/^[1-9]\d{6,14}$/.test(context.ownPhone))
    throw new Error('Connected account PN required; LID is not a phone number')
  return context.ownPhone
}
function buildNativeButton(
  button: InteractiveButton,
  id: string,
  context: ButtonContext,
): Proto.Message.InteractiveMessage.NativeFlowMessage.INativeFlowButton {
  switch (button.type) {
    case 'quick_reply': {
      if (!context.isGroup || !context.groupSafe) return nativeButton('quick_reply', { display_text: button.text, id })
      const url = `https://wa.me/${requireOwnPhone(context)}?text=${encodeURIComponent(button.text)}`
      return nativeButton('cta_url', { display_text: button.text, url, merchant_url: url })
    }
    case 'url':
      return nativeButton('cta_url', {
        display_text: button.text,
        url: button.url,
        merchant_url: button.url,
        ...(button.webview ? { webview_presentation: 'full', webview_interaction: true } : {}),
      })
    case 'copy':
      return nativeButton('cta_copy', { display_text: button.text, copy_code: button.code, id: button.code })
    case 'call':
      return nativeButton('cta_call', { display_text: button.text, phone_number: button.phoneNumber })
    case 'catalog':
      return nativeButton('cta_catalog', {
        business_phone_number: requireOwnPhone(context),
        ...(button.productId ? { catalog_product_id: button.productId } : {}),
      })
  }
}

export function buildNativeButtons(
  buttons: InteractiveButton[],
  context: ButtonContext,
  allocateId: ReplyIdAllocator = reserveReplyIds(buttons.filter((button) => button.type === 'quick_reply')),
): Proto.Message.InteractiveMessage.NativeFlowMessage.INativeFlowButton[] {
  return buttons.map((button, index) =>
    buildNativeButton(
      button,
      button.type === 'quick_reply' ? (button.id ?? allocateId(`button_${index + 1}`)) : '',
      context,
    ),
  )
}
