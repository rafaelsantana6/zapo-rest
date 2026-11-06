import { proto, type Proto } from 'zapo-js'

/** Summaries never inspect encrypted addon bytes; decrypted addons keep their existing transport. */
export function decodeExtraMessage(message: Proto.IMessage): { type: string; body: string | null } | null {
  if (message.eventMessage) return { type: 'event', body: message.eventMessage.name ?? '[event]' }
  if (message.encEventResponseMessage)
    return {
      type: 'event-response',
      body: `Event response: ${message.encEventResponseMessage.eventCreationMessageKey?.id ?? 'unknown'}`,
    }
  if (message.pinInChatMessage) {
    const pin = message.pinInChatMessage
    const type = pin.type === proto.Message.PinInChatMessage.Type.UNPIN_FOR_ALL ? 'unpin' : 'pin'
    return { type, body: `${type}: ${pin.key?.id ?? 'unknown'}` }
  }
  if (message.keepInChatMessage) {
    const keep = message.keepInChatMessage
    const type = keep.keepType === proto.KeepType.UNDO_KEEP_FOR_ALL ? 'unkeep' : 'keep'
    return { type, body: `${type}: ${keep.key?.id ?? 'unknown'}` }
  }
  if (message.pollUpdateMessage)
    return {
      type: 'poll-vote',
      body: `Poll vote: ${message.pollUpdateMessage.pollCreationMessageKey?.id ?? 'unknown'}`,
    }
  if (message.stickerPackMessage)
    return { type: 'sticker-pack', body: message.stickerPackMessage.name ?? '[sticker-pack]' }
  return null
}
