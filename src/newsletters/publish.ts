import type { FastifyRequest } from 'fastify'
import { fileTypeFromFile } from 'file-type'
import type { WaClient } from 'zapo-js'
import type { z } from 'zod'
import type { Env } from '~/config/env'
import type { NewsletterPublishSchema } from '~/http/newsletter-schemas'
import { badRequest } from '~/lib/errors'
import type { ResolvedMedia } from '~/media/fetch'
import { requireMediaFromRequest } from '~/media/request-media'

async function newsletterMimetype(media: ResolvedMedia, explicit?: string): Promise<string> {
  if (explicit?.trim()) return explicit.trim()
  if (media.mimetype?.trim() && media.mimetype !== 'application/octet-stream') return media.mimetype.trim()
  try {
    const detected = await fileTypeFromFile(media.path)
    if (detected) return detected.mime
  } catch (err) {
    if (err && typeof err === 'object' && 'code' in err) throw err
  }
  throw badRequest('Cannot determine media format; provide mimetype (for example image/png or application/pdf)')
}

export async function publishNewsletter(
  newsletter: WaClient['newsletter'],
  request: FastifyRequest,
  options: { env: Env; jid: string; messageId?: string; body: z.infer<typeof NewsletterPublishSchema> },
) {
  const { body, jid, messageId } = options
  const send =
    messageId === undefined
      ? (content: Parameters<typeof newsletter.send>[1]) => newsletter.send(jid, content)
      : (content: Parameters<typeof newsletter.send>[1]) => newsletter.editMessage(jid, messageId, content)
  if (body.type === 'text') return send({ type: 'text', text: body.text })
  const { media } = await requireMediaFromRequest(request, options.env)
  try {
    return await send({
      type: body.type,
      media: media.path,
      mimetype: await newsletterMimetype(media, body.mimetype),
      caption: body.caption,
      fileName: body.fileName ?? media.fileName,
      ptt: body.ptt,
    })
  } finally {
    if (request.resolvedMedia === media) request.resolvedMedia = null
    await media.cleanup()
  }
}
