import { proto, type Proto } from 'zapo-js'
import type { z } from 'zod'
import type { SendButtonsBodySchema } from '~/http/interactive-schemas'
import { buildNativeButton, type ButtonContext, nativeFlow } from './common'

export function buildButtons(
  input: z.infer<typeof SendButtonsBodySchema>,
  context: ButtonContext = {},
): Proto.IMessage {
  if (context.isGroup && input.groupSafe)
    return nativeFlow(
      input.text,
      input.buttons.map((button, index) =>
        buildNativeButton({ type: 'quick_reply', ...button }, index, { ...context, groupSafe: true }),
      ),
      input.footer,
    )
  return {
    documentWithCaptionMessage: {
      message: {
        buttonsMessage: {
          contentText: input.text,
          ...(input.footer !== undefined ? { footerText: input.footer } : {}),
          headerType: proto.Message.ButtonsMessage.HeaderType.EMPTY,
          buttons: input.buttons.map((button, index) => ({
            buttonId: button.id ?? `button_${index + 1}`,
            buttonText: { displayText: button.text },
            type: proto.Message.ButtonsMessage.Button.Type.RESPONSE,
          })),
        },
      },
    },
  }
}
