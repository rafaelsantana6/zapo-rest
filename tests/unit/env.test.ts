import { afterEach, describe, expect, it } from 'vitest'
import { parseEnv, resetEnvCache } from '~/config/env'

describe('parseEnv', () => {
  afterEach(() => {
    resetEnvCache()
  })

  it('parses valid env', () => {
    const env = parseEnv({
      NODE_ENV: 'test',
      ADMIN_API_KEY: 'test-admin-api-key-min-16',
      DATABASE_URL: 'postgresql://zapo:zapo@localhost:5432/zapo',
      AUTO_CONNECT_ON_BOOT: 'false',
    })
    expect(env.PORT).toBe(3000)
    expect(env.AUTO_CONNECT_ON_BOOT).toBe(false)
    expect(env.ADMIN_API_KEY.length).toBeGreaterThanOrEqual(16)
  })

  it('fails on short admin key', () => {
    expect(() =>
      parseEnv({
        ADMIN_API_KEY: 'short',
        DATABASE_URL: 'postgresql://zapo:zapo@localhost:5432/zapo',
      }),
    ).toThrow(/Invalid environment/)
  })

  it('treats empty STT_API_URL / STT_API_KEY as unset (compose injects "")', () => {
    const env = parseEnv({
      NODE_ENV: 'test',
      ADMIN_API_KEY: 'test-admin-api-key-min-16',
      DATABASE_URL: 'postgresql://zapo:zapo@localhost:5432/zapo',
      STT_ENABLED: 'false',
      STT_API_URL: '',
      STT_API_KEY: '',
      STT_MODEL: '',
      STT_LANGUAGE: '  ',
    })
    expect(env.STT_ENABLED).toBe(false)
    expect(env.STT_API_URL).toBeUndefined()
    expect(env.STT_API_KEY).toBeUndefined()
    expect(env.STT_MODEL).toBeUndefined()
    expect(env.STT_LANGUAGE).toBeUndefined()
  })

  it('accepts a valid STT_API_URL when set', () => {
    const env = parseEnv({
      NODE_ENV: 'test',
      ADMIN_API_KEY: 'test-admin-api-key-min-16',
      DATABASE_URL: 'postgresql://zapo:zapo@localhost:5432/zapo',
      STT_ENABLED: 'true',
      STT_API_URL: 'https://api.groq.com/openai',
      STT_API_KEY: 'gsk_test',
    })
    expect(env.STT_ENABLED).toBe(true)
    expect(env.STT_API_URL).toBe('https://api.groq.com/openai')
    expect(env.STT_API_KEY).toBe('gsk_test')
  })
})
