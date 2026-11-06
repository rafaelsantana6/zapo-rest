import sharp from 'sharp'
import { describe, expect, it } from 'vitest'
import { NewsletterCreateSchema } from '~/http/newsletter-schemas'
import { decodeNewsletterPicture, MAX_NEWSLETTER_PICTURE_BYTES } from '~/newsletters/admin-input'

describe('newsletter inline picture validation', () => {
  it('preserves omitted pictures and explicit removals', async () => {
    expect(await decodeNewsletterPicture(undefined)).toBeUndefined()
    expect(await decodeNewsletterPicture(null)).toBeNull()
  })
  it('accepts a decodable JPEG at the exact decoded byte limit', async () => {
    const jpeg = await sharp({ create: { width: 2, height: 2, channels: 3, background: 'blue' } })
      .jpeg()
      .toBuffer()
    const picture = Buffer.concat([jpeg, Buffer.alloc(MAX_NEWSLETTER_PICTURE_BYTES - jpeg.length)])
    const base64 = picture.toString('base64')
    expect(NewsletterCreateSchema.safeParse({ name: 'News', picture: base64 }).success).toBe(true)
    expect(await decodeNewsletterPicture(base64)).toEqual(picture)
  })
  it('rejects one decoded byte over the limit even with the same base64 length', async () => {
    const atLimit = Buffer.alloc(MAX_NEWSLETTER_PICTURE_BYTES).toString('base64')
    const overLimit = Buffer.alloc(MAX_NEWSLETTER_PICTURE_BYTES + 1).toString('base64')
    expect(atLimit.length).toBe(overLimit.length)
    expect(NewsletterCreateSchema.safeParse({ name: 'News', picture: overLimit }).success).toBe(false)
    await expect(decodeNewsletterPicture(overLimit)).rejects.toMatchObject({ statusCode: 400 })
  })
  it('rejects a JPEG signature without a decodable image', async () => {
    await expect(
      decodeNewsletterPicture(Buffer.from([0xff, 0xd8, 0xff, 0xd9]).toString('base64')),
    ).rejects.toMatchObject({ statusCode: 400 })
  })
})
