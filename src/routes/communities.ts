import type { FastifyPluginAsync } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import { resolveInstanceName, scopedInstancePaths } from '~/auth/plugin'
import {
  CommunityCreateSchema,
  CommunityGroupsSchema,
  CommunityHintSchema,
  CommunityJoinParamsSchema,
  CommunityJoinSchema,
  CommunityLinkResultSchema,
  CommunityMetadataSchema,
  CommunityOwnerSchema,
  CommunityParamsSchema,
  CommunityParticipantsSchema,
  CommunitySubGroupsSchema,
  CommunitySuggestionsSchema,
  CommunityUnlinkResultSchema,
  CommunityUnlinkSchema,
  ErrorBodySchema,
  OkSchema,
} from '~/http/openapi-schemas'
import type { InstanceManager } from '~/instances/manager'
import { notFound } from '~/lib/errors'
import { normalizeGroupJid, serializeGroupMetadata } from '~/lib/group-metadata'
import { resolveRecipientJid } from '~/lib/phone-resolve'
import type { CacheClient } from '~/redis/client'

export type CommunityRoutesDeps = { manager: InstanceManager; cache?: CacheClient }

const communitySchema = {
  tags: ['Communities'],
  security: [{ apiKey: [] }, { bearerAuth: [] }] as Record<string, string[]>[],
  params: CommunityParamsSchema,
}
const errors = { 400: ErrorBodySchema, 403: ErrorBodySchema, 404: ErrorBodySchema, 503: ErrorBodySchema }

export const communityRoutes: FastifyPluginAsync<CommunityRoutesDeps> = async (fastify, { manager, cache }) => {
  const app = fastify.withTypeProvider<ZodTypeProvider>()

  async function requireCommunity(name: string, communityId: string) {
    const client = manager.requireRegisteredClient(name)
    const jid = normalizeGroupJid(communityId)
    // MEX can return an empty list for a missing parent; verify before reading or mutating it.
    const metadata = await client.group.queryGroupMetadata(jid)
    if (!metadata?.isParentGroup) throw notFound(`Community ${jid} not found; expected a parent group`)
    return { client, jid, metadata }
  }

  app.post(
    scopedInstancePaths('/communities'),
    {
      schema: {
        tags: ['Communities'],
        security: communitySchema.security,
        summary: 'Create community',
        body: CommunityCreateSchema,
        response: { 200: CommunityMetadataSchema, ...errors },
      },
    },
    async (request) => {
      const client = manager.requireRegisteredClient(resolveInstanceName(request))
      const { subject, ...options } = request.body
      const community = await client.group.createCommunity(subject, options)
      return { community: serializeGroupMetadata(community) }
    },
  )

  app.get(
    scopedInstancePaths('/communities/:communityId'),
    {
      schema: {
        ...communitySchema,
        summary: 'Get community metadata',
        response: { 200: CommunityMetadataSchema, ...errors },
      },
    },
    async (request) => {
      const { metadata } = await requireCommunity(resolveInstanceName(request), request.params.communityId)
      return { community: serializeGroupMetadata(metadata) }
    },
  )

  app.delete(
    scopedInstancePaths('/communities/:communityId'),
    { schema: { ...communitySchema, summary: 'Deactivate community', response: { 200: OkSchema, ...errors } } },
    async (request) => {
      const { client, jid } = await requireCommunity(resolveInstanceName(request), request.params.communityId)
      await client.group.deactivateCommunity(jid)
      return { ok: true as const }
    },
  )

  app.get(
    scopedInstancePaths('/communities/:communityId/subgroups'),
    {
      schema: {
        ...communitySchema,
        summary: 'List community sub-groups',
        description: 'Includes the announcement group. Requires the upstream MEX transport.',
        response: { 200: CommunitySubGroupsSchema, ...errors },
      },
    },
    async (request) => {
      const { client, jid } = await requireCommunity(resolveInstanceName(request), request.params.communityId)
      const result = await client.group.fetchSubGroups(jid)
      return { ...result, subGroups: [...result.subGroups] }
    },
  )

  app.get(
    scopedInstancePaths('/communities/:communityId/participants'),
    {
      schema: {
        ...communitySchema,
        summary: 'List merged community participants',
        response: { 200: CommunityParticipantsSchema, ...errors },
      },
    },
    async (request) => {
      const { client, jid } = await requireCommunity(resolveInstanceName(request), request.params.communityId)
      return {
        participants: (await client.group.queryLinkedGroupsParticipants(jid)).map((participant) => ({
          ...participant,
        })),
      }
    },
  )

  app.get(
    scopedInstancePaths('/communities/:communityId/subgroups/suggestions'),
    {
      schema: {
        ...communitySchema,
        summary: 'Suggest community sub-groups',
        description: 'Requires the upstream MEX transport. The hint identifies a sub-group.',
        querystring: CommunityHintSchema,
        response: { 200: CommunitySuggestionsSchema, ...errors },
      },
    },
    async (request) => {
      const { client, jid } = await requireCommunity(resolveInstanceName(request), request.params.communityId)
      return {
        suggestions: [...(await client.group.fetchSubgroupSuggestions(jid, normalizeGroupJid(request.query.hint)))],
      }
    },
  )

  app.post(
    scopedInstancePaths('/communities/:communityId/subgroups/link'),
    {
      schema: {
        ...communitySchema,
        summary: 'Link community sub-groups',
        description: 'Inspect result.linkedJids and result.failed for partial failures.',
        body: CommunityGroupsSchema,
        response: { 200: CommunityLinkResultSchema, ...errors },
      },
    },
    async (request) => {
      const { client, jid } = await requireCommunity(resolveInstanceName(request), request.params.communityId)
      const result = await client.group.linkSubGroups(jid, request.body.groups.map(normalizeGroupJid))
      return { result: { ...result, linkedJids: [...result.linkedJids], failed: [...result.failed] } }
    },
  )

  app.post(
    scopedInstancePaths('/communities/:communityId/subgroups/unlink'),
    {
      schema: {
        ...communitySchema,
        summary: 'Unlink community sub-groups',
        description: 'Inspect result.unlinkedJids and result.failed for partial failures.',
        body: CommunityUnlinkSchema,
        response: { 200: CommunityUnlinkResultSchema, ...errors },
      },
    },
    async (request) => {
      const { client, jid } = await requireCommunity(resolveInstanceName(request), request.params.communityId)
      const { groups, removeOrphanedMembers } = request.body
      const result = await client.group.unlinkSubGroups(jid, groups.map(normalizeGroupJid), { removeOrphanedMembers })
      return { result: { ...result, unlinkedJids: [...result.unlinkedJids], failed: [...result.failed] } }
    },
  )

  app.post(
    scopedInstancePaths('/communities/:communityId/subgroups/:groupId/join'),
    {
      schema: {
        ...communitySchema,
        summary: 'Join a linked community sub-group',
        description: 'Acknowledgement only; GET /groups/:groupId for metadata after joining.',
        params: CommunityJoinParamsSchema,
        body: CommunityJoinSchema,
        response: { 200: OkSchema, ...errors },
      },
    },
    async (request) => {
      const { client, jid } = await requireCommunity(resolveInstanceName(request), request.params.communityId)
      await client.group.joinLinkedGroup(jid, normalizeGroupJid(request.params.groupId), request.body ?? undefined)
      return { ok: true as const }
    },
  )

  app.post(
    scopedInstancePaths('/communities/:communityId/owner'),
    {
      schema: {
        ...communitySchema,
        summary: 'Transfer community ownership',
        description: 'Resolves the new owner through the shared recipient resolver. Requires upstream MEX transport.',
        body: CommunityOwnerSchema,
        response: { 200: OkSchema, ...errors },
      },
    },
    async (request) => {
      const { client, jid } = await requireCommunity(resolveInstanceName(request), request.params.communityId)
      const owner = await resolveRecipientJid(client, request.body.user, cache)
      await client.group.transferCommunityOwnership(jid, owner)
      return { ok: true as const }
    },
  )
}
