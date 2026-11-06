import type { FastifyInstance } from 'fastify'
import type pg from 'pg'
import { buildApp } from '~/app'
import { type Env, parseEnv, resetEnvCache } from '~/config/env'
import { InstanceManager } from '~/instances/manager'
import { WebhookDispatcher } from '~/webhooks/dispatcher'
import type { CreateWebhookInput, WebhookConfigRecord } from '~/webhooks/types'
import type { ChatStore } from '~/store/chats'
import type { MessageStore } from '~/store/messages'
import type { LidMapStore } from '~/store/lid-map'
import { MemoryInstanceRepo } from './memory-repo'

export const ADMIN_KEY = 'test-admin-api-key-min-16'

export class MemoryWebhookRepo {
  private rows = new Map<string, WebhookConfigRecord>()

  async list(instanceName: string): Promise<WebhookConfigRecord[]> {
    return [...this.rows.values()].filter((r) => r.instanceName === instanceName)
  }

  async get(instanceName: string, id: string): Promise<WebhookConfigRecord | null> {
    const row = this.rows.get(id)
    if (!row || row.instanceName !== instanceName) return null
    return row
  }

  async create(instanceName: string, input: CreateWebhookInput): Promise<WebhookConfigRecord> {
    const now = new Date()
    const row: WebhookConfigRecord = {
      id: `wh_${this.rows.size + 1}`,
      instanceName,
      url: input.url,
      events: input.events ?? [],
      hmacKey: input.hmacKey ?? null,
      retriesPolicy: input.retries?.policy ?? 'exponential',
      retriesDelaySeconds: input.retries?.delaySeconds ?? 2,
      retriesAttempts: input.retries?.attempts ?? 5,
      customHeaders: input.customHeaders ?? [],
      enabled: input.enabled ?? true,
      createdAt: now,
      updatedAt: now,
    }
    this.rows.set(row.id, row)
    return row
  }

  async delete(instanceName: string, id: string): Promise<boolean> {
    const row = this.rows.get(id)
    if (!row || row.instanceName !== instanceName) return false
    return this.rows.delete(id)
  }

  async matching(instanceName: string, event: string): Promise<WebhookConfigRecord[]> {
    return (await this.list(instanceName)).filter((w) => {
      if (!w.enabled) return false
      if (w.events.length === 0 || w.events.includes('*')) return true
      if (w.events.includes(event)) return true
      if (w.events.includes('message.any') && event.startsWith('message')) return true
      return false
    })
  }
}

export type TestApp = {
  app: FastifyInstance
  env: Env
  repo: MemoryInstanceRepo
  webhookRepo: MemoryWebhookRepo
  manager: InstanceManager
  pool: pg.Pool
}

/** Build a Fastify app with dryRun manager + memory repos (no real WhatsApp / Postgres). */
export async function buildTestApp(opts?: {
  withWebhooks?: boolean
  chats?: ChatStore
  messages?: MessageStore
  lidMap?: LidMapStore
}): Promise<TestApp> {
  resetEnvCache()
  const env = parseEnv()
  const repo = new MemoryInstanceRepo()
  const webhookRepo = new MemoryWebhookRepo()
  const pool = {
    query: async () => ({ rows: [{ '?column?': 1 }], rowCount: 1 }),
  } as unknown as pg.Pool

  const webhooks = new WebhookDispatcher({ env })
  const manager = new InstanceManager({
    env,
    pool,
    // @ts-expect-error memory repo is compatible for dryRun paths
    repo,
    webhooks,
    dryRun: true,
  })
  await manager.init()

  const app = await buildApp({
    env,
    pool,
    // @ts-expect-error memory repo
    instanceRepo: repo,
    manager,
    chats: opts?.chats,
    messages: opts?.messages,
    lidMap: opts?.lidMap,
    ...(opts?.withWebhooks ? { webhookRepo } : {}),
  })
  await app.ready()

  return { app, env, repo, webhookRepo, manager, pool }
}

export async function createInstance(
  app: FastifyInstance,
  name: string,
  adminKey = ADMIN_KEY,
): Promise<{ name: string; apiKey: string }> {
  const res = await app.inject({
    method: 'POST',
    url: '/v1/instances',
    headers: { 'x-api-key': adminKey },
    payload: { name },
  })
  if (res.statusCode !== 200) {
    throw new Error(`create instance failed: ${res.statusCode} ${res.body}`)
  }
  const body = res.json() as { instance: { name: string; apiKey: string } }
  return body.instance
}
