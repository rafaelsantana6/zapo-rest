import type { FastifyPluginAsync, FastifyRequest } from 'fastify'
import fp from 'fastify-plugin'
import type { Env } from '~/config/env'
import type { InstanceRepo } from '~/instances/repo'
import { safeEqual } from '~/lib/crypto-keys'
import { forbidden, unauthorized } from '~/lib/errors'
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
 * Resolve the target instance for operational routes.
 *
 * **Instance API key only** — name always comes from the authenticated key.
 * Admin keys cannot call these endpoints (admin is limited to create/list/delete/rotate).
 *
 * Paths never include `:name` for operations (`/v1/messages/...`, `/v1/instance/...`).
 *
 * @example
 * ```ts
 * // path: '/v1/messages/text'
 * const name = resolveInstanceName(request)
 * ```
 */
export function resolveInstanceName(request: FastifyRequest, _nameFromParams?: string): string {
  if (request.actor.role === 'admin') {
    throw forbidden(
      'Admin API key cannot call instance methods. Use an instance API key, or admin create/list/delete only.',
    )
  }
  return request.actor.instanceName
}

/**
 * Instance-scoped REST resource path (no `:name` segment).
 * Auth: instance API key — name inferred via {@link resolveInstanceName}.
 *
 * @param resourcePath - e.g. `/messages/text` or `/chats/:chatId`
 */
export function scopedInstancePaths(resourcePath: string): string {
  const path = resourcePath.startsWith('/') ? resourcePath : `/${resourcePath}`
  return `/v1${path}`
}

/**
 * Instance lifecycle under singular `/v1/instance/...`
 * (does not collide with admin collection `/v1/instances`).
 */
export function scopedSelfPaths(resourcePath = ''): string {
  const path = !resourcePath ? '' : resourcePath.startsWith('/') ? resourcePath : `/${resourcePath}`
  return `/v1/instance${path}`
}
