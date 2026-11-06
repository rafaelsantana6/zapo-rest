import type { Proto } from 'zapo-js'
import type { z } from 'zod'
import type { SendChargeBodySchema } from '~/http/interactive-schemas'
import { nativeButton, nativeFlow } from './common'
import { pixSettings } from './pix'

function money(amount: number) {
  return { value: Math.round(amount * 100), offset: 100 }
}
export function buildCharge(input: z.infer<typeof SendChargeBodySchema>): Proto.IMessage {
  const subtotal = input.items.reduce((sum, item) => sum + Math.round(item.amount * 100) * item.quantity, 0)
  const total = subtotal - money(input.discount).value + money(input.shipping).value + money(input.tax).value
  return nativeFlow(
    input.body,
    [
      nativeButton('review_and_pay', {
        currency: 'BRL',
        reference_id: input.reference,
        type: 'physical-goods',
        total_amount: { value: total, offset: 100 },
        payment_settings: pixSettings(input),
        order: {
          status: 'payment_requested',
          subtotal: { value: subtotal, offset: 100 },
          order_type: 'ORDER',
          items: input.items.map((item) => ({ name: item.name, amount: money(item.amount), quantity: item.quantity })),
          ...(input.discount ? { discount: money(input.discount) } : {}),
          ...(input.shipping ? { shipping: money(input.shipping) } : {}),
          ...(input.tax ? { tax: money(input.tax) } : {}),
        },
      }),
    ],
    input.footer,
  )
}
