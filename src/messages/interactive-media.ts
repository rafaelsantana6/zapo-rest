import { createReadStream } from 'node:fs'
import { finished } from 'node:stream/promises'
import { fileTypeFromFile } from 'file-type'
import type { Proto, WaClient } from 'zapo-js'
import type { Env } from '~/config/env'
import type { InteractiveMedia } from '~/http/interactive-schemas'
import { badRequest } from '~/lib/errors'
import { resolveMediaToFile } from '~/media/fetch'

/** Reuse bounded downloads and upstream media encryption; never synthesize upload descriptors. */
export async function uploadInteractiveMedia(
  client: WaClient,
  input: InteractiveMedia,
  type: 'image' | 'video',
  env: Env,
): Promise<Proto.Message.IImageMessage & Proto.Message.IVideoMessage> {
  const media = await resolveMediaToFile(
    { mediaUrl: input.url, mediaBase64: input.base64, mimetype: input.mimetype },
    env,
  )
  try {
    const detected = await fileTypeFromFile(media.path)
    const mimetype = detected?.mime ?? media.mimetype ?? (type === 'image' ? 'image/jpeg' : 'video/mp4')
    if (!mimetype.startsWith(`${type}/`)) throw badRequest(`mediaType ${type} requires ${type}/*, received ${mimetype}`)
    const stream = createReadStream(media.path)
    try {
      const uploaded = await client.message.upload(stream, { type, mimetype })
      return {
        url: uploaded.url,
        directPath: uploaded.directPath,
        mediaKey: uploaded.mediaKey,
        fileSha256: uploaded.fileSha256,
        fileEncSha256: uploaded.fileEncSha256,
        fileLength: uploaded.fileLength,
        mediaKeyTimestamp: uploaded.mediaKeyTimestamp,
        mimetype,
        ...(uploaded.streamingSidecar ? { streamingSidecar: uploaded.streamingSidecar } : {}),
      }
    } finally {
      stream.destroy()
      // A rejected upload may leave the lazy file open pending; close before unlink.
      await finished(stream, { cleanup: true }).catch(() => undefined)
    }
  } finally {
    await media.cleanup()
  }
}
