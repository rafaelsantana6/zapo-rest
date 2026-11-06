import { describe, expect, it } from 'vitest'
import { parseEnv } from '~/config/env'
import { storeCacheLayer } from '~/instances/client-factory'

const baseEnv = {
  NODE_ENV: 'test',
  ADMIN_API_KEY: 'test-admin-api-key-min-16',
  DATABASE_URL: 'postgresql://zapo:zapo@localhost:5432/zapo',
}

describe('storeCacheLayer', () => {
  it('is off by default', () => {
    const env = parseEnv(baseEnv)
    expect(env.STORE_L1_CACHE).toBe(false)
    expect(env.STORE_L1_IDLE_TTL_SECONDS).toBe(1800)
    expect(storeCacheLayer(env)).toBeUndefined()
  })

  it('caches the crypto-path domains with the idle TTL in ms', () => {
    const layer = storeCacheLayer({ STORE_L1_CACHE: true, STORE_L1_IDLE_TTL_SECONDS: 600 })
    expect(layer).toEqual({
      session: true,
      identity: true,
      senderKey: true,
      privacyToken: true,
      ttlMs: { sessionMs: 600_000, identityMs: 600_000, senderKeyMs: 600_000, privacyTokenMs: 600_000 },
    })
  })

  it('leaves eviction to the size cap when the TTL is 0', () => {
    const layer = storeCacheLayer({ STORE_L1_CACHE: true, STORE_L1_IDLE_TTL_SECONDS: 0 })
    expect(layer).not.toHaveProperty('ttlMs')
    expect(layer?.session).toBe(true)
  })
})
