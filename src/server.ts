import { parseEnv } from '~/config/env'
import { migrate } from '~/db/migrate'
import { closePool, createPool } from '~/db/pool'
import { EventProcessor } from '~/events/processor'
import { InstanceManager } from '~/instances/manager'
import { InstanceRepo } from '~/instances/repo'
import { closeLogger, createRootLogger, getLogger } from '~/lib/logger'
import { createMediaStorage, ensureMediaStorageReady } from '~/media/storage'
import { closeCache, createCache } from '~/redis/client'
import { CallStore } from '~/store/calls'
import { ChatStore } from '~/store/chats'
import { ContactStore } from '~/store/contacts'
import { EventIdempotencyStore } from '~/store/events'
import { LabelStore } from '~/store/labels'
import { LidMapStore } from '~/store/lid-map'
import { LidStore } from '~/store/lids'
import { MessageStore } from '~/store/messages'
import { CallRecordingManager } from '~/voip/recording-manager'
import { WebhookDispatcher } from '~/webhooks/dispatcher'
import { WebhookOutbox } from '~/webhooks/outbox'
import { WebhookConfigRepo } from '~/webhooks/repo'
import { buildApp } from './app'

/** Graceful cleanup budget. After this we SIGKILL ourselves (process.exit alone can hang on wrtc/WA). */
const SHUTDOWN_MS = 1_200

/**
 * Exit that cannot be blocked by native addons / open sockets.
 * process.exit sometimes never returns when @roamhq/wrtc or WA keepalives are active.
 */
function hardExit(code: number, reason: string): never {
  try {
    console.error(`[shutdown] ${reason} → exit ${code}`)
  } catch {
    /* tty may already be dead (EIO) */
  }
  try {
    process.exitCode = code
    process.exit(code)
  } catch {
    /* */
  }
  // If still alive (native exit hooks / hang), nuclear option
  try {
    process.kill(process.pid, 'SIGKILL')
  } catch {
    /* */
  }
  // satisfy TypeScript `never`
  throw new Error('hardExit')
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T | undefined> {
  return Promise.race([
    promise.then((v) => v as T | undefined),
    new Promise<T | undefined>((resolve) => {
      setTimeout(() => {
        try {
          console.error(`[shutdown] ${label} timed out after ${ms}ms`)
        } catch {
          /* */
        }
        resolve(undefined)
      }, ms)
    }),
  ])
}

// Swallow broken TTY after force-kills (tsx "Force killing" → next run EIO on stdin)
for (const stream of [process.stdin, process.stdout, process.stderr]) {
  stream?.on?.('error', (err: NodeJS.ErrnoException) => {
    if (err?.code === 'EIO' || err?.code === 'EPIPE') return
    try {
      console.error('[stdio]', err)
    } catch {
      /* */
    }
  })
}

/** Installed immediately so Ctrl+C works during long boot (before listen). */
let shutdownImpl: ((signal: string) => void) | null = null
let shuttingDown = false

function onSignal(signal: string) {
  if (shutdownImpl) {
    shutdownImpl(signal)
    return
  }
  // Still booting — don't wait for WA/migrate
  hardExit(1, `${signal} during startup`)
}

process.on('SIGINT', () => onSignal('SIGINT'))
process.on('SIGTERM', () => onSignal('SIGTERM'))
process.on('SIGHUP', () => onSignal('SIGHUP'))

async function main() {
  const env = parseEnv()
  createRootLogger(env)
  const log = getLogger({ component: 'server' })

  process.on('unhandledRejection', (reason) => {
    log.error({ err: reason }, 'unhandledRejection (swallowed — process stays up)')
  })
  process.on('uncaughtException', (err) => {
    log.fatal({ err }, 'uncaughtException')
    setTimeout(() => hardExit(1, 'uncaughtException'), 50)
  })
  // Log unexpected process death (native wrtc segfaults will NOT hit this — they SIGSEGV)
  process.on('exit', (code) => {
    // stderr only — pino may already be flushed/closed
    console.error(`[exit] process exiting code=${code}`)
  })
  process.on('SIGUSR2', () => {
    log.warn('SIGUSR2 received (diagnostic)')
  })

  const pool = createPool(env)
  await migrate(pool)

  const cache = createCache(env)
  const mediaStorage = createMediaStorage(env)
  await ensureMediaStorageReady(mediaStorage, env)

  const instanceRepo = new InstanceRepo(pool)
  const webhookRepo = new WebhookConfigRepo(pool)
  const messages = new MessageStore(pool)
  const chats = new ChatStore(pool)
  const contacts = new ContactStore(pool)
  const labels = new LabelStore(pool)
  const lids = new LidStore(pool)
  const lidMap = new LidMapStore(pool)
  const idempotency = new EventIdempotencyStore(pool)
  const callStore = new CallStore(pool)
  const callRecording = new CallRecordingManager(env, mediaStorage, callStore, instanceRepo)

  const outbox = new WebhookOutbox(pool, env)
  outbox.start()

  // Periodically prune the short-lived idempotency ledger (processed_events).
  // `.unref()` so it never keeps the process alive on its own.
  const PRUNE_INTERVAL_MS = 60 * 60 * 1000 // 1h
  const PRUNE_OLDER_THAN_HOURS = 72
  const pruneTimer = setInterval(() => {
    void idempotency.prune(PRUNE_OLDER_THAN_HOURS).then(
      (n) => {
        if (n > 0) log.debug({ pruned: n }, 'processed_events pruned')
      },
      (err) => log.debug({ err }, 'processed_events prune failed'),
    )
  }, PRUNE_INTERVAL_MS)
  pruneTimer.unref()

  const webhooks = new WebhookDispatcher({
    env,
    webhookRepo,
    outbox,
    cache,
  })

  const events = new EventProcessor({
    env,
    instanceRepo,
    messages,
    chats,
    contacts,
    idempotency,
    webhooks,
    mediaStorage,
    lidMap,
    pool,
  })

  const manager = new InstanceManager({
    env,
    pool,
    repo: instanceRepo,
    webhooks,
    events,
    callRecording,
    lidMap,
    mediaStorage,
    contacts,
    cache,
  })
  // Shared runtime (store/media) only — do NOT await WA connect / lid reconcile before listen.
  // AUTO_CONNECT + reconcile over large mailbox_contacts blocked :3000 past Docker healthcheck.
  await manager.init()

  const app = await buildApp({
    env,
    pool,
    instanceRepo,
    manager,
    messages,
    chats,
    contacts,
    labels,
    lids,
    lidMap,
    calls: callStore,
    callRecording,
    webhookRepo,
    mediaStorage,
    cache,
  })

  await app.listen({ host: env.HOST, port: env.PORT })
  log.info({ host: env.HOST, port: env.PORT }, 'zapo-rest listening')

  // Background: reconnect WA sessions + lid map reconcile (healthcheck already green).
  void (async () => {
    try {
      await manager.boot()
      log.info('auto-connect boot finished')
    } catch (err) {
      log.error({ err }, 'auto-connect boot failed')
    }
    try {
      const { reconcileLidChats } = await import('~/store/chat-reconcile')
      const all = await instanceRepo.list()
      for (const inst of all) {
        await reconcileLidChats(pool, inst.name, { lidMap, chats, messages })
      }
    } catch (err) {
      log.warn({ err }, 'startup lid reconcile failed (non-fatal)')
    }
  })()

  shutdownImpl = (signal: string) => {
    if (shuttingDown) {
      hardExit(1, `${signal} again (forced)`)
    }
    shuttingDown = true

    try {
      console.error(`[shutdown] ${signal} — cleaning up (max ${SHUTDOWN_MS}ms). Press Ctrl+C again to SIGKILL.`)
    } catch {
      /* */
    }

    // Referenced timer → always fires even with open WA sockets
    setTimeout(() => {
      hardExit(1, 'grace period elapsed')
    }, SHUTDOWN_MS)

    void (async () => {
      try {
        clearInterval(pruneTimer)
        outbox.stop()
        // Fire-and-forget style caps inside manager; outer race is belt-and-suspenders
        await withTimeout(manager.shutdown(), 500, 'manager.shutdown')
        await withTimeout(app.close(), 300, 'app.close()')
        await withTimeout(closeCache(), 200, 'closeCache')
        await withTimeout(closePool(), 200, 'closePool')
        await withTimeout(closeLogger(), 150, 'closeLogger')
      } catch (err) {
        try {
          console.error('[shutdown] error', err)
        } catch {
          /* */
        }
      }
      hardExit(0, 'clean')
    })()
  }
}

main().catch((err) => {
  console.error(err)
  hardExit(1, 'main() rejected')
})
