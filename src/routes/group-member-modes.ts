import type { FastifyInstance } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import { z } from 'zod'
import { resolveInstanceName, scopedInstancePaths } from '~/auth/plugin'
import {
  ErrorBodySchema,
  GroupHistoryShareModeSchema,
  GroupMemberAddModeSchema,
  GroupMemberLinkModeSchema,
} from '~/http/openapi-schemas'
import type { InstanceManager } from '~/instances/manager'

type GroupClient = ReturnType<InstanceManager['requireRegisteredClient']>['group']

export function registerGroupMemberModeRoutes(
  fastify: FastifyInstance,
  manager: InstanceManager,
  normalizeGroupJid: (input: string) => string,
): void {
  const app = fastify.withTypeProvider<ZodTypeProvider>()

  function registerMode(
    setting: string,
    modeSchema: typeof GroupMemberAddModeSchema | typeof GroupMemberLinkModeSchema | typeof GroupHistoryShareModeSchema,
    setMode: (group: GroupClient, jid: string, mode: string) => Promise<void>,
  ) {
    app.put(
      scopedInstancePaths(`/groups/:groupId/settings/${setting}`),
      {
        schema: {
          tags: ['Groups'],
          summary: `Set group ${setting}`,
          description:
            'Admin-only. Send { mode }; accepted values are listed in the body schema. Read current values with GET /v1/groups/:groupId. History sharing controls POST /v1/groups/:groupId/share-history, independently of HISTORY_GROUP_BUNDLES (receiving).',
          security: [{ apiKey: [] }, { bearerAuth: [] }],
          params: z.object({ groupId: z.string().min(1) }),
          body: z.object({ mode: modeSchema }),
          response: {
            200: z.object({ ok: z.literal(true), mode: modeSchema }),
            400: ErrorBodySchema,
            403: ErrorBodySchema,
            404: ErrorBodySchema,
            503: ErrorBodySchema,
          },
        },
      },
      async (request) => {
        const client = manager.requireRegisteredClient(resolveInstanceName(request))
        await setMode(client.group, normalizeGroupJid(request.params.groupId), request.body.mode)
        return { ok: true as const, mode: request.body.mode }
      },
    )
  }

  registerMode('member-add-mode', GroupMemberAddModeSchema, (group, jid, mode) =>
    group.setMemberAddMode(jid, GroupMemberAddModeSchema.parse(mode)),
  )
  registerMode('member-link-mode', GroupMemberLinkModeSchema, (group, jid, mode) =>
    group.setMemberLinkMode(jid, GroupMemberLinkModeSchema.parse(mode)),
  )
  registerMode('history-share-mode', GroupHistoryShareModeSchema, (group, jid, mode) =>
    group.setMemberShareGroupHistoryMode(jid, GroupHistoryShareModeSchema.parse(mode)),
  )
}
