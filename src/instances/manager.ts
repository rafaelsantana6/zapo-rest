import type { Pool } from 'pg'
import type { WaAuthCredentials, WaClient, WaConnectionEvent, WaIncomingMessageEvent } from 'zapo-js'
import type { Env } from '~/config/env'
import type { EventProcessor } from '~/events/processor'
import { applyPictureNotification } from '~/lib/avatar-resolve'
import { badRequest, conflict, notFound, serviceUnavailable } from '~/lib/errors'
import { toRecipientJid } from '~/lib/jid'
import { bareUserJid, isLidJid } from '~/lib/jid-canon'
import { getLogger } from '~/lib/logger'
import { digitsOnly } from '~/lib/phone'
import { resolveRecipientJid } from '~/lib/phone-resolve'
import type { MediaStorage } from '~/media/storage'
import type { CacheClient } from '~/redis/client'
import { AvatarStore } from '~/store/avatars'
import type { ContactStore } from '~/store/contacts'
import { asPhoneJid, serializeCallInfo } from '~/voip/call-serialize'
import type { WebhookDispatcher } from '~/webhooks/dispatcher'
import { createSharedRuntime, createWaClient, type SharedZapoRuntime, type TestClientHooks } from './client-factory'
import type { InstanceRepo } from './repo'
import type { CreateInstanceInput, InstanceRecord, InstanceStatus, PublicInstance } from './types'
import { toPublicInstance } from './types'
import { asVoipClient } from './wa-client'
import { wipeInstanceCompletely } from './wipe'

/** Max WA sockets to open concurrently on boot (bounded so many instances don't thundering-herd). */
const BOOT_CONCURRENCY = 5

type ConnectionOpenEvent = Extract<WaConnectionEvent, { status: 'open' }>
type ConnectionCloseEvent = Extract<WaConnectionEvent, { status: 'close' }>

/** Patch shape accepted by `repo.updateStatus` — reused by the cached `persistStatus` wrapper. */
type StatusPatch = Parameters<InstanceRepo['updateStatus']>[1]

type LiveSession = {
  client: WaClient
  reconnectAttempt: number
  reconnectTimer: ReturnType<typeof setTimeout> | null
  disposed: boolean
  /**
   * Cached instance row for event handlers. The row is effectively immutable
   * while a session is live (only status/meJid change, and those flow back
   * through `persistStatus`), so handlers read this instead of hitting the DB
   * on every presence/chatstate/group/picture/call event.
   */
  record: InstanceRecord | null
}

export type InstanceManagerOptions = {
  env: Env
  pool: Pool
  repo: InstanceRepo
  webhooks: WebhookDispatcher
  events?: EventProcessor
  testHooks?: TestClientHooks
  /** When true, skip real WaClient (tests) */
  dryRun?: boolean
  callRecording?: import('~/voip/recording-manager').CallRecordingManager
  /** Optional LID↔PN map for chatstate/presence chatId normalization */
  lidMap?: import('~/store/lid-map').LidMapStore
  /** Durable avatar bytes (S3/local) — required for picture push → storage updates */
  mediaStorage?: MediaStorage
  contacts?: ContactStore
  /** Redis/memory cache for on-WA number resolve (55 + nono dígito) */
  cache?: CacheClient
}

export class InstanceManager {
  private runtime: SharedZapoRuntime | null = null
  private readonly sessions = new Map<string, LiveSession>()
  /** Per-instance serial promise chain — preserves event order & isolates failures */
  private readonly sessionQueues = new Map<string, Promise<void>>()
  /** Set during process shutdown — skip DB/webhook side-effects on close storms */
  private shuttingDown = false
  private readonly log = getLogger({ component: 'InstanceManager' })
  private readonly avatars: AvatarStore | null

  constructor(private readonly opts: InstanceManagerOptions) {
    this.avatars = opts.pool ? new AvatarStore(opts.pool) : null
  }

  /**
   * Enqueue work on a per-session chain so message/ack/history handlers
   * never race and a thrown error cannot drop subsequent events.
   */
  private enqueueSessionTask(name: string, task: () => Promise<void>): Promise<void> {
    if (this.shuttingDown) return Promise.resolve()
    const prev = this.sessionQueues.get(name) ?? Promise.resolve()
    const next = prev
      .catch(() => undefined)
      .then(task)
      .catch((err) => {
        this.log.error({ err, instance: name }, 'session task failed')
      })
      .then(() => undefined)
    this.sessionQueues.set(name, next)
    return next
  }

  /** Names of instances with a live in-memory WaClient (for metrics / resource share). */
  listLiveSessionNames(): string[] {
    return [...this.sessions.keys()]
  }

  async init(): Promise<void> {
    if (this.opts.dryRun) return
    this.runtime = await createSharedRuntime({
      env: this.opts.env,
      pool: this.opts.pool,
      testHooks: this.opts.testHooks,
    })
  }

  async boot(): Promise<void> {
    if (!this.opts.env.AUTO_CONNECT_ON_BOOT || this.opts.dryRun) return
    const all = await this.opts.repo.list()
    const connectable = all.filter((inst) => inst.status !== 'logged_out')
    await this.runBounded(connectable, BOOT_CONCURRENCY, async (inst) => {
      try {
        await this.connect(inst.name)
      } catch (err) {
        this.log.error({ err, name: inst.name }, 'auto-connect failed')
      }
    })
  }

  /** Run `fn` over `items` with at most `limit` in flight at once. */
  private async runBounded<T>(items: T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
    const queue = [...items]
    const worker = async () => {
      for (let item = queue.shift(); item !== undefined; item = queue.shift()) {
        await fn(item)
      }
    }
    const workers = Array.from({ length: Math.min(limit, queue.length) }, worker)
    await Promise.all(workers)
  }

  async list(): Promise<PublicInstance[]> {
    const rows = await this.opts.repo.list()
    return Promise.all(rows.map((row) => this.enrichPublicInstance(row)))
  }

  async get(name: string): Promise<PublicInstance> {
    const row = await this.requireRecord(name)
    return this.enrichPublicInstance(row)
  }

  /** Persist WhatsApp push name after profile update (best-effort). */
  async setStoredPushName(name: string, pushName: string): Promise<void> {
    await this.opts.repo.updateStatus(name, { pushName })
  }

  /**
   * Attach token + WhatsApp profile fields (push name, avatar) for list/get responses.
   * Prefer live credentials when the session is open; fall back to DB columns.
   */
  private async enrichPublicInstance(row: InstanceRecord): Promise<PublicInstance> {
    let pushName = row.pushName
    const client = this.tryGetClient(row.name)
    if (client) {
      try {
        const creds = client.getCredentials() as { pushName?: string; meJid?: string | null } | null
        if (creds?.pushName && creds.pushName !== pushName) {
          pushName = creds.pushName
          void this.opts.repo.updateStatus(row.name, { pushName: creds.pushName }).catch(() => undefined)
        }
      } catch {
        // ignore
      }
    }

    const avatarUrl = await this.resolveOwnAvatarUrl(row.name, row.meJid)
    return toPublicInstance(row, { pushName, avatarUrl })
  }

  /** Durable avatar for the linked account (meJid), if stored. */
  private async resolveOwnAvatarUrl(instanceName: string, meJid: string | null): Promise<string | null> {
    if (!meJid || !this.avatars) return null
    const jid = bareUserJid(meJid)
    try {
      const av =
        (await this.avatars.get(instanceName, jid, 'preview')) ?? (await this.avatars.get(instanceName, jid, 'image'))
      if (av?.status !== 'ok' || !av.storageKey) return null
      const media = this.opts.mediaStorage
      if (media?.publicUrl) {
        const pub = media.publicUrl(av.storageKey)
        if (pub) return pub
      }
      // Authenticated profile-picture endpoint (works without public storage URL)
      const phone = digitsOnly(jid.split('@')[0] ?? '')
      if (!phone) return null
      return `/v1/instances/${encodeURIComponent(instanceName)}/contacts/${encodeURIComponent(phone)}/profile-picture`
    } catch {
      return null
    }
  }

  async create(input: CreateInstanceInput) {
    if (!/^[a-zA-Z0-9_-]{1,64}$/.test(input.name)) {
      throw badRequest('name must match /^[a-zA-Z0-9_-]{1,64}$/')
    }
    const existing = await this.opts.repo.getByName(input.name)
    if (existing) throw conflict(`instance "${input.name}" already exists`)

    const row = await this.opts.repo.create(input)
    this.log.info({ name: row.name }, 'instance created')
    return toPublicInstance(row, { avatarUrl: null })
  }

  /**
   * Full instance wipe: live session logout, all app projections, zapo session
   * protocol rows, object storage prefix, then the `instances` row.
   */
  async delete(name: string): Promise<void> {
    const exists = await this.opts.repo.getByName(name)
    if (!exists) throw notFound(`instance "${name}" not found`)

    // Stop accepting new session work
    this.sessionQueues.delete(name)

    const session = this.sessions.get(name)
    if (session) {
      session.disposed = true
      this.clearReconnect(session)
      try {
        await session.client.logout().catch(async () => {
          await session.client.disconnect().catch(() => undefined)
        })
      } catch {
        await session.client.disconnect().catch(() => undefined)
      }
      this.sessions.delete(name)
    }

    // Unit tests (dryRun) use an in-memory repo without Postgres projections
    if (this.opts.dryRun) {
      await this.opts.repo.delete(name)
      this.log.info({ name }, 'instance deleted (dryRun)')
      return
    }

    // Single transactional wipe of DB + best-effort media purge
    const report = await wipeInstanceCompletely(this.opts.pool, name, {
      mediaStorage: this.opts.mediaStorage,
    })

    if (!report.instanceDeleted) {
      // Row may have been removed mid-flight; ensure repo stays consistent if dual-backed
      await this.opts.repo.delete(name).catch(() => false)
      this.log.warn({ name, report }, 'instance wipe: instances row already absent')
    }

    this.log.info({ name, report }, 'instance deleted (full wipe)')
  }

  async connect(name: string): Promise<ReturnType<typeof toPublicInstance>> {
    await this.requireRecord(name)
    if (this.opts.dryRun) {
      await this.persistStatus(name, { status: 'open' })
      return this.get(name)
    }

    let session = this.sessions.get(name)
    if (!session) {
      session = this.spawnSession(name)
      this.sessions.set(name, session)
    }

    await this.persistStatus(name, { status: 'connecting' })
    try {
      await session.client.connect()
      // If socket is already open (or creds restored) before the event is handled, reflect that now.
      const creds = session.client.getCredentials() as WaAuthCredentials | null
      if (creds?.meJid) {
        await this.persistStatus(name, {
          status: 'open',
          meJid: creds.meJid,
          pushName: creds.pushName ?? undefined,
        })
      }
    } catch (err) {
      this.log.error({ err, name }, 'connect failed')
      await this.persistStatus(name, { status: 'close' })
      throw serviceUnavailable(`failed to connect instance "${name}"`, err)
    }
    return this.get(name)
  }

  async disconnect(name: string): Promise<ReturnType<typeof toPublicInstance>> {
    await this.requireRecord(name)
    const session = this.sessions.get(name)
    if (session) {
      session.disposed = true
      this.clearReconnect(session)
      await session.client.disconnect()
      this.sessions.delete(name)
    }
    await this.persistStatus(name, { status: 'close' })
    return this.get(name)
  }

  async restart(name: string): Promise<ReturnType<typeof toPublicInstance>> {
    await this.disconnect(name)
    return this.connect(name)
  }

  async rotateKey(name: string) {
    await this.requireRecord(name)
    const row = await this.opts.repo.rotateApiKey(name)
    if (!row) throw notFound(`instance "${name}" not found`)
    const session = this.sessions.get(name)
    if (session) session.record = row
    return toPublicInstance(row)
  }

  getClient(name: string): WaClient {
    const session = this.sessions.get(name)
    if (!session) {
      throw serviceUnavailable(`instance "${name}" is not connected — call POST.../connect first`)
    }
    return session.client
  }

  tryGetClient(name: string): WaClient | null {
    return this.sessions.get(name)?.client ?? null
  }

  /**
   * Client must be connected AND registered (has meJid after QR/pairing).
   * Used by message/contact/presence/call routes.
   */
  requireRegisteredClient(name: string): WaClient {
    const client = this.getClient(name)
    const meJid = client.getCredentials()?.meJid
    if (!meJid) {
      throw serviceUnavailable(
        `instance "${name}" is not registered on WhatsApp yet (missing meJid). ` +
          'Scan the QR (GET.../qr) or complete pairing-code, wait for status "open", then retry.',
        { code: 'NOT_REGISTERED', name, hint: 'connect → scan QR → wait status open' },
      )
    }
    return client
  }

  async requireOpenClient(name: string): Promise<WaClient> {
    return this.requireRegisteredClient(name)
  }

  isRegistered(name: string): boolean {
    const client = this.tryGetClient(name)
    return Boolean(client?.getCredentials()?.meJid)
  }

  private async requireRecord(name: string): Promise<InstanceRecord> {
    const row = await this.opts.repo.getByName(name)
    if (!row) throw notFound(`instance "${name}" not found`)
    return row
  }

  /**
   * Cached instance row for a live session's event handlers. Falls back to a DB
   * read (and seeds the cache) on the first event; refreshed by `persistStatus`.
   */
  private async getRecord(name: string): Promise<InstanceRecord | null> {
    const session = this.sessions.get(name)
    if (session?.record) return session.record
    const row = await this.opts.repo.getByName(name)
    if (row && session) session.record = row
    return row
  }

  /** Persist a status/registro change and refresh the per-session record cache. */
  private async persistStatus(name: string, patch: StatusPatch): Promise<InstanceRecord | null> {
    const row = await this.opts.repo.updateStatus(name, patch)
    const session = this.sessions.get(name)
    if (session && row) session.record = row
    return row
  }

  private spawnSession(name: string): LiveSession {
    if (!this.runtime) {
      throw new Error('InstanceManager not initialized')
    }
    const client = createWaClient(this.runtime, name, this.opts.env, this.opts.testHooks)
    const session: LiveSession = {
      client,
      reconnectAttempt: 0,
      reconnectTimer: null,
      disposed: false,
      record: null,
    }
    this.wireEvents(name, session)
    return session
  }

  /**
   * Register per-session listeners. Each handler is a named private method so
   * this stays a flat registration table; serialization + failure isolation
   * live in `runSafe`.
   */
  private wireEvents(name: string, session: LiveSession): void {
    const { client } = session

    // Serialize event handling per session so projection + webhooks stay ordered
    // and a single handler failure never kills the process / drops the subscription.
    const runSafe = (label: string, fn: () => Promise<void>) => {
      void this.enqueueSessionTask(name, async () => {
        try {
          await fn()
        } catch (err) {
          this.log.error({ err, instance: name, label }, 'event handler failed (projection may need history resync)')
        }
      })
    }

    client.on('auth_qr', ({ qr, ttlMs }) => {
      runSafe('auth_qr', () => this.onAuthQr(name, qr, ttlMs))
    })

    client.on('auth_pairing_required', () => {
      runSafe('auth_pairing_required', async () => {
        await this.persistStatus(name, { status: 'pairing' })
      })
    })

    client.on('auth_paired', ({ credentials }) => {
      runSafe('auth_paired', () => this.onAuthPaired(name, session, credentials))
    })

    client.on('connection', (event) => {
      runSafe('connection', () => this.onConnection(name, session, client, event))
    })

    client.on('message', (event) => {
      runSafe('message', () => this.onIncomingMessage(name, client, event))
    })

    client.on('receipt', (event) => {
      runSafe('receipt', async () => {
        if (this.opts.events) await this.opts.events.onReceipt(name, event)
      })
    })

    client.on('message_protocol', (event) => {
      runSafe('message_protocol', async () => {
        if (this.opts.events) await this.opts.events.onProtocol(name, event)
      })
    })

    client.on('history_sync_chunk', (event) => {
      runSafe('history_sync_chunk', async () => {
        if (this.opts.events) await this.opts.events.onHistorySync(name, event, client)
      })
    })

    client.on('presence', (event) => {
      runSafe('presence', () => this.onPresence(name, event))
    })

    // Typing / recording indicators (requires presence.subscribe on the peer)
    client.on('chatstate', (event) => {
      runSafe('chatstate', () => this.onChatstate(name, event))
    })

    client.on('group', (event) => {
      runSafe('group', () => this.onGroup(name, event))
    })

    // Contact/group avatar changed (WA notification type=picture)
    client.on('picture', (event) => {
      runSafe('picture', () => this.onPicture(name, client, event))
    })

    // VoIP events (plugin-extended on client)
    // biome-ignore lint/suspicious/noExplicitAny: voip event names are plugin-extended
    const onVoip = client.on.bind(client) as (event: string, fn: (payload: any) => void) => void

    onVoip('voip_call_incoming', (call) => {
      runSafe('voip_call_incoming', () => this.onVoipIncoming(name, call))
    })

    onVoip('voip_call_state', (call) => {
      runSafe('voip_call_state', () => this.onVoipState(name, call))
    })

    onVoip('voip_call_ended', (call) => {
      runSafe('voip_call_ended', () => this.onVoipEnded(name, call))
    })

    // Peer audio → optional call recording (even without softphone stream)
    // biome-ignore lint/suspicious/noExplicitAny: plugin event
    onVoip('voip_call_inbound_audio', (payload: { call: any; pcm: Float32Array }) => {
      const rec = this.opts.callRecording
      if (!rec || !payload?.call?.callId || !payload.pcm) return
      rec.appendRemote(name, payload.call.callId, payload.pcm)
    })

    void asVoipClient(client).voip
  }

  private async onAuthQr(name: string, qr: string, ttlMs: number): Promise<void> {
    const row = await this.persistStatus(name, { status: 'qr', lastQr: qr, lastQrAt: new Date() })
    if (row) await this.opts.webhooks.emit(row, 'instance.qr', { qr, ttlMs })
  }

  private async onAuthPaired(name: string, session: LiveSession, credentials: WaAuthCredentials): Promise<void> {
    const row = await this.persistStatus(name, {
      status: 'open',
      meJid: credentials.meJid ?? null,
      pushName: credentials.pushName ?? undefined,
      lastQr: null,
    })
    session.reconnectAttempt = 0
    if (row) {
      await this.opts.webhooks.emit(row, 'instance.paired', { meJid: credentials.meJid })
    }
  }

  private async onConnection(
    name: string,
    session: LiveSession,
    client: WaClient,
    event: WaConnectionEvent,
  ): Promise<void> {
    // During process shutdown, ignore close events (avoid pool-after-end races)
    if (this.shuttingDown) return
    if (event.status === 'open') {
      await this.onConnectionOpen(name, session, client, event)
      return
    }
    await this.onConnectionClosed(name, session, event)
  }

  private async onConnectionOpen(
    name: string,
    session: LiveSession,
    client: WaClient,
    event: ConnectionOpenEvent,
  ): Promise<void> {
    session.reconnectAttempt = 0
    const creds = client.getCredentials() as WaAuthCredentials | null
    const registered = Boolean(creds?.meJid)
    const nextStatus: InstanceStatus = registered ? 'open' : 'qr'
    const row = await this.persistStatus(name, {
      status: nextStatus,
      meJid: creds?.meJid ?? undefined,
      pushName: creds?.pushName ?? undefined,
    })
    if (row) {
      await this.opts.webhooks.emit(row, 'instance.connection', {
        status: event.status,
        registered,
        meJid: creds?.meJid ?? null,
        isNewLogin: event.isNewLogin,
      })
    }
    // Presence subscriptions are wiped by WA on reconnect — clients must re-subscribe.
    // Mark available so peers can send chatstate again.
    if (registered) await this.markAvailable(name, client)
  }

  private async onConnectionClosed(name: string, session: LiveSession, event: ConnectionCloseEvent): Promise<void> {
    const isLogout = Boolean(event.isLogout)
    const status: InstanceStatus = isLogout ? 'logged_out' : 'close'
    const row = await this.persistStatus(name, { status })
    if (row) {
      await this.opts.webhooks.emit(row, 'instance.connection', {
        status: 'close',
        reason: event.reason,
        code: event.code,
        isLogout,
      })
      if (isLogout) {
        await this.opts.webhooks.emit(row, 'instance.logged_out', { reason: event.reason })
      }
    }
    if (!isLogout && !session.disposed) this.scheduleReconnect(name, session)
  }

  private async onIncomingMessage(name: string, client: WaClient, event: WaIncomingMessageEvent): Promise<void> {
    const events = this.opts.events
    if (events) {
      // Pass client so media is downloaded+stored before webhooks
      await events.onMessage(name, event, 'live', client)
      return
    }
    const row = await this.getRecord(name)
    if (!row) return
    await this.opts.webhooks.emit(row, 'message.inbound', {
      key: event.key,
      message: event.message,
      timestampSeconds: event.timestampSeconds,
      pushName: event.pushName,
    })
  }

  // biome-ignore lint/suspicious/noExplicitAny: presence event
  private async onPresence(name: string, event: any): Promise<void> {
    const row = await this.getRecord(name)
    if (!row) return
    const rawChatId = (event?.chatJid ?? event?.from ?? null) as string | null
    const resolved = await this.resolvePresenceChatIds(name, rawChatId)
    await this.opts.webhooks.emit(row, 'presence.update', {
      chatId: resolved.canonical,
      chatIdRaw: rawChatId,
      aliases: resolved.aliases,
      type: event?.type ?? null,
      lastSeen: event?.lastSeen ?? null,
      groupOnlineCount: event?.groupOnlineCount ?? null,
    })
  }

  // biome-ignore lint/suspicious/noExplicitAny: chatstate event
  private async onChatstate(name: string, event: any): Promise<void> {
    const row = await this.getRecord(name)
    if (!row) return
    const rawChatId = (event?.chatJid ?? event?.from ?? null) as string | null
    const state = event?.state ?? null
    // media: 'audio' means recording voice note
    const media = event?.media ?? null
    const resolved = await this.resolvePresenceChatIds(name, rawChatId)
    this.log.debug({ instance: name, rawChatId, canonical: resolved.canonical, state, media }, 'chatstate received')
    await this.opts.webhooks.emit(row, 'chatstate', {
      // Prefer PN so dashboard chats (stored under PN) match
      chatId: resolved.canonical,
      chatIdRaw: rawChatId,
      aliases: resolved.aliases,
      state,
      media,
      participantJid: event?.participantJid ?? null,
      recording: state === 'composing' && media === 'audio',
      composing: state === 'composing' && media !== 'audio',
      paused: state === 'paused',
    })
  }

  private async onGroup(name: string, event: unknown): Promise<void> {
    const row = await this.getRecord(name)
    if (row) await this.opts.webhooks.emit(row, 'group.update', event)
  }

  // biome-ignore lint/suspicious/noExplicitAny: picture event shape from zapo
  private async onPicture(name: string, client: WaClient, event: any): Promise<void> {
    const row = await this.getRecord(name)
    if (!row) return

    const applied = await this.applyPicture(name, client, event)
    const primary = applied?.results?.[0]
    await this.opts.webhooks.emit(row, 'contact.picture', {
      action: applied?.action ?? event?.action ?? null,
      jid: applied?.jid ?? event?.targetJid ?? event?.chatJid ?? null,
      authorJid: event?.authorJid ?? null,
      pictureId: event?.pictureId ?? primary?.waPictureId ?? null,
      contactHash: event?.contactHash ?? null,
      timestampSeconds: event?.timestampSeconds ?? null,
      url: primary?.url ?? null,
      storageKey: primary?.storageKey ?? null,
      status: primary?.status ?? (applied?.action === 'delete' ? 'none' : null),
      revalidated: Boolean(applied && applied.action !== 'request'),
      deletedTypes: applied?.deleted ?? [],
    })
  }

  /** Download + persist the new avatar bytes; null when storage isn't configured or apply failed. */
  private async applyPicture(
    name: string,
    client: WaClient,
    // biome-ignore lint/suspicious/noExplicitAny: picture event shape from zapo
    event: any,
  ): Promise<Awaited<ReturnType<typeof applyPictureNotification>>> {
    const mediaStorage = this.opts.mediaStorage
    const avatars = this.avatars
    if (!mediaStorage || !avatars) {
      this.log.debug({ instance: name }, 'picture event ignored (no mediaStorage)')
      return null
    }
    try {
      return await applyPictureNotification({
        instanceName: name,
        event: {
          action: event?.action,
          targetJid: event?.targetJid,
          authorJid: event?.authorJid,
          pictureId: event?.pictureId,
          contactHash: event?.contactHash,
          chatJid: event?.chatJid,
          timestampSeconds: event?.timestampSeconds,
        },
        client,
        mediaStorage,
        avatars,
        contacts: this.opts.contacts,
        env: this.opts.env,
        resolveJid: (raw) => toRecipientJid(raw),
      })
    } catch (err) {
      this.log.warn({ err, instance: name, event }, 'picture notification apply failed')
      return null
    }
  }

  // biome-ignore lint/suspicious/noExplicitAny: CallInfo from voip plugin
  private async onVoipIncoming(name: string, call: any): Promise<void> {
    const row = await this.getRecord(name)
    if (!row) return
    const snap = await this.enrichCallPayload(name, call)
    const rec = this.opts.callRecording
    if (rec) {
      await rec.onCallStarted(name, {
        callId: call.callId,
        // Prefer display PN so history shows the real number, not LID
        peerJid: snap.peerJid ?? call.peerJid,
        direction: call.direction ?? 'inbound',
        mediaType: call.mediaType,
        state: call.stateData?.state ?? 'ringing',
      })
    }
    await this.opts.webhooks.emit(row, 'call.incoming', snap)
  }

  // biome-ignore lint/suspicious/noExplicitAny: CallInfo from voip plugin
  private async onVoipState(name: string, call: any): Promise<void> {
    const row = await this.getRecord(name)
    if (!row) return
    const snap = await this.enrichCallPayload(name, call)
    const rec = this.opts.callRecording
    if (rec) {
      await rec.onCallState(name, {
        callId: call.callId,
        peerJid: snap.peerJid ?? call.peerJid,
        direction: call.direction,
        state: call.stateData?.state,
      })
    }
    await this.opts.webhooks.emit(row, 'call.state', snap)
  }

  // biome-ignore lint/suspicious/noExplicitAny: CallInfo from voip plugin
  private async onVoipEnded(name: string, call: any): Promise<void> {
    const row = await this.getRecord(name)
    if (!row) return
    const snap = await this.enrichCallPayload(name, call)
    const rec = this.opts.callRecording
    if (rec) {
      await rec.onCallEnded(name, {
        callId: call.callId,
        endReason: call.stateData?.endReason,
        durationSecs: call.stateData?.durationSecs,
        state: 'ended',
      })
    }
    await this.opts.webhooks.emit(row, 'call.ended', snap)
  }

  /** Mark the account available (required by WA before peers send us chatstate). */
  private async markAvailable(name: string, client: WaClient): Promise<void> {
    try {
      await client.presence.send('available')
    } catch (err) {
      this.log.debug({ err, instance: name }, 'presence available failed')
    }
  }

  private scheduleReconnect(name: string, session: LiveSession): void {
    if (session.disposed) return
    if (session.reconnectAttempt >= this.opts.env.RECONNECT_MAX_ATTEMPTS) {
      this.log.error({ name }, 'giving up reconnect')
      return
    }
    const delay = Math.min(30_000, 1_000 * 2 ** session.reconnectAttempt)
    session.reconnectAttempt += 1
    this.log.info({ name, delay, attempt: session.reconnectAttempt }, 'scheduling reconnect')
    this.clearReconnect(session)
    session.reconnectTimer = setTimeout(() => {
      void (async () => {
        if (session.disposed) return
        try {
          await this.persistStatus(name, { status: 'connecting' })
          await session.client.connect()
        } catch (err) {
          this.log.error({ err, name }, 'reconnect failed')
          this.scheduleReconnect(name, session)
        }
      })()
    }, delay)
    session.reconnectTimer.unref?.()
  }

  private clearReconnect(session: LiveSession): void {
    if (session.reconnectTimer) {
      clearTimeout(session.reconnectTimer)
      session.reconnectTimer = null
    }
  }

  /**
   * Expand a presence/chatstate `from` JID into PN-canonical + all LID aliases
   * so consumers matching either form receive the event.
   */
  private async resolvePresenceChatIds(
    instanceName: string,
    chatId: string | null,
  ): Promise<{ canonical: string | null; aliases: string[] }> {
    if (!chatId) return { canonical: null, aliases: [] }
    const lidMap = this.opts.lidMap
    if (!lidMap) return { canonical: chatId, aliases: [chatId] }
    try {
      // Single lookup pass for canonical PN + aliases (avoids a duplicate findPnByLid).
      const { canonical, aliases } = await lidMap.expandWithCanonical(instanceName, chatId)
      return { canonical, aliases: aliases.length ? aliases : [chatId] }
    } catch (err) {
      this.log.debug({ err, instanceName, chatId }, 'resolvePresenceChatIds failed; using raw chatId')
      return { canonical: chatId, aliases: [chatId] }
    }
  }

  /**
   * Prefer phone number over opaque `@lid` for call UI/history.
   * Learns LID↔PN when WhatsApp sends `callerPn` with a LID peer.
   */
  // biome-ignore lint/suspicious/noExplicitAny: CallInfo from voip plugin
  private async enrichCallPayload(instanceName: string, call: any) {
    const peer = typeof call?.peerJid === 'string' ? call.peerJid : null
    const callerPn = typeof call?.callerPn === 'string' ? call.callerPn : null
    let mappedPn: string | null = null
    const lidMap = this.opts.lidMap

    if (lidMap && peer && isLidJid(peer)) {
      const pnFromCaller = asPhoneJid(callerPn)
      if (pnFromCaller) {
        try {
          await lidMap.save(instanceName, peer, pnFromCaller)
        } catch (err) {
          this.log.debug({ err, instanceName, peer }, 'lid map save (callerPn) failed')
        }
        mappedPn = pnFromCaller
      } else {
        try {
          mappedPn = await lidMap.findPnByLid(instanceName, peer)
        } catch (err) {
          this.log.debug({ err, instanceName, peer }, 'lid map findPnByLid failed')
          mappedPn = null
        }
      }
    }

    return serializeCallInfo(call, { mappedPn })
  }

  /**
   * Subscribe to presence + chatstate for a chat, including LID/PN aliases.
   * Also marks the account available (required by WA for peer chatstates).
   */
  async subscribePresence(instanceName: string, jid: string): Promise<{ jids: string[] }> {
    const client = this.requireRegisteredClient(instanceName)
    // Accept national BR without 55 and either nono-dígito form
    const base = await resolveRecipientJid(client, jid, this.opts.cache)
    const lidMap = this.opts.lidMap
    const targets = new Set<string>([base])
    if (lidMap) {
      try {
        for (const a of await lidMap.expandAliases(instanceName, base)) {
          targets.add(a)
        }
      } catch (err) {
        this.log.debug({ err, instanceName, base }, 'expandAliases failed; subscribing base only')
      }
    }

    // Being "available" is required for many peers to send us chatstate
    await this.markAvailable(instanceName, client)

    const subscribed: string[] = []
    for (const target of targets) {
      try {
        await client.presence.subscribe(target)
        subscribed.push(target)
      } catch (err) {
        this.log.warn({ err, instanceName, target }, 'presence.subscribe failed')
      }
    }
    this.log.info({ instanceName, subscribed }, 'presence subscribed')
    return { jids: subscribed }
  }

  async shutdown(): Promise<void> {
    this.shuttingDown = true
    this.sessionQueues.clear()

    const sessions = [...this.sessions.entries()]
    this.sessions.clear()

    // Do NOT await long WA disconnect — race each client, then drop references so
    // GC + hardExit(SIGKILL) can reclaim native sockets (wrtc / ws keepalive).
    await Promise.all(
      sessions.map(async ([name, session]) => {
        session.disposed = true
        this.clearReconnect(session)
        // biome-ignore lint/suspicious/noExplicitAny: WaClient internals
        const c = session.client as any
        try {
          // Prefer connectionManager if present (faster path than full disconnect side-effects)
          const disc = typeof c.disconnect === 'function' ? c.disconnect() : Promise.resolve()
          await Promise.race([
            Promise.resolve(disc).then(() => undefined),
            new Promise<void>((resolve) => {
              setTimeout(resolve, 250)
            }),
          ])
        } catch (err) {
          this.log.warn({ err, name }, 'disconnect on shutdown failed')
        }
        try {
          c.removeAllListeners?.()
          // Stop keepalive timers if still reachable
          c.deps?.connectionManager?.keepAlive?.stop?.()
          c.deps?.keepAlive?.stop?.()
        } catch (err) {
          this.log.debug({ err, name }, 'listener cleanup on shutdown failed')
        }
      }),
    )

    if (this.runtime?.store) {
      void this.runtime.store.destroy().catch(() => undefined)
      this.runtime = null
    }
  }
}
