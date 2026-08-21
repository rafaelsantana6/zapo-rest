import type { FastifyCorsOptions } from '@fastify/cors'
import type { Env } from '~/config/env'

/**
 * Resolve `@fastify/cors` `origin` option from env.
 *
 * - `CORS_ORIGINS` set (comma-separated) → allowlist (or `*` → reflect any)
 * - production + empty → `false` (no CORS; same-origin dashboard still works)
 * - development / test + empty → `true` (reflect any Origin — convenient for local Vite)
 */
export function resolveCorsOrigin(env: Pick<Env, 'NODE_ENV' | 'CORS_ORIGINS'>): FastifyCorsOptions['origin'] {
  const raw = env.CORS_ORIGINS?.trim()
  if (raw) {
    const list = raw
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
    if (list.length === 0) {
      return env.NODE_ENV !== 'production'
    }
    if (list.includes('*')) return true
    return list
  }
  return env.NODE_ENV !== 'production'
}

/** Whether app-level rate limit should run (default: on in production only). */
export function isRateLimitEnabled(env: Pick<Env, 'NODE_ENV' | 'RATE_LIMIT_ENABLED'>): boolean {
  if (env.RATE_LIMIT_ENABLED !== undefined) return env.RATE_LIMIT_ENABLED
  return env.NODE_ENV === 'production'
}

/** True when this request path is under `/v1` (rate-limited surface). */
export function isV1ApiPath(url: string): boolean {
  const path = (url.split('?')[0] ?? '').replace(/\/+$/, '') || '/'
  return path === '/v1' || path.startsWith('/v1/')
}

/**
 * Resolve Fastify's `trustProxy` option from env.
 *
 * - `TRUST_PROXY` false → `false` (process is exposed directly; XFF is spoofable)
 * - `TRUST_PROXY_CIDRS` set → that allowlist, so only those peers are trusted
 * - otherwise → `true` (trust any peer)
 *
 * Hop counts are deliberately not supported: fastify 5.12.1 fails closed on a
 * numeric `trustProxy` because a hop count cannot validate the immediate peer,
 * which silently disabled `X-Forwarded-*` for everyone still passing one.
 */
export function resolveTrustProxy(env: Pick<Env, 'TRUST_PROXY' | 'TRUST_PROXY_CIDRS'>): boolean | string[] {
  if (!env.TRUST_PROXY) return false
  const list = (env.TRUST_PROXY_CIDRS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  return list.length > 0 ? list : true
}
