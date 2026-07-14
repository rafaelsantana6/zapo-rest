import type { InstanceRecord } from '~/instances/types'

/** In-memory InstanceRepo stand-in for dryRun / route tests (no Postgres). */
export class MemoryInstanceRepo {
  private rows = new Map<string, InstanceRecord>()

  async list(): Promise<InstanceRecord[]> {
    return [...this.rows.values()]
  }

  async getByName(name: string): Promise<InstanceRecord | null> {
    return this.rows.get(name) ?? null
  }

  async getByApiKey(apiKey: string): Promise<InstanceRecord | null> {
    return [...this.rows.values()].find((r) => r.apiKey === apiKey) ?? null
  }

  async create(input: {
    name: string
    webhookUrl?: string | null
    webhookEvents?: string[]
    pairPhone?: string | null
  }): Promise<InstanceRecord> {
    const now = new Date()
    const row: InstanceRecord = {
      name: input.name,
      apiKey: `zr_test_${input.name}_${Math.random().toString(36).slice(2, 8)}`,
      webhookUrl: input.webhookUrl ?? null,
      webhookEvents: input.webhookEvents ?? [],
      status: 'created',
      meJid: null,
      pushName: null,
      pairPhone: input.pairPhone ?? null,
      lastQr: null,
      lastQrAt: null,
      config: {},
      createdAt: now,
      updatedAt: now,
    }
    this.rows.set(input.name, row)
    return row
  }

  async delete(name: string): Promise<boolean> {
    return this.rows.delete(name)
  }

  async updateStatus(
    name: string,
    patch: Partial<Pick<InstanceRecord, 'status' | 'meJid' | 'pushName' | 'lastQr' | 'lastQrAt' | 'pairPhone'>>,
  ): Promise<InstanceRecord | null> {
    const row = this.rows.get(name)
    if (!row) return null
    Object.assign(row, patch, { updatedAt: new Date() })
    return row
  }

  async rotateApiKey(name: string): Promise<InstanceRecord | null> {
    const row = this.rows.get(name)
    if (!row) return null
    row.apiKey = `zr_rotated_${name}_${Date.now()}`
    row.updatedAt = new Date()
    return row
  }

  /** Seed a known key for SSE / multi-tenant tests. */
  seed(row: Partial<InstanceRecord> & Pick<InstanceRecord, 'name' | 'apiKey'>): InstanceRecord {
    const now = new Date()
    const full: InstanceRecord = {
      webhookUrl: null,
      webhookEvents: [],
      status: 'open',
      meJid: '5511999999999:1@s.whatsapp.net',
      pushName: null,
      pairPhone: null,
      lastQr: null,
      lastQrAt: null,
      config: {},
      createdAt: now,
      updatedAt: now,
      ...row,
    }
    this.rows.set(full.name, full)
    return full
  }
}
