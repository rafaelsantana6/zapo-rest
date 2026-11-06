import type { FastifyPluginAsync } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import { resolveInstanceName, scopedInstancePaths } from '~/auth/plugin'
import {
  ErrorBodySchema,
  GroupMembershipParticipantsSchema,
  GroupMembershipParamsSchema,
  GroupMembershipRequestsSchema,
  OkSchema,
} from '~/http/openapi-schemas'
import type { InstanceManager } from '~/instances/manager'
import { serializeMembershipRequest, throwMembershipError } from '~/lib/group-membership'
import { resolveWhatsAppNumbers } from '~/lib/phone-resolve'
import type { CacheClient } from '~/redis/client'

type GroupMembershipRoutesDeps = { manager: InstanceManager; cache?: CacheClient }

const ERRORS = {
  400: ErrorBodySchema,
  401: ErrorBodySchema,
  403: ErrorBodySchema,
  404: ErrorBodySchema,
  409: ErrorBodySchema,
  503: ErrorBodySchema,
}

const ACTIONS = {
  approve: { method: 'approveMembershipRequests', summary: 'Approve group join requests (admin only)' },
  reject: { method: 'rejectMembershipRequests', summary: 'Reject group join requests (admin only)' },
  cancel: { method: 'cancelMembershipRequests', summary: 'Cancel join requests sent by this account' },
} as const

export const groupMembershipRoutes: FastifyPluginAsync<GroupMembershipRoutesDeps> = async (fastify, deps) => {
  const app = fastify.withTypeProvider<ZodTypeProvider>()
  const { manager, cache } = deps

  app.get(
    scopedInstancePaths('/groups/:groupId/membership-requests'),
    {
      schema: {
        tags: ['Groups'],
        summary: 'List pending group join requests (admin only)',
        description:
          'Enable approval with PUT /v1/groups/:groupId/settings/membership_approval_mode { "enabled": true }. ' +
          'Returns upstream request times as ISO 8601 strings; optional metadata is omitted when absent. ' +
          '403 when not an admin, 404 for an unknown group, 409 when approval mode is off.',
        security: [{ apiKey: [] }, { bearerAuth: [] }],
        params: GroupMembershipParamsSchema,
        response: { 200: GroupMembershipRequestsSchema, ...ERRORS },
      },
    },
    async (request) => {
      const client = manager.requireRegisteredClient(resolveInstanceName(request))
      const requests = await client.group
        .queryMembershipApprovalRequests(normalizeGroupJid(request.params.groupId))
        .catch(throwMembershipError)
      return { requests: requests.map(serializeMembershipRequest) }
    },
  )

  for (const [action, { method, summary }] of Object.entries(ACTIONS)) {
    app.post(
      scopedInstancePaths(`/groups/:groupId/membership-requests/${action}`),
      {
        schema: {
          tags: ['Groups'],
          summary,
          description:
            'Participants accept phones or JIDs (including LIDs), resolved like participant add/remove. ' +
            'Cancel only withdraws requests sent by this account. ' +
            '403 when unauthorized, 404 for an unknown group, 409 when approval mode is off.',
          security: [{ apiKey: [] }, { bearerAuth: [] }],
          params: GroupMembershipParamsSchema,
          body: GroupMembershipParticipantsSchema,
          response: { 200: OkSchema, ...ERRORS },
        },
      },
      async (request) => {
        const client = manager.requireRegisteredClient(resolveInstanceName(request))
        const resolved = await resolveWhatsAppNumbers(client, request.body.participants, { cache })
        const participants = resolved.map((participant) =>
          participant.exists ? participant.jid : participant.localJid,
        )
        await client.group[method](normalizeGroupJid(request.params.groupId), participants).catch(throwMembershipError)
        return { ok: true as const }
      },
    )
  }
}

function normalizeGroupJid(input: string): string {
  if (input.includes('@')) return input
  return `${input.replace(/\D/g, '')}@g.us`
}
