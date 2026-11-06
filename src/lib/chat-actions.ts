import type { z } from 'zod'
import type { ChatMuteBodySchema } from '~/http/openapi-schemas'
import { AppError, badRequest, conflict, serviceUnavailable } from '~/lib/errors'

export const MUTE_FOREVER_MS = 253402300799000

/** Map the REST timer to the epoch required by zapo, including its forever sentinel. */
export function chatMuteEnd(body: z.infer<typeof ChatMuteBodySchema>, now = Date.now()): number | undefined {
  if (!body.muted) return undefined
  const end = body.until
    ? Date.parse(body.until)
    : body.durationSeconds !== undefined
      ? now + body.durationSeconds * 1000
      : MUTE_FOREVER_MS
  if (!Number.isSafeInteger(end) || end <= now || end > MUTE_FOREVER_MS) {
    throw badRequest('Mute end must be a future date no later than 9999-12-31T23:59:59Z')
  }
  return end
}

/** Only upstream failures are mapped here; local persistence failures remain server errors. */
export async function runChatMutation(action: () => Promise<void>): Promise<void> {
  try {
    await action()
  } catch (error) {
    if (error instanceof AppError) throw error
    const message = error instanceof Error ? error.message : String(error)
    if (/not connected|not open|disconnected|unavailable|timeout|timed out|connection closed/i.test(message)) {
      throw serviceUnavailable(message)
    }
    throw conflict(message)
  }
}
