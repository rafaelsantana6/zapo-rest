import type { FastifyInstance } from 'fastify'
import type pg from 'pg'
import { vi } from 'vitest'
import { buildApp } from '~/app'
import type { Env } from '~/config/env'
import { InstanceManager } from '~/instances/manager'
import { WebhookDispatcher } from '~/webhooks/dispatcher'
import { createMockVoipBlastClient, type MockVoipBlastClient } from './blast-mocks'
import { makeEnv } from './fixtures'
import { MemoryInstanceRepo } from './memory-repo'
import {
  MemoryCallStore,
  MemoryChatStore,
  MemoryContactStore,
  MemoryLabelStore,
  MemoryLidMapStore,
  MemoryLidStore,
  MemoryMediaStorage,
  MemoryMessageStore,
} from './memory-stores'

export const INSTANCE = 'sales-1'
export const INSTANCE_KEY = 'zr_test_sales_1'
export const ADMIN_KEY = 'test-admin-api-key-min-16'

/** Minimal WA client surface used by route handlers under test. */
export function createMockWaClient(overrides: Record<string, unknown> = {}) {
  const send = vi.fn(async (_jid: string, _content: unknown, _opts?: unknown) => ({
    id: `3EB0${Math.random().toString(16).slice(2, 10).toUpperCase()}`,
  }))
  const getLidsByPhoneNumbers = vi.fn(async (phones: string[]) =>
    phones.map((p) => ({
      phoneJid: `${p.replace(/\D/g, '')}@s.whatsapp.net`,
      lidJid: null as string | null,
      exists: true,
    })),
  )
  const client = {
    message: {
      send,
      sendReceipt: vi.fn(async () => undefined),
      downloadBytes: vi.fn(async () => Buffer.from('bytes')),
    },
    chat: {
      set: vi.fn(async () => undefined),
      setChatArchive: vi.fn(async () => undefined),
      queryChatModification: vi.fn(async () => undefined),
    },
    group: {
      queryAllGroups: vi.fn(async () => [{ id: '120363@g.us', subject: 'Test Group' }]),
      create: vi.fn(async () => ({ id: '120363new@g.us', subject: 'New' })),
    },
    profile: {
      getLidsByPhoneNumbers,
      getStatus: vi.fn(async () => ({ status: 'Hey there!' })),
      getProfilePicture: vi.fn(async () => ({ url: 'https://example.com/pic.jpg' })),
      setPushName: vi.fn(async () => undefined),
      setStatus: vi.fn(async () => undefined),
      setProfilePicture: vi.fn(async () => 'pic-id-1'),
      deleteProfilePicture: vi.fn(async () => undefined),
    },
    getCredentials: vi.fn(() => ({
      meJid: '5511999999999:1@s.whatsapp.net',
      pushName: 'Test',
    })),
    privacy: {
      getPrivacySettings: vi.fn(async () => ({ last: 'all', status: 'contacts' })),
      setPrivacySetting: vi.fn(async () => undefined),
      getBlocklist: vi.fn(async () => ['5511000000000@s.whatsapp.net']),
    },
    presence: {
      send: vi.fn(async () => undefined),
      sendChatstate: vi.fn(async () => undefined),
      subscribe: vi.fn(async () => undefined),
    },
    ...overrides,
  }
  // Deep-merge profile if caller overrides only part of it
  if (overrides.profile && typeof overrides.profile === 'object') {
    client.profile = { ...client.profile, ...(overrides.profile as object) }
  }
  return client
}

export type MockWaApp = {
  app: FastifyInstance
  manager: InstanceManager
  client: ReturnType<typeof createMockWaClient>
  messages: MemoryMessageStore
  chats: MemoryChatStore
  contacts: MemoryContactStore
  labels: MemoryLabelStore
  lids: MemoryLidStore
  lidMap: MemoryLidMapStore
  mediaStorage: MemoryMediaStorage
  calls: MemoryCallStore
  repo: MemoryInstanceRepo
  env: Env
}

export type BuildMockedWaAppOpts = {
  env?: Partial<Env>
  /** Attach a VoIP-capable client for blast routes. */
  withVoip?: boolean | MockVoipBlastClient
  neverAnswer?: boolean
}

export async function buildMockedWaApp(opts: BuildMockedWaAppOpts = {}): Promise<MockWaApp> {
  const env = makeEnv({ RATE_LIMIT_ENABLED: false, MEDIA_REDIRECT_DOWNLOADS: false, ...opts.env })
  const repo = new MemoryInstanceRepo()
  repo.seed({ name: INSTANCE, apiKey: INSTANCE_KEY, status: 'open' })

  const messages = new MemoryMessageStore()
  const chats = new MemoryChatStore()
  const contacts = new MemoryContactStore()
  const labels = new MemoryLabelStore()
  const lids = new MemoryLidStore()
  const lidMap = new MemoryLidMapStore()
  const mediaStorage = new MemoryMediaStorage()
  const calls = new MemoryCallStore()

  const pool = { query: async () => ({ rows: [{ '?column?': 1 }], rowCount: 1 }) } as unknown as pg.Pool
  const webhooks = new WebhookDispatcher({ env })
  const manager = new InstanceManager({
    env,
    pool,
    // @ts-expect-error memory repo
    repo,
    webhooks,
    dryRun: true,
  })
  await manager.init()

  let client: ReturnType<typeof createMockWaClient> | MockVoipBlastClient
  if (opts.withVoip) {
    client =
      typeof opts.withVoip === 'object' ? opts.withVoip : createMockVoipBlastClient({ neverAnswer: opts.neverAnswer })
  } else {
    client = createMockWaClient()
  }

  vi.spyOn(manager, 'requireRegisteredClient').mockReturnValue(client as never)
  vi.spyOn(manager, 'requireOpenClient').mockResolvedValue(client as never)
  vi.spyOn(manager, 'tryGetClient').mockReturnValue(client as never)

  const app = await buildApp({
    env,
    pool,
    // @ts-expect-error memory repo
    instanceRepo: repo,
    manager,
    messages: messages as never,
    chats: chats as never,
    contacts: contacts as never,
    labels: labels as never,
    lids: lids as never,
    lidMap: lidMap as never,
    mediaStorage: mediaStorage as never,
    calls: calls as never,
  })
  await app.ready()

  return {
    app,
    manager,
    client: client as ReturnType<typeof createMockWaClient>,
    messages,
    chats,
    contacts,
    labels,
    lids,
    lidMap,
    mediaStorage,
    calls,
    repo,
    env,
  }
}
