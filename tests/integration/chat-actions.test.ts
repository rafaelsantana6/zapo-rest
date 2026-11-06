import type { InjectOptions } from 'fastify'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { MUTE_FOREVER_MS } from '~/lib/chat-actions'
import { MemoryChatStore, MemoryLidMapStore, MemoryMessageStore } from '../helpers/memory-stores'
import { ADMIN_KEY, buildTestApp, createInstance, type TestApp } from '../helpers/test-app'

function fakeChatActions() {
  return {
    setMessageStar: vi.fn<(...args: unknown[]) => Promise<void>>(async () => undefined),
    setChatPin: vi.fn<(...args: unknown[]) => Promise<void>>(async () => undefined),
    setChatMute: vi.fn<(...args: unknown[]) => Promise<void>>(async () => undefined),
    setChatLock: vi.fn<(...args: unknown[]) => Promise<void>>(async () => undefined),
    clearChat: vi.fn<(...args: unknown[]) => Promise<void>>(async () => undefined),
    deleteChat: vi.fn<(...args: unknown[]) => Promise<void>>(async () => undefined),
    deleteMessageForMe: vi.fn<(...args: unknown[]) => Promise<void>>(async () => undefined),
  }
}

const jid = '5511999999999@s.whatsapp.net'
const instanceName = 'chat-actions'

describe('chat action routes', () => {
  let ctx: TestApp
  let apiKey: string
  const chat = fakeChatActions()
  const messages = new MemoryMessageStore()
  const chats = new MemoryChatStore(messages)
  const lidMap = new MemoryLidMapStore()
  const request = (method: InjectOptions['method'], suffix: string, payload?: InjectOptions['payload'], chatId = jid) =>
    ctx.app.inject({
      method,
      url: `/v1/chats/${encodeURIComponent(chatId)}${suffix}`,
      headers: { 'x-api-key': apiKey },
      payload,
    })

  beforeAll(async () => {
    ctx = await buildTestApp({ chats: chats as never, messages: messages as never, lidMap: lidMap as never })
    apiKey = (await createInstance(ctx.app, instanceName)).apiKey
    vi.spyOn(ctx.manager, 'requireRegisteredClient').mockReturnValue({ chat } as never)
  })
  beforeEach(async () => {
    vi.clearAllMocks()
    chats.byKey.clear()
    messages.byKey.clear()
    messages.actions.clear()
    await chats.upsert({ instanceName, chatJid: jid, archived: true, pinned: 0 })
  })
  afterAll(async () => {
    await ctx.app.close()
  })

  it('pins a phone and unarchives it; GET/list expose flags', async () => {
    const result = await request('POST', '/pin', { pinned: true }, '5511999999999')
    expect(result.statusCode).toBe(200)
    expect(chat.setChatPin).toHaveBeenCalledWith(jid, true)
    expect(result.json().chat).toMatchObject({
      pinned: 1,
      archived: false,
      muted: false,
      muteUntil: null,
      locked: false,
    })
    expect((await request('GET', '')).json().chat.pinned).toBe(1)
    const list = await ctx.app.inject({ method: 'GET', url: '/v1/chats', headers: { 'x-api-key': apiKey } })
    expect(list.json().chats[0]).toMatchObject({ pinned: 1, muted: false, locked: false })
    expect((await request('POST', '/pin', { pinned: false })).json().chat.pinned).toBe(0)
  })

  it.each(['120363@g.us', '12345@lid', '5511999999999@s.whatsapp.net'])('normalizes %s for pin', async (chatId) => {
    expect((await request('POST', '/pin', { pinned: true }, chatId)).statusCode).toBe(200)
    expect(chat.setChatPin).toHaveBeenCalledWith(chatId, true)
  })

  it('maps a LID alias to its canonical PN', async () => {
    await lidMap.save(instanceName, '999@lid', jid)
    expect((await request('POST', '/pin', { pinned: true }, '999@lid')).statusCode).toBe(200)
    expect(chat.setChatPin).toHaveBeenCalledWith(jid, true)
  })

  it('mutes forever and unmutes', async () => {
    expect((await request('POST', '/mute', { muted: true })).json().chat.muted).toBe(true)
    expect(chat.setChatMute).toHaveBeenLastCalledWith(jid, true, MUTE_FOREVER_MS)
    const unmute = await request('POST', '/mute', { muted: false })
    expect(unmute.statusCode).toBe(200)
    expect(unmute.json().chat).toMatchObject({ muted: false, muteUntil: null, muteEndMs: null })
    expect(chat.setChatMute).toHaveBeenLastCalledWith(jid, false, undefined)
  })

  it('maps ISO and duration mute timers', async () => {
    const until = '2090-01-01T00:00:00Z'
    expect((await request('POST', '/mute', { muted: true, until })).statusCode).toBe(200)
    expect(chat.setChatMute).toHaveBeenLastCalledWith(jid, true, Date.parse(until))
    const before = Date.now()
    expect((await request('POST', '/mute', { muted: true, durationSeconds: 60 })).statusCode).toBe(200)
    const end = chat.setChatMute.mock.calls.at(-1)?.[2] as number
    expect(end).toBeGreaterThanOrEqual(before + 60000)
    expect(end).toBeLessThanOrEqual(Date.now() + 60000)
  })

  it('locks and unlocks, clearing archive and pin', async () => {
    await chats.upsert({ instanceName, chatJid: jid, pinned: 1 })
    const lock = await request('POST', '/lock', { locked: true })
    expect(lock.statusCode).toBe(200)
    expect(chat.setChatLock).toHaveBeenCalledWith(jid, true)
    expect(lock.json().chat).toMatchObject({ locked: true, archived: false, pinned: 0 })
    expect((await request('POST', '/lock', { locked: false })).json().chat.locked).toBe(false)
  })

  it('keeps messages starred through REST when clearing chat', async () => {
    await messages.upsert({ instanceName, chatJid: jid, messageId: 'starred' })
    const star = await ctx.app.inject({
      method: 'POST',
      url: '/v1/messages/star',
      headers: { 'x-api-key': apiKey },
      payload: { chatId: jid, messageId: 'starred', starred: true },
    })
    expect(star.statusCode).toBe(200)
    await messages.upsert({ instanceName, chatJid: jid, messageId: 'starred' })
    expect((await request('POST', '/clear')).statusCode).toBe(200)
    expect((await messages.get(instanceName, 'starred'))?.starred).toBe(true)
  })

  it('clear preserves starred rows by default and refreshes preview', async () => {
    await messages.upsert({ instanceName, chatJid: jid, messageId: 'old', body: 'keep', timestampMs: 1 })
    const starred = await messages.get(instanceName, 'old')
    if (starred) starred.starred = true
    await messages.upsert({ instanceName, chatJid: jid, messageId: 'new', timestampMs: 2 })
    const clear = await request('POST', '/clear')
    expect(clear.statusCode, clear.body).toBe(200)
    expect(chat.clearChat).toHaveBeenCalledWith(jid, {})
    expect(await messages.get(instanceName, 'new')).toBeNull()
    expect((await chats.get(instanceName, jid))?.lastMessageId).toBe('old')
    expect((await request('POST', '/clear', { deleteStarred: true, deleteMedia: true })).statusCode).toBe(200)
    expect(chat.clearChat).toHaveBeenLastCalledWith(jid, { deleteStarred: true, deleteMedia: true })
    expect(await messages.get(instanceName, 'old')).toBeNull()
    expect((await chats.get(instanceName, jid))?.lastMessageId).toBeNull()
  })

  it('remote delete removes chats/messages and aliases, preserving another instance', async () => {
    await lidMap.save(instanceName, '999@lid', jid)
    for (const chatJid of [jid, '999@lid']) {
      await chats.upsert({ instanceName, chatJid })
      await messages.upsert({ instanceName, chatJid, messageId: chatJid })
    }
    await messages.upsert({ instanceName: 'other', chatJid: jid, messageId: 'other' })
    const result = await request('POST', '/delete', { deleteMedia: true })
    expect(result.statusCode).toBe(200)
    expect(chat.deleteChat).toHaveBeenCalledWith(jid, { deleteMedia: true })
    expect(await chats.get(instanceName, jid)).toBeNull()
    expect(await chats.get(instanceName, '999@lid')).toBeNull()
    expect(messages.byKey.size).toBe(1)
  })

  it.each(['clear', 'delete'])('%s preserves a message that arrives while upstream flushes', async (action) => {
    await messages.upsert({ instanceName, chatJid: jid, messageId: 'old', timestampMs: 1000 })
    chat[action === 'clear' ? 'clearChat' : 'deleteChat'].mockImplementationOnce(async () => {
      await messages.upsert({ instanceName, chatJid: jid, messageId: 'concurrent', timestampMs: Date.now() + 1000 })
    })
    expect((await request('POST', `/${action}`)).statusCode).toBe(200)
    expect(await messages.get(instanceName, 'old')).toBeNull()
    expect(await messages.get(instanceName, 'concurrent')).toBeTruthy()
    expect((await chats.get(instanceName, jid))?.lastMessageId).toBe('concurrent')
  })

  it('legacy DELETE only removes the chat projection', async () => {
    await messages.upsert({ instanceName, chatJid: jid, messageId: 'local' })
    expect((await request('DELETE', '')).statusCode).toBe(200)
    expect(chat.deleteChat).not.toHaveBeenCalled()
    expect(await chats.get(instanceName, jid)).toBeNull()
    expect(await messages.get(instanceName, 'local')).toBeTruthy()
  })

  it.each([false, true])('delete-for-me uses the stored group key (fromMe=%s)', async (fromMe) => {
    const group = '120363@g.us'
    await messages.upsert({
      instanceName,
      chatJid: group,
      messageId: 'group',
      fromMe,
      participantJid: '111@lid',
      timestampMs: 1234,
    })
    expect((await request('DELETE', '/messages/group/for-me?deleteMedia=true', undefined, group)).statusCode).toBe(200)
    expect(chat.deleteMessageForMe).toHaveBeenCalledWith(
      { chatJid: group, id: 'group', fromMe, participantJid: '111@lid' },
      { deleteMedia: true, messageTimestampMs: 1234 },
    )
    expect(await messages.get(instanceName, 'group')).toBeNull()
  })

  it('delete-for-me refreshes preview without marking the chat read', async () => {
    await chats.upsert({ instanceName, chatJid: jid, unreadCount: 5 })
    await messages.upsert({ instanceName, chatJid: jid, messageId: 'older', timestampMs: 1000 })
    await messages.upsert({ instanceName, chatJid: jid, messageId: 'newer', timestampMs: 2000 })
    expect((await request('DELETE', '/messages/newer/for-me')).statusCode).toBe(200)
    expect(await chats.get(instanceName, jid)).toMatchObject({ unreadCount: 5, lastMessageId: 'older' })
  })

  it('rejects missing messages and messages from another chat', async () => {
    await messages.upsert({ instanceName, chatJid: '120363@g.us', messageId: 'foreign' })
    expect((await request('DELETE', '/messages/foreign/for-me')).statusCode).toBe(404)
    expect((await request('DELETE', '/messages/missing/for-me')).statusCode).toBe(404)
    expect(chat.deleteMessageForMe).not.toHaveBeenCalled()
  })

  it.each([
    ['/pin', {}],
    ['/pin', { pinned: 'yes' }],
    ['/lock', { locked: 1 }],
    ['/mute', { muted: true, until: 'invalid' }],
    ['/mute', { muted: true, until: '2000-01-01T00:00:00Z' }],
    ['/mute', { muted: true, durationSeconds: 0 }],
    ['/mute', { muted: true, durationSeconds: 1, until: '2090-01-01T00:00:00Z' }],
    ['/mute', { muted: false, durationSeconds: 1 }],
    ['/clear', { deleteStarred: 'true' }],
    ['/delete', { deleteMedia: 1 }],
  ])('rejects malformed body on %s', async (path, payload) => {
    expect((await request('POST', path, payload)).statusCode).toBe(400)
  })

  it.each([
    ['/pin', { pinned: true }, 'setChatPin'],
    ['/mute', { muted: true }, 'setChatMute'],
    ['/lock', { locked: true }, 'setChatLock'],
    ['/clear', {}, 'clearChat'],
    ['/delete', {}, 'deleteChat'],
  ] as const)('maps upstream conflicts without changing projection: %s', async (path, payload, method) => {
    await messages.upsert({ instanceName, chatJid: jid, messageId: 'keep' })
    const before = structuredClone(await chats.get(instanceName, jid))
    chat[method].mockRejectedValueOnce(new Error('app-state collection BLOCKED'))
    const result = await request('POST', path, payload)
    expect(result.statusCode).toBe(409)
    expect(result.body).toContain('BLOCKED')
    expect(await chats.get(instanceName, jid)).toEqual(before)
    expect(await messages.get(instanceName, 'keep')).toBeTruthy()
  })

  it('maps disconnected upstream to 503', async () => {
    chat.setChatMute.mockRejectedValueOnce(new Error('client not connected'))
    expect((await request('POST', '/mute', { muted: true })).statusCode).toBe(503)
  })

  it('delete-for-me keeps the row on upstream failure', async () => {
    await messages.upsert({ instanceName, chatJid: jid, messageId: 'keep' })
    chat.deleteMessageForMe.mockRejectedValueOnce(new Error('app-state conflict'))
    expect((await request('DELETE', '/messages/keep/for-me')).statusCode).toBe(409)
    expect(await messages.get(instanceName, 'keep')).toBeTruthy()
  })

  it('documents optional clear/delete bodies and required flag bodies', () => {
    const spec = ctx.app.swagger()
    for (const action of ['clear', 'delete']) {
      expect(spec.paths?.[`/v1/chats/{chatId}/${action}`]?.post).toHaveProperty('requestBody.required', false)
    }
    expect(spec.paths?.['/v1/chats/{chatId}/pin']?.post).toHaveProperty('requestBody.required', true)
  })

  it('requires an instance key', async () => {
    for (const key of [undefined, ADMIN_KEY]) {
      const result = await ctx.app.inject({
        method: 'POST',
        url: `/v1/chats/${jid}/pin`,
        headers: key ? { 'x-api-key': key } : {},
        payload: { pinned: true },
      })
      expect(result.statusCode).toBe(key ? 403 : 401)
    }
  })
})
