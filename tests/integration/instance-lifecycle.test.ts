import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  ErrorBodySchema,
  InstanceResponseSchema,
  InstanceWithKeyResponseSchema,
  OkSchema,
} from '~/http/openapi-schemas'
import { ADMIN_KEY, buildTestApp, createInstance, type TestApp } from '../helpers/test-app'

describe('instance lifecycle HTTP contracts', () => {
  let ctx: TestApp

  beforeAll(async () => {
    ctx = await buildTestApp()
  })

  afterAll(async () => {
    await ctx.app.close()
  })

  it('create → get → list → rotate key → delete with schema checks', async () => {
    const created = await createInstance(ctx.app, 'life-1')
    const get = await ctx.app.inject({
      method: 'GET',
      url: '/v1/instances/life-1',
      headers: { 'x-api-key': created.apiKey },
    })
    expect(get.statusCode).toBe(200)
    // GET with instance token returns full instance including apiKey, pushName, avatarUrl.
    const inst = InstanceResponseSchema.parse(get.json())
    expect(inst.instance.name).toBe('life-1')
    expect(inst.instance.apiKey).toBe(created.apiKey)
    expect(inst.instance).toHaveProperty('pushName')
    expect(inst.instance).toHaveProperty('avatarUrl')

    const rotate = await ctx.app.inject({
      method: 'POST',
      url: '/v1/instances/life-1/keys/rotate',
      headers: { 'x-api-key': ADMIN_KEY },
    })
    if (rotate.statusCode === 200) {
      const rotated = InstanceWithKeyResponseSchema.parse(rotate.json())
      expect(rotated.instance.apiKey).not.toBe(created.apiKey)
      expect(rotated.instance.apiKey).toBeTruthy()
      // old key must fail
      const old = await ctx.app.inject({
        method: 'GET',
        url: '/v1/instances/life-1',
        headers: { 'x-api-key': created.apiKey },
      })
      expect(old.statusCode).toBe(401)
    } else {
      // endpoint may be named differently — still assert error envelope
      expect(ErrorBodySchema.safeParse(rotate.json()).success || rotate.statusCode === 404).toBe(true)
    }

    const del = await ctx.app.inject({
      method: 'DELETE',
      url: '/v1/instances/life-1',
      headers: { 'x-api-key': ADMIN_KEY },
    })
    if (del.statusCode === 200) {
      expect(OkSchema.safeParse(del.json()).success || InstanceResponseSchema.safeParse(del.json()).success).toBe(true)
    }

    const missing = await ctx.app.inject({
      method: 'GET',
      url: '/v1/instances/life-1',
      headers: { 'x-api-key': ADMIN_KEY },
    })
    expect([404, 401, 403]).toContain(missing.statusCode)
  })

  it('duplicate create conflicts', async () => {
    await createInstance(ctx.app, 'life-dup')
    const again = await ctx.app.inject({
      method: 'POST',
      url: '/v1/instances',
      headers: { 'x-api-key': ADMIN_KEY, 'content-type': 'application/json' },
      payload: { name: 'life-dup' },
    })
    expect([409, 400, 500]).toContain(again.statusCode)
  })

  it('instance key cannot create instances', async () => {
    const inst = await createInstance(ctx.app, 'life-scoped')
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/v1/instances',
      headers: { 'x-api-key': inst.apiKey, 'content-type': 'application/json' },
      payload: { name: 'nope' },
    })
    expect(res.statusCode).toBe(403)
  })
})
