import sharp from 'sharp'
import { badRequest } from '~/lib/errors'

/** The upstream pack upload always labels the cover as a 252×252 JPEG. */
export async function createStickerPackCover(path: string): Promise<Uint8Array> {
  try {
    return await sharp(path, { unlimited: false })
      .rotate()
      .resize(252, 252, { fit: 'cover' })
      .flatten({ background: '#ffffff' })
      .jpeg({ quality: 85 })
      .toBuffer()
  } catch {
    throw badRequest('sticker pack cover/trayIcon must be a decodable image (JPEG, PNG or WebP)')
  }
}
