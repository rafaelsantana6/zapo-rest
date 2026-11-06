import type { Proto } from 'zapo-js'
import type { z } from 'zod'
import type { SendCarouselBodySchema } from '~/http/interactive-schemas'
import { buildNativeButtons, type ButtonContext } from './common'
import { reserveReplyIds } from './reply-ids'

export type UploadedCardMedia =
  | { imageMessage: Proto.Message.IImageMessage }
  | { videoMessage: Proto.Message.IVideoMessage }
export function buildCarousel(
  input: z.infer<typeof SendCarouselBodySchema>,
  media: UploadedCardMedia[],
  context: ButtonContext = {},
): Proto.IMessage {
  if (media.length !== input.cards.length) throw new Error('Each carousel card requires uploaded media')
  const allocateId = reserveReplyIds(
    input.cards.flatMap((card) => card.buttons.filter((button) => button.type === 'quick_reply')),
  )
  return {
    interactiveMessage: {
      body: { text: input.body },
      carouselMessage: {
        messageVersion: 1,
        cards: input.cards.map((card, index) => ({
          header: {
            ...(card.title !== undefined ? { title: card.title } : {}),
            hasMediaAttachment: true,
            ...media[index],
          },
          body: { text: card.body },
          nativeFlowMessage: {
            buttons: buildNativeButtons(card.buttons, context, allocateId),
            messageParamsJson: '',
            messageVersion: 1,
          },
        })),
      },
    },
  }
}
