/**
 * Extract a stable, API-friendly projection from zapo incoming message events.
 * Canonical chat JID prefers PN over LID (PN preference rewrite + LID↔PN map).
 */

import { bareUserJid, extractLidPnPair, isGroupJid, type LidPnPair, preferPnChatJid } from '~/lib/jid-canon'
import { sanitizeRawForStorage } from '~/media/revive-raw'

export type DecodedMessage = {
  messageId: string
  /** Canonical chat id (PN preferred when known) */
  chatJid: string
  /** Original remoteJid from the stanza (may be @lid) */
  remoteJid: string | null
  /** Alternate addressing (PN when remote is LID, or vice-versa) */
  remoteJidAlt: string | null
  /** LID↔PN pair extracted from the key, if both forms present */
  lidPnPair: LidPnPair | null
  senderJid: string | null
  participantJid: string | null
  fromMe: boolean
  timestampMs: number | null
  type: string
  body: string | null
  caption: string | null
  hasMedia: boolean
  mediaMime: string | null
  mediaFilename: string | null
  /**
   * WhatsApp CDN / direct URL from the proto (encrypted URL).
   * Used as fallback when object storage is disabled or download fails.
   */
  mediaDirectUrl: string | null
  pushName: string | null
  raw: unknown
}

// biome-ignore lint/suspicious/noExplicitAny: zapo event shapes vary
export function decodeIncomingMessage(event: any): DecodedMessage | null {
  const key = event?.key ?? {}
  const messageId = key.id as string | undefined
  const remoteJid = (key.remoteJid as string | undefined) ?? null
  const remoteJidAlt = (key.remoteJidAlt as string | undefined) ?? null

  // If remoteJid is @lid and remoteJidAlt is PN, store under PN
  const chatJid = preferPnChatJid(remoteJid, remoteJidAlt)
  if (!messageId || !chatJid) return null

  // Groups: keep group jid even if alt exists
  const finalChatJid = remoteJid && isGroupJid(remoteJid) ? bareUserJid(remoteJid) : chatJid

  const lidPnPair = extractLidPnPair(remoteJid, remoteJidAlt)
  // Descend the same wrappers zapo uses on the wire (ephemeral, bot-forwarded, …)
  // so a forwarded image stays media and an AI rich response is not `unknown`.
  const message = unwrapInboundMessage(event.message ?? event)
  const type = detectType(message)
  const body = extractBody(message)
  const caption = extractCaption(message)
  const hasMedia = MEDIA_TYPES.has(type)

  const ts =
    typeof event.timestampSeconds === 'number'
      ? event.timestampSeconds * 1000
      : typeof event.messageTimestamp === 'number'
        ? event.messageTimestamp > 1e12
          ? event.messageTimestamp
          : event.messageTimestamp * 1000
        : null

  return {
    messageId,
    chatJid: finalChatJid,
    remoteJid: remoteJid ? bareUserJid(remoteJid) : null,
    remoteJidAlt: remoteJidAlt ? bareUserJid(remoteJidAlt) : null,
    lidPnPair,
    senderJid: remoteJid ? bareUserJid(remoteJid) : null,
    participantJid: key.participant
      ? bareUserJid(String(key.participant))
      : key.participantAlt
        ? bareUserJid(String(key.participantAlt))
        : null,
    fromMe: Boolean(key.fromMe),
    timestampMs: ts,
    type,
    body,
    caption,
    hasMedia,
    mediaMime: extractMime(message),
    mediaFilename: extractFilename(message),
    mediaDirectUrl: extractMediaDirectUrl(message),
    pushName: (event.pushName as string) ?? null,
    raw: sanitizeRawForStorage(event),
  }
}

const MEDIA_TYPES = new Set(['image', 'video', 'audio', 'document', 'sticker', 'ptv'])

/** Envelopes whose real payload lives on `.message`. Mirrors zapo `unwrapMessage`. */
const INBOUND_WRAPPERS = [
  'ephemeralMessage',
  'groupMentionedMessage',
  'botInvokeMessage',
  'deviceSentMessage',
  'viewOnceMessage',
  'viewOnceMessageV2',
  'documentWithCaptionMessage',
  'groupStatusMessage',
  'groupStatusMessageV2',
  'botForwardedMessage',
] as const

// biome-ignore lint/suspicious/noExplicitAny: proto bag
function unwrapInboundMessage(message: any): any {
  let current = message
  for (let depth = 0; depth < 8 && current && typeof current === 'object'; depth++) {
    let inner: unknown
    for (const field of INBOUND_WRAPPERS) {
      inner = current[field]?.message
      if (inner) break
    }
    if (!inner) return current
    current = inner
  }
  return current
}

function pushText(parts: string[], value: unknown) {
  if (typeof value === 'string' && value.trim()) parts.push(value)
}

// biome-ignore lint/suspicious/noExplicitAny: proto bag
function richResponseText(message: any): string | null {
  const subs = message?.richResponseMessage?.submessages
  if (!Array.isArray(subs)) return null
  const parts: string[] = []
  for (const sub of subs) {
    pushText(parts, sub?.messageText)
    pushText(parts, sub?.imageMetadata?.imageText)
    const blocks = sub?.codeMetadata?.codeBlocks
    if (Array.isArray(blocks)) {
      const code = blocks
        .map((block: { codeContent?: unknown }) => (typeof block?.codeContent === 'string' ? block.codeContent : ''))
        .join('')
      pushText(parts, code)
    }
  }
  return parts.length ? parts.join('\n') : null
}

// biome-ignore lint/suspicious/noExplicitAny: proto bag
function detectType(message: any): string {
  if (!message || typeof message !== 'object') return 'unknown'
  if (message.richResponseMessage || message.botForwardedMessage) return 'text'
  if (message.conversation || message.extendedTextMessage) return 'text'
  if (message.imageMessage) return 'image'
  if (message.videoMessage) return 'video'
  if (message.audioMessage) return 'audio'
  if (message.documentMessage || message.documentWithCaptionMessage) return 'document'
  if (message.stickerMessage) return 'sticker'
  if (message.reactionMessage) return 'reaction'
  if (message.protocolMessage) {
    const t = message.protocolMessage.type
    if (t === 0 || t === 'REVOKE') return 'revoke'
    if (t === 14 || t === 'MESSAGE_EDIT') return 'edit'
    return 'protocol'
  }
  if (message.locationMessage || message.liveLocationMessage) return 'location'
  if (message.contactMessage || message.contactsArrayMessage) return 'contact'
  if (message.pollCreationMessage || message.pollCreationMessageV3) return 'poll'
  if (message.buttonsMessage || message.listMessage || message.templateMessage) return 'interactive'
  if (message.ptvMessage) return 'ptv'
  if (typeof message.type === 'string') return message.type
  if (typeof message.text === 'string') return 'text'
  return 'unknown'
}

// biome-ignore lint/suspicious/noExplicitAny: proto bag
function extractBody(message: any): string | null {
  if (!message) return null
  const rich = richResponseText(message)
  if (rich) return rich
  if (typeof message.text === 'string') return message.text
  if (typeof message.conversation === 'string') return message.conversation
  if (message.extendedTextMessage?.text) return String(message.extendedTextMessage.text)
  if (message.reactionMessage?.text) return String(message.reactionMessage.text)
  if (message.protocolMessage?.editedMessage) {
    return extractBody(message.protocolMessage.editedMessage)
  }
  // Location: compact "lat,lng" for list previews + dashboard map links
  const loc = message.locationMessage ?? message.liveLocationMessage
  if (loc && (loc.degreesLatitude != null || loc.degreesLongitude != null)) {
    const lat = Number(loc.degreesLatitude)
    const lng = Number(loc.degreesLongitude)
    const name = typeof loc.name === 'string' ? loc.name : typeof loc.address === 'string' ? loc.address : ''
    const coords = `${lat},${lng}`
    return name ? `${name} (${coords})` : coords
  }
  return null
}

// biome-ignore lint/suspicious/noExplicitAny: proto bag
function extractCaption(message: any): string | null {
  if (!message) return null
  const caps = [
    message.imageMessage?.caption,
    message.videoMessage?.caption,
    message.documentMessage?.caption,
    message.documentWithCaptionMessage?.message?.documentMessage?.caption,
    message.caption,
  ]
  for (const c of caps) {
    if (typeof c === 'string' && c.length) return c
  }
  return null
}

// biome-ignore lint/suspicious/noExplicitAny: proto bag
function extractMime(message: any): string | null {
  const m =
    message?.imageMessage?.mimetype ??
    message?.videoMessage?.mimetype ??
    message?.audioMessage?.mimetype ??
    message?.documentMessage?.mimetype ??
    message?.stickerMessage?.mimetype ??
    message?.mimetype
  return typeof m === 'string' ? m : null
}

// biome-ignore lint/suspicious/noExplicitAny: proto bag
function extractFilename(message: any): string | null {
  const f =
    message?.documentMessage?.fileName ??
    message?.documentWithCaptionMessage?.message?.documentMessage?.fileName ??
    message?.fileName
  return typeof f === 'string' ? f : null
}

/**
 * Best-effort WhatsApp media URL from the stanza (mmg.whatsapp.net etc).
 * Not always downloadable without keys — use getBase64 / stream endpoint for decrypted bytes.
 */
// biome-ignore lint/suspicious/noExplicitAny: proto bag
function extractMediaDirectUrl(message: any): string | null {
  if (!message || typeof message !== 'object') return null
  const bags = [
    message.imageMessage,
    message.videoMessage,
    message.audioMessage,
    message.documentMessage,
    message.stickerMessage,
    message.ptvMessage,
    message.documentWithCaptionMessage?.message?.documentMessage,
  ]
  for (const bag of bags) {
    if (!bag || typeof bag !== 'object') continue
    if (typeof bag.url === 'string' && bag.url.startsWith('http')) return bag.url
    if (typeof bag.directPath === 'string' && bag.directPath.length) {
    }
  }
  if (typeof message.mediaUrl === 'string' && message.mediaUrl.startsWith('http')) {
    return message.mediaUrl
  }
  return null
}

export function previewFromDecoded(d: DecodedMessage): string {
  if (d.type === 'protocol' || d.type === 'revoke') return ''
  if (d.body) return d.body.slice(0, 200)
  if (d.caption) return d.caption.slice(0, 200)
  if (d.hasMedia) return `[${d.type}]`
  if (d.type === 'unknown') return ''
  return `[${d.type}]`
}
