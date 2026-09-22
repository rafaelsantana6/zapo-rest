import type { FastifyPluginAsync } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import { z } from 'zod'
import { resolveInstanceName, scopedInstancePaths } from '~/auth/plugin'
import { ErrorBodySchema } from '~/http/openapi-schemas'
import type { InstanceManager } from '~/instances/manager'
import { badRequest } from '~/lib/errors'
import { resolveRecipientJid } from '~/lib/phone-resolve'
import type { CacheClient } from '~/redis/client'

export type GroupHistoryRoutesDeps = {
  manager: InstanceManager
  cache?: CacheClient
}

const GroupParams = z.object({
  groupId: z.string().min(1),
})

function normalizeGroupJid(input: string): string {
  if (input.includes('@')) return input
  return `${input.replace(/\D/g, '')}@g.us`
}

/**
 * Share recent group history with members who joined later.
 * Receiving is `HISTORY_GROUP_BUNDLES` (default on) plus the `history.group` webhook.
 * WhatsApp rejects the send when `group_history_send` is off for the account.
 */
export const groupHistoryRoutes: FastifyPluginAsync<GroupHistoryRoutesDeps> = async (fastify, deps) => {
  const app = fastify.withTypeProvider<ZodTypeProvider>()
  const { manager, cache } = deps

  app.post(
    scopedInstancePaths('/groups/:groupId/share-history'),
    {
      schema: {
        tags: ['Groups'],
        summary: 'Share group history with members who joined later',
        description:
          'Sends a history bundle only to `to` (`client.message.shareGroupHistory`), then a hidden notice to the whole group.\n\n' +
          '`to` accepts the same forms as message send, including `@handle`. Each JID must be a current member in the **group addressing mode** (LID groups want `@lid`).\n\n' +
          'The account must have the `group_history_send` property. Admin-only groups reject a share from a regular member. An absent `noticeMessageId` means the bundle was delivered and must not be retried.',
        security: [{ apiKey: [] }, { bearerAuth: [] }],
        params: GroupParams,
        body: z.object({
          to: z.array(z.string().min(1)).min(1).meta({ description: 'Members who should receive the bundle.' }),
          count: z.number().int().positive().max(1000).optional(),
          sinceMs: z.number().int().nonnegative().optional(),
        }),
        response: {
          200: z.object({
            bundleMessageId: z.string(),
            noticeMessageId: z.string().optional(),
            messagesCount: z.number(),
            historyReceivers: z.array(z.string()),
            nonHistoryReceivers: z.array(z.string()),
          }),
          400: ErrorBodySchema,
          401: ErrorBodySchema,
          403: ErrorBodySchema,
          503: ErrorBodySchema,
        },
      },
    },
    async (request) => {
      const name = resolveInstanceName(request)
      const client = manager.requireRegisteredClient(name)
      const toJids: string[] = []
      for (const raw of request.body.to) {
        toJids.push(await resolveRecipientJid(client, raw, cache))
      }
      try {
        const result = await client.message.shareGroupHistory(normalizeGroupJid(request.params.groupId), {
          toJids,
          ...(request.body.count != null ? { count: request.body.count } : {}),
          ...(request.body.sinceMs != null ? { sinceMs: request.body.sinceMs } : {}),
        })
        return {
          bundleMessageId: result.bundleMessageId,
          ...(result.noticeMessageId ? { noticeMessageId: result.noticeMessageId } : {}),
          messagesCount: result.messagesCount,
          historyReceivers: [...result.historyReceivers],
          nonHistoryReceivers: [...result.nonHistoryReceivers],
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : 'share group history failed'
        throw badRequest(message)
      }
    },
  )
}
