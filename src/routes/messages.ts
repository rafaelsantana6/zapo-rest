import type { FastifyPluginAsync } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import { z } from 'zod'
import { resolveInstanceName, scopedInstancePaths } from '~/auth/plugin'
import type { Env } from '~/config/env'
import {
  ErrorBodySchema,
  EXAMPLES,
  InstanceNameParams,
  SendMediaBodySchema,
  SendMessageResponseSchema,
  SendTextBodySchema,
} from '~/http/openapi-schemas'
import type { InstanceManager } from '~/instances/manager'
import { badRequest, notFound } from '~/lib/errors'
import { resolveRecipientJid } from '~/lib/phone-resolve'
import { buildVCard, type VCardContact } from '~/lib/vcard'
import { resolveMediaToFile } from '~/media/fetch'
import type { CacheClient } from '~/redis/client'
import type { MessageStore } from '~/store/messages'
import { toPublicMessage } from '~/store/messages'

export type MessageRoutesDeps = {
  manager: InstanceManager
  env: Env
  messages?: MessageStore
  cache?: CacheClient
}

const ReactBody = z.object({
  to: z.string().min(1),
  messageId: z.string().min(1),
  emoji: z.string().describe('Emoji reaction; empty string removes reaction'),
  fromMe: z.boolean().optional(),
  participant: z.string().optional(),
})

const EditBody = z.object({
  to: z.string().min(1),
  messageId: z.string().min(1),
  text: z.string().min(1),
})

const RevokeBody = z.object({
  to: z.string().min(1),
  messageId: z.string().min(1),
})

const PollBody = z.object({
  to: z.string().min(1),
  name: z.string().min(1),
  options: z.array(z.string().min(1)).min(2).max(12),
  selectableCount: z.number().int().positive().optional(),
})

const LocationBody = z.object({
  to: z.string().min(1),
  latitude: z.number(),
  longitude: z.number(),
  name: z.string().optional(),
  address: z.string().optional(),
})

const ReplyBody = SendTextBodySchema.extend({
  quotedMessageId: z.string().min(1),
  quotedFromMe: z.boolean().optional(),
  quotedParticipant: z.string().optional(),
})

export const messageRoutes: FastifyPluginAsync<MessageRoutesDeps> = async (fastify, deps) => {
  const app = fastify.withTypeProvider<ZodTypeProvider>()
  const { manager, env, messages, cache } = deps

  /** Transparent BR/MX/AR JID resolve (9th digit) when instance is registered. */
  async function recipientJid(name: string, to: string): Promise<string> {
    const client = manager.tryGetClient(name)
    return resolveRecipientJid(client, to, cache)
  }

  /** Upsert outbound send into app_messages (upsert-projections non-negotiable). */
  async function projectOutbound(opts: {
    instanceName: string
    messageId: string
    chatJid: string
    type: string
    body?: string | null
    caption?: string | null
    hasMedia?: boolean
    mediaMime?: string | null
    mediaFilename?: string | null
    raw?: unknown
  }): Promise<void> {
    if (!messages) return
    await messages.upsert({
      instanceName: opts.instanceName,
      messageId: opts.messageId,
      chatJid: opts.chatJid,
      fromMe: true,
      timestampMs: Date.now(),
      type: opts.type,
      body: opts.body ?? null,
      caption: opts.caption ?? null,
      hasMedia: opts.hasMedia ?? false,
      mediaMime: opts.mediaMime ?? null,
      mediaFilename: opts.mediaFilename ?? null,
      ack: 1,
      source: 'live',
      raw: opts.raw ?? {},
    })
  }

  app.post(
    scopedInstancePaths('/messages/text'),
    {
      schema: {
        tags: ['Messages'],
        summary: 'Send text message',
        description:
          'Sends a plain-text WhatsApp message via `client.message.send`.\n\n' +
          '**Requirements:** instance connected (`status: open`).\n\n' +
          '**Example body**\n' +
          '```json\n' +
          `${JSON.stringify(EXAMPLES.textMessage, null, 2)}\n` +
          '```',
        security: [{ apiKey: [] }, { bearerAuth: [] }],
        params: InstanceNameParams,
        body: SendTextBodySchema,
        response: {
          200: SendMessageResponseSchema,
          400: ErrorBodySchema,
          503: ErrorBodySchema,
        },
      },
    },
    async (request) => {
      const name = resolveInstanceName(request, request.params.name)
      const body = request.body
      const client = manager.requireRegisteredClient(name)
      const jid = await recipientJid(name, body.to)
      const content =
        body.linkPreview !== undefined
          ? { type: 'text' as const, text: body.text, linkPreview: body.linkPreview }
          : body.text
      const result = await client.message.send(jid, content, {
        mentions: body.mentions,
      })
      await projectOutbound({
        instanceName: name,
        messageId: result.id,
        chatJid: jid,
        type: 'text',
        body: body.text,
        raw: result,
      })
      return { id: result.id, result }
    },
  )

  app.post(
    scopedInstancePaths('/messages/reply'),
    {
      schema: {
        tags: ['Messages'],
        summary: 'Reply to a message',
        security: [{ apiKey: [] }, { bearerAuth: [] }],
        params: InstanceNameParams,
        body: ReplyBody,
      },
    },
    async (request) => {
      const name = resolveInstanceName(request, request.params.name)
      const body = request.body
      const client = manager.requireRegisteredClient(name)
      const jid = await recipientJid(name, body.to)
      const result = await client.message.send(
        jid,
        {
          type: 'text',
          text: body.text,
        },
        {
          mentions: body.mentions,
          quote: {
            remoteJid: jid,
            fromMe: body.quotedFromMe ?? false,
            id: body.quotedMessageId,
            participant: body.quotedParticipant,
          },
        },
      )
      await projectOutbound({
        instanceName: name,
        messageId: result.id,
        chatJid: jid,
        type: 'text',
        body: body.text,
        raw: result,
      })
      return { id: result.id, result }
    },
  )

  app.post(
    scopedInstancePaths('/messages/image'),
    {
      schema: {
        tags: ['Messages'],
        summary: 'Send image',
        security: [{ apiKey: [] }, { bearerAuth: [] }],
        params: InstanceNameParams,
        body: SendMediaBodySchema,
        response: { 200: SendMessageResponseSchema, 400: ErrorBodySchema, 503: ErrorBodySchema },
      },
    },
    async (request) => {
      const name = resolveInstanceName(request, request.params.name)
      const body = request.body
      const client = manager.requireRegisteredClient(name)
      const jid = await recipientJid(name, body.to)
      const media = await resolveMediaToFile(body, env)
      try {
        const result = await client.message.send(
          jid,
          {
            type: 'image',
            media: media.path,
            mimetype: media.mimetype ?? body.mimetype,
            caption: body.caption,
          },
          { viewOnce: body.viewOnce },
        )
        await projectOutbound({
          instanceName: name,
          messageId: result.id,
          chatJid: jid,
          type: 'image',
          caption: body.caption ?? null,
          hasMedia: true,
          mediaMime: media.mimetype ?? body.mimetype ?? null,
          raw: result,
        })
        return { id: result.id, result }
      } finally {
        await media.cleanup()
      }
    },
  )

  app.post(
    scopedInstancePaths('/messages/video'),
    {
      schema: {
        tags: ['Messages'],
        summary: 'Send video',
        security: [{ apiKey: [] }, { bearerAuth: [] }],
        params: InstanceNameParams,
        body: SendMediaBodySchema,
      },
    },
    async (request) => {
      const name = resolveInstanceName(request, request.params.name)
      const body = request.body
      const client = manager.requireRegisteredClient(name)
      const jid = await recipientJid(name, body.to)
      const media = await resolveMediaToFile(body, env)
      try {
        const result = await client.message.send(jid, {
          type: 'video',
          media: media.path,
          mimetype: media.mimetype ?? body.mimetype ?? 'video/mp4',
          caption: body.caption,
        })
        await projectOutbound({
          instanceName: name,
          messageId: result.id,
          chatJid: jid,
          type: 'video',
          caption: body.caption ?? null,
          hasMedia: true,
          mediaMime: media.mimetype ?? body.mimetype ?? 'video/mp4',
          raw: result,
        })
        return { id: result.id, result }
      } finally {
        await media.cleanup()
      }
    },
  )

  app.post(
    scopedInstancePaths('/messages/audio'),
    {
      schema: {
        tags: ['Messages'],
        summary: 'Send audio / voice note',
        security: [{ apiKey: [] }, { bearerAuth: [] }],
        params: InstanceNameParams,
        body: SendMediaBodySchema,
        response: { 200: SendMessageResponseSchema, 400: ErrorBodySchema, 503: ErrorBodySchema },
      },
    },
    async (request) => {
      const name = resolveInstanceName(request, request.params.name)
      const body = request.body
      const client = manager.requireRegisteredClient(name)
      const jid = await recipientJid(name, body.to)
      const media = await resolveMediaToFile(body, env)
      try {
        const result = await client.message.send(jid, {
          type: 'audio',
          media: media.path,
          mimetype: media.mimetype ?? body.mimetype,
          ptt: body.ptt,
        })
        await projectOutbound({
          instanceName: name,
          messageId: result.id,
          chatJid: jid,
          type: 'audio',
          hasMedia: true,
          mediaMime: media.mimetype ?? body.mimetype ?? null,
          raw: result,
        })
        return { id: result.id, result }
      } finally {
        await media.cleanup()
      }
    },
  )

  app.post(
    scopedInstancePaths('/messages/document'),
    {
      schema: {
        tags: ['Messages'],
        summary: 'Send document',
        security: [{ apiKey: [] }, { bearerAuth: [] }],
        params: InstanceNameParams,
        body: SendMediaBodySchema,
        response: { 200: SendMessageResponseSchema, 400: ErrorBodySchema, 503: ErrorBodySchema },
      },
    },
    async (request) => {
      const name = resolveInstanceName(request, request.params.name)
      const body = request.body
      const client = manager.requireRegisteredClient(name)
      const jid = await recipientJid(name, body.to)
      const media = await resolveMediaToFile(body, env)
      try {
        const result = await client.message.send(jid, {
          type: 'document',
          media: media.path,
          mimetype: media.mimetype ?? body.mimetype,
          fileName: body.fileName,
          caption: body.caption,
        })
        await projectOutbound({
          instanceName: name,
          messageId: result.id,
          chatJid: jid,
          type: 'document',
          caption: body.caption ?? null,
          hasMedia: true,
          mediaMime: media.mimetype ?? body.mimetype ?? null,
          mediaFilename: body.fileName ?? null,
          raw: result,
        })
        return { id: result.id, result }
      } finally {
        await media.cleanup()
      }
    },
  )

  app.post(
    scopedInstancePaths('/messages/sticker'),
    {
      schema: {
        tags: ['Messages'],
        summary: 'Send sticker',
        security: [{ apiKey: [] }, { bearerAuth: [] }],
        params: InstanceNameParams,
        body: SendMediaBodySchema,
      },
    },
    async (request) => {
      const name = resolveInstanceName(request, request.params.name)
      const body = request.body
      const client = manager.requireRegisteredClient(name)
      const jid = await recipientJid(name, body.to)
      const media = await resolveMediaToFile(body, env)
      try {
        const result = await client.message.send(jid, {
          type: 'sticker',
          media: media.path,
          mimetype: media.mimetype ?? body.mimetype ?? 'image/webp',
        })
        await projectOutbound({
          instanceName: name,
          messageId: result.id,
          chatJid: jid,
          type: 'sticker',
          hasMedia: true,
          mediaMime: media.mimetype ?? body.mimetype ?? 'image/webp',
          raw: result,
        })
        return { id: result.id, result }
      } finally {
        await media.cleanup()
      }
    },
  )

  app.post(
    scopedInstancePaths('/messages/location'),
    {
      schema: {
        tags: ['Messages'],
        summary: 'Send location',
        security: [{ apiKey: [] }, { bearerAuth: [] }],
        params: InstanceNameParams,
        body: LocationBody,
      },
    },
    async (request) => {
      const name = resolveInstanceName(request, request.params.name)
      const body = request.body
      const client = manager.requireRegisteredClient(name)
      const jid = await recipientJid(name, body.to)
      const result = await client.message.send(jid, {
        locationMessage: {
          degreesLatitude: body.latitude,
          degreesLongitude: body.longitude,
          name: body.name,
          address: body.address,
        },
      })
      await projectOutbound({
        instanceName: name,
        messageId: result.id,
        chatJid: jid,
        type: 'location',
        body: body.name ?? body.address ?? `${body.latitude},${body.longitude}`,
        raw: result,
      })
      return { id: result.id, result }
    },
  )

  app.post(
    scopedInstancePaths('/messages/poll'),
    {
      schema: {
        tags: ['Messages'],
        summary: 'Send poll',
        security: [{ apiKey: [] }, { bearerAuth: [] }],
        params: InstanceNameParams,
        body: PollBody,
      },
    },
    async (request) => {
      const name = resolveInstanceName(request, request.params.name)
      const body = request.body
      const client = manager.requireRegisteredClient(name)
      const jid = await recipientJid(name, body.to)
      const result = await client.message.send(jid, {
        type: 'poll',
        name: body.name,
        options: body.options,
        selectableCount: body.selectableCount ?? 1,
      })
      await projectOutbound({
        instanceName: name,
        messageId: result.id,
        chatJid: jid,
        type: 'poll',
        body: body.name,
        raw: result,
      })
      return { id: result.id, result }
    },
  )

  app.post(
    scopedInstancePaths('/messages/react'),
    {
      schema: {
        tags: ['Messages'],
        summary: 'React to a message',
        security: [{ apiKey: [] }, { bearerAuth: [] }],
        params: InstanceNameParams,
        body: ReactBody,
      },
    },
    async (request) => {
      const name = resolveInstanceName(request, request.params.name)
      const body = request.body
      const client = manager.requireRegisteredClient(name)
      const jid = await recipientJid(name, body.to)
      const result = await client.message.send(jid, {
        type: 'reaction',
        emoji: body.emoji,
        target: {
          remoteJid: jid,
          fromMe: body.fromMe ?? false,
          id: body.messageId,
          participant: body.participant,
        },
      })
      return { id: result.id, result }
    },
  )

  app.post(
    scopedInstancePaths('/messages/edit'),
    {
      schema: {
        tags: ['Messages'],
        summary: 'Edit a sent text message',
        security: [{ apiKey: [] }, { bearerAuth: [] }],
        params: InstanceNameParams,
        body: EditBody,
      },
    },
    async (request) => {
      const name = resolveInstanceName(request, request.params.name)
      const body = request.body
      const client = manager.requireRegisteredClient(name)
      const jid = await recipientJid(name, body.to)
      const result = await client.message.send(
        jid,
        { type: 'text', text: body.text },
        { editKey: { id: body.messageId } },
      )
      if (messages) {
        await messages.markEdited(name, body.messageId, body.text)
      }
      return { id: result.id, result }
    },
  )

  app.post(
    scopedInstancePaths('/messages/revoke'),
    {
      schema: {
        tags: ['Messages'],
        summary: 'Revoke / delete for everyone',
        security: [{ apiKey: [] }, { bearerAuth: [] }],
        params: InstanceNameParams,
        body: RevokeBody,
      },
    },
    async (request) => {
      const name = resolveInstanceName(request, request.params.name)
      const body = request.body
      const client = manager.requireRegisteredClient(name)
      const jid = await recipientJid(name, body.to)
      const result = await client.message.send(jid, {
        type: 'revoke',
        target: { remoteJid: jid, fromMe: true, id: body.messageId },
      })
      if (messages) {
        await messages.markDeleted(name, body.messageId)
      }
      return { id: result.id, result }
    },
  )

  app.post(
    scopedInstancePaths('/messages/contact'),
    {
      schema: {
        tags: ['Messages'],
        summary: 'Send contact vCard(s)',
        description: 'Sends one or more contacts as WhatsApp contactMessage / contactsArrayMessage (vCard 3.0).',
        security: [{ apiKey: [] }, { bearerAuth: [] }],
        params: InstanceNameParams,
        body: z.object({
          to: z.string().min(1),
          contacts: z
            .array(
              z.object({
                fullName: z.string().min(1),
                phoneNumber: z.string().min(1),
                wuid: z.string().optional(),
                organization: z.string().optional(),
                email: z.string().optional(),
                url: z.string().optional(),
              }),
            )
            .min(1)
            .max(20),
        }),
      },
    },
    async (request) => {
      const name = resolveInstanceName(request, request.params.name)
      const body = request.body
      const client = manager.requireRegisteredClient(name)
      const jid = await recipientJid(name, body.to)
      const contacts = body.contacts as VCardContact[]

      let content: Record<string, unknown>
      const first = contacts[0]
      if (contacts.length === 1 && first) {
        content = {
          contactMessage: {
            displayName: first.fullName,
            vcard: buildVCard(first),
          },
        }
      } else {
        content = {
          contactsArrayMessage: {
            displayName: `${contacts.length} contacts`,
            contacts: contacts.map((c) => ({
              displayName: c.fullName,
              vcard: buildVCard(c),
            })),
          },
        }
      }

      const result = await client.message.send(jid, content as never)
      await projectOutbound({
        instanceName: name,
        messageId: result.id,
        chatJid: jid,
        type: 'contact',
        body: contacts.map((c) => c.fullName).join(', '),
        raw: result,
      })
      return { id: result.id, result }
    },
  )

  app.post(
    scopedInstancePaths('/messages/forward'),
    {
      schema: {
        tags: ['Messages'],
        summary: 'Forward a stored message',
        description:
          'Forwards a message from the local store to another chat (`forward: true`). ' +
          'Text is re-sent from `body`; other types use the raw proto payload when available.',
        security: [{ apiKey: [] }, { bearerAuth: [] }],
        params: InstanceNameParams,
        body: z.object({
          to: z.string().min(1),
          messageId: z.string().min(1),
          /** Optional score to propagate "frequently forwarded" badge */
          score: z.number().int().positive().optional(),
        }),
      },
    },
    async (request) => {
      const name = resolveInstanceName(request, request.params.name)
      const body = request.body
      if (!messages) throw badRequest('message store not available')

      const stored = await messages.get(name, body.messageId)
      if (!stored) throw notFound(`message ${body.messageId} not found in store`)
      if (stored.isDeleted) throw badRequest('cannot forward a deleted message')

      const client = manager.requireRegisteredClient(name)
      const jid = await recipientJid(name, body.to)
      const forwardOpt = body.score != null ? { score: body.score } : true

      const content = reconstructForwardContent(stored)
      const result = await client.message.send(jid, content as never, { forward: forwardOpt })

      await projectOutbound({
        instanceName: name,
        messageId: result.id,
        chatJid: jid,
        type: stored.type,
        body: stored.body,
        caption: stored.caption,
        hasMedia: stored.hasMedia,
        raw: { forwardedFrom: body.messageId, result },
      })
      return { id: result.id, result, forwardedFrom: body.messageId }
    },
  )

  app.post(
    scopedInstancePaths('/messages/star'),
    {
      schema: {
        tags: ['Messages'],
        summary: 'Star / unstar a message (app-state)',
        security: [{ apiKey: [] }, { bearerAuth: [] }],
        params: InstanceNameParams,
        body: z.object({
          chatId: z.string().min(1),
          messageId: z.string().min(1),
          fromMe: z.boolean().default(true),
          starred: z.boolean(),
          participant: z.string().optional(),
        }),
      },
    },
    async (request) => {
      const name = resolveInstanceName(request, request.params.name)
      const body = request.body
      const client = manager.requireRegisteredClient(name)
      const chatJid = await recipientJid(name, body.chatId)
      await client.chat.setMessageStar(
        {
          chatJid,
          id: body.messageId,
          fromMe: body.fromMe,
          participantJid: body.participant,
        },
        body.starred,
      )
      return { ok: true as const, messageId: body.messageId, starred: body.starred }
    },
  )

  app.get(
    scopedInstancePaths('/messages/:messageId'),
    {
      schema: {
        tags: ['Messages'],
        summary: 'Get stored message by id',
        security: [{ apiKey: [] }, { bearerAuth: [] }],
        params: InstanceNameParams.extend({ messageId: z.string() }),
      },
    },
    async (request) => {
      const params = request.params
      const name = resolveInstanceName(request, params.name)
      if (!messages) return { message: null }
      const msg = await messages.get(name, params.messageId)
      return { message: msg ? toPublicMessage(msg, { instanceName: name }) : null }
    },
  )
}

/** Rebuild send content for forward from app_messages projection. */
function reconstructForwardContent(stored: {
  type: string
  body: string | null
  caption: string | null
  raw: unknown
}): unknown {
  // Prefer original proto message bag when present
  // biome-ignore lint/suspicious/noExplicitAny: stored raw shape varies
  const raw = stored.raw as any
  const protoMsg = raw?.message ?? raw?.result?.message ?? null
  if (protoMsg && typeof protoMsg === 'object' && !Array.isArray(protoMsg)) {
    // If it looks like a WA message proto (has known keys), send as IMessage
    const keys = Object.keys(protoMsg)
    if (keys.some((k) => k.endsWith('Message') || k === 'conversation')) {
      return protoMsg
    }
  }

  if (stored.type === 'text' || stored.body) {
    return { type: 'text' as const, text: stored.body ?? stored.caption ?? '' }
  }
  if (stored.caption) {
    return { type: 'text' as const, text: stored.caption }
  }
  throw badRequest(`cannot forward message type "${stored.type}" without stored proto payload — re-send media manually`)
}
