/**
 * HTTP-level Zod contract tests: invalid inputs → validation errors;
 * successful responses parse against public OpenAPI schemas.
 * Guards consumers of zapo-rest against accidental response shape breaks.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  ErrorBodySchema,
  HealthResponseSchema,
  InstanceListResponseSchema,
  InstanceResponseSchema,
  InstanceWithKeyResponseSchema,
  MeResponseSchema,
  OkSchema,
  QrResponseSchema,
} from '~/http/openapi-schemas'
import { ADMIN_KEY, buildTestApp, createInstance, type TestApp } from '../helpers/test-app'

describe('HTTP Zod contracts (dryRun app)', () => {
  let ctx: TestApp
  let instanceKey: string
  let instanceName: string

  beforeAll(async () => {
    ctx = await buildTestApp({ withWebhooks: true })
    const inst = await createInstance(ctx.app, 'contract-1')
    instanceKey = inst.apiKey
    instanceName = inst.name
  })

  afterAll(async () => {
    await ctx.app.close()
  })

  it('GET /health response matches HealthResponseSchema', async () => {
    const res = await ctx.app.inject({ method: 'GET', url: '/health' })
    expect(res.statusCode).toBe(200)
    expect(HealthResponseSchema.parse(res.json())).toEqual({ status: 'ok' })
  })

  it('GET /v1/me admin + instance shapes', async () => {
    const admin = await ctx.app.inject({
      method: 'GET',
      url: '/v1/me',
      headers: { 'x-api-key': ADMIN_KEY },
    })
    expect(admin.statusCode).toBe(200)
    expect(MeResponseSchema.parse(admin.json())).toEqual({ role: 'admin' })

    const inst = await ctx.app.inject({
      method: 'GET',
      url: '/v1/me',
      headers: { 'x-api-key': instanceKey },
    })
    expect(inst.statusCode).toBe(200)
    const parsed = MeResponseSchema.parse(inst.json())
    expect(parsed.role).toBe('instance')
    if (parsed.role === 'instance') {
      expect(parsed.instance.name).toBe(instanceName)
      expect(parsed.instance.apiKey).toBe(instanceKey)
      expect(parsed.instance).toHaveProperty('pushName')
      expect(parsed.instance).toHaveProperty('avatarUrl')
      expect(parsed.instance).toHaveProperty('status')
      expect(parsed.instance).toHaveProperty('createdAt')
      expect(parsed.instance).toHaveProperty('updatedAt')
    }
  })

  it('POST /v1/instances validates body and returns InstanceResponseSchema', async () => {
    const bad = await ctx.app.inject({
      method: 'POST',
      url: '/v1/instances',
      headers: { 'x-api-key': ADMIN_KEY, 'content-type': 'application/json' },
      payload: { name: 'invalid name!' },
    })
    expect(bad.statusCode).toBeGreaterThanOrEqual(400)
    expect(ErrorBodySchema.safeParse(bad.json()).success).toBe(true)

    const ok = await ctx.app.inject({
      method: 'POST',
      url: '/v1/instances',
      headers: { 'x-api-key': ADMIN_KEY, 'content-type': 'application/json' },
      payload: {
        name: 'contract-2',
        webhookUrl: 'https://example.com/hooks',
        webhookEvents: ['message', 'instance.connection'],
      },
    })
    expect(ok.statusCode).toBe(200)
    // Create is one of the only two responses that carry the plaintext key.
    const body = InstanceWithKeyResponseSchema.parse(ok.json())
    expect(body.instance.name).toBe('contract-2')
    expect(body.instance.webhookUrl).toBe('https://example.com/hooks')
    expect(body.instance.apiKey).toMatch(/^zr_/)
  })

  it('GET /v1/instances list matches InstanceListResponseSchema (admin)', async () => {
    const res = await ctx.app.inject({
      method: 'GET',
      url: '/v1/instances',
      headers: { 'x-api-key': ADMIN_KEY },
    })
    expect(res.statusCode).toBe(200)
    const list = InstanceListResponseSchema.parse(res.json())
    expect(list.instances.length).toBeGreaterThanOrEqual(1)
    for (const inst of list.instances) {
      expect(inst.name.length).toBeGreaterThan(0)
      // List includes apiKey (and profile fields) for admin.
      expect(inst).toHaveProperty('apiKey')
      expect(inst).toHaveProperty('pushName')
      expect(inst).toHaveProperty('avatarUrl')
      expect(inst.createdAt).toMatch(/^\d{4}-/)
    }
  })

  it('GET /v1/instances/:name QR endpoint shape', async () => {
    const res = await ctx.app.inject({
      method: 'GET',
      url: `/v1/instances/${instanceName}/qr`,
      headers: { 'x-api-key': instanceKey },
    })
    expect(res.statusCode).toBe(200)
    const qr = QrResponseSchema.parse(res.json())
    expect(['created', 'connecting', 'qr', 'pairing', 'open', 'close', 'logged_out']).toContain(qr.status)
  })

  it('POST messages/text rejects invalid body before touching WhatsApp', async () => {
    const missingText = await ctx.app.inject({
      method: 'POST',
      url: `/v1/instances/${instanceName}/messages/text`,
      headers: { 'x-api-key': instanceKey, 'content-type': 'application/json' },
      payload: { to: '5511999999999' },
    })
    expect(missingText.statusCode).toBeGreaterThanOrEqual(400)
    expect(ErrorBodySchema.safeParse(missingText.json()).success).toBe(true)

    const missingTo = await ctx.app.inject({
      method: 'POST',
      url: `/v1/instances/${instanceName}/messages/text`,
      headers: { 'x-api-key': instanceKey, 'content-type': 'application/json' },
      payload: { text: 'oi' },
    })
    expect(missingTo.statusCode).toBeGreaterThanOrEqual(400)
  })

  it('POST messages/* require instance access (403 other key)', async () => {
    const other = await createInstance(ctx.app, 'contract-other')
    const res = await ctx.app.inject({
      method: 'POST',
      url: `/v1/instances/${instanceName}/messages/text`,
      headers: { 'x-api-key': other.apiKey, 'content-type': 'application/json' },
      payload: { to: '5511999999999', text: 'nope' },
    })
    expect(res.statusCode).toBe(403)
    expect(ErrorBodySchema.parse(res.json()).error.code).toMatch(/FORBIDDEN|forbidden/i)
  })

  it('webhook create validates URL and returns public webhook shape', async () => {
    const bad = await ctx.app.inject({
      method: 'POST',
      url: `/v1/instances/${instanceName}/webhooks`,
      headers: { 'x-api-key': instanceKey, 'content-type': 'application/json' },
      payload: { url: 'not-https' },
    })
    expect(bad.statusCode).toBeGreaterThanOrEqual(400)

    const ok = await ctx.app.inject({
      method: 'POST',
      url: `/v1/instances/${instanceName}/webhooks`,
      headers: { 'x-api-key': instanceKey, 'content-type': 'application/json' },
      payload: {
        url: 'https://webhook.site/zapo-contract',
        events: ['message', 'message.any'],
        hmac: { key: 'hmac-secret-min' },
        retries: { policy: 'exponential', delaySeconds: 2, attempts: 4 },
        customHeaders: [{ name: 'X-Env', value: 'test' }],
      },
    })
    expect(ok.statusCode).toBe(200)
    const body = ok.json() as {
      webhook: {
        id: string
        url: string
        events: string[]
        hmac: { configured: true } | null
        retries: { policy: string; attempts: number }
        enabled: boolean
        createdAt: string
      }
    }
    expect(body.webhook.url).toBe('https://webhook.site/zapo-contract')
    expect(body.webhook.hmac).toEqual({ configured: true })
    expect(body.webhook.retries.policy).toBe('exponential')
    expect(body.webhook.createdAt).toMatch(/^\d{4}-/)

    const list = await ctx.app.inject({
      method: 'GET',
      url: `/v1/instances/${instanceName}/webhooks`,
      headers: { 'x-api-key': instanceKey },
    })
    expect(list.statusCode).toBe(200)
    const listed = list.json() as { webhooks: unknown[]; availableEvents: string[] }
    expect(listed.webhooks.length).toBeGreaterThanOrEqual(1)
    expect(listed.availableEvents).toContain('message')
  })

  it('instance connect ok schema (dryRun)', async () => {
    const res = await ctx.app.inject({
      method: 'POST',
      url: `/v1/instances/${instanceName}/connect`,
      headers: { 'x-api-key': instanceKey },
    })
    // dryRun may return 200 ok or 503 if connect path expects client — accept documented shapes
    if (res.statusCode === 200) {
      expect(OkSchema.safeParse(res.json()).success || InstanceResponseSchema.safeParse(res.json()).success).toBe(true)
    } else {
      expect(ErrorBodySchema.safeParse(res.json()).success).toBe(true)
    }
  })

  it('Authorization Bearer works same as X-Api-Key for me', async () => {
    const res = await ctx.app.inject({
      method: 'GET',
      url: '/v1/me',
      headers: { authorization: `Bearer ${ADMIN_KEY}` },
    })
    expect(res.statusCode).toBe(200)
    expect(MeResponseSchema.parse(res.json()).role).toBe('admin')
  })
})
