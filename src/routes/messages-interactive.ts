import { randomUUID } from 'node:crypto'
import type { FastifyPluginAsync } from 'fastify'
import type { Proto, WaClient } from 'zapo-js'
import { z } from 'zod'
import { resolveInstanceName, scopedInstancePaths } from '~/auth/plugin'
import type { Env } from '~/config/env'
import { decodeInteractive } from '~/events/decode-interactive'
import {
  ErrorBodySchema,
  SendMessageResponseSchema,
  SendButtonsBodySchema,
  SendInteractiveBodySchema,
  SendListBodySchema,
  SendCarouselBodySchema,
  SendNativeFormBodySchema,
  SendPixBodySchema,
  SendChargeBodySchema,
  SendProductBodySchema,
} from '~/http/openapi-schemas'
import type { InstanceManager } from '~/instances/manager'
import { badRequest, serviceUnavailable } from '~/lib/errors'
import { bareUserJid } from '~/lib/jid-canon'
import { resolveRecipientJid } from '~/lib/phone-resolve'
import { buildButtons } from '~/messages/interactive/buttons'
import { buildCarousel, type UploadedCardMedia } from '~/messages/interactive/carousel'
import { buildCharge } from '~/messages/interactive/charge'
import { buildInteractive } from '~/messages/interactive/interactive'
import { buildList } from '~/messages/interactive/list'
import { buildNativeForm } from '~/messages/interactive/native-form'
import { buildPix } from '~/messages/interactive/pix'
import { buildProduct } from '~/messages/interactive/product'
import { uploadInteractiveMedia } from '~/messages/interactive-media'
import type { CacheClient } from '~/redis/client'
import type { MessageStore } from '~/store/messages'

type InteractiveRoutesDeps = { manager: InstanceManager; env: Env; cache?: CacheClient; messages?: MessageStore }
type SendContext = { client: WaClient; jid: string; ownPhone?: string }
type BuiltMessage = { message: Proto.IMessage; flowToken?: string }

function ownPhone(client: WaClient): string | undefined {
  const jid = client.getCredentials()?.meJid
  if (!jid || !/^\d+(?::\d+)?@s\.whatsapp\.net$/.test(jid)) return undefined
  return bareUserJid(jid).split('@')[0]
}
function requireOwnPhone(context: SendContext): string {
  if (!context.ownPhone)
    throw serviceUnavailable(
      'Connected account phone number unavailable; cannot use LID for business owner or private reply',
    )
  return context.ownPhone
}

export const interactiveMessageRoutes: FastifyPluginAsync<InteractiveRoutesDeps> = async (app, deps) => {
  function register<S extends z.ZodType<{ to: string }>>(
    path: string,
    schema: S,
    build: (body: z.output<S>, context: SendContext) => BuiltMessage | Promise<BuiltMessage>,
    formResponse = false,
  ) {
    app.post<{ Body: z.output<S> }>(
      scopedInstancePaths(`/messages/${path}`),
      {
        schema: {
          tags: ['Messages'],
          summary: `Send ${path} message`,
          description:
            schema.description ?? 'Interactive/business message via raw proto; zapo-js owns delivery metadata.',
          security: [{ apiKey: [] }, { bearerAuth: [] }],
          body: schema,
          response: {
            200: formResponse ? SendMessageResponseSchema.extend({ flowToken: z.string() }) : SendMessageResponseSchema,
            400: ErrorBodySchema,
            503: ErrorBodySchema,
          },
        },
      },
      async (request) => {
        // Fastify cannot reduce its conditional Body type for a generic Zod schema.
        const body = request.body as z.output<S>
        const name = resolveInstanceName(request)
        const client = deps.manager.requireRegisteredClient(name)
        const jid = await resolveRecipientJid(deps.manager.tryGetClient(name), body.to, deps.cache)
        const built = await build(body, { client, jid, ownPhone: ownPhone(client) })
        const result = await client.message.send(jid, built.message)
        const decoded = decodeInteractive(built.message)
        await deps.messages?.upsert({
          instanceName: name,
          messageId: result.id,
          chatJid: jid,
          fromMe: true,
          timestampMs: Date.now(),
          type: decoded?.type ?? path,
          body: decoded?.body ?? null,
          caption: null,
          hasMedia: false,
          mediaMime: null,
          mediaFilename: null,
          ack: 1,
          source: 'live',
          raw: { ...result, message: built.message },
        })
        return { id: result.id, result, ...(built.flowToken !== undefined ? { flowToken: built.flowToken } : {}) }
      },
    )
  }
  register('buttons', SendButtonsBodySchema, (body, context) => {
    const isGroup = context.jid.endsWith('@g.us')
    if (isGroup && body.groupSafe) requireOwnPhone(context)
    return { message: buildButtons(body, { isGroup, ownPhone: context.ownPhone }) }
  })
  register('interactive', SendInteractiveBodySchema, (body, context) => {
    const isGroup = context.jid.endsWith('@g.us')
    if (
      body.buttons.some(
        (button) => button.type === 'catalog' || (button.type === 'quick_reply' && isGroup && body.groupSafe),
      )
    )
      requireOwnPhone(context)
    return { message: buildInteractive(body, { isGroup, ownPhone: context.ownPhone }) }
  })
  register('list', SendListBodySchema, (body) => ({ message: buildList(body) }))
  register('carousel', SendCarouselBodySchema, async (body, context) => {
    if (body.cards.some((card) => card.buttons.some((button) => button.type === 'catalog'))) requireOwnPhone(context)
    const media: UploadedCardMedia[] = []
    for (const card of body.cards) {
      const uploaded = await uploadInteractiveMedia(context.client, card.media, card.mediaType, deps.env)
      media.push(card.mediaType === 'video' ? { videoMessage: uploaded } : { imageMessage: uploaded })
    }
    return { message: buildCarousel(body, media, { ownPhone: context.ownPhone }) }
  })
  register(
    'native-form',
    SendNativeFormBodySchema,
    (body, context) => {
      if (!/@(?:s\.whatsapp\.net|lid)$/.test(context.jid))
        throw badRequest('native-form requires a 1:1 recipient; groups and broadcasts are unsupported')
      const flowToken = body.flowToken ?? randomUUID()
      return { message: buildNativeForm(body, flowToken), flowToken }
    },
    true,
  )
  register('pix', SendPixBodySchema, (body) => ({ message: buildPix(body, body.reference ?? `PIX-${randomUUID()}`) }))
  register('charge', SendChargeBodySchema, (body) => ({ message: buildCharge(body) }))
  register('product', SendProductBodySchema, async (body, context) => {
    const owner = body.businessOwnerJid
      ? bareUserJid(body.businessOwnerJid)
      : `${requireOwnPhone(context)}@s.whatsapp.net`
    const image = body.productImage
      ? await uploadInteractiveMedia(context.client, body.productImage, 'image', deps.env)
      : undefined
    return { message: buildProduct(body, owner, image) }
  })
}
