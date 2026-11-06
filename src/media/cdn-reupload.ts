/**
 * WhatsApp CDN answers 404/410 when a blob has expired (typical of history).
 * Retrying that URL cannot succeed. One `requestMediaReupload` asks the
 * sender's primary for a fresh `directPath`; the media key and hashes normally
 * stay valid. Some primaries re-encrypt on reupload instead, and the original
 * key no longer opens the blob: that MAC/hash mismatch is final (zapo-js 1.10).
 */

import { reviveBinaryFields } from '~/media/revive-raw'

const MEDIA_FIELDS = [
  'imageMessage',
  'videoMessage',
  'audioMessage',
  'documentMessage',
  'stickerMessage',
  'ptvMessage',
  'messageHistoryBundle',
] as const

/** Same envelopes zapo `unwrapMessage` descends before it reads the media node. */
const WRAPPER_FIELDS = [
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

export type MediaReuploadResult = {
  result: string
  directPath?: string
}

export type MediaDownloadClient = {
  message: {
    downloadBytes: (source: unknown) => Promise<Uint8Array>
    requestMediaReupload?: (source: unknown) => Promise<MediaReuploadResult>
  }
}

export type MediaDownloadState = {
  /** Proto `message` (or the media node itself) passed to `downloadBytes`. */
  proto: unknown
  /** `{ key, message }` for `requestMediaReupload`, when the stanza still has a key. */
  reuploadEvent: { key: Record<string, unknown>; message: unknown } | null
  /** True after one reupload attempt, success or not. */
  askedReupload: boolean
  /** True once `proto` carries a fresh `directPath` from a successful reupload. */
  reuploaded: boolean
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

/** CDN gone: zapo's `download failed with status 404|410`, or a status field. */
export function isExpiredCdnError(err: unknown): boolean {
  if (isRecord(err)) {
    const status = err.status ?? err.statusCode
    if (status === 404 || status === 410 || status === '404' || status === '410') return true
  }
  const message = err instanceof Error ? err.message : typeof err === 'string' ? err : ''
  return /\bstatus (404|410)\b/.test(message)
}

/** zapo's `media MAC mismatch` / `encrypted|plaintext file hash mismatch`. */
export function isMediaIntegrityError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : typeof err === 'string' ? err : ''
  return /\b(media MAC|file hash) mismatch\b/.test(message)
}

/**
 * Copy `source` with `directPath` written on the downloadable media node.
 * Returns the same reference when there is nothing to patch.
 */
export function patchMediaDirectPath(source: unknown, directPath: string): unknown {
  if (!isRecord(source)) return source
  for (const field of MEDIA_FIELDS) {
    const node = source[field]
    if (!isRecord(node)) continue
    return { ...source, [field]: { ...node, directPath } }
  }
  for (const field of WRAPPER_FIELDS) {
    const node = source[field]
    if (!isRecord(node) || !('message' in node)) continue
    const inner = patchMediaDirectPath(node.message, directPath)
    if (inner === node.message) continue
    return { ...source, [field]: { ...node, message: inner } }
  }
  return source
}

/** Split a live event or stored raw into a download proto and a reupload event. */
export function createMediaDownloadState(source: unknown): MediaDownloadState {
  if (!isRecord(source) || !isRecord(source.message)) {
    return { proto: reviveBinaryFields(source), reuploadEvent: null, askedReupload: false, reuploaded: false }
  }
  const proto = reviveBinaryFields(source.message)
  const key = isRecord(source.key) ? source.key : null
  return {
    proto,
    reuploadEvent: key ? { key, message: proto } : null,
    askedReupload: false,
    reuploaded: false,
  }
}

function canAskReupload(client: MediaDownloadClient, state: MediaDownloadState, err: unknown): boolean {
  return (
    !state.askedReupload &&
    state.reuploadEvent != null &&
    typeof client.message.requestMediaReupload === 'function' &&
    isExpiredCdnError(err)
  )
}

async function downloadAfterReupload(
  client: MediaDownloadClient,
  state: MediaDownloadState,
  expired: unknown,
): Promise<Uint8Array> {
  state.askedReupload = true
  const request = client.message.requestMediaReupload
  if (!request || !state.reuploadEvent) throw expired
  let retry: MediaReuploadResult
  try {
    retry = await request(state.reuploadEvent)
  } catch {
    // Newsletter or a missing key: keep the CDN error and do not ask again.
    throw expired
  }
  if (retry.result !== 'success' || !retry.directPath) {
    throw new Error(`media reupload ${retry.result}`)
  }
  const patched = patchMediaDirectPath(state.proto, retry.directPath)
  if (patched === state.proto) throw expired
  state.proto = patched
  state.reuploaded = true
  return downloadReuploaded(client, patched)
}

/** Re-encrypted blob: nothing in the reupload answer carries the new key, so no retry helps. */
async function downloadReuploaded(client: MediaDownloadClient, proto: unknown): Promise<Uint8Array> {
  try {
    return await client.message.downloadBytes(proto)
  } catch (err) {
    if (isMediaIntegrityError(err)) throw new Error(`media reupload re-encrypted: ${(err as Error).message}`)
    throw err
  }
}

/**
 * Download decrypted bytes. On CDN 404/410, ask for one fresh `directPath` and
 * download that. A later call sees `askedReupload` and does not ask again.
 */
export async function downloadMediaBytes(client: MediaDownloadClient, state: MediaDownloadState): Promise<Uint8Array> {
  if (state.reuploaded) return downloadReuploaded(client, state.proto)
  try {
    return await client.message.downloadBytes(state.proto)
  } catch (err) {
    if (!canAskReupload(client, state, err)) throw err
    return downloadAfterReupload(client, state, err)
  }
}
