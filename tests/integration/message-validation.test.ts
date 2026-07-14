import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { ErrorBodySchema } from '~/http/openapi-schemas'
import { buildTestApp, createInstance, type TestApp } from '../helpers/test-app'

/**
 * Exhaustive validation matrix for message endpoints — ensures bad payloads
 * never hit zapo-js / WhatsApp and return a stable error envelope.
 */
describe('message endpoint validation matrix', () => {
  let ctx: TestApp
  let key: string
  let _name: string

  beforeAll(async () => {
    ctx = await buildTestApp()
    const inst = await createInstance(ctx.app, 'msg-val')
    key = inst.apiKey
    _name = inst.name
  })

  afterAll(async () => {
    await ctx.app.close()
  })

  async function post(path: string, payload: unknown) {
    return ctx.app.inject({
      method: 'POST',
      url: `/v1${path}`,
      headers: { 'x-api-key': key, 'content-type': 'application/json' },
      payload: payload as Record<string, unknown>,
    })
  }

  function expectValidation(res: { statusCode: number; json: () => unknown }) {
    expect(res.statusCode).toBeGreaterThanOrEqual(400)
    expect(res.statusCode).toBeLessThan(500)
    expect(ErrorBodySchema.safeParse(res.json()).success).toBe(true)
  }

  it('text', async () => {
    expectValidation(await post('/messages/text', { to: '5511' }))
    expectValidation(await post('/messages/text', { text: 'x' }))
    expectValidation(await post('/messages/text', { to: '5511', text: '' }))
  })

  it('react', async () => {
    expectValidation(await post('/messages/react', { to: '5511', messageId: 'x' }))
    expectValidation(await post('/messages/react', { to: '5511', emoji: '👍' }))
  })

  it('edit', async () => {
    expectValidation(await post('/messages/edit', { to: '5511', messageId: 'x' }))
    expectValidation(await post('/messages/edit', { to: '5511', messageId: 'x', text: '' }))
  })

  it('revoke', async () => {
    expectValidation(await post('/messages/revoke', { to: '5511' }))
    expectValidation(await post('/messages/revoke', { messageId: 'x' }))
  })

  it('poll', async () => {
    expectValidation(await post('/messages/poll', { to: '5511', name: 'q', options: ['a'] }))
    expectValidation(
      await post('/messages/poll', {
        to: '5511',
        name: 'q',
        options: Array.from({ length: 13 }, (_, i) => `o${i}`),
      }),
    )
  })

  it('location', async () => {
    expectValidation(await post('/messages/location', { to: '5511', latitude: 1 }))
    expectValidation(await post('/messages/location', { to: '5511', longitude: 1 }))
  })

  it('image requires media source shape when invalid url', async () => {
    expectValidation(await post('/messages/image', { to: '5511999999999', mediaUrl: 'not-a-url' }))
  })

  it('reply requires quotedMessageId', async () => {
    expectValidation(await post('/messages/reply', { to: '5511', text: 'hi' }))
  })
})
