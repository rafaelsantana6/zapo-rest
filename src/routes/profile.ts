import { readFile } from 'node:fs/promises'
import type { FastifyPluginAsync, FastifyRequest } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import { z } from 'zod'
import { resolveInstanceName, scopedInstancePaths } from '~/auth/plugin'
import type { Env } from '~/config/env'
import { ErrorBodySchema, OkSchema } from '~/http/openapi-schemas'
import type { InstanceManager } from '~/instances/manager'
import { badRequest } from '~/lib/errors'
import { resolveMediaToFile } from '~/media/fetch'

export type ProfileRoutesDeps = {
  manager: InstanceManager
  env: Env
}

const SetPushNameBody = z
  .object({
    name: z
      .string()
      .min(1)
      .max(25)
      .optional()
      .meta({ description: 'WhatsApp push name (display name). Max 25 chars.', example: 'Loja Sales' }),
    pushName: z
      .string()
      .min(1)
      .max(25)
      .optional()
      .meta({ description: 'Alias of `name` (same field).', example: 'Loja Sales' }),
  })
  .refine((b) => Boolean(b.name?.trim() || b.pushName?.trim()), {
    message: 'name or pushName is required',
  })
  .meta({
    description: 'Body for updating the WhatsApp display name (push name).',
    example: { name: 'Loja Sales' },
  })

const SetProfileImageBody = z
  .object({
    mediaUrl: z
      .string()
      .url()
      .optional()
      .meta({ description: 'Public HTTPS URL of a JPEG image', example: 'https://cdn.example.com/avatar.jpg' }),
    mediaBase64: z.string().optional().meta({ description: 'Raw or data-URL base64 of a JPEG image' }),
    mimetype: z.string().optional().meta({ description: 'Optional MIME (default image/jpeg)', example: 'image/jpeg' }),
  })
  .refine((b) => Boolean(b.mediaUrl || b.mediaBase64), {
    message: 'mediaUrl or mediaBase64 is required',
  })
  .meta({
    description: 'JPEG avatar bytes via URL or base64. WhatsApp expects JPEG profile pictures.',
    example: { mediaUrl: 'https://cdn.example.com/avatar.jpg' },
  })

const SetProfileImageResponse = z
  .object({
    ok: z.literal(true),
    pictureId: z.union([z.string(), z.number(), z.null()]).optional(),
  })
  .meta({ example: { ok: true, pictureId: '123456' } })

export const profileRoutes: FastifyPluginAsync<ProfileRoutesDeps> = async (fastify, deps) => {
  const app = fastify.withTypeProvider<ZodTypeProvider>()
  const { manager, env } = deps

  app.get(
    scopedInstancePaths('/profile'),
    {
      schema: {
        tags: ['Profile'],
        summary: 'Get own profile snapshot',
        description:
          'Returns a best-effort snapshot of the linked account: `meJid`, about status, and profile picture metadata.\n\n' +
          '**Short form (instance key):** `GET /v1/profile`',
        security: [{ apiKey: [] }, { bearerAuth: [] }],
        response: {
          200: z.object({ profile: z.any().meta({ type: 'object', additionalProperties: true }) }),
          401: ErrorBodySchema,
          403: ErrorBodySchema,
          503: ErrorBodySchema,
        },
      },
    },
    async (request) => {
      const name = resolveInstanceName(request)
      const client = manager.requireRegisteredClient(name)
      const creds = client.getCredentials()
      const meJid = creds?.meJid
      let status: string | null = null
      let picture: unknown = null
      if (meJid) {
        try {
          const s = await client.profile.getStatus(meJid)
          status = s.status
        } catch {
          // ignore
        }
        try {
          picture = await client.profile.getProfilePicture(meJid, 'preview')
        } catch {
          // ignore
        }
      }
      return {
        profile: {
          meJid,
          status,
          picture,
          credentials: {
            meJid: creds?.meJid ?? null,
            registered: Boolean(creds?.meJid),
          },
        },
      }
    },
  )

  /** Shared handler: update WhatsApp push name + persist on instance row. */
  async function handleSetPushName(request: FastifyRequest) {
    const instanceName = resolveInstanceName(request)
    const body = SetPushNameBody.parse(request.body)
    const pushName = (body.name ?? body.pushName ?? '').trim()
    if (!pushName) throw badRequest('name or pushName is required')
    const client = manager.requireRegisteredClient(instanceName)
    await client.profile.setPushName(pushName)
    await manager.setStoredPushName(instanceName, pushName).catch(() => undefined)
    return { ok: true as const }
  }

  const setPushNameDescription =
    'Updates the WhatsApp **push name** (display name shown to contacts).\n\n' +
    'Body: `{ "name": "…" }` or `{ "pushName": "…" }` (max 25 characters).\n\n' +
    'Also persists on the instance row so list/get return the new `pushName`.\n\n' +
    '**Paths**\n' +
    '- Named: `PUT /v1/instances/:name/profile/name`\n' +
    '- Short (instance key): `PUT /v1/profile/name`\n\n' +
    '```bash\n' +
    'curl -s -X PUT "$BASE/v1/profile/name" \\\n' +
    '  -H "X-Api-Key: $INSTANCE_API_KEY" -H "content-type: application/json" \\\n' +
    '  -d \'{"name":"Loja Sales"}\'\n' +
    '```'

  app.put(
    scopedInstancePaths('/profile/name'),
    {
      schema: {
        tags: ['Profile'],
        summary: 'Set push name (display name)',
        description: setPushNameDescription,
        security: [{ apiKey: [] }, { bearerAuth: [] }],
        body: SetPushNameBody,
        response: {
          200: OkSchema,
          400: ErrorBodySchema,
          401: ErrorBodySchema,
          403: ErrorBodySchema,
          503: ErrorBodySchema,
        },
      },
    },
    handleSetPushName,
  )

  /** Shared handler: set WhatsApp profile picture from URL or base64. */
  async function handleSetProfileImage(request: FastifyRequest) {
    const instanceName = resolveInstanceName(request)
    const body = SetProfileImageBody.parse(request.body)
    const client = manager.requireRegisteredClient(instanceName)
    const media = await resolveMediaToFile(body, env)
    try {
      const bytes = await readFile(media.path)
      if (bytes.byteLength === 0) throw badRequest('empty image payload')
      const id = await client.profile.setProfilePicture(bytes)
      return { ok: true as const, pictureId: id ?? null }
    } finally {
      await media.cleanup()
    }
  }

  const setImageDescription =
    'Updates the WhatsApp **profile picture** (avatar). Provide JPEG bytes via `mediaUrl` (public HTTPS) or `mediaBase64`.\n\n' +
    '**Paths** (identical handlers)\n' +
    '- `PUT /v1/instances/:name/profile/image` · `PUT /v1/profile/image` (preferred)\n' +
    '- `PUT /v1/instances/:name/profile/picture` · `PUT /v1/profile/picture` (alias)\n\n' +
    '```bash\n' +
    'curl -s -X PUT "$BASE/v1/profile/image" \\\n' +
    '  -H "X-Api-Key: $INSTANCE_API_KEY" -H "content-type: application/json" \\\n' +
    '  -d \'{"mediaUrl":"https://cdn.example.com/avatar.jpg"}\'\n' +
    '```'

  app.put(
    scopedInstancePaths('/profile/image'),
    {
      schema: {
        tags: ['Profile'],
        summary: 'Set profile picture (avatar)',
        description: setImageDescription,
        security: [{ apiKey: [] }, { bearerAuth: [] }],
        body: SetProfileImageBody,
        response: {
          200: SetProfileImageResponse,
          400: ErrorBodySchema,
          401: ErrorBodySchema,
          403: ErrorBodySchema,
          503: ErrorBodySchema,
        },
      },
    },
    handleSetProfileImage,
  )

  app.put(
    scopedInstancePaths('/profile/picture'),
    {
      schema: {
        tags: ['Profile'],
        summary: 'Set profile picture (alias of /profile/image)',
        description: setImageDescription,
        security: [{ apiKey: [] }, { bearerAuth: [] }],
        body: SetProfileImageBody,
        response: {
          200: SetProfileImageResponse,
          400: ErrorBodySchema,
          401: ErrorBodySchema,
          403: ErrorBodySchema,
          503: ErrorBodySchema,
        },
      },
    },
    handleSetProfileImage,
  )

  app.put(
    scopedInstancePaths('/profile/status'),
    {
      schema: {
        tags: ['Profile'],
        summary: 'Set about status',
        description:
          'Updates the WhatsApp **About** text (status string).\n\n' +
          '**Short form (instance key):** `PUT /v1/profile/status`',
        security: [{ apiKey: [] }, { bearerAuth: [] }],
        body: z.object({
          status: z.string().max(139).meta({ description: 'About text (max 139 chars)', example: 'Atendimento 9–18h' }),
        }),
        response: {
          200: OkSchema,
          400: ErrorBodySchema,
          401: ErrorBodySchema,
          403: ErrorBodySchema,
          503: ErrorBodySchema,
        },
      },
    },
    async (request) => {
      const name = resolveInstanceName(request)
      const body = request.body
      const client = manager.requireRegisteredClient(name)
      await client.profile.setStatus(body.status)
      return { ok: true as const }
    },
  )

  app.delete(
    scopedInstancePaths('/profile/picture'),
    {
      schema: {
        tags: ['Profile'],
        summary: 'Delete profile picture',
        description:
          'Removes the WhatsApp profile picture.\n\n' +
          '**Also:** `DELETE /v1/profile/image` (alias).\n' +
          '**Short form (instance key):** `DELETE /v1/profile/picture` or `/v1/profile/image`',
        security: [{ apiKey: [] }, { bearerAuth: [] }],
        response: {
          200: OkSchema,
          401: ErrorBodySchema,
          403: ErrorBodySchema,
          503: ErrorBodySchema,
        },
      },
    },
    async (request) => {
      const name = resolveInstanceName(request)
      const client = manager.requireRegisteredClient(name)
      await client.profile.deleteProfilePicture()
      return { ok: true as const }
    },
  )

  app.delete(
    scopedInstancePaths('/profile/image'),
    {
      schema: {
        tags: ['Profile'],
        summary: 'Delete profile picture (alias of /profile/picture)',
        security: [{ apiKey: [] }, { bearerAuth: [] }],
        response: {
          200: OkSchema,
          401: ErrorBodySchema,
          403: ErrorBodySchema,
          503: ErrorBodySchema,
        },
      },
    },
    async (request) => {
      const name = resolveInstanceName(request)
      const client = manager.requireRegisteredClient(name)
      await client.profile.deleteProfilePicture()
      return { ok: true as const }
    },
  )
}
