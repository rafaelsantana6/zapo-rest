import type pg from 'pg'
import { bareUserJid, isLidJid, isPnJid, toPnJid } from '~/lib/jid-canon'

export type LidMapRow = {
  instanceName: string
  lid: string
  pn: string
  updatedAt: Date
}

/**
 * multi-config lid_map: many LIDs can point at the same PN over time;
 * primary key is (instance, lid). Lookups also go PN → lids[].
 */
export class LidMapStore {
  constructor(private readonly pool: pg.Pool) {}

  async save(instanceName: string, lid: string, pn: string): Promise<void> {
    const lidBare = bareUserJid(lid)
    const pnBare = toPnJid(pn)
    if (!isLidJid(lidBare) || !isPnJid(pnBare)) return

    await this.pool.query(
      `INSERT INTO lid_map (instance_name, lid, pn, updated_at)
       VALUES ($1, $2, $3, now())
       ON CONFLICT (instance_name, lid) DO UPDATE SET
         pn = EXCLUDED.pn,
         updated_at = now()`,
      [instanceName, lidBare, pnBare],
    )
  }

  /**
   * Bulk upsert LID→PN pairs. Chunked multi-row INSERT (not N sequential round-trips).
   * Used by startup/history reconcile when mailbox_contacts has thousands of rows.
   */
  async saveMany(instanceName: string, pairs: { lid: string; pn: string }[]): Promise<number> {
    const cleaned: { lid: string; pn: string }[] = []
    const seen = new Set<string>()
    for (const p of pairs) {
      const lidBare = bareUserJid(p.lid)
      const pnBare = toPnJid(p.pn)
      if (!isLidJid(lidBare) || !isPnJid(pnBare)) continue
      if (seen.has(lidBare)) continue
      seen.add(lidBare)
      cleaned.push({ lid: lidBare, pn: pnBare })
    }
    if (cleaned.length === 0) return 0

    // Stay under typical param limits (~65k); 3 params/row → ~500 is safe and fast.
    const CHUNK = 500
    let n = 0
    for (let i = 0; i < cleaned.length; i += CHUNK) {
      const chunk = cleaned.slice(i, i + CHUNK)
      const values: unknown[] = []
      const placeholders: string[] = []
      let p = 1
      for (const row of chunk) {
        placeholders.push(`($${p}, $${p + 1}, $${p + 2}, now())`)
        values.push(instanceName, row.lid, row.pn)
        p += 3
      }
      await this.pool.query(
        `INSERT INTO lid_map (instance_name, lid, pn, updated_at)
         VALUES ${placeholders.join(', ')}
         ON CONFLICT (instance_name, lid) DO UPDATE SET
           pn = EXCLUDED.pn,
           updated_at = now()`,
        values,
      )
      n += chunk.length
    }
    return n
  }

  async findPnByLid(instanceName: string, lid: string): Promise<string | null> {
    const bare = bareUserJid(lid)
    const { rows } = await this.pool.query<{ pn: string }>(
      `SELECT pn FROM lid_map WHERE instance_name = $1 AND lid = $2 LIMIT 1`,
      [instanceName, bare],
    )
    return rows[0]?.pn ?? null
  }

  /**
   * Batch variant of {@link findPnByLid}: one query for many LIDs.
   * Returns a `bareLid → pn` map (missing LIDs are simply absent).
   * Used by reconcile to avoid N+1 findPnByLid round-trips.
   */
  async findPnsByLids(instanceName: string, lids: string[]): Promise<Map<string, string>> {
    const bares = [...new Set(lids.map(bareUserJid))]
    if (bares.length === 0) return new Map()
    const { rows } = await this.pool.query<{ lid: string; pn: string }>(
      `SELECT lid, pn FROM lid_map WHERE instance_name = $1 AND lid = ANY($2::text[])`,
      [instanceName, bares],
    )
    return new Map(rows.map((r) => [r.lid, r.pn]))
  }

  async findLidsByPn(instanceName: string, pn: string): Promise<string[]> {
    const bare = toPnJid(pn)
    const { rows } = await this.pool.query<{ lid: string }>(
      `SELECT lid FROM lid_map WHERE instance_name = $1 AND pn = $2`,
      [instanceName, bare],
    )
    return rows.map((r) => r.lid)
  }

  /**
   * Resolve a chat id to the preferred PN form when mapped; otherwise return bare input.
   */
  async resolveCanonical(instanceName: string, jid: string): Promise<string> {
    const bare = bareUserJid(jid)
    if (isPnJid(bare)) return toPnJid(bare)
    if (isLidJid(bare)) {
      const pn = await this.findPnByLid(instanceName, bare)
      if (pn) return pn
    }
    return bare
  }

  /**
   * All JIDs that belong to the same conversation identity (PN + every known LID).
   */
  async expandAliases(instanceName: string, jid: string): Promise<string[]> {
    const bare = bareUserJid(jid)
    const set = new Set<string>([bare])

    if (isLidJid(bare)) {
      const pn = await this.findPnByLid(instanceName, bare)
      if (pn) {
        set.add(pn)
        for (const lid of await this.findLidsByPn(instanceName, pn)) set.add(lid)
      }
    } else if (isPnJid(bare)) {
      const pn = toPnJid(bare)
      set.add(pn)
      for (const lid of await this.findLidsByPn(instanceName, pn)) set.add(lid)
    }

    return [...set]
  }

  /**
   * Resolve the canonical PN AND expand every alias in a single lookup pass,
   * sharing the findPnByLid query. Equivalent to calling
   * {@link resolveCanonical} + {@link expandAliases} but without the duplicate
   * round-trip — used on the presence/chatstate hot path.
   */
  async expandWithCanonical(instanceName: string, jid: string): Promise<{ canonical: string; aliases: string[] }> {
    const bare = bareUserJid(jid)
    const set = new Set<string>([bare])
    let canonical = bare

    if (isLidJid(bare)) {
      const pn = await this.findPnByLid(instanceName, bare)
      if (pn) {
        canonical = pn
        set.add(pn)
        for (const lid of await this.findLidsByPn(instanceName, pn)) set.add(lid)
      }
    } else if (isPnJid(bare)) {
      canonical = toPnJid(bare)
      set.add(canonical)
      for (const lid of await this.findLidsByPn(instanceName, canonical)) set.add(lid)
    }

    return { canonical, aliases: [...set] }
  }

  async list(instanceName: string, opts: { limit?: number; offset?: number } = {}): Promise<LidMapRow[]> {
    const limit = Math.min(opts.limit ?? 100, 500)
    const offset = opts.offset ?? 0
    const { rows } = await this.pool.query<{
      instance_name: string
      lid: string
      pn: string
      updated_at: Date
    }>(
      `SELECT * FROM lid_map WHERE instance_name = $1
 ORDER BY lid ASC LIMIT $2 OFFSET $3`,
      [instanceName, limit, offset],
    )
    return rows.map((r) => ({
      instanceName: r.instance_name,
      lid: r.lid,
      pn: r.pn,
      updatedAt: r.updated_at,
    }))
  }

  async count(instanceName: string): Promise<number> {
    const { rows } = await this.pool.query<{ c: string }>(
      `SELECT COUNT(*)::text AS c FROM lid_map WHERE instance_name = $1`,
      [instanceName],
    )
    return Number(rows[0]?.c ?? 0)
  }
}
