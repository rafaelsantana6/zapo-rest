import { readFile } from 'node:fs/promises'
import type { FastifyPluginAsync, FastifyRequest } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import { z } from 'zod'
import { resolveInstanceName, scopedInstancePaths } from '~/auth/plugin'
import type { Env } from '~/config/env'
import { ErrorBodySchema, MEDIA_INPUT_HELP, OkSchema } from '~/http/openapi-schemas'
import type { InstanceManager } from '~/instances/manager'
import { badRequest } from '~/lib/errors'
import { bareUserJid } from '~/lib/jid-canon'
import { normalizeProfileJpeg } from '~/media/profile-image'
import { mediaPreValidation, requireMediaFromRequest } from '~/media/request-media'
import { parseWaIqError } from '~/lib/wa-iq-error'

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
  .meta({
    description:
      'JPEG avatar via `mediaUrl`, `mediaBase64`, or multipart `file`. WhatsApp expects JPEG profile pictures. ' +
      'Size limit: MEDIA_UPLOAD_MAX_BYTES.',
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
          'Returns the linked account profile, **aligned with `GET /v1/instance`**:\n\n' +
          '- `pushName` / `avatarUrl` from credentials + durable storage (same enrichment as instance get)\n' +
          '- `status` = WhatsApp About text (best-effort IQ)\n' +
          '- `picture` = WA envelope when available; `url` prefers durable `avatarUrl`\n\n' +
          'Uses **bare PN JID** (device suffix stripped) for status/picture IQs — device JIDs often return empty.\n\n' +
          '```bash\ncurl -s "$BASE/v1/profile" -H "X-Api-Key: $INSTANCE_API_KEY"\n```',
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
      // Same enrichment path as GET /v1/instance (pushName + avatarUrl)
      const instance = await manager.get(name)
      const creds = client.getCredentials()
      const meJid = creds?.meJid ?? instance.meJid
      // Device JIDs (`user:device@s.whatsapp.net`) break getStatus / getProfilePicture IQs
      const bareJid = meJid ? bareUserJid(meJid) : null

      let status: string | null = null
      let picture: unknown = null
      if (bareJid) {
        try {
          const s = await client.profile.getStatus(bareJid)
          status = s.status ?? null
        } catch {
          // About may be empty / rate-limited — not fatal
        }
        // Prefer full-res IQ; fall back to preview (same as durable resolve policy)
        try {
          picture = await client.profile.getProfilePicture(bareJid, 'image')
        } catch {
          try {
            picture = await client.profile.getProfilePicture(bareJid, 'preview')
          } catch {
            // Privacy / missing pic — fall through to durable avatarUrl
          }
        }
      }

      // Prefer durable avatar URL (same as instance.avatarUrl) over ephemeral WA CDN
      if (instance.avatarUrl) {
        if (picture && typeof picture === 'object' && !Array.isArray(picture)) {
          picture = { ...(picture as Record<string, unknown>), url: instance.avatarUrl }
        } else {
          picture = { url: instance.avatarUrl }
        }
      }

      return {
        profile: {
          meJid,
          bareJid,
          pushName: instance.pushName,
          avatarUrl: instance.avatarUrl,
          status,
          picture,
          credentials: {
            meJid: meJid ?? null,
            pushName: instance.pushName,
            registered: Boolean(meJid),
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

  /** Shared handler: set WhatsApp profile picture from URL, base64, or multipart file. */
  async function handleSetProfileImage(request: FastifyRequest) {
    const instanceName = resolveInstanceName(request)
    // Body already validated by route schema (JSON) or filled by mediaPreValidation (multipart)
    SetProfileImageBody.parse(request.body ?? {})
    const client = manager.requireRegisteredClient(instanceName)
    const { media } = await requireMediaFromRequest(request, env)
    try {
      const raw = await readFile(media.path)
      // WA expects compact JPEG; multipart often sends PNG/HEIC/huge phone photos
      const jpeg = await normalizeProfileJpeg(raw)
      try {
        const id = await client.profile.setProfilePicture(jpeg)
        return { ok: true as const, pictureId: id ?? null }
      } catch (err) {
        const iq = parseWaIqError(err)
        if (iq) {
          throw badRequest(
            `WhatsApp rejected the profile picture (${iq.code ?? iq.kind}). ` +
              'Use a clear JPEG/PNG/WebP photo (we re-encode to JPEG ≤640px).',
            { wa: iq },
          )
        }
        throw err
      }
    } finally {
      await media.cleanup()
    }
  }

  const setImageDescription =
    'Updates the WhatsApp **profile picture** (avatar).\n\n' +
    MEDIA_INPUT_HELP +
    '**Paths** (identical handlers)\n' +
    '- `PUT /v1/profile/image` (preferred) · alias `PUT /v1/profile/picture`\n\n' +
    '```bash\n' +
    'curl -s -X PUT "$BASE/v1/profile/image" \\\n' +
    '  -H "X-Api-Key: $INSTANCE_API_KEY" -H "content-type: application/json" \\\n' +
    '  -d \'{"mediaUrl":"https://cdn.example.com/avatar.jpg"}\'\n\n' +
    'curl -s -X PUT "$BASE/v1/profile/image" -H "X-Api-Key: $INSTANCE_API_KEY" \\\n' +
    '  -F file=@./avatar.jpg\n' +
    '```'

  const profileMediaHooks = { preValidation: mediaPreValidation(env) }

  app.put(
    scopedInstancePaths('/profile/image'),
    {
      ...profileMediaHooks,
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
      ...profileMediaHooks,
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
