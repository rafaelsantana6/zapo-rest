import type pg from 'pg'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { ChatStore } from '~/store/chats'
import { MessageStore } from '~/store/messages'
import { LidMapStore } from '~/store/lid-map'
import { reconcileLidChats } from '~/store/chat-reconcile'
import { seedInstance, tryCreateTestPool, uniqueName, wipeInstance } from '../helpers/pg'

const pool = await tryCreateTestPool()
describe.runIf(pool)('durable chat action state (Postgres)', () => {
  const db = pool as pg.Pool
  const instance = uniqueName('chat_state')
  const jid = '5511999999999@s.whatsapp.net'
  let chats: ChatStore
  let messages: MessageStore
  let lidMap: LidMapStore
  beforeAll(() => {
    chats = new ChatStore(db)
    messages = new MessageStore(db)
    lidMap = new LidMapStore(db)
  })
  beforeEach(async () => {
    await wipeInstance(db, instance)
    await seedInstance(db, instance)
  })
  afterAll(async () => {
    await wipeInstance(db, instance)
  })

  it('retains stars received before materialization and across reconstructed stores', async () => {
    await messages.setStarred(instance, 'star', true, 1000)
    const restarted = new MessageStore(db)
    const saved = await restarted.upsert({
      instanceName: instance,
      chatJid: jid,
      messageId: 'star',
      timestampMs: 1000,
      starred: false,
    })
    expect(saved?.starred).toBe(true)
    await restarted.clearChat(instance, [jid], { deleteStarred: false, beforeMs: 2000 })
    expect((await restarted.get(instance, 'star'))?.starred).toBe(true)
  })

  it('keeps a delete-for-me tombstone even when the message has not arrived yet', async () => {
    await messages.deleteForMe(instance, jid, 'missing')
    const saved = await new MessageStore(db).upsert({
      instanceName: instance,
      chatJid: jid,
      messageId: 'missing',
      timestampMs: 1000,
    })
    expect(saved).toBeNull()
    expect(await messages.get(instance, 'missing')).toBeNull()
  })

  it.each([false, true])('keeps chat deletion cutoffs after reconstruction (deleteChat=%s)', async (deleteChat) => {
    await messages.clearChat(instance, [jid], { deleteStarred: true, beforeMs: 2000, deleteChat })
    const restarted = new MessageStore(db)
    expect(
      await restarted.upsert({ instanceName: instance, chatJid: jid, messageId: 'old', timestampMs: 1000 }),
    ).toBeNull()
    expect(await restarted.upsert({ instanceName: instance, chatJid: jid, messageId: 'unknown' })).toBeNull()
    expect(
      await restarted.upsert({ instanceName: instance, chatJid: jid, messageId: 'new', timestampMs: 3000 }),
    ).toBeTruthy()
  })

  it('preserves an intentionally cleared empty chat in list and reconcile', async () => {
    await chats.upsert({ instanceName: instance, chatJid: jid, lastMessageId: 'm', lastMessageTs: 1000 })
    await messages.upsert({ instanceName: instance, chatJid: jid, messageId: 'm', timestampMs: 1000 })
    await messages.clearChat(instance, [jid], { deleteStarred: true, beforeMs: 2000 })
    await chats.refreshLastMessage(instance, jid, [jid])
    await chats.setUnread(instance, jid, 0)
    expect((await chats.list(instance)).map((chat) => chat.chatJid)).toContain(jid)
    await reconcileLidChats(db, instance, { chats, messages, lidMap })
    expect(await chats.get(instance, jid)).toBeTruthy()
    expect((await chats.list(instance)).map((chat) => chat.chatJid)).toContain(jid)
  })

  it('uses authoritative canonical flags while an active LID supplies the preview', async () => {
    await lidMap.save(instance, '111@lid', jid)
    await chats.upsert({
      instanceName: instance,
      chatJid: '111@lid',
      pinned: 0,
      archived: true,
      lastMessageTs: 2000,
      lastMessageId: 'm',
    })
    await chats.setState(
      { instanceName: instance, chatJid: jid, pinned: 1, archived: false, locked: true, muteEndMs: 253402300799000 },
      3000,
    )
    const listed = (await chats.list(instance))[0]
    expect(listed).toMatchObject({ chatJid: jid, pinned: 1, archived: false, locked: true, lastMessageId: 'm' })
    await chats.upsert({
      instanceName: instance,
      chatJid: jid,
      pinned: 0,
      archived: true,
      locked: false,
      muteEndMs: null,
      lastMessageTs: 4000,
    })
    expect(await chats.get(instance, jid)).toMatchObject({
      pinned: 1,
      archived: false,
      locked: true,
      muteEndMs: 253402300799000,
    })
  })

  it('filters and sorts canonical flags after choosing the latest alias preview', async () => {
    await lidMap.save(instance, '111@lid', jid)
    await chats.upsert({
      instanceName: instance,
      chatJid: '111@lid',
      pinned: 0,
      archived: true,
      lastMessageId: 'lid-message',
      lastMessageTs: 2000,
    })
    await chats.setState({ instanceName: instance, chatJid: jid, pinned: 1, archived: false }, 3000)
    await chats.upsert({
      instanceName: instance,
      chatJid: '5511888888888@s.whatsapp.net',
      pinned: 0,
      archived: false,
      lastMessageTs: 4000,
    })
    expect(await chats.list(instance, { archived: true })).toEqual([])
    expect((await chats.list(instance, { archived: false }))[0]).toMatchObject({
      chatJid: jid,
      pinned: 1,
      archived: false,
      lastMessageId: 'lid-message',
    })
    expect((await chats.list(instance))[0]?.chatJid).toBe(jid)
  })

  it('keeps LID actions effective after a new PN mapping appears', async () => {
    await chats.setState({ instanceName: instance, chatJid: '111@lid', pinned: 1 }, 1000)
    await messages.clearChat(instance, ['111@lid'], { deleteStarred: true, beforeMs: 2000, deleteChat: true })
    await lidMap.save(instance, '111@lid', jid)
    expect(
      await messages.upsert({ instanceName: instance, chatJid: jid, messageId: 'old', timestampMs: 1000 }),
    ).toBeNull()
    expect(await chats.actions.isDeleted(instance, jid)).toBe(true)
    expect(await chats.actions.getSettings(instance, jid)).toMatchObject({ pinned: 1 })
  })

  it('retains a cleared LID chat after later PN reconciliation', async () => {
    const lid = '111@lid'
    await chats.upsert({ instanceName: instance, chatJid: lid, lastMessageTs: 1000 })
    await messages.clearChat(instance, [lid], { deleteStarred: true, beforeMs: 2000 })
    await chats.refreshLastMessage(instance, lid, [lid])
    await lidMap.save(instance, lid, jid)
    await reconcileLidChats(db, instance, { chats, messages, lidMap })
    expect(await chats.get(instance, jid)).toBeTruthy()
    expect((await chats.list(instance)).map((chat) => chat.chatJid)).toContain(jid)
  })

  it('overlays late LID settings on an existing PN after merge', async () => {
    await chats.upsert({ instanceName: instance, chatJid: jid, pinned: 0, lastMessageTs: 2000 })
    await chats.setState({ instanceName: instance, chatJid: '111@lid', pinned: 1, locked: true }, 1000)
    await lidMap.save(instance, '111@lid', jid)
    await chats.mergeLidIntoPn(instance, '111@lid', jid)
    expect(await chats.get(instance, jid)).toMatchObject({ pinned: 1, locked: true })
    expect((await chats.list(instance))[0]).toMatchObject({ pinned: 1, locked: true })
  })

  it('does not rematerialize stale settings after a newer chat deletion', async () => {
    await chats.setState({ instanceName: instance, chatJid: jid, pinned: 1 }, 1000)
    await messages.clearChat(instance, [jid], { deleteStarred: true, beforeMs: 2000, deleteChat: true })
    expect(await chats.setState({ instanceName: instance, chatJid: jid, pinned: 1 }, 1000)).toBeNull()
    expect(await chats.get(instance, jid)).toBeNull()
    expect(await chats.list(instance)).toEqual([])
    expect(await chats.setState({ instanceName: instance, chatJid: jid, pinned: 1 }, 3000)).toMatchObject({ pinned: 1 })
  })

  it.each([false, true])(
    'enforces a PN action when an existing LID is mapped later (deleteChat=%s)',
    async (deleteChat) => {
      const lid = '111@lid'
      await chats.upsert({ instanceName: instance, chatJid: lid, lastMessageId: 'old', lastMessageTs: 1000 })
      await messages.upsert({ instanceName: instance, chatJid: lid, messageId: 'old', timestampMs: 1000 })
      if (!deleteChat)
        await messages.upsert({
          instanceName: instance,
          chatJid: lid,
          messageId: 'star',
          timestampMs: 1000,
          starred: true,
        })
      await messages.clearChat(instance, [jid], { deleteStarred: deleteChat, beforeMs: 2000, deleteChat })
      await lidMap.save(instance, lid, jid)
      await messages.rekeyChat(instance, lid, jid)
      await chats.mergeLidIntoPn(instance, lid, jid)
      expect(await messages.get(instance, 'old')).toBeNull()
      if (deleteChat) {
        expect(await chats.list(instance)).toEqual([])
        expect(await chats.get(instance, jid)).toBeNull()
      } else {
        expect((await messages.get(instance, 'star'))?.starred).toBe(true)
        expect((await chats.get(instance, jid))?.lastMessageId).toBe('star')
      }
    },
  )

  it('orders each setting independently and persists mutation cursors', async () => {
    await chats.setState({ instanceName: instance, chatJid: jid, pinned: 0, archived: true }, 2000)
    await chats.setState(
      { instanceName: instance, chatJid: jid, pinned: 1, archived: false, muteEndMs: 253402300799000 },
      1000,
    )
    expect(await chats.get(instance, jid)).toMatchObject({ pinned: 0, archived: true, muteEndMs: 253402300799000 })
    const cursor = { collection: 'regular_low', index: 'pin', timestamp: 2000 }
    expect(await chats.actions.acceptMutation(instance, cursor)).toBe(true)
    expect(await new ChatStore(db).actions.acceptMutation(instance, { ...cursor, timestamp: 1000 })).toBe(false)
    expect(await chats.actions.acceptMutation(instance, cursor)).toBe(true)
  })
})
