import type { FastifyInstance } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import { z } from 'zod'
import { resolveInstanceName, scopedInstancePaths } from '~/auth/plugin'
import {
  ChatClearBodySchema,
  ChatDeleteBodySchema,
  ChatLockBodySchema,
  ChatMuteBodySchema,
  ChatPinBodySchema,
  ErrorBodySchema,
  OkSchema,
  PublicChatSchema,
} from '~/http/openapi-schemas'
import { chatMuteEnd, runChatMutation } from '~/lib/chat-actions'
import { conflict, notFound } from '~/lib/errors'
import { toPublicChat } from '~/store/chats'
import type { ChatRoutesDeps } from './chats'

const ChatParams = z.object({ chatId: z.string().min(1).describe('Phone, user/group JID or LID') })
const responses = {
  200: OkSchema,
  400: ErrorBodySchema,
  401: ErrorBodySchema,
  403: ErrorBodySchema,
  404: ErrorBodySchema,
  409: ErrorBodySchema,
  503: ErrorBodySchema,
}
const baseSchema = {
  tags: ['Chats'],
  security: [{ apiKey: [] }, { bearerAuth: [] }] as Record<string, string[]>[],
  params: ChatParams,
  response: responses,
}

export function registerChatActions(
  app: FastifyInstance,
  deps: ChatRoutesDeps,
  resolveChatId: (name: string, chatId: string) => Promise<string>,
): void {
  const r = app.withTypeProvider<ZodTypeProvider>()
  const { manager, chats, messages, lidMap } = deps
  const aliases = async (name: string, jid: string) => [
    ...new Set([jid, ...(lidMap ? await lidMap.expandAliases(name, jid) : [])]),
  ]

  r.post(
    scopedInstancePaths('/chats/:chatId/pin'),
    {
      schema: {
        ...baseSchema,
        summary: 'Pin or unpin chat',
        description: 'Pinning also unarchives the chat. Projection changes only after upstream success.',
        body: ChatPinBodySchema,
        response: { ...responses, 200: z.object({ chat: PublicChatSchema }) },
      },
    },
    async (request) => {
      const name = resolveInstanceName(request)
      const jid = await resolveChatId(name, request.params.chatId)
      const { pinned } = request.body
      const timestampMs = Date.now()
      await runChatMutation(() => manager.requireRegisteredClient(name).chat.setChatPin(jid, pinned))
      const chat = await chats.setState(
        {
          instanceName: name,
          chatJid: jid,
          pinned: pinned ? 1 : 0,
          ...(pinned ? { archived: false } : {}),
        },
        timestampMs,
      )
      if (!chat) throw conflict('chat was deleted by a newer action')
      return { chat: toPublicChat(chat) }
    },
  )

  r.post(
    scopedInstancePaths('/chats/:chatId/mute'),
    {
      schema: {
        ...baseSchema,
        summary: 'Mute or unmute chat',
        description:
          'Use until (ISO) or durationSeconds; neither means forever. GET computes expiration without waiting for another phone event.',
        body: ChatMuteBodySchema,
        response: { ...responses, 200: z.object({ chat: PublicChatSchema }) },
      },
    },
    async (request) => {
      const name = resolveInstanceName(request)
      const jid = await resolveChatId(name, request.params.chatId)
      const timestampMs = Date.now()
      const end = chatMuteEnd(request.body, timestampMs)
      await runChatMutation(() => manager.requireRegisteredClient(name).chat.setChatMute(jid, request.body.muted, end))
      const chat = await chats.setState({ instanceName: name, chatJid: jid, muteEndMs: end ?? null }, timestampMs)
      if (!chat) throw conflict('chat was deleted by a newer action')
      return { chat: toPublicChat(chat) }
    },
  )

  r.post(
    scopedInstancePaths('/chats/:chatId/lock'),
    {
      schema: {
        ...baseSchema,
        summary: 'Lock or unlock chat',
        description: 'Locking also clears archive and pin.',
        body: ChatLockBodySchema,
        response: { ...responses, 200: z.object({ chat: PublicChatSchema }) },
      },
    },
    async (request) => {
      const name = resolveInstanceName(request)
      const jid = await resolveChatId(name, request.params.chatId)
      const { locked } = request.body
      const timestampMs = Date.now()
      await runChatMutation(() => manager.requireRegisteredClient(name).chat.setChatLock(jid, locked))
      const chat = await chats.setState(
        {
          instanceName: name,
          chatJid: jid,
          locked,
          ...(locked ? { archived: false, pinned: 0 } : {}),
        },
        timestampMs,
      )
      if (!chat) throw conflict('chat was deleted by a newer action')
      return { chat: toPublicChat(chat) }
    },
  )

  r.post(
    scopedInstancePaths('/chats/:chatId/clear'),
    {
      schema: {
        ...baseSchema,
        summary: 'Clear chat history for your account',
        description:
          'Preserves the chat, starred messages and media by default. deleteStarred/deleteMedia are forwarded to zapo; stored media objects are not purged. Other participants keep their copies.',
        body: ChatClearBodySchema.nullish(),
      },
    },
    async (request) => {
      const name = resolveInstanceName(request)
      const jid = await resolveChatId(name, request.params.chatId)
      const options = request.body ?? {}
      const beforeMs = Date.now()
      await runChatMutation(() => manager.requireRegisteredClient(name).chat.clearChat(jid, options))
      const jids = await aliases(name, jid)
      await messages.clearChat(name, jids, { deleteStarred: options.deleteStarred === true, beforeMs })
      return { ok: true as const }
    },
  )

  r.post(
    scopedInstancePaths('/chats/:chatId/delete'),
    {
      schema: {
        ...baseSchema,
        summary: 'Delete chat and history for your account',
        description:
          'Syncs deleteChat across your devices and removes local chat/messages, including LID aliases. Does not leave groups. zapo builds the last-message range from its mailbox; no caller-supplied last message is accepted. DELETE /chats/:chatId only removes the local chat row. Stored media objects are not purged.',
        body: ChatDeleteBodySchema.nullish(),
      },
    },
    async (request) => {
      const name = resolveInstanceName(request)
      const jid = await resolveChatId(name, request.params.chatId)
      const beforeMs = Date.now()
      await runChatMutation(() => manager.requireRegisteredClient(name).chat.deleteChat(jid, request.body ?? {}))
      const jids = await aliases(name, jid)
      await messages.clearChat(name, jids, { deleteStarred: true, beforeMs, deleteChat: true })
      return { ok: true as const }
    },
  )

  r.delete(
    scopedInstancePaths('/chats/:chatId/messages/:messageId/for-me'),
    {
      schema: {
        ...baseSchema,
        summary: 'Delete one message for your account',
        description:
          'Uses the stored fromMe, participant and timestamp; recipients keep their copy. Stored media objects are not purged.',
        params: ChatParams.extend({ messageId: z.string().min(1) }),
        querystring: z.object({ deleteMedia: z.enum(['true', 'false']).optional() }),
      },
    },
    async (request) => {
      const name = resolveInstanceName(request)
      const jid = await resolveChatId(name, request.params.chatId)
      const jids = await aliases(name, jid)
      const message = await messages.get(name, request.params.messageId)
      if (!message || !jids.includes(message.chatJid)) throw notFound('message not found in this chat')
      await runChatMutation(() =>
        manager.requireRegisteredClient(name).chat.deleteMessageForMe(
          {
            chatJid: message.chatJid,
            id: message.messageId,
            fromMe: message.fromMe,
            participantJid: message.participantJid ?? message.senderJid ?? undefined,
          },
          { deleteMedia: request.query.deleteMedia === 'true', messageTimestampMs: message.timestampMs ?? undefined },
        ),
      )
      await messages.deleteForMe(name, message.chatJid, message.messageId)
      for (const alias of jids) await chats.refreshLastMessage(name, alias, jids)
      return { ok: true as const }
    },
  )
}
