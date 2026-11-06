import type { FastifyPluginAsync } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import {
  ErrorBodySchema,
  MEDIA_INPUT_HELP,
  SendEventBodySchema,
  SendEventResponseBodySchema,
  SendKeepBodySchema,
  SendMessageResponseSchema,
  SendPinBodySchema,
  SendPollVoteBodySchema,
  SendPtvBodySchema,
  SendStickerPackBodySchema,
} from '~/http/openapi-schemas'
import { resolveInstanceName, scopedInstancePaths } from '~/auth/plugin'
import { encryptedMessageParent, loadMessageTarget } from '~/lib/message-target'
import { resolveRecipientJid } from '~/lib/phone-resolve'
import { resolveMediaToFile, type ResolvedMedia } from '~/media/fetch'
import { mediaPreValidation, requireMediaFromRequest } from '~/media/request-media'
import type { MessageRoutesDeps } from './messages'
import type { UpsertMessageInput } from '~/store/messages'

const RESPONSE = {
  200: SendMessageResponseSchema,
  400: ErrorBodySchema,
  404: ErrorBodySchema,
  409: ErrorBodySchema,
  503: ErrorBodySchema,
}
const SECURITY: Record<string, string[]>[] = [{ apiKey: [] }, { bearerAuth: [] }]
const PIN_DURATION_SECONDS = { '24h': 86400, '7d': 604800, '30d': 2592000 } as const

export const messageExtraRoutes: FastifyPluginAsync<MessageRoutesDeps> = async (fastify, deps) => {
  const app = fastify.withTypeProvider<ZodTypeProvider>()
  const { manager, env, messages, cache } = deps
  async function recipient(name: string, to: string) {
    return resolveRecipientJid(manager.tryGetClient(name), to, cache)
  }
  async function project(input: UpsertMessageInput) {
    await messages?.upsert({ ...input, fromMe: true, timestampMs: Date.now(), ack: 1, source: 'live' })
  }

  app.post(
    scopedInstancePaths('/messages/event'),
    {
      schema: {
        tags: ['Messages'],
        summary: 'Create a calendar event',
        security: SECURITY,
        body: SendEventBodySchema,
        response: RESPONSE,
      },
    },
    async (request) => {
      const name = resolveInstanceName(request)
      const client = manager.requireRegisteredClient(name)
      const { to, startTime, endTime, ...fields } = request.body
      const jid = await recipient(name, to)
      const result = await client.message.send(jid, {
        type: 'event',
        ...fields,
        startTime: Math.floor(Date.parse(startTime) / 1000),
        endTime: endTime ? Math.floor(Date.parse(endTime) / 1000) : undefined,
      })
      await project({
        instanceName: name,
        chatJid: jid,
        messageId: result.id,
        type: 'event',
        body: fields.name,
        raw: result,
      })
      return { id: result.id, result }
    },
  )

  app.post(
    scopedInstancePaths('/messages/event/respond'),
    {
      schema: {
        tags: ['Messages'],
        summary: 'Respond to a stored calendar event',
        security: SECURITY,
        description:
          'Requires the original event and its 32-byte secret in this session. 404: original absent; 409: secret/author unavailable.',
        body: SendEventResponseBodySchema,
        response: RESPONSE,
      },
    },
    async (request) => {
      const name = resolveInstanceName(request)
      const client = manager.requireRegisteredClient(name)
      const body = request.body
      const jid = await recipient(name, body.to)
      const original = await loadMessageTarget(deps, { instanceName: name, messageId: body.eventMessageId, jid })
      const result = await client.message.send(jid, {
        type: 'event-response',
        event: encryptedMessageParent(original, 'event'),
        response: body.response,
        extraGuestCount: body.extraGuestCount,
      })
      return { id: result.id, result }
    },
  )

  app.post(
    scopedInstancePaths('/messages/pin'),
    {
      schema: {
        tags: ['Messages'],
        summary: 'Pin or unpin a stored message',
        security: SECURITY,
        description:
          '24h (default), 7d or 30d. A pin always includes durationSecs: receiving clients drop pins without a duration. Unpin omits durationSecs.',
        body: SendPinBodySchema,
        response: RESPONSE,
      },
    },
    async (request) => {
      const name = resolveInstanceName(request)
      const client = manager.requireRegisteredClient(name)
      const body = request.body
      const jid = await recipient(name, body.to)
      const { target } = await loadMessageTarget(deps, { instanceName: name, messageId: body.messageId, jid })
      const result = await client.message.send(
        jid,
        body.pinned
          ? { type: 'pin', target, durationSecs: PIN_DURATION_SECONDS[body.duration] }
          : { type: 'unpin', target },
      )
      return { id: result.id, result }
    },
  )

  app.post(
    scopedInstancePaths('/messages/keep'),
    {
      schema: {
        tags: ['Messages'],
        summary: 'Keep or unkeep a stored disappearing message',
        security: SECURITY,
        body: SendKeepBodySchema,
        response: RESPONSE,
      },
    },
    async (request) => {
      const name = resolveInstanceName(request)
      const client = manager.requireRegisteredClient(name)
      const body = request.body
      const jid = await recipient(name, body.to)
      const { target } = await loadMessageTarget(deps, { instanceName: name, messageId: body.messageId, jid })
      const result = await client.message.send(jid, { type: body.kept ? 'keep' : 'unkeep', target })
      return { id: result.id, result }
    },
  )

  app.post(
    scopedInstancePaths('/messages/poll/vote'),
    {
      schema: {
        tags: ['Messages'],
        summary: 'Vote on a stored poll',
        security: SECURITY,
        description:
          'Requires the original poll and its 32-byte secret in this session. Exact option names, at least one. 404: original absent; 409: secret/author unavailable.',
        body: SendPollVoteBodySchema,
        response: RESPONSE,
      },
    },
    async (request) => {
      const name = resolveInstanceName(request)
      const client = manager.requireRegisteredClient(name)
      const body = request.body
      const jid = await recipient(name, body.to)
      const original = await loadMessageTarget(deps, { instanceName: name, messageId: body.pollMessageId, jid })
      const result = await client.message.send(jid, {
        type: 'poll-vote',
        poll: encryptedMessageParent(original, 'poll'),
        selectedOptionNames: body.options,
      })
      return { id: result.id, result }
    },
  )

  app.post(
    scopedInstancePaths('/messages/ptv'),
    {
      preValidation: mediaPreValidation(env),
      // Validation can fail after multipart has already created a temporary file.
      onResponse: async (request) => {
        await request.resolvedMedia?.cleanup()
      },
      schema: {
        tags: ['Messages'],
        summary: 'Send a round video note (PTV)',
        security: SECURITY,
        description: `${MEDIA_INPUT_HELP}No caption.`,
        body: SendPtvBodySchema,
        response: RESPONSE,
      },
    },
    async (request) => {
      const name = resolveInstanceName(request)
      const client = manager.requireRegisteredClient(name)
      const body = request.body
      const jid = await recipient(name, body.to)
      const { media } = await requireMediaFromRequest(request, env)
      try {
        const result = await client.message.send(jid, {
          type: 'ptv',
          media: media.path,
          mimetype: media.mimetype ?? body.mimetype ?? 'video/mp4',
          contextInfo: body.contextInfo,
        })
        await project({
          instanceName: name,
          chatJid: jid,
          messageId: result.id,
          type: 'ptv',
          hasMedia: true,
          mediaMime: media.mimetype ?? body.mimetype ?? 'video/mp4',
          raw: result,
        })
        return { id: result.id, result }
      } finally {
        await media.cleanup()
        request.resolvedMedia = null
      }
    },
  )

  app.post(
    scopedInstancePaths('/messages/sticker-pack'),
    {
      schema: {
        tags: ['Messages'],
        summary: 'Send a sticker pack',
        security: SECURITY,
        body: SendStickerPackBodySchema,
        response: RESPONSE,
      },
    },
    async (request) => {
      const name = resolveInstanceName(request)
      const client = manager.requireRegisteredClient(name)
      const body = request.body
      const jid = await recipient(name, body.to)
      const files: ResolvedMedia[] = []
      async function mediaPath(source: { url?: string; base64?: string }) {
        const file = await resolveMediaToFile({ mediaUrl: source.url, mediaBase64: source.base64 }, env)
        files.push(file)
        return file.path
      }
      try {
        const stickers = []
        for (const sticker of body.stickers) {
          stickers.push({ fileName: sticker.fileName, emojis: sticker.emojis, media: await mediaPath(sticker.media) })
        }
        const trayIcon = { fileName: body.trayIcon.fileName, media: await mediaPath(body.trayIcon.media) }
        const coverThumbnail = body.coverThumbnail ? await mediaPath(body.coverThumbnail) : undefined
        const result = await client.message.send(jid, {
          type: 'sticker-pack',
          stickerPackId: body.id,
          name: body.name,
          publisher: body.publisher,
          stickers,
          trayIcon,
          coverThumbnail,
          contextInfo: body.contextInfo,
        })
        await project({
          instanceName: name,
          chatJid: jid,
          messageId: result.id,
          type: 'sticker-pack',
          body: body.name,
          raw: result,
        })
        return { id: result.id, result }
      } finally {
        await Promise.all(files.map((file) => file.cleanup()))
      }
    },
  )
}
