import type { Proto } from 'zapo-js'
import type { z } from 'zod'
import type { SendInteractiveBodySchema } from '~/http/interactive-schemas'
import { buildNativeButton, type ButtonContext, nativeFlow } from './common'

export function buildInteractive(
  input: z.infer<typeof SendInteractiveBodySchema>,
  context: ButtonContext = {},
): Proto.IMessage {
  const message = nativeFlow(
    input.body,
    input.buttons.map((button, index) => buildNativeButton(button, index, { ...context, groupSafe: input.groupSafe })),
    input.footer,
  )
  if (input.header && message.interactiveMessage)
    message.interactiveMessage.header = { title: input.header, hasMediaAttachment: false }
  return message
}
