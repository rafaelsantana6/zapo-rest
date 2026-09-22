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
  const downloadBytes = vi.fn(async (_source?: unknown) => Buffer.from('rehydrated-file-bytes'))
  const requestMediaReupload = vi.fn()

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
      message: { downloadBytes, requestMediaReupload },
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
    expect(requestMediaReupload).not.toHaveBeenCalled()
  })

  it('asks the sender to re-upload when the CDN blob expired, then stores the fresh bytes', async () => {
    for (const k of [...mediaStorage.objects.keys()]) {
      await mediaStorage.delete(k)
    }
    await messages.setMedia('sales-1', 'MSG_MEDIA_1', {
      url: '/x',
      storageKey: 'sales-1/cas/sha256/expired.pdf',
      mime: 'application/pdf',
      filename: 'report.pdf',
    })
    downloadBytes.mockReset()
    downloadBytes.mockImplementation(async (source: unknown) => {
      const path = (source as { documentMessage?: { directPath?: string } }).documentMessage?.directPath
      if (path === '/v/fresh.pdf') return Buffer.from('fresh-bytes')
      throw new Error('download failed with status 404 for https://mmg.whatsapp.net/old')
    })
    requestMediaReupload.mockReset()
    requestMediaReupload.mockResolvedValue({ result: 'success', directPath: '/v/fresh.pdf' })

    const res = await app.inject({
      method: 'GET',
      url: '/v1/messages/MSG_MEDIA_1/media',
      headers: { 'x-api-key': 'zr_test_sales_1' },
    })

    expect(res.statusCode).toBe(200)
    expect(res.headers['x-media-source']).toBe('rehydrated')
    expect(res.body).toBe('fresh-bytes')
    expect(requestMediaReupload).toHaveBeenCalledTimes(1)
    const asked = requestMediaReupload.mock.calls[0]?.[0] as { key: { id: string } }
    expect(asked.key.id).toBe('MSG_MEDIA_1')
  })

  it('returns 404 when the sender no longer has the expired blob', async () => {
    for (const k of [...mediaStorage.objects.keys()]) {
      await mediaStorage.delete(k)
    }
    await messages.setMedia('sales-1', 'MSG_MEDIA_1', {
      url: '/x',
      storageKey: 'sales-1/cas/sha256/gone.pdf',
      mime: 'application/pdf',
      filename: 'report.pdf',
    })
    downloadBytes.mockReset()
    downloadBytes.mockRejectedValue(new Error('download failed with status 410 for https://mmg.whatsapp.net/old'))
    requestMediaReupload.mockReset()
    requestMediaReupload.mockResolvedValue({ result: 'not_found' })

    const res = await app.inject({
      method: 'GET',
      url: '/v1/messages/MSG_MEDIA_1/media',
      headers: { 'x-api-key': 'zr_test_sales_1' },
    })

    expect(res.statusCode).toBe(404)
    expect(downloadBytes).toHaveBeenCalledTimes(1)
    expect(requestMediaReupload).toHaveBeenCalledTimes(1)
  })
})
