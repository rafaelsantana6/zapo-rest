import type { FastifyPluginAsync } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import { z } from 'zod'
import { resolveInstanceName, scopedInstancePaths } from '~/auth/plugin'
import { ErrorBodySchema } from '~/http/openapi-schemas'
import type { InstanceManager } from '~/instances/manager'
import { badRequest, conflict } from '~/lib/errors'

export type ProfileUsernameRoutesDeps = {
  manager: InstanceManager
}

const UsernameBody = z.object({
  username: z.string().min(1).meta({
    description: 'Handle without requiring a leading @. `@loja` and `loja` are both accepted.',
    example: 'loja',
  }),
  reserved: z.boolean().optional().meta({ description: 'Reserve the handle instead of publishing it.' }),
})

const ResolveUsernameBody = z.object({
  username: z.string().min(1).meta({ description: 'Handle. A `:1234` suffix is a username key.', example: '@loja' }),
  usernameKey: z.string().optional().meta({ description: 'Key when the server answered `key-required`.' }),
})

const OwnUsernameResponse = z.object({
  username: z.string().nullable(),
  state: z.string().nullable(),
})

/**
 * Username (`@handle`) on the linked account.
 * Recovery PIN from `getOwnUsername` is intentionally omitted — it is a secret.
 */
export const profileUsernameRoutes: FastifyPluginAsync<ProfileUsernameRoutesDeps> = async (fastify, deps) => {
  const app = fastify.withTypeProvider<ZodTypeProvider>()
  const { manager } = deps

  app.get(
    scopedInstancePaths('/profile/username'),
    {
      schema: {
        tags: ['Profile'],
        summary: 'Get own username',
        description:
          'Current account handle (`client.profile.getOwnUsername`). `null` when none is set.\n\n' +
          'Changes made on another device arrive as the `profile.username` webhook (`own_username`, or the MEX account-sync equivalent).',
        security: [{ apiKey: [] }, { bearerAuth: [] }],
        response: { 200: OwnUsernameResponse, 401: ErrorBodySchema, 403: ErrorBodySchema, 503: ErrorBodySchema },
      },
    },
    async (request) => {
      const name = resolveInstanceName(request)
      const client = manager.requireRegisteredClient(name)
      const own = await client.profile.getOwnUsername()
      return { username: own.username, state: own.state }
    },
  )

  app.put(
    scopedInstancePaths('/profile/username'),
    {
      schema: {
        tags: ['Profile'],
        summary: 'Set own username',
        description:
          'Reserves or publishes a handle (`client.profile.setUsername`). `409` when the server rejects it (taken, rate-limited). Check suggestions first.',
        security: [{ apiKey: [] }, { bearerAuth: [] }],
        body: UsernameBody,
        response: {
          200: z.object({ ok: z.literal(true), username: z.string() }),
          400: ErrorBodySchema,
          401: ErrorBodySchema,
          403: ErrorBodySchema,
          409: ErrorBodySchema,
          503: ErrorBodySchema,
        },
      },
    },
    async (request) => {
      const name = resolveInstanceName(request)
      const client = manager.requireRegisteredClient(name)
      const username = request.body.username.trim().replace(/^@/, '')
      const ok = await client.profile.setUsername({
        username,
        ...(request.body.reserved != null ? { reserved: request.body.reserved } : {}),
      })
      if (!ok) throw conflict(`username "${username}" was not accepted`)
      return { ok: true as const, username }
    },
  )

  app.delete(
    scopedInstancePaths('/profile/username'),
    {
      schema: {
        tags: ['Profile'],
        summary: 'Delete own username',
        security: [{ apiKey: [] }, { bearerAuth: [] }],
        response: {
          200: z.object({ ok: z.literal(true) }),
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
      const ok = await client.profile.deleteUsername()
      if (!ok) throw badRequest('username was not deleted')
      return { ok: true as const }
    },
  )

  app.get(
    scopedInstancePaths('/profile/username/check'),
    {
      schema: {
        tags: ['Profile'],
        summary: 'Check username availability',
        security: [{ apiKey: [] }, { bearerAuth: [] }],
        querystring: z.object({
          username: z.string().min(1).meta({ example: 'loja' }),
        }),
        response: {
          200: z.object({ available: z.boolean(), suggestions: z.array(z.string()) }),
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
      const username = request.query.username.trim().replace(/^@/, '')
      const result = await client.profile.checkUsernameAvailability(username)
      return { available: result.available, suggestions: [...result.suggestions] }
    },
  )

  app.post(
    scopedInstancePaths('/profile/username/resolve'),
    {
      schema: {
        tags: ['Profile'],
        summary: 'Resolve a username to a JID',
        description:
          '`found` includes the LID (`jid`) and phone JID when WhatsApp revealed it. `key-required` means retry with `usernameKey` or `@handle:1234`. Sending to `@handle` uses this same lookup.',
        security: [{ apiKey: [] }, { bearerAuth: [] }],
        body: ResolveUsernameBody,
        response: {
          200: z.object({
            status: z.enum(['found', 'key-required', 'not-found']),
            username: z.string().nullable().optional(),
            jid: z.string().optional(),
            pnJid: z.string().nullable().optional(),
            isBusiness: z.boolean().optional(),
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
      const lookup = await client.profile.resolveUsername({
        username: request.body.username.trim(),
        ...(request.body.usernameKey ? { usernameKey: request.body.usernameKey } : {}),
      })
      if (lookup.status === 'found') {
        return {
          status: 'found' as const,
          username: lookup.username,
          jid: lookup.jid,
          pnJid: lookup.pnJid,
          isBusiness: lookup.isBusiness,
        }
      }
      if (lookup.status === 'key-required') {
        return { status: 'key-required' as const, username: lookup.username }
      }
      return { status: 'not-found' as const, username: null }
    },
  )
}
