import { readFile } from 'node:fs/promises'
import type pg from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { migrate } from '~/db/migrate'
import { ChatStore, toPublicChat } from '~/store/chats'
import { MessageStore } from '~/store/messages'
import { seedInstance, tryCreateTestPool, uniqueName, wipeInstance } from '../helpers/pg'

const pool = await tryCreateTestPool()
describe.runIf(pool)('chat action projections (Postgres)', () => {
  const db = pool as pg.Pool
  const instanceName = uniqueName('chat_actions')
  const jid = '5511999999999@s.whatsapp.net'
  let chats: ChatStore
  let messages: MessageStore
  beforeAll(async () => {
    await seedInstance(db, instanceName)
    chats = new ChatStore(db)
    messages = new MessageStore(db)
  })
  afterAll(async () => {
    await wipeInstance(db, instanceName)
  })

  it('migrates a legacy schema twice without losing rows', async () => {
    const client = await db.connect()
    const schemaName = uniqueName('chat_migration')
    try {
      await client.query('BEGIN')
      await client.query(`CREATE SCHEMA "${schemaName}"`)
      await client.query(`SET LOCAL search_path TO "${schemaName}"`)
      const schema = await readFile('src/db/schema.sql', 'utf8')
      await client.query(
        schema.replace('ALTER TABLE app_chats ADD COLUMN IF NOT EXISTS locked BOOLEAN NOT NULL DEFAULT false;', ''),
      )
      await client.query("INSERT INTO instances (name, api_key) VALUES ('legacy', 'legacy-key')")
      await client.query("INSERT INTO app_chats (instance_name, chat_jid, pinned) VALUES ('legacy', '123@lid', 1)")
      const connectionPool = { query: client.query.bind(client) } as unknown as pg.Pool
      await migrate(connectionPool)
      await migrate(connectionPool)
      const { rows } = await client.query("SELECT pinned, locked FROM app_chats WHERE instance_name = 'legacy'")
      expect(rows).toEqual([{ pinned: 1, locked: false }])
    } finally {
      await client.query('ROLLBACK')
      client.release()
    }
  })

  it('persists flags through message upserts and clears mute explicitly', async () => {
    await chats.upsert({
      instanceName,
      chatJid: jid,
      pinned: 1,
      muteEndMs: 253402300799000,
      locked: true,
      archived: true,
    })
    await chats.upsert({ instanceName, chatJid: jid, lastMessageId: 'm', lastMessageTs: 1 })
    const chat = await chats.get(instanceName, jid)
    expect(chat && toPublicChat(chat)).toMatchObject({ pinned: 1, locked: true, muted: true, archived: true })
    const merged = await chats.list(instanceName)
    expect(merged.find((row) => row.chatJid === jid)?.locked).toBe(true)
    await chats.upsert({ instanceName, chatJid: jid, muteEndMs: null, locked: false, pinned: 0 })
    expect(await chats.get(instanceName, jid)).toMatchObject({ pinned: 0, locked: false, muteEndMs: null })
  })

  it('clears unstarred messages, refreshes preview and physically deletes one message', async () => {
    await messages.upsert({ instanceName, chatJid: jid, messageId: 'keep', timestampMs: 1000, body: 'star' })
    await messages.upsert({ instanceName, chatJid: jid, messageId: 'drop', timestampMs: 2000 })
    await messages.setStarred(instanceName, 'keep', true)
    await messages.upsert({ instanceName, chatJid: jid, messageId: 'keep' })
    await messages.clearChat(instanceName, [jid], false)
    expect(await messages.get(instanceName, 'drop')).toBeNull()
    expect(await messages.get(instanceName, 'keep')).toBeTruthy()
    await chats.refreshLastMessage(instanceName, jid, [jid])
    expect((await chats.get(instanceName, jid))?.lastMessageId).toBe('keep')
    await messages.deleteForMe(instanceName, jid, 'keep')
    await chats.refreshLastMessage(instanceName, jid, [jid])
    expect(await messages.get(instanceName, 'keep')).toBeNull()
    expect((await chats.get(instanceName, jid))?.lastMessageId).toBeNull()
  })

  it('phone clear cutoff preserves newer rows, then delete removes starred too', async () => {
    await messages.upsert({ instanceName, chatJid: jid, messageId: 'old', timestampMs: 1000 })
    await messages.upsert({ instanceName, chatJid: jid, messageId: 'new', timestampMs: 3000 })
    await messages.clearChat(instanceName, [jid], true, 2000)
    expect(await messages.get(instanceName, 'old')).toBeNull()
    expect(await messages.get(instanceName, 'new')).toBeTruthy()
    await messages.clearChat(instanceName, [jid], true)
    await chats.delete(instanceName, jid)
    expect(await chats.get(instanceName, jid)).toBeNull()
    expect(await messages.listByChat(instanceName, jid)).toEqual([])
  })
})
