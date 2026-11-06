import type { Proto } from 'zapo-js'
import type { z } from 'zod'
import type { SendNativeFormBodySchema } from '~/http/interactive-schemas'
import { nativeButton, nativeFlow } from './common'

export function buildNativeForm(input: z.infer<typeof SendNativeFormBodySchema>, flowToken: string): Proto.IMessage {
  return nativeFlow(
    input.body ?? '',
    [
      nativeButton('galaxy_message', {
        flow_action: 'navigate',
        flow_message_version: '4',
        flow_cta: input.cta,
        form_type: input.formType,
        flow_id: input.flowId,
        flow_token: flowToken,
        ...(input.screen !== undefined || input.data !== undefined
          ? {
              flow_action_payload: {
                ...(input.screen !== undefined ? { screen: input.screen } : {}),
                ...(input.data !== undefined ? { data: input.data } : {}),
              },
            }
          : {}),
      }),
    ],
    undefined,
    3,
  )
}
