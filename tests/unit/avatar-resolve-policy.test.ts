import { describe, expect, it, vi } from 'vitest'
import {
  applyPictureNotification,
  pickBestAvatarResult,
  resolveAvatarsByPolicy,
  type AvatarResolveResult,
} from '~/lib/avatar-resolve'
import { preferredAvatarReadOrder, typesToFetch } from '~/lib/profile-picture-cache'
import { makeEnv } from '../helpers/fixtures'

function okResult(type: 'preview' | 'image', url: string): AvatarResolveResult {
  return {
    jid: '5511999999999@s.whatsapp.net',
    type,
    status: 'ok',
    reason: null,
    url,
    storageKey: `sales-1/avatars/abc/${type}.jpg`,
    sha256: 'x',
    waPictureId: '1',
    mimeType: 'image/jpeg',
    sizeBytes: 10,
    revalidated: true,
    fromStorage: true,
    lastCheckedAt: new Date().toISOString(),
    lastFetchedAt: new Date().toISOString(),
    wa: null,
    picture: { url },
  }
}

describe('avatar fetch policy helpers', () => {
  it('typesToFetch: both prefers image first', () => {
    expect(typesToFetch('both')).toEqual(['image', 'preview'])
    expect(typesToFetch('image')).toEqual(['image'])
    expect(typesToFetch('preview')).toEqual(['preview'])
  })

  it('preferred read order is full-res first', () => {
    expect(preferredAvatarReadOrder()).toEqual(['image', 'preview'])
  })

  it('pickBestAvatarResult prefers image over preview', () => {
    const preview = okResult('preview', '/preview')
    const image = okResult('image', '/image')
    expect(pickBestAvatarResult([preview, image])?.url).toBe('/image')
    expect(pickBestAvatarResult([preview])?.url).toBe('/preview')
    expect(pickBestAvatarResult([])).toBeNull()
  })
})

describe('resolveAvatarsByPolicy / applyPictureNotification', () => {
  it('resolveAvatarsByPolicy fetches image then preview when both', async () => {
    const order: string[] = []
    const client = {
      profile: {
        getProfilePicture: vi.fn(async (_jid: string, type: string) => {
          order.push(type)
          // Empty envelope → negative cache path (no CDN/SSRF)
          return {}
        }),
      },
    }
    const mediaStorage = {
      putAt: vi.fn(),
      exists: vi.fn(async () => false),
      delete: vi.fn(async () => undefined),
      publicUrl: () => null,
    }
    const avatars = {
      get: vi.fn(async () => null),
      upsertOk: vi.fn(),
      upsertNegative: vi.fn(async (input: { picType: string }) => ({
        instanceName: 'sales-1',
        jid: '5511999999999@s.whatsapp.net',
        picType: input.picType,
        status: 'none' as const,
        reason: 'item-not-found',
        storageKey: null,
        sha256: null,
        waPictureId: null,
        mimeType: null,
        sizeBytes: null,
        lastCheckedAt: new Date(),
        lastFetchedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      })),
      touchChecked: vi.fn(),
    }

    const { results } = await resolveAvatarsByPolicy({
      instanceName: 'sales-1',
      jid: '5511999999999@s.whatsapp.net',
      refresh: true,
      client: client as never,
      mediaStorage: mediaStorage as never,
      avatars: avatars as never,
      env: makeEnv({ AVATAR_FETCH_TYPES: 'both', PROFILE_PICTURE_CACHE_TTL_SECONDS: 0 }),
    })
    expect(order).toEqual(['image', 'preview'])
    expect(results.map((r) => r.type)).toEqual(['image', 'preview'])
  })

  it('applyPictureNotification set uses AVATAR_FETCH_TYPES (not chicken-egg image)', async () => {
    const types: string[] = []
    const client = {
      profile: {
        getProfilePicture: vi.fn(async (_jid: string, type: string) => {
          types.push(type)
          // empty → soft none without CDN
          return {}
        }),
      },
    }
    const mediaStorage = {
      putAt: vi.fn(),
      exists: vi.fn(async () => false),
      delete: vi.fn(async () => undefined),
      publicUrl: () => null,
    }
    const avatars = {
      get: vi.fn(async () => null), // no prior image meta — old code would skip image
      upsertOk: vi.fn(),
      upsertNegative: vi.fn(async (input: { picType: string }) => ({
        instanceName: 'sales-1',
        jid: '5511@s.whatsapp.net',
        picType: input.picType,
        status: 'none' as const,
        reason: 'item-not-found',
        storageKey: null,
        sha256: null,
        waPictureId: null,
        mimeType: null,
        sizeBytes: null,
        lastCheckedAt: new Date(),
        lastFetchedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      })),
      touchChecked: vi.fn(),
    }

    const applied = await applyPictureNotification({
      instanceName: 'sales-1',
      event: { action: 'set', targetJid: '5511999999999@s.whatsapp.net' },
      client: client as never,
      mediaStorage: mediaStorage as never,
      avatars: avatars as never,
      env: makeEnv({ AVATAR_FETCH_TYPES: 'both', PROFILE_PICTURE_CACHE_TTL_SECONDS: 0 }),
    })

    expect(applied?.action).toBe('set')
    expect(types).toEqual(['image', 'preview'])
  })

  it('applyPictureNotification preview-only skips image IQ', async () => {
    const types: string[] = []
    const client = {
      profile: {
        getProfilePicture: vi.fn(async (_jid: string, type: string) => {
          types.push(type)
          return {}
        }),
      },
    }
    const mediaStorage = {
      putAt: vi.fn(),
      exists: vi.fn(async () => false),
      delete: vi.fn(async () => undefined),
      publicUrl: () => null,
    }
    const avatars = {
      get: vi.fn(async () => null),
      upsertOk: vi.fn(),
      upsertNegative: vi.fn(async (input: { picType: string }) => ({
        instanceName: 'sales-1',
        jid: '5511@s.whatsapp.net',
        picType: input.picType,
        status: 'none' as const,
        reason: 'item-not-found',
        storageKey: null,
        sha256: null,
        waPictureId: null,
        mimeType: null,
        sizeBytes: null,
        lastCheckedAt: new Date(),
        lastFetchedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      })),
      touchChecked: vi.fn(),
    }

    await applyPictureNotification({
      instanceName: 'sales-1',
      event: { action: 'set', targetJid: '5511999999999@s.whatsapp.net' },
      client: client as never,
      mediaStorage: mediaStorage as never,
      avatars: avatars as never,
      env: makeEnv({ AVATAR_FETCH_TYPES: 'preview', PROFILE_PICTURE_CACHE_TTL_SECONDS: 0 }),
    })

    expect(types).toEqual(['preview'])
  })
})
