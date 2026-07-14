import type { FastifyPluginAsync } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import { z } from 'zod'
import { resolveInstanceName, scopedInstancePaths } from '~/auth/plugin'
import { ErrorBodySchema } from '~/http/openapi-schemas'
import type { InstanceManager } from '~/instances/manager'
import { notFound } from '~/lib/errors'
import { resolveRecipientJid } from '~/lib/phone-resolve'
import type { CacheClient } from '~/redis/client'
import { type LabelStore, toPublicLabel } from '~/store/labels'

export type LabelRoutesDeps = {
  manager: InstanceManager
  labels: LabelStore
  cache?: CacheClient
}

const LabelIdParams = z.object({
  labelId: z.string().min(1),
})

const LabelBody = z.object({
  id: z.string().min(1).max(64).optional().describe('Stable label id; auto ULID if omitted'),
  name: z.string().min(1).max(100),
  color: z.number().int().min(0).max(20).optional().describe('WA palette index 0–20'),
  isActive: z.boolean().optional(),
})

export const labelRoutes: FastifyPluginAsync<LabelRoutesDeps> = async (app, deps) => {
  const { manager, labels, cache } = deps
  const r = app.withTypeProvider<ZodTypeProvider>()

  r.get(
    scopedInstancePaths('/labels'),
    {
      schema: {
        tags: ['Labels'],
        summary: 'List labels',
        description: 'WhatsApp Business labels (app-state LabelEdit). Stored locally + synced via chat.set.',
        security: [{ apiKey: [] }, { bearerAuth: [] }],
      },
    },
    async (request) => {
      const name = resolveInstanceName(request)
      await manager.get(name)
      const rows = await labels.list(name)
      return { labels: rows.map(toPublicLabel) }
    },
  )

  r.post(
    scopedInstancePaths('/labels'),
    {
      schema: {
        tags: ['Labels'],
        summary: 'Create / upsert label',
        security: [{ apiKey: [] }, { bearerAuth: [] }],
        body: LabelBody,
      },
    },
    async (request) => {
      const name = resolveInstanceName(request)
      const body = request.body
      const client = manager.requireRegisteredClient(name)
      const row = await labels.upsert({
        instanceName: name,
        labelId: body.id,
        name: body.name,
        color: body.color,
        isActive: body.isActive,
      })
      await client.chat.set({
        schema: 'LabelEdit',
        id: row.labelId,
        labelEditAction: {
          name: row.name,
          color: row.color,
          isActive: row.isActive,
        },
      } as never)
      return { label: toPublicLabel(row) }
    },
  )

  r.put(
    scopedInstancePaths('/labels/:labelId'),
    {
      schema: {
        tags: ['Labels'],
        summary: 'Update label',
        security: [{ apiKey: [] }, { bearerAuth: [] }],
        params: LabelIdParams,
        body: LabelBody.omit({ id: true }),
      },
    },
    async (request) => {
      const params = request.params
      const name = resolveInstanceName(request)
      const body = request.body
      const existing = await labels.get(name, params.labelId)
      if (!existing) throw notFound('label not found')
      const client = manager.requireRegisteredClient(name)
      const row = await labels.upsert({
        instanceName: name,
        labelId: params.labelId,
        name: body.name,
        color: body.color ?? existing.color,
        isActive: body.isActive ?? existing.isActive,
      })
      await client.chat.set({
        schema: 'LabelEdit',
        id: row.labelId,
        labelEditAction: {
          name: row.name,
          color: row.color,
          isActive: row.isActive,
        },
      } as never)
      return { label: toPublicLabel(row) }
    },
  )

  r.delete(
    scopedInstancePaths('/labels/:labelId'),
    {
      schema: {
        tags: ['Labels'],
        summary: 'Delete label',
        security: [{ apiKey: [] }, { bearerAuth: [] }],
        params: LabelIdParams,
        response: { 200: z.object({ ok: z.literal(true) }), 404: ErrorBodySchema },
      },
    },
    async (request) => {
      const params = request.params
      const name = resolveInstanceName(request)
      const existing = await labels.get(name, params.labelId)
      if (!existing) throw notFound('label not found')
      try {
        const client = manager.requireRegisteredClient(name)
        await client.chat.set({
          schema: 'LabelEdit',
          id: params.labelId,
          labelEditAction: {
            name: existing.name,
            color: existing.color,
            isActive: false,
            deleted: true,
          },
        } as never)
      } catch {
        // still delete local
      }
      await labels.delete(name, params.labelId)
      return { ok: true as const }
    },
  )

  r.post(
    scopedInstancePaths('/labels/:labelId/chats'),
    {
      schema: {
        tags: ['Labels'],
        summary: 'Associate / remove label on a chat',
        security: [{ apiKey: [] }, { bearerAuth: [] }],
        params: LabelIdParams,
        body: z.object({
          chatId: z.string().min(1),
          labeled: z.boolean().default(true),
        }),
      },
    },
    async (request) => {
      const params = request.params
      const name = resolveInstanceName(request)
      const body = request.body
      const existing = await labels.get(name, params.labelId)
      if (!existing) throw notFound('label not found')
      const client = manager.requireRegisteredClient(name)
      const chatJid = await resolveRecipientJid(client, body.chatId, cache)
      if (body.labeled) {
        await client.chat.set({
          schema: 'LabelJid',
          labelId: params.labelId,
          chatJid,
          labelAssociationAction: { labeled: true },
        } as never)
      } else {
        await client.chat.remove({
          schema: 'LabelJid',
          labelId: params.labelId,
          chatJid,
        } as never)
      }
      await labels.setChatLabel(name, params.labelId, chatJid, body.labeled)
      return { ok: true as const, labelId: params.labelId, chatId: chatJid, labeled: body.labeled }
    },
  )

  r.get(
    scopedInstancePaths('/labels/:labelId/chats'),
    {
      schema: {
        tags: ['Labels'],
        summary: 'List chats with this label',
        security: [{ apiKey: [] }, { bearerAuth: [] }],
        params: LabelIdParams,
      },
    },
    async (request) => {
      const params = request.params
      const name = resolveInstanceName(request)
      const existing = await labels.get(name, params.labelId)
      if (!existing) throw notFound('label not found')
      const chats = await labels.listChats(name, params.labelId)
      return { chats }
    },
  )

  r.get(
    scopedInstancePaths('/chats/:chatId/labels'),
    {
      schema: {
        tags: ['Labels'],
        summary: 'List labels on a chat',
        security: [{ apiKey: [] }, { bearerAuth: [] }],
        params: z.object({ chatId: z.string() }),
      },
    },
    async (request) => {
      const params = request.params
      const name = resolveInstanceName(request)
      const client = manager.tryGetClient(name)
      const chatJid = await resolveRecipientJid(client, params.chatId, cache)
      const rows = await labels.listLabelsForChat(name, chatJid)
      return { labels: rows.map(toPublicLabel) }
    },
  )
}
