/**
 * Validation matrices for Groups / Contacts / Presence — bad payloads never hit WA.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { ErrorBodySchema } from '~/http/openapi-schemas'
import { buildTestApp, createInstance, type TestApp } from '../helpers/test-app'

describe('groups / contacts / presence validation matrix', () => {
  let ctx: TestApp
  let key: string
  let name: string

  beforeAll(async () => {
    ctx = await buildTestApp()
    const inst = await createInstance(ctx.app, 'gcp-val')
    key = inst.apiKey
    name = inst.name
  })

  afterAll(async () => {
    await ctx.app.close()
  })

  async function inject(method: 'POST' | 'PUT', path: string, payload: unknown) {
    return ctx.app.inject({
      method,
      url: `/v1/instances/${name}${path}`,
      headers: { 'x-api-key': key, 'content-type': 'application/json' },
      payload: payload as Record<string, unknown>,
    })
  }

  async function post(path: string, payload: unknown) {
    return inject('POST', path, payload)
  }

  function expectValidation(res: { statusCode: number; json: () => unknown }) {
    // Prefer real schema validation (400). Wrong paths used to soft-pass via 404,
    // which broke in CI when dashboard/docs dist is absent (no SPA notFound envelope).
    expect(res.statusCode).toBe(400)
    expect(ErrorBodySchema.safeParse(res.json()).success).toBe(true)
  }

  describe('presence', () => {
    it('rejects invalid presence type', async () => {
      expectValidation(await post('/presence', { type: 'away' }))
      expectValidation(await post('/presence', {}))
    })

    it('rejects invalid chatstate', async () => {
      expectValidation(
        await ctx.app.inject({
          method: 'POST',
          url: `/v1/instances/${name}/chats/5511999999999/chatstate`,
          headers: { 'x-api-key': key, 'content-type': 'application/json' },
          payload: { state: 'flying' },
        }),
      )
      expectValidation(
        await ctx.app.inject({
          method: 'POST',
          url: `/v1/instances/${name}/chats/5511999999999/chatstate`,
          headers: { 'x-api-key': key, 'content-type': 'application/json' },
          payload: {},
        }),
      )
    })
  })

  describe('contacts', () => {
    it('jid builder requires numbers array', async () => {
      expectValidation(await post('/contacts/jid', {}))
      expectValidation(await post('/contacts/jid', { numbers: [] }))
    })

    it('resolve requires numbers bounds', async () => {
      expectValidation(await post('/contacts/resolve', { numbers: [] }))
      expectValidation(await post('/contacts/check', { phones: [] }))
      expectValidation(
        await post('/contacts/check', {
          phones: Array.from({ length: 51 }, () => '5511999999999'),
        }),
      )
    })

    it('block/unblock require jid', async () => {
      expectValidation(await post('/contacts/block', {}))
      expectValidation(await post('/contacts/unblock', { jid: '' }))
    })
  })

  describe('groups', () => {
    it('create requires subject + participants', async () => {
      expectValidation(await post('/groups', { subject: 'x' }))
      expectValidation(await post('/groups', { participants: ['5511'] }))
      expectValidation(await post('/groups', { subject: '', participants: ['5511'] }))
      expectValidation(
        await post('/groups', {
          subject: 'ok',
          participants: [],
        }),
      )
    })

    it('participant ops require non-empty arrays', async () => {
      const gid = '120363@g.us'
      const g = `/groups/${encodeURIComponent(gid)}`
      expectValidation(await post(`${g}/participants/add`, { participants: [] }))
      expectValidation(await post(`${g}/participants/remove`, { participants: [] }))
      // promote lives under /admin, not /participants
      expectValidation(await post(`${g}/admin/promote`, {}))
      expectValidation(await post(`${g}/admin/demote`, { participants: [] }))
    })

    it('subject / description / join code validation', async () => {
      const gid = '120363@g.us'
      const g = `/groups/${encodeURIComponent(gid)}`
      // subject is PUT
      expectValidation(await inject('PUT', `${g}/subject`, { subject: '' }))
      expectValidation(await inject('PUT', `${g}/description`, { description: 1 }))
      // join is POST /groups/join (no :groupId)
      expectValidation(await post('/groups/join', { code: '' }))
      expectValidation(await post('/groups/join', {}))
    })
  })

  describe('calls', () => {
    it('start call requires to', async () => {
      expectValidation(await post('/calls', {}))
      expectValidation(await post('/calls', { to: '' }))
    })

    it('mute requires boolean', async () => {
      expectValidation(
        await ctx.app.inject({
          method: 'POST',
          url: `/v1/instances/${name}/calls/fake-id/mute`,
          headers: { 'x-api-key': key, 'content-type': 'application/json' },
          payload: { muted: 'yes' },
        }),
      )
    })
  })

  describe('cross-instance forbidden', () => {
    it('other instance key cannot hit presence', async () => {
      const other = await createInstance(ctx.app, 'gcp-other')
      const res = await ctx.app.inject({
        method: 'POST',
        url: `/v1/instances/${name}/presence`,
        headers: { 'x-api-key': other.apiKey, 'content-type': 'application/json' },
        payload: { type: 'available' },
      })
      expect(res.statusCode).toBe(403)
      expect(ErrorBodySchema.parse(res.json()).error.code).toMatch(/FORBIDDEN/i)
    })
  })
})
