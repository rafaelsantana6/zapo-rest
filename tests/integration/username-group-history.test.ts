import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { buildTestApp, createInstance, type TestApp } from '../helpers/test-app'

describe('username and group history routes', () => {
  let ctx: TestApp
  let apiKey = ''
  const profile = {
    getOwnUsername: vi.fn(async () => ({ username: 'loja', state: 'ACTIVE', pin: '1234' })),
    setUsername: vi.fn(async () => true),
    deleteUsername: vi.fn(async () => true),
    checkUsernameAvailability: vi.fn(async () => ({ available: false, suggestions: ['loja2'] })),
    resolveUsername: vi.fn(async () => ({
      status: 'found' as const,
      jid: 'abc@lid',
      username: 'loja',
      isBusiness: false,
      pnJid: '5511999999999@s.whatsapp.net',
    })),
  }
  const shareGroupHistory = vi.fn(async () => ({
    bundleMessageId: 'B1',
    noticeMessageId: 'N1',
    messagesCount: 3,
    historyReceivers: ['abc@lid'],
    nonHistoryReceivers: [],
  }))

  beforeAll(async () => {
    ctx = await buildTestApp()
    const created = await createInstance(ctx.app, 'sales-user')
    apiKey = created.apiKey
    vi.spyOn(ctx.manager, 'requireRegisteredClient').mockReturnValue({
      profile,
      message: { shareGroupHistory },
    } as never)
  })

  afterAll(async () => {
    await ctx.app.close()
  })

  it('returns the own handle and hides the recovery pin', async () => {
    const res = await ctx.app.inject({
      method: 'GET',
      url: '/v1/profile/username',
      headers: { 'x-api-key': apiKey },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ username: 'loja', state: 'ACTIVE' })
    expect(res.json()).not.toHaveProperty('pin')
  })

  it('sets a username and conflicts when the server rejects it', async () => {
    const ok = await ctx.app.inject({
      method: 'PUT',
      url: '/v1/profile/username',
      headers: { 'x-api-key': apiKey, 'content-type': 'application/json' },
      payload: { username: '@loja' },
    })
    expect(ok.statusCode).toBe(200)
    expect(profile.setUsername).toHaveBeenCalledWith({ username: 'loja' })

    profile.setUsername.mockResolvedValueOnce(false)
    const taken = await ctx.app.inject({
      method: 'PUT',
      url: '/v1/profile/username',
      headers: { 'x-api-key': apiKey, 'content-type': 'application/json' },
      payload: { username: 'taken' },
    })
    expect(taken.statusCode).toBe(409)
  })

  it('checks availability and resolves a handle', async () => {
    const check = await ctx.app.inject({
      method: 'GET',
      url: '/v1/profile/username/check?username=loja',
      headers: { 'x-api-key': apiKey },
    })
    expect(check.statusCode).toBe(200)
    expect(check.json()).toEqual({ available: false, suggestions: ['loja2'] })

    const resolved = await ctx.app.inject({
      method: 'POST',
      url: '/v1/profile/username/resolve',
      headers: { 'x-api-key': apiKey, 'content-type': 'application/json' },
      payload: { username: '@loja', usernameKey: '99' },
    })
    expect(resolved.statusCode).toBe(200)
    expect(resolved.json()).toMatchObject({ status: 'found', jid: 'abc@lid' })
    expect(profile.resolveUsername).toHaveBeenCalledWith({ username: '@loja', usernameKey: '99' })
  })

  it('shares group history with a resolved member', async () => {
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/v1/groups/120363/share-history',
      headers: { 'x-api-key': apiKey, 'content-type': 'application/json' },
      payload: { to: ['abc@lid'], count: 10 },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({ bundleMessageId: 'B1', messagesCount: 3 })
    expect(shareGroupHistory).toHaveBeenCalledWith('120363@g.us', { toJids: ['abc@lid'], count: 10 })
  })

  it('turns a share rejection into 400', async () => {
    shareGroupHistory.mockRejectedValueOnce(new Error('account is not allowed to share group history'))
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/v1/groups/120363@g.us/share-history',
      headers: { 'x-api-key': apiKey, 'content-type': 'application/json' },
      payload: { to: ['abc@lid'] },
    })
    expect(res.statusCode).toBe(400)
    expect(res.json().error.message).toMatch(/not allowed/)
  })
})
