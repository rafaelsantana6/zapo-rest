import type pg from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { MessageStore, toPublicMessage } from '~/store/messages'
import { seedInstance, tryCreateTestPool, uniqueName, wipeInstance } from '../helpers/pg'

// SKIPPED (not silently green) when Postgres is unavailable — resolved at collection time.
const pool = await tryCreateTestPool()

describe.skipIf(!pool)('MessageStore (Postgres)', () => {
  const db = pool as pg.Pool
  let messages: MessageStore
  const inst = uniqueName('msg')

  beforeAll(async () => {
    messages = new MessageStore(db)
    await seedInstance(db, inst)
  })

  afterAll(async () => {
    await wipeInstance(db, inst)
  })

  it('upsert is idempotent and GREATEST(ack) wins', async () => {
    const a = await messages.upsert({
      instanceName: inst,
      messageId: 'M1',
      chatJid: '5511888888888@s.whatsapp.net',
      body: 'hello',
      type: 'text',
      fromMe: false,
      timestampMs: 1_700_000_000_000,
      ack: 0,
    })
    expect(a?.body).toBe('hello')

    const b = await messages.upsert({
      instanceName: inst,
      messageId: 'M1',
      chatJid: '5511888888888@s.whatsapp.net',
      body: 'hello-edited-fields',
      type: 'text',
      ack: 2,
    })
    expect(b?.body).toBe('hello-edited-fields')
    expect(b?.ack).toBe(2)

    // lower ack must not decrease
    const c = await messages.upsert({
      instanceName: inst,
      messageId: 'M1',
      chatJid: '5511888888888@s.whatsapp.net',
      ack: 1,
      type: 'text',
    })
    expect(c?.ack).toBe(2)

    const got = await messages.get(inst, 'M1')
    expect(got?.messageId).toBe('M1')
  })

  it('updateAck / markDeleted / markEdited / setMedia', async () => {
    await messages.upsert({
      instanceName: inst,
      messageId: 'M2',
      chatJid: '5511999999999@s.whatsapp.net',
      body: 'orig',
      type: 'text',
    })

    const acked = await messages.updateAck(inst, 'M2', 3)
    expect(acked?.ack).toBe(3)

    const edited = await messages.markEdited(inst, 'M2', 'new body', { edited: true })
    expect(edited?.body).toBe('new body')
    expect(edited?.isEdited).toBe(true)

    await messages.setMedia(inst, 'M2', {
      url: 'http://media.test/x.jpg',
      storageKey: `${inst}/M2.jpg`,
      mime: 'image/jpeg',
    })
    const withMedia = await messages.get(inst, 'M2')
    expect(withMedia?.hasMedia).toBe(true)
    expect(withMedia?.mediaStorageKey).toBe(`${inst}/M2.jpg`)

    const del = await messages.markDeleted(inst, 'M2')
    expect(del?.isDeleted).toBe(true)
  })

  it('listByChat orders and filters; rekeyChat moves threads', async () => {
    await messages.upsert({
      instanceName: inst,
      messageId: 'L1',
      chatJid: '999@lid',
      body: 'a',
      timestampMs: 100,
      type: 'text',
    })
    await messages.upsert({
      instanceName: inst,
      messageId: 'L2',
      chatJid: '999@lid',
      body: 'b',
      timestampMs: 200,
      type: 'text',
    })

    const list = await messages.listByChat(inst, '999@lid', { limit: 10 })
    expect(list.map((m) => m.messageId)).toEqual(['L2', 'L1'])

    const n = await messages.rekeyChat(inst, '999@lid', '5511777777777@s.whatsapp.net')
    expect(n).toBe(2)
    expect(await messages.listByChat(inst, '999@lid')).toHaveLength(0)
    expect(await messages.listByChat(inst, '5511777777777@s.whatsapp.net')).toHaveLength(2)
  })

  it('toPublicMessage exposes stable consumer shape', async () => {
    const row = await messages.get(inst, 'M1')
    expect(row).toBeTruthy()
    if (!row) throw new Error('expected message')
    const pub = toPublicMessage(row, { instanceName: inst })
    expect(pub).toMatchObject({
      id: 'M1',
      chatId: expect.any(String),
      type: 'text',
      fromMe: false,
    })
    expect(pub).toHaveProperty('body')
    expect(pub).toHaveProperty('ack')
    expect(pub).toHaveProperty('_data')
  })
})
