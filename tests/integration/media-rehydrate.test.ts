import type pg from 'pg'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { buildApp } from '~/app'
import { InstanceManager } from '~/instances/manager'
import { WebhookDispatcher } from '~/webhooks/dispatcher'
import { makeEnv } from '../helpers/fixtures'
import { MemoryInstanceRepo } from '../helpers/memory-repo'
import { MemoryMediaStorage, MemoryMessageStore } from '../helpers/memory-stores'

describe('media GET rehydrate', () => {
  let app: Awaited<ReturnType<typeof buildApp>>
  let mediaStorage: MemoryMediaStorage
  let messages: MemoryMessageStore
  let manager: InstanceManager
  const downloadBytes = vi.fn(async () => Buffer.from('rehydrated-file-bytes'))

  beforeAll(async () => {
    const env = makeEnv({
      RATE_LIMIT_ENABLED: false,
      MEDIA_REDIRECT_DOWNLOADS: false, // force proxy so we can assert body
    })
    const repo = new MemoryInstanceRepo()
    repo.seed({ name: 'sales-1', apiKey: 'zr_test_sales_1', status: 'open' })

    mediaStorage = new MemoryMediaStorage()
    messages = new MemoryMessageStore()
    const pool = { query: async () => ({ rows: [{ '?column?': 1 }], rowCount: 1 }) } as unknown as pg.Pool
    const webhooks = new WebhookDispatcher({ env })
    manager = new InstanceManager({
      env,
      pool,
      // @ts-expect-error memory repo
      repo,
      webhooks,
      dryRun: true,
    })
    await manager.init()

    vi.spyOn(manager, 'requireRegisteredClient').mockReturnValue({
      message: { downloadBytes },
    } as never)

    // Message points at a missing CAS object + has raw for rehydrate
    await messages.upsert({
      instanceName: 'sales-1',
      messageId: 'MSG_MEDIA_1',
      chatJid: '5511888888888@s.whatsapp.net',
      fromMe: false,
      type: 'document',
      hasMedia: true,
      mediaMime: 'application/pdf',
      mediaFilename: 'report.pdf',
      mediaStorageKey: 'sales-1/cas/sha256/deadbeef.pdf',
      raw: {
        key: { id: 'MSG_MEDIA_1', remoteJid: '5511888888888@s.whatsapp.net' },
        message: {
          documentMessage: {
            mimetype: 'application/pdf',
            fileName: 'report.pdf',
            directPath: '/v/t.pdf',
            mediaKey: Object.fromEntries([...new Uint8Array(32).fill(7)].map((b, i) => [String(i), b])),
            fileSha256: Object.fromEntries([...new Uint8Array(32).fill(1)].map((b, i) => [String(i), b])),
            fileEncSha256: Object.fromEntries([...new Uint8Array(32).fill(2)].map((b, i) => [String(i), b])),
            fileLength: { low: 22, high: 0, unsigned: true },
          },
        },
      },
    })

    app = await buildApp({
      env,
      pool,
      // @ts-expect-error memory repo
      instanceRepo: repo,
      manager,
      messages: messages as never,
      mediaStorage: mediaStorage as never,
    })
    await app.ready()
  })

  afterAll(async () => {
    vi.restoreAllMocks()
    await app.close()
  })

  it('re-downloads from WhatsApp when storage object is missing, stores, then delivers', async () => {
    expect(await mediaStorage.exists('sales-1/cas/sha256/deadbeef.pdf')).toBe(false)

    const res = await app.inject({
      method: 'GET',
      url: '/v1/messages/MSG_MEDIA_1/media',
      headers: { 'x-api-key': 'zr_test_sales_1' },
    })

    expect(res.statusCode).toBe(200)
    expect(res.headers['x-media-source']).toBe('rehydrated')
    expect(res.headers['x-media-delivery']).toBe('proxy')
    expect(res.body).toBe('rehydrated-file-bytes')
    expect(downloadBytes).toHaveBeenCalled()

    // Object now exists under CAS key (with hash of content)
    const keys = [...mediaStorage.objects.keys()]
    expect(keys.some((k) => k.startsWith('sales-1/cas/sha256/'))).toBe(true)

    // Second GET hits storage (no second WA download required if exists)
    downloadBytes.mockClear()
    const res2 = await app.inject({
      method: 'GET',
      url: '/v1/messages/MSG_MEDIA_1/media',
      headers: { 'x-api-key': 'zr_test_sales_1' },
    })
    expect(res2.statusCode).toBe(200)
    expect(res2.headers['x-media-source']).toBe('storage')
    expect(downloadBytes).not.toHaveBeenCalled()
  })

  it('returns 404 when rehydrate fails', async () => {
    downloadBytes.mockRejectedValueOnce(new Error('wa offline'))
    // wipe storage + point message at missing key again
    for (const k of [...mediaStorage.objects.keys()]) {
      await mediaStorage.delete(k)
    }
    await messages.setMedia('sales-1', 'MSG_MEDIA_1', {
      url: '/x',
      storageKey: 'sales-1/cas/sha256/missing-again.pdf',
      mime: 'application/pdf',
      filename: 'report.pdf',
    })

    const res = await app.inject({
      method: 'GET',
      url: '/v1/messages/MSG_MEDIA_1/media',
      headers: { 'x-api-key': 'zr_test_sales_1' },
    })
    expect(res.statusCode).toBe(404)
  })
})
