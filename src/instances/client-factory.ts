import { createMediaProcessor } from '@zapo-js/media-utils'
import { createPostgresStore, ensurePgMigrations, type WaPgMigrationDomain } from '@zapo-js/store-postgres'
import { voipPlugin } from '@zapo-js/voip'
import type { Pool } from 'pg'
import { createPinoLogger, createStore, type Logger, WaClient, type WaClientOptions, type WaStore } from 'zapo-js'
import type { Env } from '~/config/env'
import { getLogger } from '~/lib/logger'

/** All domains used by createPostgresStore + caches — warm once at boot to avoid concurrent CREATE TABLE races. */
const PG_MIGRATION_DOMAINS: readonly WaPgMigrationDomain[] = [
  'auth',
  'signal',
  'senderKey',
  'appState',
  'retry',
  'mailbox',
  'participants',
  'deviceList',
  'privacyToken',
  'messageSecret',
] as const

export type TestClientHooks = {
  chatSocketUrls?: string[]
  /** Opaque CA material from FakeWaServer.noiseRootCa */
  noiseRootCa?: unknown
  mediaProxyAgent?: WaClientOptions['proxy'] extends infer P ? (P extends { mediaUpload?: infer A } ? A : never) : never
}

export type ClientFactoryOptions = {
  env: Env
  pool: Pool
  store?: WaStore
  testHooks?: TestClientHooks
  logger?: Logger
}

export type SharedZapoRuntime = {
  store: WaStore
  mediaProcessor: ReturnType<typeof createMediaProcessor>
  logger: Logger
}

export async function createSharedRuntime(opts: ClientFactoryOptions): Promise<SharedZapoRuntime> {
  const pinoLevel = opts.env.LOG_LEVEL === 'fatal' ? 'error' : opts.env.LOG_LEVEL
  const logger =
    opts.logger ??
    (await createPinoLogger({
      level: pinoLevel,
      pretty: opts.env.NODE_ENV === 'development',
    }))

  let store = opts.store
  if (!store) {
    if (opts.testHooks) {
      // memory-only store for fake-server e2e
      store = createStore({})
    } else {
      // Serial migration before any session write-behind can race CREATE TABLE
      // (Postgres: concurrent IF NOT EXISTS → pg_type_typname_nsp_index errors).
      const log = getLogger({ component: 'zapo-store-pg' })
      try {
        await ensurePgMigrations(opts.pool, [...PG_MIGRATION_DOMAINS], '')
        log.info({ domains: PG_MIGRATION_DOMAINS.length }, 'postgres store migrations ensured')
      } catch (err) {
        log.warn({ err }, 'postgres store pre-migrate failed — sessions may retry via ensureReady')
      }

      store = createStore({
        backends: {
          postgres: createPostgresStore({ pool: opts.pool }),
        },
        providers: {
          auth: 'postgres',
          signal: 'postgres',
          preKey: 'postgres',
          session: 'postgres',
          identity: 'postgres',
          senderKey: 'postgres',
          appState: 'postgres',
          privacyToken: 'postgres',
          messages: 'postgres',
          threads: 'postgres',
          contacts: 'postgres',
        },
      })
    }
  }

  const mediaProcessor = createMediaProcessor()

  return { store, mediaProcessor, logger }
}

export function createWaClient(
  runtime: SharedZapoRuntime,
  sessionId: string,
  env: Env,
  testHooks?: TestClientHooks,
): WaClient {
  // Build options loosely so FakeWaServer CA type is accepted at runtime
  const options: WaClientOptions = {
    store: runtime.store,
    sessionId,
    recoverFromClientTooOld: true,
    markOnlineOnConnect: false,
    history: {
      enabled: env.HISTORY_SYNC_ENABLED,
      requireFullSync: env.HISTORY_REQUIRE_FULL_SYNC,
    },
    plugins: [voipPlugin({ maxConcurrentCalls: env.VOIP_MAX_CONCURRENT_CALLS })],
    media: {
      processor: runtime.mediaProcessor,
      generateThumbnail: true,
      generateWaveform: true,
      normalizeVoiceNote: true,
    },
    ...(testHooks?.chatSocketUrls ? { chatSocketUrls: testHooks.chatSocketUrls } : {}),
    ...(testHooks?.noiseRootCa
      ? {
          testHooks: {
            noiseRootCa: testHooks.noiseRootCa as WaClientOptions['testHooks'] extends
              | { noiseRootCa?: infer C }
              | undefined
              ? C
              : never,
          },
        }
      : {}),
    ...(testHooks?.mediaProxyAgent
      ? {
          proxy: {
            mediaUpload: testHooks.mediaProxyAgent,
            mediaDownload: testHooks.mediaProxyAgent,
          },
        }
      : {}),
  }

  return new WaClient(options, runtime.logger)
}
