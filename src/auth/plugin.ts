import type { FastifyPluginAsync, FastifyRequest } from 'fastify'
import fp from 'fastify-plugin'
import type { Env } from '~/config/env'
import type { InstanceRepo } from '~/instances/repo'
import { safeEqual } from '~/lib/crypto-keys'
import { badRequest, forbidden, unauthorized } from '~/lib/errors'
import type { Actor } from './types'
import { canAccessInstance, isAdmin } from './types'

export type AuthDeps = {
  env: Env
  instanceRepo: InstanceRepo
}

declare module 'fastify' {
  interface FastifyRequest {
    actor: Actor
  }
}

function extractApiKey(request: FastifyRequest): string | null {
  // Prefer headers — never put secrets in URLs when the client can send headers
  // (SSE via fetch, REST, curl). Query is last-resort for native EventSource / WS browsers.
  const header = request.headers['x-api-key']
  if (typeof header === 'string' && header.length > 0) return header

  const auth = request.headers.authorization
  if (typeof auth === 'string' && auth.toLowerCase().startsWith('bearer ')) {
    return auth.slice(7).trim()
  }

  // Fallback only: EventSource cannot set headers; browser WebSocket often cannot either.
  // Prefer fetch()+ReadableStream (SSE) or protocols that allow headers when possible.
  const q = request.query as { apiKey?: string } | undefined
  if (q && typeof q.apiKey === 'string' && q.apiKey.length > 0) return q.apiKey

  return null
}

export async function resolveActor(deps: AuthDeps, apiKey: string): Promise<Actor | null> {
  // Admin key lives in env as plaintext — compare timing-safely.
  if (safeEqual(apiKey, deps.env.ADMIN_API_KEY)) {
    return { role: 'admin' }
  }
  // Instance keys are stored and looked up as plaintext (unique index on api_key).
  const instance = await deps.instanceRepo.getByApiKey(apiKey)
  if (!instance) return null
  return { role: 'instance', instanceName: instance.name }
}

const authPluginImpl: FastifyPluginAsync<AuthDeps> = async (app, deps) => {
  app.decorateRequest('actor', {
    getter(this: FastifyRequest) {
      return (this as FastifyRequest & { _actor?: Actor })._actor as Actor
    },
    setter(this: FastifyRequest, value: Actor) {
      ;(this as FastifyRequest & { _actor?: Actor })._actor = value
    },
  })

  app.addHook('onRequest', async (request) => {
    // Protect only /v1/* — OpenAPI UI/JSON at /docs is public (use network ACL in prod if needed)
    const url = request.url.split('?')[0] ?? ''
    if (!url.startsWith('/v1')) {
      return
    }

    const key = extractApiKey(request)
    if (!key) {
      throw unauthorized('Missing API key (X-Api-Key or Authorization: Bearer)')
    }
    const actor = await resolveActor(deps, key)
    if (!actor) {
      throw unauthorized('Invalid API key')
    }
    request.actor = actor
  })
}

export const authPlugin = fp(authPluginImpl, { name: 'auth-plugin' })

export function requireAdmin(request: FastifyRequest): void {
  if (!isAdmin(request.actor)) {
    throw forbidden('Admin API key required')
  }
}

export function requireInstanceAccess(request: FastifyRequest, instanceName: string): void {
  if (!canAccessInstance(request.actor, instanceName)) {
    throw forbidden(`No access to instance "${instanceName}"`)
  }
}

/**
 * Resolve the target instance for a request.
 *
 * Dual routing (both work for the same handlers):
 * - **Named:** `/v1/instances/:name/...` — `nameFromParams` present; access-checked.
 * - **Inferred:** `/v1/...` (no name) — only with an **instance** API key; uses `actor.instanceName`.
 *
 * **Admin API key must always pass the instance name** (named path). Omitting it → 400.
 *
 * @example
 * ```ts
 * // path: ['/v1/instances/:name/messages/text', '/v1/messages/text']
 * const name = resolveInstanceName(request, request.params.name)
 * ```
 */
export function resolveInstanceName(request: FastifyRequest, nameFromParams?: string): string {
  if (nameFromParams) {
    requireInstanceAccess(request, nameFromParams)
    return nameFromParams
  }
  if (request.actor.role === 'admin') {
    throw badRequest('Instance name is required when using the admin API key. Use /v1/instances/:name/...')
  }
  return request.actor.instanceName
}

/**
 * Dual URL pair for instance-scoped REST resources.
 * Named form keeps multi-tenant admin access; short form omits the name for instance keys.
 *
 * Returns a path array; `enableMultiUrlRoutes` (in app bootstrap) expands it so each
 * Fastify method shorthand registers both URLs. Typed as `string` for TS overloads.
 *
 * @param resourcePath - Path after the instance segment, e.g. `/messages/text` or `/chats/:chatId`
 */
export function scopedInstancePaths(resourcePath: string): string {
  const path = resourcePath.startsWith('/') ? resourcePath : `/${resourcePath}`
  return [`/v1/instances/:name${path}`, `/v1${path}`] as unknown as string
}

/**
 * Dual URL pair for instance lifecycle ops (get/connect/qr/…).
 * Short form uses singular `/v1/instance/...` so it never collides with admin
 * collection routes under `/v1/instances`.
 */
export function scopedSelfPaths(resourcePath = ''): string {
  const path = !resourcePath ? '' : resourcePath.startsWith('/') ? resourcePath : `/${resourcePath}`
  return [`/v1/instances/:name${path}`, `/v1/instance${path}`] as unknown as string
}
