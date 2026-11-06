import type { FastifyRequest } from 'fastify'
import type { WaClient } from 'zapo-js'
import type { z } from 'zod'
import type { Env } from '~/config/env'
import type { NewsletterPublishSchema } from '~/http/newsletter-schemas'
import { requireMediaFromRequest } from '~/media/request-media'

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
      mimetype: media.mimetype ?? body.mimetype,
      caption: body.caption,
      fileName: body.fileName ?? media.fileName,
      ptt: body.ptt,
    })
  } finally {
    if (request.resolvedMedia === media) request.resolvedMedia = null
    await media.cleanup()
  }
}
