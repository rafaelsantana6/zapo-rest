import { EventEmitter } from 'node:events'
import type pg from 'pg'
import { describe, expect, it, vi } from 'vitest'
import type { WaAppStateMutationEvent } from 'zapo-js'
import { EventProcessor, type EventProcessorDeps } from '~/events/processor'
import { InstanceManager } from '~/instances/manager'
import { MUTE_FOREVER_MS } from '~/lib/chat-actions'
import { toPublicChat } from '~/store/chats'
import { makeEnv } from '../helpers/fixtures'
import { MemoryInstanceRepo } from '../helpers/memory-repo'
import {
  MemoryChatStore,
  MemoryContactStore,
  MemoryIdempotencyStore,
  MemoryLidMapStore,
  MemoryMediaStorage,
  MemoryMessageStore,
} from '../helpers/memory-stores'

function recordingChatWebhooks() {
  return { emit: vi.fn(async (_row: unknown, _event: string, _payload: unknown) => undefined) }
}

function fakeMutation(fields: Record<string, unknown>): WaAppStateMutationEvent {
  return {
    operation: 'set',
    source: 'patch',
    collection: 'regular_low',
    version: 1,
    timestamp: Date.now(),
    _raw: { index: '[]', indexParts: [], value: null },
    ...fields,
  } as unknown as WaAppStateMutationEvent
}

function processorContext() {
  const repo = new MemoryInstanceRepo()
  repo.seed({ name: 'events', apiKey: 'zr_events' })
  const messages = new MemoryMessageStore()
  const chats = new MemoryChatStore(messages)
  const lidMap = new MemoryLidMapStore()
  const webhooks = recordingChatWebhooks()
  const deps = {
    env: makeEnv(),
    instanceRepo: repo,
    messages,
    chats,
    contacts: new MemoryContactStore(),
    idempotency: new MemoryIdempotencyStore(),
    lidMap,
    mediaStorage: new MemoryMediaStorage(),
    webhooks,
  }
  const processor = new EventProcessor(deps as unknown as EventProcessorDeps)
  return { repo, messages, chats, lidMap, webhooks, processor, env: deps.env }
}
const jid = '5511999999999@s.whatsapp.net'

describe('phone chat app-state projections', () => {
  it.each([
    [
      { schema: 'Pin', pinned: true },
      { pinned: 1, archived: false },
    ],
    [{ schema: 'Pin', pinned: false }, { pinned: 0 }],
    [
      { schema: 'Mute', muted: true, muteEndTimestamp: MUTE_FOREVER_MS },
      { muted: true, muteEndMs: MUTE_FOREVER_MS },
    ],
    [
      { schema: 'Mute', muted: false },
      { muted: false, muteUntil: null },
    ],
    [
      { schema: 'LockChat', locked: true },
      { locked: true, pinned: 0, archived: false },
    ],
    [{ schema: 'LockChat', locked: false }, { locked: false }],
    [
      { schema: 'Archive', archived: true },
      { archived: true, pinned: 0 },
    ],
  ])('projects and publishes %j', async (fields, expected) => {
    const ctx = processorContext()
    await ctx.chats.upsert({
      instanceName: 'events',
      chatJid: jid,
      pinned: 1,
      archived: true,
      muteEndMs: MUTE_FOREVER_MS,
    })
    await ctx.processor.onAppStateMutation('events', fakeMutation({ ...fields, chatJid: jid }))
    const stored = await ctx.chats.get('events', jid)
    expect(stored && toPublicChat(stored)).toMatchObject(expected)
    expect(ctx.webhooks.emit).toHaveBeenCalledWith(
      expect.anything(),
      'chat.update',
      expect.objectContaining({ chatId: jid, ...expected }),
    )
  })

  it('maps phone LID changes into the canonical chat', async () => {
    const ctx = processorContext()
    await ctx.lidMap.save('events', '111@lid', jid)
    await ctx.processor.onAppStateMutation('events', fakeMutation({ schema: 'Pin', chatJid: '111@lid', pinned: true }))
    expect((await ctx.chats.get('events', jid))?.pinned).toBe(1)
    expect(await ctx.chats.get('events', '111@lid')).toBeNull()
  })

  it('unsets flags on a remove mutation', async () => {
    const ctx = processorContext()
    for (const fields of [
      { schema: 'Pin', pinned: true },
      { schema: 'Mute', muted: true },
      { schema: 'LockChat', locked: true },
    ]) {
      await ctx.processor.onAppStateMutation('events', fakeMutation({ ...fields, chatJid: jid }))
      await ctx.processor.onAppStateMutation(
        'events',
        fakeMutation({ schema: fields.schema, operation: 'remove', chatJid: jid }),
      )
    }
    const stored = await ctx.chats.get('events', jid)
    expect(stored && toPublicChat(stored)).toMatchObject({ pinned: 0, muted: false, muteEndMs: null, locked: false })
  })

  it('reports expired mute as inactive without another event', async () => {
    const ctx = processorContext()
    await ctx.processor.onAppStateMutation(
      'events',
      fakeMutation({ schema: 'Mute', chatJid: jid, muted: true, muteEndTimestamp: 1000 }),
    )
    const stored = await ctx.chats.get('events', jid)
    expect(stored && toPublicChat(stored)).toMatchObject({ muted: false, muteUntil: null, muteEndMs: 1000 })
  })

  it('keeps settings when a new message upserts the chat', async () => {
    const ctx = processorContext()
    await ctx.chats.upsert({
      instanceName: 'events',
      chatJid: jid,
      locked: true,
      pinned: 1,
      muteEndMs: MUTE_FOREVER_MS,
    })
    await ctx.chats.upsert({ instanceName: 'events', chatJid: jid, lastMessageId: 'new', lastMessageTs: 1 })
    expect(await ctx.chats.get('events', jid)).toMatchObject({ locked: true, pinned: 1, muteEndMs: MUTE_FOREVER_MS })
  })

  it('ignores unrelated mutations and malformed mute epochs', async () => {
    const ctx = processorContext()
    await ctx.processor.onAppStateMutation(
      'events',
      fakeMutation({ schema: 'Mute', chatJid: jid, muted: true, muteEndTimestamp: 'bad' }),
    )
    await ctx.processor.onAppStateMutation('events', fakeMutation({ schema: 'Contact', id: jid }))
    expect(ctx.chats.byKey.size).toBe(0)
    expect(ctx.webhooks.emit).not.toHaveBeenCalled()
  })

  it('phone clear preserves starred and newer messages', async () => {
    const ctx = processorContext()
    await ctx.chats.upsert({ instanceName: 'events', chatJid: jid })
    for (const [messageId, timestampMs] of [
      ['old', 1000],
      ['star', 1000],
      ['new', 4000],
    ] as const) {
      const message = await ctx.messages.upsert({ instanceName: 'events', chatJid: jid, messageId, timestampMs })
      message.starred = messageId === 'star'
    }
    await ctx.processor.onAppStateMutation(
      'events',
      fakeMutation({
        schema: 'ClearChat',
        chatJid: jid,
        deleteStarred: '0',
        deleteMedia: '0',
        messageRange: { lastMessageTimestamp: 2 },
      }),
    )
    expect(await ctx.messages.get('events', 'old')).toBeNull()
    expect(await ctx.messages.get('events', 'star')).toBeTruthy()
    expect(await ctx.messages.get('events', 'new')).toBeTruthy()
    expect((await ctx.chats.get('events', jid))?.lastMessageId).toBe('new')
  })

  it('phone delete removes an empty chat and emits deletion', async () => {
    const ctx = processorContext()
    await ctx.chats.upsert({ instanceName: 'events', chatJid: jid })
    await ctx.messages.upsert({ instanceName: 'events', chatJid: jid, messageId: 'old', timestampMs: 1000 })
    await ctx.processor.onAppStateMutation(
      'events',
      fakeMutation({ schema: 'DeleteChat', chatJid: jid, deleteMedia: '0', messageRange: { lastMessageTimestamp: 2 } }),
    )
    expect(await ctx.chats.get('events', jid)).toBeNull()
    expect(ctx.messages.byKey.size).toBe(0)
    expect(ctx.webhooks.emit).toHaveBeenCalledWith(expect.anything(), 'chat.update', {
      chatId: jid,
      action: 'DeleteChat',
      deleted: true,
    })
  })

  it('phone delete-for-me removes only a matching message', async () => {
    const ctx = processorContext()
    await ctx.messages.upsert({ instanceName: 'events', chatJid: jid, messageId: 'm', fromMe: true })
    await ctx.processor.onAppStateMutation(
      'events',
      fakeMutation({ schema: 'DeleteMessageForMe', remote: jid, id: 'm', fromMe: false, participant: null }),
    )
    expect(await ctx.messages.get('events', 'm')).toBeTruthy()
    await ctx.processor.onAppStateMutation(
      'events',
      fakeMutation({ schema: 'DeleteMessageForMe', remote: jid, id: 'm', fromMe: true, participant: null }),
    )
    expect(await ctx.messages.get('events', 'm')).toBeNull()
  })

  it('phone stars survive clear while unstarred messages are removed', async () => {
    const ctx = processorContext()
    await ctx.messages.upsert({ instanceName: 'events', chatJid: jid, messageId: 'star', timestampMs: 1000 })
    await ctx.processor.onAppStateMutation(
      'events',
      fakeMutation({ schema: 'Star', remote: jid, id: 'star', fromMe: false, participant: null, starred: true }),
    )
    await ctx.processor.onAppStateMutation(
      'events',
      fakeMutation({
        schema: 'ClearChat',
        chatJid: jid,
        deleteStarred: '0',
        messageRange: { lastMessageTimestamp: 2 },
      }),
    )
    expect((await ctx.messages.get('events', 'star'))?.starred).toBe(true)
  })

  it('does not emit a duplicate chat.update for a replayed mutation', async () => {
    const ctx = processorContext()
    const event = fakeMutation({ schema: 'Pin', chatJid: jid, pinned: true })
    await ctx.processor.onAppStateMutation('events', event)
    await ctx.processor.onAppStateMutation('events', event)
    expect(ctx.webhooks.emit).toHaveBeenCalledTimes(1)
  })

  it('InstanceManager wires the inbound mutation through the processor', async () => {
    const ctx = processorContext()
    const manager = new InstanceManager({
      env: ctx.env,
      pool: {} as pg.Pool,
      repo: ctx.repo as never,
      webhooks: ctx.webhooks as never,
      events: ctx.processor,
      dryRun: true,
    })
    const client = new EventEmitter()
    const wire = (manager as unknown as { wireEvents: (name: string, session: unknown) => void }).wireEvents
    wire.call(manager, 'events', { client, disposed: false })
    client.emit('mutation', fakeMutation({ schema: 'Pin', chatJid: jid, pinned: true }))
    await vi.waitFor(() => expect(ctx.webhooks.emit).toHaveBeenCalled())
    expect((await ctx.chats.get('events', jid))?.pinned).toBe(1)
  })
})
