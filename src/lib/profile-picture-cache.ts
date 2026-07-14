/**
 * multi-config profile picture cache.
 * Default TTL 24h — avoid hammering WhatsApp (rate-overlimit).
 * Negative results (privacy / no pic) are cached with the same TTL.
 */

import type { CacheClient } from '~/redis/client'

export type ProfilePictureType = 'preview' | 'image'

/** Auto-fetch policy for own profile + picture notifications (env `AVATAR_FETCH_TYPES`). */
export type AvatarFetchTypes = 'preview' | 'image' | 'both'

/**
 * Types to download on background/auto paths. `image` is listed first so
 * full-res is preferred when both are fetched.
 */
export function typesToFetch(mode: AvatarFetchTypes): ProfilePictureType[] {
  switch (mode) {
    case 'preview':
      return ['preview']
    case 'image':
      return ['image']
    case 'both':
      return ['image', 'preview']
  }
}

/** Prefer full-res when choosing which stored avatar URL to expose. */
export function preferredAvatarReadOrder(): ProfilePictureType[] {
  return ['image', 'preview']
}

export type CachedProfilePicture = {
  picture: unknown | null
  /** When picture is null: not-authorized, item-not-found, … */
  reason: string | null
  jid: string
  type: ProfilePictureType
  cachedAt: string
}

export function profilePictureCacheKey(instanceName: string, jid: string, type: ProfilePictureType): string {
  return `pp:v1:${instanceName}:${jid}:${type}`
}

/** Default 24h — matches docs */
export const PROFILE_PICTURE_CACHE_TTL_DEFAULT = 24 * 60 * 60

export async function getCachedProfilePicture(
  cache: CacheClient | undefined,
  instanceName: string,
  jid: string,
  type: ProfilePictureType,
): Promise<CachedProfilePicture | null> {
  if (!cache) return null
  try {
    const raw = await cache.get(profilePictureCacheKey(instanceName, jid, type))
    if (!raw) return null
    const parsed = JSON.parse(raw) as CachedProfilePicture
    if (!parsed || typeof parsed.jid !== 'string') return null
    return parsed
  } catch {
    return null
  }
}

export async function putProfilePictureCache(
  cache: CacheClient | undefined,
  instanceName: string,
  entry: CachedProfilePicture,
  ttlSeconds: number,
): Promise<void> {
  if (!cache || ttlSeconds <= 0) return
  try {
    await cache.set(profilePictureCacheKey(instanceName, entry.jid, entry.type), JSON.stringify(entry), ttlSeconds)
  } catch {
    /* best-effort */
  }
}

/** Extract a CDN URL from zapo getProfilePicture envelope for app_contacts column */
export function extractProfilePictureUrl(picture: unknown): string | null {
  if (!picture || typeof picture !== 'object') return null
  const p = picture as Record<string, unknown>
  for (const k of ['url', 'profilePictureUrl', 'eurl']) {
    const v = p[k]
    if (typeof v === 'string' && (v.startsWith('http') || v.startsWith('//'))) return v
  }
  if (p.picture && typeof p.picture === 'object') {
    return extractProfilePictureUrl(p.picture)
  }
  return null
}
