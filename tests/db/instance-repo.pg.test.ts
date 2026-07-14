import type pg from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { InstanceRepo } from '~/instances/repo'
import { toPublicInstance } from '~/instances/types'
import { tryCreateTestPool, uniqueName, wipeInstance } from '../helpers/pg'

// Resolve DB availability at collection time so the suite reports as SKIPPED (not a silent green
// pass) when Postgres is unavailable. `tryCreateTestPool` memoizes one shared pool across files.
const pool = await tryCreateTestPool()

describe.skipIf(!pool)('InstanceRepo (Postgres)', () => {
  const db = pool as pg.Pool
  let repo: InstanceRepo
  const name = uniqueName('irepo')

  beforeAll(() => {
    repo = new InstanceRepo(db)
  })

  afterAll(async () => {
    await wipeInstance(db, name)
  })

  it('create / get / list / updateStatus / rotate / delete', async () => {
    const created = await repo.create({
      name,
      webhookUrl: 'https://example.com/hook',
      webhookEvents: ['message'],
    })
    expect(created.apiKey).toMatch(/^zr_/)
    expect(created.status).toBe('created')
    const createdKey = created.apiKey

    expect((await repo.getByName(name))?.name).toBe(name)
    expect((await repo.getByApiKey(createdKey))?.name).toBe(name)
    expect((await repo.list()).some((r) => r.name === name)).toBe(true)

    const updated = await repo.updateStatus(name, {
      status: 'open',
      meJid: '5511999999999:1@s.whatsapp.net',
      lastQr: 'qr-payload',
      lastQrAt: new Date(),
    })
    expect(updated?.status).toBe('open')
    expect(updated?.meJid).toContain('@s.whatsapp.net')

    expect(updated).toBeTruthy()
    if (!updated) throw new Error('expected updated instance')
    const pub = toPublicInstance(updated)
    expect(pub.createdAt).toMatch(/^\d{4}-/)
    expect(pub.lastQrAt).toMatch(/^\d{4}-/)
    // Plaintext token is stored and returned on reads (create key still valid).
    expect(pub.apiKey).toBe(created.apiKey)
    expect((await repo.getByName(name))?.apiKey).toBe(created.apiKey)

    const rotated = await repo.rotateApiKey(name)
    expect(rotated?.apiKey).toBeTruthy()
    expect(rotated?.apiKey).not.toBe(created.apiKey)
    expect(await repo.getByApiKey(created.apiKey as string)).toBeNull()
    expect((await repo.getByName(name))?.apiKey).toBe(rotated?.apiKey)

    expect(await repo.delete(name)).toBe(true)
    expect(await repo.getByName(name)).toBeNull()
  })
})
