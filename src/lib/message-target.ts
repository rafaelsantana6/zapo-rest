import { proto, type Proto, unwrapMessage } from 'zapo-js'
import type { InstanceManager } from '~/instances/manager'
import { badRequest, conflict, notFound } from '~/lib/errors'
import { bareUserJid, isGroupJid, toPnJid } from '~/lib/jid-canon'
import type { LidMapStore } from '~/store/lid-map'
import { reviveBytes } from '~/media/revive-raw'
import type { MessageStore } from '~/store/messages'

type TargetDeps = { manager: InstanceManager; messages?: MessageStore; lidMap?: LidMapStore }
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
  const raw = (row?.raw ?? {}) as {
    key?: Proto.IMessageKey & { remoteJidAlt?: string | null }
    message?: Proto.IMessage
  }
  const originalJid = raw.key?.remoteJid ?? mailbox?.threadJid ?? row?.chatJid
  const allowedJids = [row?.chatJid, originalJid, raw.key?.remoteJidAlt]
    .filter((value): value is string => Boolean(value))
    .map(toPnJid)
  const requestedJids = allowedJids.includes(toPnJid(jid))
    ? [jid]
    : ((await deps.lidMap?.expandAliases(instanceName, jid)) ?? [jid])
  if (!requestedJids.some((value) => allowedJids.includes(toPnJid(value)))) {
    throw badRequest(`message ${messageId} does not belong to recipient ${jid}`)
  }
  const fromMe = raw.key?.fromMe ?? mailbox?.fromMe ?? row?.fromMe ?? false
  const message = raw.message ?? (mailbox?.messageBytes ? proto.Message.decode(mailbox.messageBytes) : {})
  const content = unwrapMessage(message)
  const cached = await stores?.messageSecret.get(messageId)
  // Own DM history/echoes can cache the peer as sender too; exclude every known peer alias.
  const ownDirect = fromMe && messageAuthor(originalJid) !== undefined
  const peerAliases = ownDirect ? ((await deps.lidMap?.expandAliases(instanceName, originalJid ?? jid)) ?? []) : []
  const peerJids = new Set([...allowedJids, ...requestedJids, ...peerAliases].map(toPnJid))
  const authorJid = [
    cached?.senderJid,
    raw.key?.participant,
    mailbox?.senderJid,
    mailbox?.participantJid,
    row?.participantJid,
    fromMe ? undefined : originalJid,
  ]
    .map(messageAuthor)
    .find((value) => value !== undefined && (!ownDirect || !peerJids.has(value)))
  const participant =
    raw.key?.participant ??
    mailbox?.participantJid ??
    row?.participantJid ??
    (isGroupJid(originalJid) ? authorJid : undefined)
  if (isGroupJid(originalJid) && !fromMe && !messageAuthor(participant)) {
    throw conflict(`message ${messageId} is missing the original group participant; receive/sync the original first`)
  }
  const secret =
    cached?.secret ??
    reviveBytes(message.messageContextInfo?.messageSecret ?? content.messageContextInfo?.messageSecret)
  return {
    target: { remoteJid: originalJid ?? jid, id: messageId, fromMe, participant: participant ?? undefined },
    message: content,
    type: row?.type,
    // The cached sender is canonical for addon crypto (may be a LID rather than the credential PN).
    authorJid,
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
  if (secret?.byteLength !== 32 || !authorJid || !messageAuthor(authorJid)) {
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

function messageAuthor(jid?: string | null): string | undefined {
  if (!jid) return undefined
  const bare = toPnJid(bareUserJid(jid))
  return /^[^@\s]+@(s\.whatsapp\.net|lid)$/.test(bare) ? bare : undefined
}
