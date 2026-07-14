/**
 * Durable avatar cache: bytes in MediaStorage + meta in Postgres.
 * - Deterministic storage keys (overwrite on change → no orphans)
 * - TTL on last_checked_at controls WA revalidation (on-demand only)
 * - Compare wa picture id / sha256 before rewriting bytes
 */

import type { Env } from '~/config/env'
import {
  extractProfilePictureUrl,
  preferredAvatarReadOrder,
  PROFILE_PICTURE_CACHE_TTL_DEFAULT,
  type ProfilePictureType,
  typesToFetch,
} from '~/lib/profile-picture-cache'
import { isSoftProfileQueryFailure, parseWaIqError } from '~/lib/wa-iq-error'
import type { MediaStorage } from '~/media/storage'
import { type AvatarStatus, type AvatarStore, avatarStorageKey, type ContactAvatar, sha256Hex } from '~/store/avatars'
import type { ContactStore } from '~/store/contacts'

export type AvatarEnv = Pick<Env, 'PROFILE_PICTURE_CACHE_TTL_SECONDS' | 'AVATAR_FETCH_TYPES'>

export type WaClientLike = {
  profile: {
    // Accept any client with getProfilePicture (zapo WaProfilePictureType is string union)
    // biome-ignore lint/suspicious/noExplicitAny: bridge to zapo client without tight coupling
    getProfilePicture: (...args: any[]) => Promise<unknown>
  }
}

export type AvatarResolveResult = {
  jid: string
  type: ProfilePictureType
  status: AvatarStatus
  reason: string | null
  /** Public or API-relative URL for the image bytes (our storage) */
  url: string | null
  storageKey: string | null
  sha256: string | null
  waPictureId: string | null
  mimeType: string | null
  sizeBytes: number | null
  /** true when WA was queried this request */
  revalidated: boolean
  /** true when serving existing storage without WA call */
  fromStorage: boolean
  lastCheckedAt: string
  lastFetchedAt: string | null
  /** Raw WA envelope when available (id/url/directPath) — for debug */
  wa: unknown | null
  /** picture envelope for API consumers (url points to our durable copy when possible) */
  picture: unknown | null
}

function extractWaPictureId(picture: unknown): string | null {
  if (!picture || typeof picture !== 'object') return null
  const p = picture as Record<string, unknown>
  if (p.id != null && String(p.id).length > 0) return String(p.id)
  if (p.directPath != null && String(p.directPath).length > 0) return String(p.directPath)
  return null
}

function isFresh(meta: ContactAvatar, ttlSeconds: number): boolean {
  if (ttlSeconds <= 0) return false
  const ageMs = Date.now() - meta.lastCheckedAt.getTime()
  return ageMs < ttlSeconds * 1000
}

const MAX_AVATAR_BYTES = 8 * 1024 * 1024 // 8 MiB — profile pics are small

async function downloadUrl(url: string): Promise<{ buf: Buffer; mime: string | null }> {
  // WA CDN URLs are https; still gate against private/metadata destinations.
  const { assertPublicUrl } = await import('~/lib/ssrf-guard')
  await assertPublicUrl(url)

  const res = await fetch(url, {
    headers: {
      // some CDN paths are happier with a browser-ish UA
      'user-agent': 'zapo-rest/0.1',
      accept: 'image/*,*/*',
    },
    redirect: 'error',
  })
  if (!res.ok) {
    throw new Error(`avatar CDN download failed: HTTP ${res.status}`)
  }
  const declared = Number(res.headers.get('content-length') ?? 0)
  if (declared > MAX_AVATAR_BYTES) {
    throw new Error(`avatar CDN download too large: content-length ${declared}`)
  }
  const ab = await res.arrayBuffer()
  if (ab.byteLength > MAX_AVATAR_BYTES) {
    throw new Error(`avatar CDN download too large: ${ab.byteLength} bytes`)
  }
  const mime = res.headers.get('content-type')
  return { buf: Buffer.from(ab), mime: mime?.split(';')[0] ?? null }
}

function apiAvatarUrl(instanceName: string, jid: string, picType: ProfilePictureType): string {
  return `/v1/instances/${encodeURIComponent(instanceName)}/contacts/${encodeURIComponent(jid)}/profile-picture/file?type=${picType}`
}

function toResult(
  meta: ContactAvatar,
  opts: {
    revalidated: boolean
    fromStorage: boolean
    wa?: unknown | null
    publicUrl?: string | null
  },
): AvatarResolveResult {
  const url =
    meta.status === 'ok' && meta.storageKey
      ? (opts.publicUrl ?? apiAvatarUrl(meta.instanceName, meta.jid, meta.picType))
      : null
  const picture =
    meta.status === 'ok'
      ? {
          id: meta.waPictureId,
          url,
          storageKey: meta.storageKey,
          mimeType: meta.mimeType,
          sizeBytes: meta.sizeBytes,
          sha256: meta.sha256,
        }
      : null
  return {
    jid: meta.jid,
    type: meta.picType,
    status: meta.status,
    reason: meta.reason,
    url,
    storageKey: meta.storageKey,
    sha256: meta.sha256,
    waPictureId: meta.waPictureId,
    mimeType: meta.mimeType,
    sizeBytes: meta.sizeBytes,
    revalidated: opts.revalidated,
    fromStorage: opts.fromStorage,
    lastCheckedAt: meta.lastCheckedAt.toISOString(),
    lastFetchedAt: meta.lastFetchedAt?.toISOString() ?? null,
    wa: opts.wa ?? null,
    picture,
  }
}

/** Prefer full-res `ok` result over preview when multiple types were resolved. */
export function pickBestAvatarResult(results: AvatarResolveResult[]): AvatarResolveResult | null {
  for (const type of preferredAvatarReadOrder()) {
    const hit = results.find((r) => r.type === type && r.status === 'ok' && r.url)
    if (hit) return hit
  }
  return results.find((r) => r.status === 'ok' && r.url) ?? results[0] ?? null
}

/**
 * Resolve avatars according to `AVATAR_FETCH_TYPES` (image first when `both`).
 * Returns every attempt plus the best URL for consumers (instance.avatarUrl).
 */
export async function resolveAvatarsByPolicy(opts: {
  instanceName: string
  jid: string
  refresh?: boolean
  client: WaClientLike
  mediaStorage: MediaStorage
  avatars: AvatarStore
  contacts?: ContactStore
  env: AvatarEnv
}): Promise<{ results: AvatarResolveResult[]; best: AvatarResolveResult | null }> {
  const types = typesToFetch(opts.env.AVATAR_FETCH_TYPES)
  const results: AvatarResolveResult[] = []
  for (const picType of types) {
    try {
      const r = await resolveContactAvatar({
        instanceName: opts.instanceName,
        jid: opts.jid,
        picType,
        refresh: opts.refresh,
        client: opts.client,
        mediaStorage: opts.mediaStorage,
        avatars: opts.avatars,
        contacts: opts.contacts,
        env: opts.env,
      })
      results.push(r)
    } catch {
      // one type failing shouldn't block the other
    }
  }
  return { results, best: pickBestAvatarResult(results) }
}

export type StoredAvatarLookup =
  | { kind: 'ok'; url: string }
  /** All known rows are privacy/none — do not suggest on-demand path */
  | { kind: 'none' }
  /** No usable row yet */
  | { kind: 'miss' }

/**
 * Pick a durable avatar URL from storage, preferring full-res over preview.
 * Does not hit WhatsApp.
 */
export async function getStoredAvatarUrl(opts: {
  instanceName: string
  jid: string
  avatars: AvatarStore
  mediaStorage?: MediaStorage | null
  /** Relative API path fallback when storage has no public URL */
  apiPathFallback?: string | null
}): Promise<StoredAvatarLookup> {
  let sawNegative = false
  let sawRow = false
  for (const picType of preferredAvatarReadOrder()) {
    const av = await opts.avatars.get(opts.instanceName, opts.jid, picType)
    if (!av) continue
    sawRow = true
    if (av.status === 'ok' && av.storageKey) {
      const pub = opts.mediaStorage?.publicUrl?.(av.storageKey)
      const url = pub ?? opts.apiPathFallback ?? apiAvatarUrl(opts.instanceName, opts.jid, picType)
      return { kind: 'ok', url }
    }
    if (av.status === 'privacy' || av.status === 'none') {
      sawNegative = true
    }
  }
  if (sawRow && sawNegative) return { kind: 'none' }
  return { kind: 'miss' }
}

export async function resolveContactAvatar(opts: {
  instanceName: string
  jid: string
  picType: ProfilePictureType
  refresh?: boolean
  client: WaClientLike
  mediaStorage: MediaStorage
  avatars: AvatarStore
  contacts?: ContactStore
  env: AvatarEnv
}): Promise<AvatarResolveResult> {
  const { instanceName, jid, picType, refresh = false, client, mediaStorage, avatars, contacts } = opts
  const ttl =
    opts.env.PROFILE_PICTURE_CACHE_TTL_SECONDS > 0
      ? opts.env.PROFILE_PICTURE_CACHE_TTL_SECONDS
      : PROFILE_PICTURE_CACHE_TTL_DEFAULT
  const cacheEnabled = opts.env.PROFILE_PICTURE_CACHE_TTL_SECONDS !== 0

  const existing = await avatars.get(instanceName, jid, picType)

  // Fresh positive with bytes on disk → serve without WA
  if (
    cacheEnabled &&
    !refresh &&
    existing &&
    isFresh(existing, ttl) &&
    existing.status === 'ok' &&
    existing.storageKey
  ) {
    const ok = await mediaStorage.exists(existing.storageKey)
    if (ok) {
      return toResult(existing, {
        revalidated: false,
        fromStorage: true,
        publicUrl: mediaStorage.publicUrl(existing.storageKey) ?? apiAvatarUrl(instanceName, jid, picType),
      })
    }
    // meta says ok but object missing → fall through to revalidate
  }

  // Fresh negative → no WA hammer
  if (cacheEnabled && !refresh && existing && isFresh(existing, ttl) && existing.status !== 'ok') {
    return toResult(existing, { revalidated: false, fromStorage: false })
  }

  // ── Live revalidate against WhatsApp ─────────────────────────────────────
  let waPicture: unknown | null = null
  let softReason: string | null = null
  try {
    waPicture = await client.profile.getProfilePicture(jid, picType)
  } catch (err) {
    if (isSoftProfileQueryFailure(err)) {
      softReason = parseWaIqError(err)?.code ?? parseWaIqError(err)?.kind ?? 'unavailable'
      waPicture = null
    } else {
      throw err
    }
  }

  const waId = extractWaPictureId(waPicture)
  const waUrl = extractProfilePictureUrl(waPicture)
  const empty = !waUrl && !waId && (!waPicture || Object.keys(waPicture as object).length === 0)

  // Privacy / none
  if (softReason || empty || !waUrl) {
    const status: AvatarStatus = softReason === 'not-authorized' || softReason === 'privacy' ? 'privacy' : 'none'
    const reason = softReason ?? (empty ? 'item-not-found' : 'unavailable')
    // Delete old bytes if any (no orphans)
    if (existing?.storageKey) {
      await mediaStorage.delete(existing.storageKey)
    }
    // Also delete deterministic key even if meta stale
    await mediaStorage.delete(avatarStorageKey(instanceName, jid, picType))
    const meta = await avatars.upsertNegative({
      instanceName,
      jid,
      picType,
      status,
      reason,
    })
    if (contacts) {
      void contacts.setProfilePictureUrl(instanceName, jid, null).catch(() => undefined)
    }
    return toResult(meta, { revalidated: true, fromStorage: false, wa: waPicture })
  }

  // Same WA picture id → touch check only (skip download)
  if (
    existing?.status === 'ok' &&
    existing.storageKey &&
    waId &&
    existing.waPictureId &&
    waId === existing.waPictureId
  ) {
    const stillThere = await mediaStorage.exists(existing.storageKey)
    if (stillThere) {
      await avatars.touchChecked(instanceName, jid, picType)
      const fresh = await avatars.get(instanceName, jid, picType)
      if (!fresh) {
        return toResult(existing, {
          revalidated: true,
          fromStorage: true,
          wa: waPicture,
          publicUrl: mediaStorage.publicUrl(existing.storageKey) ?? apiAvatarUrl(instanceName, jid, picType),
        })
      }
      return toResult(fresh, {
        revalidated: true,
        fromStorage: true,
        wa: waPicture,
        publicUrl: mediaStorage.publicUrl(existing.storageKey) ?? apiAvatarUrl(instanceName, jid, picType),
      })
    }
  }

  // Download CDN bytes
  let buf: Buffer
  let mime: string | null = 'image/jpeg'
  try {
    const dl = await downloadUrl(waUrl)
    buf = dl.buf
    mime = dl.mime ?? 'image/jpeg'
  } catch {
    // CDN fail: if we still have storage, keep it and touch check
    if (existing?.status === 'ok' && existing.storageKey) {
      await avatars.touchChecked(instanceName, jid, picType)
      const fresh = await avatars.get(instanceName, jid, picType)
      if (fresh) {
        return toResult(fresh, {
          revalidated: true,
          fromStorage: true,
          wa: waPicture,
          publicUrl: mediaStorage.publicUrl(existing.storageKey) ?? apiAvatarUrl(instanceName, jid, picType),
        })
      }
    }
    const meta = await avatars.upsertNegative({
      instanceName,
      jid,
      picType,
      status: 'none',
      reason: 'cdn_download_failed',
    })
    return toResult(meta, { revalidated: true, fromStorage: false, wa: waPicture })
  }

  const hash = sha256Hex(buf)
  const storageKey = avatarStorageKey(instanceName, jid, picType)

  // Same hash as stored → no rewrite
  if (existing?.sha256 === hash && existing.storageKey) {
    const stillThere = await mediaStorage.exists(existing.storageKey)
    if (stillThere) {
      const meta = await avatars.upsertOk({
        instanceName,
        jid,
        picType,
        storageKey: existing.storageKey,
        sha256: hash,
        waPictureId: waId,
        mimeType: mime,
        sizeBytes: buf.byteLength,
        bytesChanged: false,
      })
      const storageKey = meta.storageKey ?? existing.storageKey
      if (contacts && storageKey) {
        const apiUrl = mediaStorage.publicUrl(storageKey) ?? apiAvatarUrl(instanceName, jid, picType)
        void contacts.setProfilePictureUrl(instanceName, jid, apiUrl).catch(() => undefined)
      }
      return toResult(meta, {
        revalidated: true,
        fromStorage: true,
        wa: waPicture,
        publicUrl: storageKey
          ? (mediaStorage.publicUrl(storageKey) ?? apiAvatarUrl(instanceName, jid, picType))
          : apiAvatarUrl(instanceName, jid, picType),
      })
    }
  }

  // Write/overwrite deterministic key
  const stored = await mediaStorage.putAt(storageKey, buf, { mimeType: mime ?? 'image/jpeg' })
  const meta = await avatars.upsertOk({
    instanceName,
    jid,
    picType,
    storageKey: stored.storageKey,
    sha256: hash,
    waPictureId: waId,
    mimeType: mime,
    sizeBytes: stored.sizeBytes,
    bytesChanged: true,
  })

  const publicUrl = mediaStorage.publicUrl(stored.storageKey) ?? apiAvatarUrl(instanceName, jid, picType)
  if (contacts) {
    void contacts.setProfilePictureUrl(instanceName, jid, publicUrl).catch(() => undefined)
  }

  return toResult(meta, {
    revalidated: true,
    fromStorage: true,
    wa: waPicture,
    publicUrl,
  })
}

export type PictureNotificationEvent = {
  action?: string
  targetJid?: string
  authorJid?: string
  pictureId?: number | string
  contactHash?: string
  chatJid?: string
  timestampSeconds?: number
}

/**
 * Handle zapo `picture` notification: refresh durable storage on set/set_avatar,
 * wipe storage on delete. Call only when mediaStorage is configured.
 */
export async function applyPictureNotification(opts: {
  instanceName: string
  event: PictureNotificationEvent
  client: WaClientLike
  mediaStorage: MediaStorage
  avatars: AvatarStore
  contacts?: ContactStore
  env: AvatarEnv
  /** Normalize target JID (PN preferred) */
  resolveJid?: (raw: string) => string
}): Promise<{
  action: string
  jid: string
  results: AvatarResolveResult[]
  deleted: ProfilePictureType[]
} | null> {
  const rawJid = opts.event.targetJid ?? opts.event.chatJid
  if (!rawJid) return null
  const jid = opts.resolveJid ? opts.resolveJid(rawJid) : rawJid
  const action = (opts.event.action ?? 'set').toLowerCase()

  if (action === 'delete') {
    const deleted: ProfilePictureType[] = []
    for (const picType of ['preview', 'image'] as const) {
      const existing = await opts.avatars.get(opts.instanceName, jid, picType)
      if (existing?.storageKey) {
        await opts.mediaStorage.delete(existing.storageKey)
      }
      await opts.mediaStorage.delete(avatarStorageKey(opts.instanceName, jid, picType))
      await opts.avatars.upsertNegative({
        instanceName: opts.instanceName,
        jid,
        picType,
        status: 'none',
        reason: 'picture_deleted',
      })
      deleted.push(picType)
    }
    if (opts.contacts) {
      void opts.contacts.setProfilePictureUrl(opts.instanceName, jid, null).catch(() => undefined)
    }
    return { action: 'delete', jid, results: [], deleted }
  }

  if (action === 'request') {
    // Peer requesting our picture — no storage action for contact avatars
    return { action: 'request', jid, results: [], deleted: [] }
  }

  // set | set_avatar | unknown → force revalidate per AVATAR_FETCH_TYPES (default both)
  const { results } = await resolveAvatarsByPolicy({
    instanceName: opts.instanceName,
    jid,
    refresh: true,
    client: opts.client,
    mediaStorage: opts.mediaStorage,
    avatars: opts.avatars,
    contacts: opts.contacts,
    env: opts.env,
  })
  return { action: action === 'set_avatar' ? 'set_avatar' : 'set', jid, results, deleted: [] }
}
