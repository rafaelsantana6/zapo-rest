import { describe, expect, it } from 'vitest'
import sharp from 'sharp'
import { normalizeProfileJpeg } from '~/media/profile-image'

describe('normalizeProfileJpeg', () => {
  it('converts PNG to JPEG under max edge', async () => {
    const png = await sharp({
      create: { width: 1200, height: 800, channels: 3, background: { r: 20, g: 40, b: 60 } },
    })
      .png()
      .toBuffer()

    const jpeg = await normalizeProfileJpeg(png)
    const meta = await sharp(jpeg).metadata()
    expect(meta.format).toBe('jpeg')
    expect(Math.max(meta.width ?? 0, meta.height ?? 0)).toBeLessThanOrEqual(640)
    expect(jpeg.byteLength).toBeGreaterThan(100)
    // Should be smaller than a raw 1200x800-ish encode path
    expect(jpeg.byteLength).toBeLessThan(png.byteLength + 50_000)
  })

  it('rejects empty buffer', async () => {
    await expect(normalizeProfileJpeg(Buffer.alloc(0))).rejects.toMatchObject({ statusCode: 400 })
  })

  it('rejects non-image bytes', async () => {
    await expect(normalizeProfileJpeg(Buffer.from('not-an-image'))).rejects.toMatchObject({ statusCode: 400 })
  })
})
