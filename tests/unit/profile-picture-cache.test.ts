import { describe, expect, it } from 'vitest'
import {
  extractProfilePictureUrl,
  preferredAvatarReadOrder,
  PROFILE_PICTURE_CACHE_TTL_DEFAULT,
  profilePictureCacheKey,
  typesToFetch,
} from '~/lib/profile-picture-cache'
import { avatarStorageKey, sha256Hex } from '~/store/avatars'

describe('profile-picture-cache', () => {
  it('builds stable redis keys', () => {
    expect(profilePictureCacheKey('sales-1', '5511@s.whatsapp.net', 'preview')).toBe(
      'pp:v1:sales-1:5511@s.whatsapp.net:preview',
    )
  })

  it('default revalidation TTL is 24h', () => {
    expect(PROFILE_PICTURE_CACHE_TTL_DEFAULT).toBe(86_400)
  })

  it('extracts url from envelope', () => {
    expect(extractProfilePictureUrl({ url: 'https://pps.whatsapp.net/v/t.jpg' })).toBe(
      'https://pps.whatsapp.net/v/t.jpg',
    )
    expect(extractProfilePictureUrl({ profilePictureUrl: 'https://x/y' })).toBe('https://x/y')
    expect(extractProfilePictureUrl(null)).toBeNull()
  })

  it('avatar storage keys are deterministic (no orphans on update)', () => {
    const a = avatarStorageKey('sales-1', '5511999999999@s.whatsapp.net', 'preview')
    const b = avatarStorageKey('sales-1', '5511999999999@s.whatsapp.net', 'preview')
    expect(a).toBe(b)
    expect(a).toMatch(/^sales-1\/avatars\/[a-f0-9]+\/preview\.jpg$/)
  })

  it('sha256 is stable', () => {
    expect(sha256Hex(Buffer.from('abc'))).toBe(sha256Hex(Buffer.from('abc')))
  })

  it('AVATAR_FETCH_TYPES maps to fetch order (image before preview when both)', () => {
    expect(typesToFetch('both')).toEqual(['image', 'preview'])
    expect(typesToFetch('image')).toEqual(['image'])
    expect(typesToFetch('preview')).toEqual(['preview'])
    expect(preferredAvatarReadOrder()).toEqual(['image', 'preview'])
  })
})
