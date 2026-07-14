import { readFile } from 'node:fs/promises'
import type { FastifyPluginAsync } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import { z } from 'zod'
import { resolveInstanceName, scopedInstancePaths } from '~/auth/plugin'
import type { Env } from '~/config/env'
import { ErrorBodySchema } from '~/http/openapi-schemas'
import type { InstanceManager } from '~/instances/manager'
import { serviceUnavailable } from '~/lib/errors'
import { resolveWhatsAppNumbers } from '~/lib/phone-resolve'
import { resolveMediaToFile } from '~/media/fetch'
import type { CacheClient } from '~/redis/client'

const GroupParams = z.object({
  groupId: z.string().min(1),
})

const GroupSettingSchema = z.enum([
  'announcement',
  'restrict',
  'ephemeral',
  'membership_approval_mode',
  'allow_non_admin_sub_group_creation',
  'group_history',
  'allow_admin_reports',
  'no_frequently_forwarded',
])

export type GroupRoutesDeps = {
  manager: InstanceManager
  env?: Env
  cache?: CacheClient
}

export const groupRoutes: FastifyPluginAsync<GroupRoutesDeps> = async (fastify, deps) => {
  const app = fastify.withTypeProvider<ZodTypeProvider>()
  const { manager, env, cache } = deps

  /** Resolve participant phones with 55 + nono dígito via usync batch. */
  async function resolveParticipants(client: ReturnType<InstanceManager['requireRegisteredClient']>, phones: string[]) {
    const resolved = await resolveWhatsAppNumbers(client, phones, { cache })
    return resolved.map((r) => (r.exists ? r.jid : r.localJid))
  }

  app.get(
    scopedInstancePaths('/groups'),
    {
      schema: {
        tags: ['Groups'],
        summary: 'List groups',
        security: [{ apiKey: [] }, { bearerAuth: [] }],
        response: {
          200: z.object({ groups: z.array(z.any().meta({ type: 'object', additionalProperties: true })) }),
          503: ErrorBodySchema,
        },
      },
    },
    async (request) => {
      const name = resolveInstanceName(request)
      const client = manager.requireRegisteredClient(name)
      const groups = await client.group.queryAllGroups()
      return { groups: [...groups] }
    },
  )

  app.post(
    scopedInstancePaths('/groups'),
    {
      schema: {
        tags: ['Groups'],
        summary: 'Create group',
        security: [{ apiKey: [] }, { bearerAuth: [] }],
        body: z.object({
          subject: z.string().min(1).max(100),
          participants: z.array(z.string()).min(1),
          description: z.string().optional(),
        }),
      },
    },
    async (request) => {
      const name = resolveInstanceName(request)
      const body = request.body
      const client = manager.requireRegisteredClient(name)
      const participants = await resolveParticipants(client, body.participants)
      const group = await client.group.createGroup(body.subject, participants, {
        description: body.description,
      })
      return { group }
    },
  )

  app.get(
    scopedInstancePaths('/groups/:groupId'),
    {
      schema: {
        tags: ['Groups'],
        summary: 'Get group metadata',
        security: [{ apiKey: [] }, { bearerAuth: [] }],
        params: GroupParams,
      },
    },
    async (request) => {
      const params = request.params
      const name = resolveInstanceName(request)
      const client = manager.requireRegisteredClient(name)
      const jid = normalizeGroupJid(params.groupId)
      const group = await client.group.queryGroupMetadata(jid)
      return { group }
    },
  )

  app.post(
    scopedInstancePaths('/groups/:groupId/leave'),
    {
      schema: {
        tags: ['Groups'],
        summary: 'Leave group',
        security: [{ apiKey: [] }, { bearerAuth: [] }],
        params: GroupParams,
      },
    },
    async (request) => {
      const params = request.params
      const name = resolveInstanceName(request)
      const client = manager.requireRegisteredClient(name)
      const jid = normalizeGroupJid(params.groupId)
      await client.group.leaveGroup([jid])
      return { ok: true as const }
    },
  )

  app.put(
    scopedInstancePaths('/groups/:groupId/subject'),
    {
      schema: {
        tags: ['Groups'],
        summary: 'Set group subject',
        security: [{ apiKey: [] }, { bearerAuth: [] }],
        params: GroupParams,
        body: z.object({ subject: z.string().min(1).max(100) }),
      },
    },
    async (request) => {
      const params = request.params
      const name = resolveInstanceName(request)
      const body = request.body
      const client = manager.requireRegisteredClient(name)
      await client.group.setSubject(normalizeGroupJid(params.groupId), body.subject)
      return { ok: true as const }
    },
  )

  app.put(
    scopedInstancePaths('/groups/:groupId/description'),
    {
      schema: {
        tags: ['Groups'],
        summary: 'Set group description',
        security: [{ apiKey: [] }, { bearerAuth: [] }],
        params: GroupParams,
        body: z.object({ description: z.string().nullable() }),
      },
    },
    async (request) => {
      const params = request.params
      const name = resolveInstanceName(request)
      const body = request.body
      const client = manager.requireRegisteredClient(name)
      await client.group.setDescription(normalizeGroupJid(params.groupId), body.description)
      return { ok: true as const }
    },
  )

  app.get(
    scopedInstancePaths('/groups/:groupId/invite-code'),
    {
      schema: {
        tags: ['Groups'],
        summary: 'Get invite code',
        security: [{ apiKey: [] }, { bearerAuth: [] }],
        params: GroupParams,
      },
    },
    async (request) => {
      const params = request.params
      const name = resolveInstanceName(request)
      const client = manager.requireRegisteredClient(name)
      const code = await client.group.queryInviteCode(normalizeGroupJid(params.groupId))
      return { code, inviteLink: `https://chat.whatsapp.com/${code}` }
    },
  )

  app.post(
    scopedInstancePaths('/groups/:groupId/invite-code/revoke'),
    {
      schema: {
        tags: ['Groups'],
        summary: 'Revoke invite code',
        security: [{ apiKey: [] }, { bearerAuth: [] }],
        params: GroupParams,
      },
    },
    async (request) => {
      const params = request.params
      const name = resolveInstanceName(request)
      const client = manager.requireRegisteredClient(name)
      const result = await client.group.revokeInvite(normalizeGroupJid(params.groupId))
      return { code: result.code, inviteLink: `https://chat.whatsapp.com/${result.code}` }
    },
  )

  app.post(
    scopedInstancePaths('/groups/join'),
    {
      schema: {
        tags: ['Groups'],
        summary: 'Join group via invite code',
        security: [{ apiKey: [] }, { bearerAuth: [] }],
        body: z.object({ code: z.string().min(1) }),
      },
    },
    async (request) => {
      const name = resolveInstanceName(request)
      const body = request.body
      const client = manager.requireRegisteredClient(name)
      const code = body.code.replace(/^https?:\/\/chat\.whatsapp\.com\//, '')
      const group = await client.group.joinGroupViaInvite(code)
      return { group }
    },
  )

  app.get(
    scopedInstancePaths('/groups/join-info'),
    {
      schema: {
        tags: ['Groups'],
        summary: 'Preview group invite',
        security: [{ apiKey: [] }, { bearerAuth: [] }],
        querystring: z.object({ code: z.string().min(1) }),
      },
    },
    async (request) => {
      const name = resolveInstanceName(request)
      const q = request.query
      const client = manager.requireRegisteredClient(name)
      const code = q.code.replace(/^https?:\/\/chat\.whatsapp\.com\//, '')
      const info = await client.group.queryGroupInviteInfo(code)
      return { info }
    },
  )

  app.post(
    scopedInstancePaths('/groups/:groupId/participants/add'),
    {
      schema: {
        tags: ['Groups'],
        summary: 'Add participants',
        security: [{ apiKey: [] }, { bearerAuth: [] }],
        params: GroupParams,
        body: z.object({ participants: z.array(z.string()).min(1) }),
      },
    },
    async (request) => {
      const params = request.params
      const name = resolveInstanceName(request)
      const body = request.body
      const client = manager.requireRegisteredClient(name)
      const result = await client.group.addParticipants(
        normalizeGroupJid(params.groupId),
        await resolveParticipants(client, body.participants),
      )
      return { result }
    },
  )

  app.post(
    scopedInstancePaths('/groups/:groupId/participants/remove'),
    {
      schema: {
        tags: ['Groups'],
        summary: 'Remove participants',
        security: [{ apiKey: [] }, { bearerAuth: [] }],
        params: GroupParams,
        body: z.object({ participants: z.array(z.string()).min(1) }),
      },
    },
    async (request) => {
      const params = request.params
      const name = resolveInstanceName(request)
      const body = request.body
      const client = manager.requireRegisteredClient(name)
      const result = await client.group.removeParticipants(
        normalizeGroupJid(params.groupId),
        await resolveParticipants(client, body.participants),
      )
      return { result }
    },
  )

  app.post(
    scopedInstancePaths('/groups/:groupId/admin/promote'),
    {
      schema: {
        tags: ['Groups'],
        summary: 'Promote admins',
        security: [{ apiKey: [] }, { bearerAuth: [] }],
        params: GroupParams,
        body: z.object({ participants: z.array(z.string()).min(1) }),
      },
    },
    async (request) => {
      const params = request.params
      const name = resolveInstanceName(request)
      const body = request.body
      const client = manager.requireRegisteredClient(name)
      const result = await client.group.promoteParticipants(
        normalizeGroupJid(params.groupId),
        await resolveParticipants(client, body.participants),
      )
      return { result }
    },
  )

  app.post(
    scopedInstancePaths('/groups/:groupId/admin/demote'),
    {
      schema: {
        tags: ['Groups'],
        summary: 'Demote admins',
        security: [{ apiKey: [] }, { bearerAuth: [] }],
        params: GroupParams,
        body: z.object({ participants: z.array(z.string()).min(1) }),
      },
    },
    async (request) => {
      const params = request.params
      const name = resolveInstanceName(request)
      const body = request.body
      const client = manager.requireRegisteredClient(name)
      const result = await client.group.demoteParticipants(
        normalizeGroupJid(params.groupId),
        await resolveParticipants(client, body.participants),
      )
      return { result }
    },
  )

  app.get(
    scopedInstancePaths('/groups/:groupId/picture'),
    {
      schema: {
        tags: ['Groups'],
        summary: 'Get group picture',
        security: [{ apiKey: [] }, { bearerAuth: [] }],
        params: GroupParams,
        querystring: z.object({
          type: z.enum(['preview', 'image']).optional(),
        }),
      },
    },
    async (request) => {
      const params = request.params
      const name = resolveInstanceName(request)
      const q = request.query
      const client = manager.requireRegisteredClient(name)
      const jid = normalizeGroupJid(params.groupId)
      const picture = await client.profile.getProfilePicture(jid, q.type ?? 'preview')
      return { picture }
    },
  )

  app.put(
    scopedInstancePaths('/groups/:groupId/picture'),
    {
      schema: {
        tags: ['Groups'],
        summary: 'Set group picture (JPEG bytes via URL or base64)',
        security: [{ apiKey: [] }, { bearerAuth: [] }],
        params: GroupParams,
        body: z.object({
          mediaUrl: z.string().url().optional(),
          mediaBase64: z.string().optional(),
        }),
      },
    },
    async (request) => {
      const params = request.params
      const name = resolveInstanceName(request)
      if (!env) throw serviceUnavailable('MEDIA storage env not configured')
      const body = request.body
      const client = manager.requireRegisteredClient(name)
      const jid = normalizeGroupJid(params.groupId)
      const media = await resolveMediaToFile(body, env)
      try {
        const bytes = await readFile(media.path)
        const pictureId = await client.profile.setProfilePicture(bytes, jid)
        return { ok: true as const, pictureId }
      } finally {
        await media.cleanup()
      }
    },
  )

  app.delete(
    scopedInstancePaths('/groups/:groupId/picture'),
    {
      schema: {
        tags: ['Groups'],
        summary: 'Delete group picture',
        security: [{ apiKey: [] }, { bearerAuth: [] }],
        params: GroupParams,
      },
    },
    async (request) => {
      const params = request.params
      const name = resolveInstanceName(request)
      const client = manager.requireRegisteredClient(name)
      await client.profile.deleteProfilePicture(normalizeGroupJid(params.groupId))
      return { ok: true as const }
    },
  )

  app.put(
    scopedInstancePaths('/groups/:groupId/settings/:setting'),
    {
      schema: {
        tags: ['Groups'],
        summary: 'Toggle group setting',
        description:
          'Settings: `announcement` (messages admin-only), `restrict` (info admin-only), ' +
          '`ephemeral`, `membership_approval_mode`, `group_history`, etc.',
        security: [{ apiKey: [] }, { bearerAuth: [] }],
        params: GroupParams.extend({ setting: GroupSettingSchema }),
        body: z.object({
          enabled: z.boolean(),
          /** For ephemeral: duration in seconds (0 disables). Also calls setEphemeralDuration. */
          ephemeralSeconds: z.number().int().nonnegative().optional(),
        }),
      },
    },
    async (request) => {
      const params = request.params
      const name = resolveInstanceName(request)
      const body = request.body
      const client = manager.requireRegisteredClient(name)
      const jid = normalizeGroupJid(params.groupId)

      if (params.setting === 'ephemeral') {
        const seconds = body.enabled ? (body.ephemeralSeconds ?? 86_400) : 0
        await client.group.setEphemeralDuration(jid, seconds)
        if (!body.enabled) {
          await client.group.setSetting(jid, 'ephemeral', false)
        }
        return { ok: true as const, setting: params.setting, enabled: body.enabled, ephemeralSeconds: seconds }
      }

      await client.group.setSetting(jid, params.setting, body.enabled)
      return { ok: true as const, setting: params.setting, enabled: body.enabled }
    },
  )

  /** multi-config aliases for common security toggles */
  app.put(
    scopedInstancePaths('/groups/:groupId/settings/security/messages-admin-only'),
    {
      schema: {
        tags: ['Groups'],
        summary: 'Messages admin-only (announcement)',
        security: [{ apiKey: [] }, { bearerAuth: [] }],
        params: GroupParams,
        body: z.object({ enabled: z.boolean() }),
      },
    },
    async (request) => {
      const params = request.params
      const name = resolveInstanceName(request)
      const body = request.body
      const client = manager.requireRegisteredClient(name)
      await client.group.setSetting(normalizeGroupJid(params.groupId), 'announcement', body.enabled)
      return { ok: true as const, enabled: body.enabled }
    },
  )

  app.put(
    scopedInstancePaths('/groups/:groupId/settings/security/info-admin-only'),
    {
      schema: {
        tags: ['Groups'],
        summary: 'Group info admin-only (restrict)',
        security: [{ apiKey: [] }, { bearerAuth: [] }],
        params: GroupParams,
        body: z.object({ enabled: z.boolean() }),
      },
    },
    async (request) => {
      const params = request.params
      const name = resolveInstanceName(request)
      const body = request.body
      const client = manager.requireRegisteredClient(name)
      await client.group.setSetting(normalizeGroupJid(params.groupId), 'restrict', body.enabled)
      return { ok: true as const, enabled: body.enabled }
    },
  )
}

function normalizeGroupJid(input: string): string {
  if (input.includes('@')) return input
  return `${input.replace(/\D/g, '')}@g.us`
}
