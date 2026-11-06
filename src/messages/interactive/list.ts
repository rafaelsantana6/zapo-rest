import type { Proto } from 'zapo-js'
import type { z } from 'zod'
import type { SendListBodySchema } from '~/http/interactive-schemas'
import { nativeButton, nativeFlow } from './common'
import { reserveReplyIds } from './reply-ids'

export function buildList(input: z.infer<typeof SendListBodySchema>): Proto.IMessage {
  const allocateId = reserveReplyIds(input.sections.flatMap((section) => section.rows))
  return nativeFlow(
    input.body,
    [
      nativeButton('single_select', {
        title: input.buttonText,
        sections: input.sections.map((section, sectionIndex) => ({
          title: section.title,
          rows: section.rows.map((row, rowIndex) => ({
            header: '',
            title: row.title,
            description: row.description ?? '',
            id: row.id ?? allocateId(`row_${sectionIndex + 1}_${rowIndex + 1}`),
          })),
        })),
      }),
    ],
    input.footer,
  )
}
