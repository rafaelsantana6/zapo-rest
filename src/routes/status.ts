import type { FastifyPluginAsync } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import { z } from 'zod'
import { resolveInstanceName, scopedInstancePaths } from '~/auth/plugin'
import type { Env } from '~/config/env'
import type { InstanceManager } from '~/instances/manager'
import { badRequest } from '~/lib/errors'
import { resolveRecipientJid } from '~/lib/phone-resolve'
import { resolveMediaToFile } from '~/media/fetch'
import type { CacheClient } from '~/redis/client'

export type StatusRoutesDeps = {
  manager: InstanceManager
  env: Env
  cache?: CacheClient
}

const Recipients = z.array(z.string().min(1)).min(1).max(256)

const SendStatusBody = z.object({
  recipients: Recipients.describe('JIDs or phones that should receive the status (fan-out list)'),
  text: z.string().min(1).optional(),
  mediaUrl: z.string().url().optional(),
  mediaBase64: z.string().optional(),
  mimetype: z.string().optional(),
  caption: z.string().optional(),
  type: z.enum(['text', 'image', 'video', 'audio']).optional(),
  statusSetting: z.enum(['contacts', 'allowlist', 'denylist', 'close_friends']).optional(),
})

export const statusRoutes: FastifyPluginAsync<StatusRoutesDeps> = async (fastify, deps) => {
  const app = fastify.withTypeProvider<ZodTypeProvider>()
  const { manager, env, cache } = deps

  app.post(
    scopedInstancePaths('/status/send'),
    {
      schema: {
        tags: ['Status'],
        summary: 'Publish a status / story broadcast',
        description:
          'Uses `client.status.send`. Provide `text` and/or media. `recipients` is the fan-out list required by zapo.',
        security: [{ apiKey: [] }, { bearerAuth: [] }],
        body: SendStatusBody,
      },
    },
    async (request) => {
      const name = resolveInstanceName(request)
      const body = request.body
      const client = manager.requireRegisteredClient(name)

      const recipients: string[] = []
      for (const r of body.recipients) {
        recipients.push(await resolveRecipientJid(client, r, cache))
      }

      let content: Parameters<typeof client.status.send>[0]['content']
      const mediaType = body.type ?? (body.mediaUrl || body.mediaBase64 ? 'image' : 'text')

      if (mediaType === 'text' || (!body.mediaUrl && !body.mediaBase64)) {
        if (!body.text) throw badRequest('text is required when type is "text" (no media provided)')
        content = { type: 'text', text: body.text }
      } else {
        const media = await resolveMediaToFile(
          { mediaUrl: body.mediaUrl, mediaBase64: body.mediaBase64, mimetype: body.mimetype },
          env,
        )
        try {
          if (mediaType === 'video') {
            content = {
              type: 'video',
              media: media.path,
              mimetype: media.mimetype ?? body.mimetype ?? 'video/mp4',
              caption: body.caption ?? body.text,
            }
          } else if (mediaType === 'audio') {
            content = {
              type: 'audio',
              media: media.path,
              mimetype: media.mimetype ?? body.mimetype,
            }
          } else {
            content = {
              type: 'image',
              media: media.path,
              mimetype: media.mimetype ?? body.mimetype ?? 'image/jpeg',
              caption: body.caption ?? body.text,
            }
          }
          const result = await client.status.send({
            content,
            recipients,
            statusSetting: body.statusSetting,
          })
          return { id: result.id, result, recipients }
        } finally {
          await media.cleanup()
        }
      }

      const result = await client.status.send({
        content,
        recipients,
        statusSetting: body.statusSetting,
      })
      return { id: result.id, result, recipients }
    },
  )

  app.post(
    scopedInstancePaths('/status/revoke'),
    {
      schema: {
        tags: ['Status'],
        summary: 'Revoke a published status',
        security: [{ apiKey: [] }, { bearerAuth: [] }],
        body: z.object({
          messageId: z.string().min(1),
          recipients: Recipients,
          statusSetting: z.enum(['contacts', 'allowlist', 'denylist', 'close_friends']).optional(),
        }),
      },
    },
    async (request) => {
      const name = resolveInstanceName(request)
      const body = request.body
      const client = manager.requireRegisteredClient(name)
      const recipients: string[] = []
      for (const r of body.recipients) {
        recipients.push(await resolveRecipientJid(client, r, cache))
      }
      const result = await client.status.revokeStatus({
        messageId: body.messageId,
        recipients,
        statusSetting: body.statusSetting,
      })
      return { id: result.id, result }
    },
  )

  app.post(
    scopedInstancePaths('/status/privacy'),
    {
      schema: {
        tags: ['Status'],
        summary: 'Set status distribution privacy',
        security: [{ apiKey: [] }, { bearerAuth: [] }],
        body: z.object({
          mode: z.enum([
            'CONTACTS',
            'ALLOWLIST',
            'DENYLIST',
            'CLOSE_FRIENDS',
            'contacts',
            'allowlist',
            'denylist',
            'close_friends',
          ]),
          userJids: z.array(z.string()).optional(),
          shareToFB: z.boolean().optional(),
          shareToIG: z.boolean().optional(),
        }),
      },
    },
    async (request) => {
      const name = resolveInstanceName(request)
      const body = request.body
      const client = manager.requireRegisteredClient(name)
      const userJids: string[] = []
      for (const j of body.userJids ?? []) {
        userJids.push(await resolveRecipientJid(client, j, cache))
      }
      const modeMap: Record<string, 'CONTACTS' | 'ALLOW_LIST' | 'DENY_LIST' | 'CLOSE_FRIENDS' | 'CUSTOM_LIST'> = {
        CONTACTS: 'CONTACTS',
        ALLOWLIST: 'ALLOW_LIST',
        ALLOW_LIST: 'ALLOW_LIST',
        DENYLIST: 'DENY_LIST',
        DENY_LIST: 'DENY_LIST',
        CLOSE_FRIENDS: 'CLOSE_FRIENDS',
        CUSTOM_LIST: 'CUSTOM_LIST',
      }
      const modeKey = body.mode.toUpperCase().replace(/-/g, '_')
      const mode = modeMap[modeKey] ?? modeMap[modeKey.replace('ALLOWLIST', 'ALLOW_LIST')] ?? 'CONTACTS'
      await client.status.setPrivacy({
        mode,
        userJids: userJids.length ? userJids : undefined,
        shareToFB: body.shareToFB,
        shareToIG: body.shareToIG,
      })
      return { ok: true as const }
    },
  )

  app.post(
    scopedInstancePaths('/status/mute'),
    {
      schema: {
        tags: ['Status'],
        summary: 'Mute / unmute a contact status',
        security: [{ apiKey: [] }, { bearerAuth: [] }],
        body: z.object({
          jid: z.string().min(1),
          muted: z.boolean(),
        }),
      },
    },
    async (request) => {
      const name = resolveInstanceName(request)
      const body = request.body
      const client = manager.requireRegisteredClient(name)
      const jid = await resolveRecipientJid(client, body.jid, cache)
      await client.status.setUserMuted(jid, body.muted)
      return { ok: true as const, jid, muted: body.muted }
    },
  )
}
