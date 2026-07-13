import { beforeEach, describe, expect, it, vi } from 'vitest'
import { EventProcessor } from '~/events/processor'
import {
  editProtocolEvent,
  imageMessageEvent,
  makeEnv,
  receiptEvent,
  revokeProtocolEvent,
  textMessageEvent,
} from '../helpers/fixtures'
import { MemoryInstanceRepo } from '../helpers/memory-repo'
import {
  MemoryChatStore,
  MemoryContactStore,
  MemoryIdempotencyStore,
  MemoryLidMapStore,
  MemoryMediaStorage,
  MemoryMessageStore,
} from '../helpers/memory-stores'

describe('EventProcessor', () => {
  let messages: MemoryMessageStore
  let chats: MemoryChatStore
  let contacts: MemoryContactStore
  let idempotency: MemoryIdempotencyStore
  let lidMap: MemoryLidMapStore
  let mediaStorage: MemoryMediaStorage
  let repo: MemoryInstanceRepo
  let webhooks: { emit: ReturnType<typeof vi.fn> }
  let processor: EventProcessor

  beforeEach(() => {
    messages = new MemoryMessageStore()
    chats = new MemoryChatStore()
    contacts = new MemoryContactStore()
    idempotency = new MemoryIdempotencyStore()
    lidMap = new MemoryLidMapStore()
    mediaStorage = new MemoryMediaStorage()
    repo = new MemoryInstanceRepo()
    repo.seed({ name: 'sales-1', apiKey: 'zr_sales' })
    webhooks = { emit: vi.fn(async () => undefined) }

    processor = new EventProcessor({
      env: makeEnv({ MEDIA_AUTO_DOWNLOAD: false }),
      // @ts-expect-error memory repo
      instanceRepo: repo,
      // @ts-expect-error memory store
      messages,
      // @ts-expect-error memory store
      chats,
      // @ts-expect-error memory store
      contacts,
      // @ts-expect-error memory store
      idempotency,
      // @ts-expect-error mock dispatcher
      webhooks,
      mediaStorage,
      // @ts-expect-error memory lid map
      lidMap,
    })
  })

  it('upserts text message, chat, contact and emits message webhooks once', async () => {
    await processor.onMessage('sales-1', textMessageEvent({ id: 'T1', text: 'oi' }))

    const msg = await messages.get('sales-1', 'T1')
    expect(msg).toBeTruthy()
    expect(msg?.body).toBe('oi')
    expect(msg?.type).toBe('text')
    expect(msg?.chatJid).toBe('5511888888888@s.whatsapp.net')

    expect(chats.byKey.size).toBe(1)
    expect(contacts.byKey.size).toBe(1)

    expect(webhooks.emit).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'sales-1' }),
      'message',
      expect.objectContaining({ id: 'T1', body: 'oi', fromMe: false }),
    )
    expect(webhooks.emit).toHaveBeenCalledWith(expect.anything(), 'message.any', expect.anything())
    expect(webhooks.emit).toHaveBeenCalledWith(expect.anything(), 'message.inbound', expect.anything())
    expect(webhooks.emit).toHaveBeenCalledTimes(3)
  })

  it('skips webhooks on duplicate live event but still upserts projection', async () => {
    await processor.onMessage('sales-1', textMessageEvent({ id: 'DUP', text: 'first' }))
    webhooks.emit.mockClear()

    await processor.onMessage('sales-1', textMessageEvent({ id: 'DUP', text: 'second' }))
    const msg = await messages.get('sales-1', 'DUP')
    expect(msg?.body).toBe('second')
    expect(webhooks.emit).not.toHaveBeenCalled()
  })

  it('history source never fires message webhooks', async () => {
    await processor.onMessage('sales-1', textMessageEvent({ id: 'H1' }), 'history')
    expect(await messages.get('sales-1', 'H1')).toBeTruthy()
    expect(webhooks.emit).not.toHaveBeenCalled()
  })

  it('does not emit message.inbound for fromMe', async () => {
    await processor.onMessage('sales-1', textMessageEvent({ id: 'OUT1', fromMe: true, text: 'eu' }))
    const events = webhooks.emit.mock.calls.map((c) => c[1])
    expect(events).toContain('message')
    expect(events).toContain('message.any')
    expect(events).not.toContain('message.inbound')
  })

  it('ignores undecodable events', async () => {
    await processor.onMessage('sales-1', { noKey: true })
    expect(messages.byKey.size).toBe(0)
    expect(webhooks.emit).not.toHaveBeenCalled()
  })

  it('resolves LID chat via lid_map to PN', async () => {
    await lidMap.save('sales-1', '1234567890@lid', '5511888888888@s.whatsapp.net')
    await processor.onMessage(
      'sales-1',
      textMessageEvent({
        id: 'LID1',
        remoteJid: '1234567890@lid',
        remoteJidAlt: '5511888888888@s.whatsapp.net',
      }),
    )
    const msg = await messages.get('sales-1', 'LID1')
    expect(msg?.chatJid).toBe('5511888888888@s.whatsapp.net')
  })

  it('updates ack with GREATEST semantics and emits message.ack once', async () => {
    await processor.onMessage('sales-1', textMessageEvent({ id: 'ACK1' }))
    webhooks.emit.mockClear()

    await processor.onReceipt('sales-1', receiptEvent({ messageIds: ['ACK1'], status: 'delivered' }))
    expect((await messages.get('sales-1', 'ACK1'))?.ack).toBe(2)
    expect(webhooks.emit).toHaveBeenCalledWith(
      expect.anything(),
      'message.ack',
      expect.objectContaining({ id: 'ACK1', ack: 2 }),
    )

    webhooks.emit.mockClear()
    await processor.onReceipt('sales-1', receiptEvent({ messageIds: ['ACK1'], status: 'delivered' }))
    expect(webhooks.emit).not.toHaveBeenCalled()

    await processor.onReceipt('sales-1', receiptEvent({ messageIds: ['ACK1'], status: 'read' }))
    expect((await messages.get('sales-1', 'ACK1'))?.ack).toBe(3)
  })

  it('maps numeric and legacy ack aliases', async () => {
    await processor.onMessage('sales-1', textMessageEvent({ id: 'ACK2' }))
    webhooks.emit.mockClear()
    await processor.onReceipt('sales-1', receiptEvent({ messageIds: ['ACK2'], status: 'PLAYED' }))
    expect((await messages.get('sales-1', 'ACK2'))?.ack).toBe(4)

    await processor.onMessage('sales-1', textMessageEvent({ id: 'ACK3' }))
    await processor.onReceipt('sales-1', { ids: ['ACK3'], status: 2 })
    expect((await messages.get('sales-1', 'ACK3'))?.ack).toBe(2)
  })

  it('handles REVOKE protocol', async () => {
    await processor.onMessage('sales-1', textMessageEvent({ id: 'REV1' }))
    webhooks.emit.mockClear()
    await processor.onProtocol('sales-1', revokeProtocolEvent('REV1'))
    expect((await messages.get('sales-1', 'REV1'))?.isDeleted).toBe(true)
    expect(webhooks.emit).toHaveBeenCalledWith(
      expect.anything(),
      'message.revoked',
      expect.objectContaining({ revokedMessageId: 'REV1' }),
    )
  })

  it('handles MESSAGE_EDIT protocol', async () => {
    await processor.onMessage('sales-1', textMessageEvent({ id: 'ED1', text: 'old' }))
    webhooks.emit.mockClear()
    await processor.onProtocol('sales-1', editProtocolEvent('ED1', 'new body'))
    expect((await messages.get('sales-1', 'ED1'))?.body).toBe('new body')
    expect((await messages.get('sales-1', 'ED1'))?.isEdited).toBe(true)
    expect(webhooks.emit).toHaveBeenCalledWith(
      expect.anything(),
      'message.edited',
      expect.objectContaining({ id: 'ED1', body: 'new body' }),
    )
  })

  it('onHistorySync emits history.sync webhook', async () => {
    await processor.onHistorySync('sales-1', { chunk: 1 }, null)
    expect(webhooks.emit).toHaveBeenCalledWith(expect.anything(), 'history.sync', { chunk: 1 })
  })

  it('downloadAndStoreMedia stores bytes and sets media url', async () => {
    const downloadBytes = vi.fn(async () => Buffer.from('jpeg-bytes'))
    const client = { message: { downloadBytes } } as never

    await processor.onMessage('sales-1', imageMessageEvent({ id: 'IMG1' }))
    await processor.downloadAndStoreMedia('sales-1', client, imageMessageEvent({ id: 'IMG1' }), 'IMG1')

    const msg = await messages.get('sales-1', 'IMG1')
    expect(msg?.mediaStorageKey).toMatch(/^sales-1\/cas\/sha256\/[a-f0-9]{64}/)
    expect(msg?.mediaUrl).toMatch(/^http:\/\/media\.test\//)
    expect(downloadBytes).toHaveBeenCalledTimes(1)
  })

  it('downloadAndStoreMedia retries then gives up', async () => {
    vi.useFakeTimers()
    const downloadBytes = vi.fn(async () => {
      throw new Error('cdn down')
    })
    const client = { message: { downloadBytes } } as never
    const p = processor.downloadAndStoreMedia('sales-1', client, imageMessageEvent({ id: 'IMG2' }), 'IMG2')
    // advance through 4 backoff sleeps (1s,2s,3s,3s)
    for (let i = 0; i < 4; i++) {
      await vi.advanceTimersByTimeAsync(3_500)
    }
    await p
    expect(downloadBytes).toHaveBeenCalledTimes(5)
    vi.useRealTimers()
  })

  it('auto-downloads media on live when MEDIA_AUTO_DOWNLOAD=true', async () => {
    processor = new EventProcessor({
      env: makeEnv({ MEDIA_AUTO_DOWNLOAD: true }),
      // @ts-expect-error memory
      instanceRepo: repo,
      // @ts-expect-error memory
      messages,
      // @ts-expect-error memory
      chats,
      // @ts-expect-error memory
      contacts,
      // @ts-expect-error memory
      idempotency,
      // @ts-expect-error mock
      webhooks,
      mediaStorage,
      // @ts-expect-error memory
      lidMap,
    })

    const downloadBytes = vi.fn(async () => Buffer.from('img'))
    const client = { message: { downloadBytes } } as never
    await processor.onMessage('sales-1', imageMessageEvent({ id: 'IMG3' }), 'live', client)

    // Stage 1: message with mediaStage=meta (async download does not HOL-block)
    expect(webhooks.emit).toHaveBeenCalledWith(
      expect.anything(),
      'message',
      expect.objectContaining({ id: 'IMG3', hasMedia: true, mediaStage: 'meta' }),
    )

    await vi.waitFor(async () => {
      expect(downloadBytes).toHaveBeenCalled()
      const msg = await messages.get('sales-1', 'IMG3')
      expect(msg?.mediaStorageKey).toBeTruthy()
    })

    // Stage 2: storage ready
    expect(webhooks.emit).toHaveBeenCalledWith(
      expect.anything(),
      'message.media.stored',
      expect.objectContaining({
        id: 'IMG3',
        mediaStage: 'stored',
        mediaStorageKey: expect.any(String),
        mediaUrl: expect.any(String),
      }),
    )
  })

  it('emits message.media.failed after download retries exhaust', async () => {
    processor = new EventProcessor({
      env: makeEnv({ MEDIA_AUTO_DOWNLOAD: true }),
      // @ts-expect-error memory
      instanceRepo: repo,
      // @ts-expect-error memory
      messages,
      // @ts-expect-error memory
      chats,
      // @ts-expect-error memory
      contacts,
      // @ts-expect-error memory
      idempotency,
      // @ts-expect-error mock
      webhooks,
      mediaStorage,
      // @ts-expect-error memory
      lidMap,
    })

    vi.useFakeTimers()
    const downloadBytes = vi.fn(async () => {
      throw new Error('cdn down')
    })
    const client = { message: { downloadBytes } } as never
    const p = processor.onMessage('sales-1', imageMessageEvent({ id: 'IMG-FAIL' }), 'live', client)
    await p
    for (let i = 0; i < 4; i++) {
      await vi.advanceTimersByTimeAsync(3_500)
    }
    // drain async mediaSem work
    await vi.advanceTimersByTimeAsync(1)
    await vi.waitFor(() => {
      expect(webhooks.emit).toHaveBeenCalledWith(
        expect.anything(),
        'message.media.failed',
        expect.objectContaining({ id: 'IMG-FAIL', mediaStage: 'failed', error: expect.stringContaining('cdn') }),
      )
    })
    vi.useRealTimers()
  })

  it('recordLidPn rekeys messages and merges chats', async () => {
    await processor.onMessage(
      'sales-1',
      textMessageEvent({ id: 'R1', remoteJid: '999@lid', remoteJidAlt: '5511888888888@s.whatsapp.net' }),
    )
    // force message under LID only
    const m = await messages.get('sales-1', 'R1')
    if (m) m.chatJid = '999@lid'
    await chats.upsert({ instanceName: 'sales-1', chatJid: '999@lid', name: 'ghost' })

    await processor.recordLidPn('sales-1', '999@lid', '5511888888888@s.whatsapp.net')
    expect((await messages.get('sales-1', 'R1'))?.chatJid).toBe('5511888888888@s.whatsapp.net')
  })

  it('importFromZapoStore imports contacts/threads/messages', async () => {
    const client = {
      store: {
        session: () => ({
          contacts: {
            list: async () => [
              {
                jid: '5511777777777@s.whatsapp.net',
                pushName: 'Peer',
                phoneNumber: '5511777777777',
                lid: '555@lid',
              },
            ],
          },
          threads: {
            list: async () => [
              { jid: '5511777777777@s.whatsapp.net', name: 'Peer', unreadCount: 1 },
              { jid: 'ghost@lid', name: null, unreadCount: 0 },
            ],
          },
          messages: {
            listByThread: async (jid: string) => {
              if (jid.includes('ghost')) return []
              return [
                {
                  id: 'ZM1',
                  threadJid: jid,
                  fromMe: false,
                  timestampMs: 1_700_000_200,
                  senderJid: jid,
                },
              ]
            },
          },
        }),
      },
    } as never

    const result = await processor.importFromZapoStore('sales-1', client)
    expect(result.messages).toBeGreaterThanOrEqual(1)
    expect(result.chats).toBeGreaterThanOrEqual(1)
    expect(await messages.get('sales-1', 'ZM1')).toBeTruthy()
  })

  it('importFromZapoStore does not throw when contact store has no list() (real WaContactStore)', async () => {
    // Mirrors production: @zapo-js/store-postgres WaContactStore has getByJid/upsert only.
    const client = {
      store: {
        session: () => ({
          contacts: {
            getByJid: async () => null,
            upsert: async () => undefined,
          },
          threads: {
            list: async () => [],
          },
          messages: {
            listByThread: async () => [],
          },
        }),
      },
    } as never

    await expect(processor.importFromZapoStore('sales-1', client)).resolves.toEqual({
      chats: 0,
      messages: 0,
    })
  })

  it('importFromZapoStore loads contacts from mailbox_contacts when list() is absent', async () => {
    const pool = {
      query: vi.fn(async () => ({
        rows: [
          {
            jid: '5511666666666@s.whatsapp.net',
            display_name: 'FromSQL',
            push_name: 'SQL',
            lid: '777@lid',
            phone_number: '5511666666666',
            last_updated_ms: 1_700_000_000,
          },
        ],
      })),
    }

    const withPool = new EventProcessor({
      env: makeEnv({ MEDIA_AUTO_DOWNLOAD: false }),
      // @ts-expect-error memory repo
      instanceRepo: repo,
      // @ts-expect-error memory store
      messages,
      // @ts-expect-error memory store
      chats,
      // @ts-expect-error memory store
      contacts,
      // @ts-expect-error memory store
      idempotency,
      // @ts-expect-error mock dispatcher
      webhooks,
      mediaStorage,
      // @ts-expect-error memory lid map
      lidMap,
      // @ts-expect-error pool mock
      pool,
    })

    const client = {
      store: {
        session: () => ({
          contacts: {
            getByJid: async () => null,
            upsert: async () => undefined,
          },
          threads: { list: async () => [] },
          messages: { listByThread: async () => [] },
        }),
      },
    } as never

    await withPool.importFromZapoStore('sales-1', client)
    expect(pool.query).toHaveBeenCalled()
    expect(contacts.byKey.size).toBeGreaterThanOrEqual(1)
    const stored = [...contacts.byKey.values()].find((c) => c.jid.includes('5511666666666'))
    expect(stored?.displayName).toBe('FromSQL')
  })
})
