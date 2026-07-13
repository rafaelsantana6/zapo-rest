import { describe, expect, it, vi } from 'vitest'
import { LidMapStore } from '~/store/lid-map'

describe('LidMapStore.saveMany', () => {
  it('batches multi-row upsert and skips invalid pairs', async () => {
    const queries: { text: string; values: unknown[] }[] = []
    const pool = {
      query: vi.fn(async (text: string, values?: unknown[]) => {
        queries.push({ text, values: values ?? [] })
        return { rows: [], rowCount: 0 }
      }),
    }
    // @ts-expect-error pool mock
    const store = new LidMapStore(pool)

    const n = await store.saveMany('sales-1', [
      { lid: '111@lid', pn: '5511999999999@s.whatsapp.net' },
      { lid: '111@lid', pn: '5511999999999@s.whatsapp.net' }, // dupe lid
      { lid: '222@lid', pn: '5511888888888' },
      { lid: 'not-a-lid', pn: '5511777777777@s.whatsapp.net' }, // invalid
    ])

    expect(n).toBe(2)
    expect(pool.query).toHaveBeenCalledTimes(1)
    const q = queries[0]
    expect(q?.text).toContain('INSERT INTO lid_map')
    expect(q?.text).toContain('ON CONFLICT')
    // instance + lid + pn × 2 rows
    expect(q?.values).toEqual([
      'sales-1',
      '111@lid',
      '5511999999999@s.whatsapp.net',
      'sales-1',
      '222@lid',
      '5511888888888@s.whatsapp.net',
    ])
  })

  it('chunks large batches', async () => {
    const pool = {
      query: vi.fn(async () => ({ rows: [], rowCount: 0 })),
    }
    // @ts-expect-error pool mock
    const store = new LidMapStore(pool)
    const pairs = Array.from({ length: 1200 }, (_, i) => ({
      lid: `${i}@lid`,
      pn: `5511${String(i).padStart(8, '0')}@s.whatsapp.net`,
    }))
    const n = await store.saveMany('sales-1', pairs)
    expect(n).toBe(1200)
    // CHUNK=500 → 3 queries
    expect(pool.query).toHaveBeenCalledTimes(3)
  })
})
