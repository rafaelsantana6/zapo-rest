import { createReadStream } from 'node:fs'
import { finished } from 'node:stream/promises'
import { stat } from 'node:fs/promises'
import { fileTypeFromFile } from 'file-type'
import type { Proto, WaClient } from 'zapo-js'
import type { Env } from '~/config/env'
import type { InteractiveMedia } from '~/http/interactive-schemas'
import { badRequest } from '~/lib/errors'
import { resolveMediaToFile } from '~/media/fetch'
import { parseInlineBase64 } from '~/media/inline-base64'

/** Reuse bounded downloads and upstream media encryption; never synthesize upload descriptors. */
export async function uploadInteractiveMedia(
  client: WaClient,
  input: InteractiveMedia,
  type: 'image' | 'video',
  env: Env,
): Promise<Proto.Message.IImageMessage & Proto.Message.IVideoMessage> {
  const inline = input.base64 === undefined ? undefined : parseInlineBase64(input.base64)
  if (inline === null) throw badRequest('Expected nonempty valid base64 or a base64 data URI')
  const declaredMimetype = input.mimetype ?? inline?.mimetype
  const media = await resolveMediaToFile(
    { mediaUrl: input.url, mediaBase64: inline?.base64, mimetype: declaredMimetype },
    env,
  )
  try {
    if ((await stat(media.path)).size === 0) throw badRequest('Media content must not be empty')
    const detected = await fileTypeFromFile(media.path)
    const mimetype = detected?.mime ?? declaredMimetype
    if (!mimetype) throw badRequest(`Cannot identify media content; provide an explicit ${type} mimetype`)
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
