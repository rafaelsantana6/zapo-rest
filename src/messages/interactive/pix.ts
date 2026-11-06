import type { Proto } from 'zapo-js'
import type { z } from 'zod'
import { inferPixKeyType, type SendPixBodySchema } from '~/http/interactive-schemas'
import { nativeButton, nativeFlow } from './common'

export function pixSettings(input: { merchantName: string; key: string; keyType?: string }): object[] {
  return [
    {
      type: 'pix_static_code',
      pix_static_code: {
        merchant_name: input.merchantName,
        key: input.key,
        key_type: input.keyType ?? inferPixKeyType(input.key),
      },
    },
  ]
}
export function buildPix(input: z.infer<typeof SendPixBodySchema>, reference: string): Proto.IMessage {
  const zero = { value: 0, offset: 100 }
  return nativeFlow(
    input.body,
    [
      nativeButton('payment_info', {
        currency: 'BRL',
        total_amount: zero,
        reference_id: reference,
        type: 'physical-goods',
        order: {
          status: 'pending',
          subtotal: zero,
          order_type: 'ORDER',
          items: [{ name: '', amount: zero, quantity: 0, sale_amount: zero }],
        },
        payment_settings: pixSettings(input),
        share_payment_status: false,
        is_soft_deleted: false,
        referral: 'chat_attachment',
      }),
    ],
    input.footer,
  )
}
