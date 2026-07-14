/**
 * Normalize uploads for WhatsApp profile / group pictures.
 * WA expects a compact JPEG; browser multipart often sends PNG/HEIC or multi-MB photos
 * that fail the set-picture IQ (surfaced as 502 WA_IQ_FAILED).
 */

import sharp from 'sharp'
import { badRequest } from '~/lib/errors'

/** Longest edge after resize (WhatsApp full profile pic is roughly this order). */
const MAX_EDGE_PX = 640
const JPEG_QUALITY = 85
/** Reject absurd inputs before sharp allocates huge buffers. */
const MAX_INPUT_BYTES = 25 * 1024 * 1024

/**
 * Decode any common image format and re-encode as JPEG suitable for setProfilePicture.
 *
 * @example
 *   const jpeg = await normalizeProfileJpeg(await readFile(upload.path))
 *   await client.profile.setProfilePicture(jpeg)
 */
export async function normalizeProfileJpeg(input: Buffer): Promise<Buffer> {
  if (!input || input.byteLength === 0) {
    throw badRequest('empty image payload')
  }
  if (input.byteLength > MAX_INPUT_BYTES) {
    throw badRequest(`image too large: ${input.byteLength} bytes (max ${MAX_INPUT_BYTES} before processing)`)
  }

  try {
    // failOn: 'none' tolerates slightly corrupt phone exports; rotate() applies EXIF orientation
    const pipeline = sharp(input, { failOn: 'none', unlimited: false }).rotate()
    const meta = await pipeline.metadata()
    if (!meta.format && !meta.width) {
      throw new Error('unrecognized image')
    }

    const jpeg = await pipeline
      .resize(MAX_EDGE_PX, MAX_EDGE_PX, { fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: JPEG_QUALITY, mozjpeg: true, chromaSubsampling: '4:2:0' })
      .toBuffer()

    if (jpeg.byteLength === 0) throw new Error('empty jpeg output')
    return jpeg
  } catch (err) {
    if (err && typeof err === 'object' && 'statusCode' in err) throw err
    const detail = err instanceof Error ? err.message : String(err)
    throw badRequest(
      `invalid image: could not decode as JPEG/PNG/WebP (or convert failed: ${detail}). ` +
        'Upload a photo or send mediaUrl to a JPEG.',
    )
  }
}
