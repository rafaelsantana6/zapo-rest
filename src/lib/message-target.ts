import { proto, type Proto, unwrapMessage } from 'zapo-js'
import type { InstanceManager } from '~/instances/manager'
import { badRequest, conflict, notFound } from '~/lib/errors'
import { bareUserJid } from '~/lib/jid-canon'
import { reviveBytes } from '~/media/revive-raw'
import type { MessageStore } from '~/store/messages'

type TargetDeps = { manager: InstanceManager; messages?: MessageStore }
type StoredOriginal = {
  target: { remoteJid: string; id: string; fromMe: boolean; participant?: string }
  message: Proto.IMessage
  type?: string
  authorJid?: string
  secret?: Uint8Array
}

/** Use the original wire identity, including LID addressing, rather than guessing from the recipient. */
export async function loadMessageTarget(
  deps: TargetDeps,
  input: { instanceName: string; messageId: string; jid: string },
): Promise<StoredOriginal> {
  const { instanceName, messageId, jid } = input
  const row = await deps.messages?.get(instanceName, messageId)
  const stores = deps.manager.getMessageStores(instanceName)
  const mailbox = await stores?.messages.getById(messageId)
  if (!row && !mailbox) throw notFound(`message ${messageId} is not stored in this instance`)
  const raw = (row?.raw ?? {}) as { key?: Proto.IMessageKey; message?: Proto.IMessage }
  const originalJid = raw.key?.remoteJid ?? mailbox?.threadJid ?? row?.chatJid
  const allowedJids = [row?.chatJid, originalJid].filter((value): value is string => Boolean(value))
  if (!allowedJids.some((value) => bareUserJid(value) === bareUserJid(jid))) {
    throw badRequest(`message ${messageId} does not belong to recipient ${jid}`)
  }
  const fromMe = raw.key?.fromMe ?? mailbox?.fromMe ?? row?.fromMe ?? false
  const participant = raw.key?.participant ?? mailbox?.participantJid ?? row?.participantJid ?? undefined
  const message = raw.message ?? (mailbox?.messageBytes ? proto.Message.decode(mailbox.messageBytes) : {})
  const content = unwrapMessage(message)
  const cached = await stores?.messageSecret.get(messageId)
  const secret =
    cached?.secret ??
    reviveBytes(message.messageContextInfo?.messageSecret ?? content.messageContextInfo?.messageSecret)
  return {
    target: { remoteJid: originalJid ?? jid, id: messageId, fromMe, participant },
    message: content,
    type: row?.type,
    // The cached sender is canonical for addon crypto (may be a LID rather than the credential PN).
    authorJid: cached?.senderJid || participant || (fromMe ? mailbox?.senderJid : originalJid) || undefined,
    secret: secret ? new Uint8Array(secret) : undefined,
  }
}

export function encryptedMessageParent(original: StoredOriginal, kind: 'event' | 'poll') {
  const { target, message, secret, authorJid } = original
  const matches =
    kind === 'event'
      ? message.eventMessage
      : (message.pollCreationMessage ??
        message.pollCreationMessageV2 ??
        message.pollCreationMessageV3 ??
        message.pollCreationMessageV4 ??
        message.pollCreationMessageV5 ??
        message.pollCreationMessageV6)
  if (!matches && original.type !== kind) throw badRequest(`message ${target.id} is not a stored ${kind}`)
  if (secret?.byteLength !== 32 || !authorJid) {
    throw conflict(
      `message ${target.id} is missing the original ${kind} secret or author; receive/sync the original first`,
    )
  }
  return {
    id: target.id,
    fromMe: target.fromMe,
    participant: target.participant ?? (target.remoteJid.endsWith('@g.us') ? authorJid : undefined),
    authorJid,
    messageSecret: secret,
  }
}
