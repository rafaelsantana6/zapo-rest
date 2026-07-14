import type { FastifyPluginAsync } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import { z } from 'zod'
import { resolveInstanceName, scopedInstancePaths } from '~/auth/plugin'
import { ErrorBodySchema } from '~/http/openapi-schemas'
import type { InstanceManager } from '~/instances/manager'
import { notFound } from '~/lib/errors'
import { toRecipientJid } from '~/lib/jid'
import { bareUserJid, isLidJid } from '~/lib/jid-canon'
import { resolveRecipientJid } from '~/lib/phone-resolve'
import type { CacheClient } from '~/redis/client'
import { type ChatStore, toPublicChat } from '~/store/chats'
import type { LidMapStore } from '~/store/lid-map'
import { type MessageStore, toPublicMessage } from '~/store/messages'

const ChatParams = z.object({
  chatId: z.string().min(1).describe('Chat JID or phone digits (LID or PN — aliases merged)'),
})

const ListChatsQuery = z.object({
  limit: z.coerce.number().int().positive().max(200).optional(),
  offset: z.coerce.number().int().nonnegative().optional(),
  archived: z
    .union([z.boolean(), z.string()])
    .optional()
    .transform((v) => {
      if (v === undefined) return undefined
      if (typeof v === 'boolean') return v
      return ['1', 'true', 'yes'].includes(v.toLowerCase())
    }),
  /** Collapse LID+PN duplicates (default true — merge) */
  merge: z
    .union([z.boolean(), z.string()])
    .optional()
    .transform((v) => {
      if (v === undefined) return true
      if (typeof v === 'boolean') return v
      return !['0', 'false', 'no'].includes(v.toLowerCase())
    }),
})

const ListMessagesQuery = z.object({
  limit: z.coerce.number().int().positive().max(200).optional(),
  before: z.coerce.number().optional().describe('timestamp_ms cursor (exclusive)'),
  after: z.coerce.number().optional(),
  downloadMedia: z
    .union([z.boolean(), z.string()])
    .optional()
    .transform((v) => v === true || v === 'true' || v === '1'),
})

export type ChatRoutesDeps = {
  manager: InstanceManager
  chats: ChatStore
  messages: MessageStore
  lidMap?: LidMapStore
  cache?: CacheClient
}

export const chatRoutes: FastifyPluginAsync<ChatRoutesDeps> = async (app, deps) => {
  const { manager, chats, messages, lidMap, cache } = deps
  const r = app.withTypeProvider<ZodTypeProvider>()

  async function resolveChatId(instanceName: string, chatId: string): Promise<string> {
    // Accept digits / full JID / @lid — always 55 + nono dígito when phone-like
    let jid: string
    try {
      if (chatId.includes('@g.us') || chatId.includes('@lid') || chatId.includes('@broadcast')) {
        jid = bareUserJid(chatId)
      } else {
        const client = manager.tryGetClient(instanceName)
        jid = await resolveRecipientJid(client, chatId, cache)
      }
    } catch {
      try {
        jid = chatId.includes('@') ? bareUserJid(chatId) : toRecipientJid(chatId)
      } catch {
        jid = bareUserJid(chatId)
      }
    }
    if (lidMap) {
      return lidMap.resolveCanonical(instanceName, jid)
    }
    return jid
  }

  r.get(
    scopedInstancePaths('/chats'),
    {
      schema: {
        tags: ['Chats'],
        summary: 'List chats',
        description:
          'Returns chat projections. **merge=true (default)** collapses multiple `@lid` rows ' +
          'that map to the same phone JID ( style), preferring `@s.whatsapp.net`.',
        security: [{ apiKey: [] }, { bearerAuth: [] }],
        querystring: ListChatsQuery,
        response: {
          200: z.object({ chats: z.array(z.any().meta({ type: 'object', additionalProperties: true })) }),
          401: ErrorBodySchema,
        },
      },
    },
    async (request) => {
      const name = resolveInstanceName(request)
      const q = request.query
      const rows = await chats.list(name, {
        limit: q.limit,
        offset: q.offset,
        archived: q.archived,
        merge: q.merge,
      })
      return { chats: rows.map(toPublicChat) }
    },
  )

  r.post(
    scopedInstancePaths('/chats/reconcile-lids'),
    {
      schema: {
        tags: ['Chats'],
        summary: 'Reconcile LID→PN chats',
        description: 'Rebuilds lid_map from contacts, merges duplicate LID/PN conversations, deletes empty LID ghosts.',
        security: [{ apiKey: [] }, { bearerAuth: [] }],
      },
    },
    async (request) => {
      const name = resolveInstanceName(request)
      if (!lidMap) throw notFound('lid map not available')
      const { reconcileLidChats } = await import('~/store/chat-reconcile')
      const result = await reconcileLidChats(chats.pool, name, { lidMap, chats, messages })
      return { ok: true as const, ...result }
    },
  )

  r.get(
    scopedInstancePaths('/chats/:chatId'),
    {
      schema: {
        tags: ['Chats'],
        summary: 'Get chat',
        security: [{ apiKey: [] }, { bearerAuth: [] }],
        params: ChatParams,
        response: {
          200: z.object({ chat: z.any().meta({ type: 'object', additionalProperties: true }) }),
          404: ErrorBodySchema,
        },
      },
    },
    async (request) => {
      const params = request.params
      const name = resolveInstanceName(request)
      const jid = await resolveChatId(name, params.chatId)
      let chat = await chats.get(name, jid)
      // Fallback: try original lid form
      if (!chat && isLidJid(params.chatId)) {
        chat = await chats.get(name, bareUserJid(params.chatId))
      }
      if (!chat) throw notFound(`chat "${jid}" not found`)
      const altJids = lidMap ? await lidMap.expandAliases(name, chat.chatJid) : []
      return {
        chat: toPublicChat({
          ...chat,
          altJids: altJids.filter((a) => a !== chat?.chatJid),
        }),
      }
    },
  )

  r.get(
    scopedInstancePaths('/chats/:chatId/messages'),
    {
      schema: {
        tags: ['Chats'],
        summary: 'List chat messages',
        description: 'Paginated history (newest first). Includes messages stored under any LID alias of the chat.',
        security: [{ apiKey: [] }, { bearerAuth: [] }],
        params: ChatParams,
        querystring: ListMessagesQuery,
        response: {
          200: z.object({ messages: z.array(z.any().meta({ type: 'object', additionalProperties: true })) }),
        },
      },
    },
    async (request) => {
      const params = request.params
      const name = resolveInstanceName(request)
      const q = request.query
      const jid = await resolveChatId(name, params.chatId)
      const aliases = lidMap ? await lidMap.expandAliases(name, jid) : [jid]
      const rows = await messages.listByChat(name, jid, {
        limit: q.limit,
        beforeTs: q.before,
        afterTs: q.after,
        chatJids: aliases,
      })
      return {
        messages: rows.map((m) => toPublicMessage(m, { instanceName: name })),
        chatId: jid,
        aliases,
      }
    },
  )

  r.get(
    scopedInstancePaths('/chats/:chatId/messages/:messageId'),
    {
      schema: {
        tags: ['Chats'],
        summary: 'Get message by id',
        security: [{ apiKey: [] }, { bearerAuth: [] }],
        params: ChatParams.extend({ messageId: z.string().min(1) }),
        response: {
          200: z.object({ message: z.any().meta({ type: 'object', additionalProperties: true }) }),
          404: ErrorBodySchema,
        },
      },
    },
    async (request) => {
      const params = request.params
      const name = resolveInstanceName(request)
      const msg = await messages.get(name, params.messageId)
      if (!msg) throw notFound('message not found')
      return { message: toPublicMessage(msg, { instanceName: name }) }
    },
  )

  r.post(
    scopedInstancePaths('/chats/:chatId/messages/read'),
    {
      schema: {
        tags: ['Chats'],
        summary: 'Mark chat messages as read',
        security: [{ apiKey: [] }, { bearerAuth: [] }],
        params: ChatParams,
        body: z.object({
          messageIds: z.array(z.string()).min(1).max(50),
        }),
        response: { 200: z.object({ ok: z.literal(true) }) },
      },
    },
    async (request) => {
      const params = request.params
      const name = resolveInstanceName(request)
      const body = request.body
      const client = manager.requireRegisteredClient(name)
      const jid = await resolveChatId(name, params.chatId)
      await client.message.sendReceipt(jid, body.messageIds, { type: 'read' })
      await chats.setUnread(name, jid, 0)
      return { ok: true as const }
    },
  )

  r.post(
    scopedInstancePaths('/chats/:chatId/archive'),
    {
      schema: {
        tags: ['Chats'],
        summary: 'Archive chat',
        security: [{ apiKey: [] }, { bearerAuth: [] }],
        params: ChatParams,
      },
    },
    async (request) => {
      const params = request.params
      const name = resolveInstanceName(request)
      const jid = await resolveChatId(name, params.chatId)
      try {
        const client = manager.requireRegisteredClient(name)
        await client.chat.setChatArchive(jid, true)
      } catch {
        // projection-only fallback
      }
      const row = await chats.setArchived(name, jid, true)
      return { chat: row ? toPublicChat(row) : { id: jid, archived: true } }
    },
  )

  r.post(
    scopedInstancePaths('/chats/:chatId/unarchive'),
    {
      schema: {
        tags: ['Chats'],
        summary: 'Unarchive chat',
        security: [{ apiKey: [] }, { bearerAuth: [] }],
        params: ChatParams,
      },
    },
    async (request) => {
      const params = request.params
      const name = resolveInstanceName(request)
      const jid = await resolveChatId(name, params.chatId)
      try {
        const client = manager.requireRegisteredClient(name)
        await client.chat.setChatArchive(jid, false)
      } catch {
        // ignore
      }
      const row = await chats.setArchived(name, jid, false)
      return { chat: row ? toPublicChat(row) : { id: jid, archived: false } }
    },
  )

  r.post(
    scopedInstancePaths('/chats/:chatId/unread'),
    {
      schema: {
        tags: ['Chats'],
        summary: 'Mark chat as unread (app-state)',
        security: [{ apiKey: [] }, { bearerAuth: [] }],
        params: ChatParams,
      },
    },
    async (request) => {
      const params = request.params
      const name = resolveInstanceName(request)
      const jid = await resolveChatId(name, params.chatId)
      const client = manager.requireRegisteredClient(name)
      await client.chat.setChatRead(jid, false)
      await chats.setUnread(name, jid, 1)
      return { ok: true as const, chatId: jid, unread: true }
    },
  )

  r.delete(
    scopedInstancePaths('/chats/:chatId'),
    {
      schema: {
        tags: ['Chats'],
        summary: 'Delete chat from local store',
        security: [{ apiKey: [] }, { bearerAuth: [] }],
        params: ChatParams,
      },
    },
    async (request) => {
      const params = request.params
      const name = resolveInstanceName(request)
      const jid = await resolveChatId(name, params.chatId)
      await chats.delete(name, jid)
      return { ok: true as const }
    },
  )

  r.post(
    scopedInstancePaths('/chats/:chatId/history-sync'),
    {
      schema: {
        tags: ['Chats'],
        summary: 'Request on-demand history sync for a chat',
        description:
          'Asks WhatsApp to backfill older messages via `message.requestHistorySync`. Chunks arrive as `history.sync` events.',
        security: [{ apiKey: [] }, { bearerAuth: [] }],
        params: ChatParams,
        body: z
          .object({
            count: z.number().int().positive().max(200).optional(),
            oldestMsgId: z.string().optional(),
            oldestMsgFromMe: z.boolean().optional(),
            oldestMsgTimestampMs: z.number().optional(),
          })
          .optional(),
      },
    },
    async (request) => {
      const params = request.params
      const name = resolveInstanceName(request)
      const body = request.body ?? {}
      const client = manager.requireRegisteredClient(name)
      const jid = await resolveChatId(name, params.chatId)
      const result = await client.message.requestHistorySync({
        chatJid: jid,
        count: body.count,
        oldestMsgId: body.oldestMsgId,
        oldestMsgFromMe: body.oldestMsgFromMe,
        oldestMsgTimestampMs: body.oldestMsgTimestampMs,
      })
      return { ok: true as const, requestId: result.messageId }
    },
  )
}
