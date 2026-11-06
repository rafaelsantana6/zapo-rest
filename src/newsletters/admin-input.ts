import sharp from 'sharp'
import type { WaClient } from 'zapo-js'
import { AppError, badRequest } from '~/lib/errors'
import { resolveRecipientJid } from '~/lib/phone-resolve'
import type { CacheClient } from '~/redis/client'

export const MAX_NEWSLETTER_PICTURE_BYTES = 256 * 1024
const MAX_PICTURE_PIXELS = 16_777_216

/** Validate inline JPEG bytes before the channel admin API sends them to WhatsApp. */
export async function decodeNewsletterPicture(picture: string | null | undefined): Promise<Buffer | null | undefined> {
  if (typeof picture !== 'string') return picture
  const bytes = Buffer.from(picture, 'base64')
  if (bytes.length > MAX_NEWSLETTER_PICTURE_BYTES) {
    throw badRequest(`picture has ${bytes.length} bytes; expected at most ${MAX_NEWSLETTER_PICTURE_BYTES}`)
  }
  try {
    const image = sharp(bytes, { failOn: 'error', limitInputPixels: MAX_PICTURE_PIXELS })
    const metadata = await image.metadata()
    if (metadata.format !== 'jpeg') throw badRequest(`picture format "${metadata.format ?? 'unknown'}"; expected JPEG`)
    await image.stats()
    return bytes
  } catch (err) {
    if (err instanceof AppError) throw err
    throw badRequest('picture must be a decodable JPEG with at most 16 megapixels')
  }
}

/** Admin targets are account identities, never a channel, group or broadcast list. */
export async function resolveNewsletterAdminUser(
  client: WaClient,
  input: string,
  cache?: CacheClient,
): Promise<string> {
  const jid = await resolveRecipientJid(client, input, cache)
  if (!/^\d+(?::\d+)?@(s\.whatsapp\.net|lid)$/.test(jid)) {
    throw badRequest(`resolved admin recipient "${jid}"; expected a PN or LID user JID`)
  }
  return jid
}
