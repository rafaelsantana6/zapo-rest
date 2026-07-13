import type { WaClient } from 'zapo-js'
import type { Env } from '~/config/env'
import type { InstanceRepo } from '~/instances/repo'
import type { InstanceRecord } from '~/instances/types'
import { isLidJid, isPnJid, toPnJid } from '~/lib/jid-canon'
import { getLogger } from '~/lib/logger'
import { Semaphore } from '~/lib/semaphore'
import type { MediaStorage } from '~/media/storage'
import type { ChatStore } from '~/store/chats'
import type { ContactStore } from '~/store/contacts'
import type { EventIdempotencyStore } from '~/store/events'
import type { LidMapStore } from '~/store/lid-map'
import type { AppMessage, MessageStore } from '~/store/messages'
import type { WebhookDispatcher } from '~/webhooks/dispatcher'
import { type DecodedMessage, decodeIncomingMessage, previewFromDecoded } from './decode-message'

/** Element shape of a zapo mailbox thread's message list (loose — store is untyped). */
type ZapoThreadMessage = {
  id: string
  threadJid?: string
  senderJid?: string
  participantJid?: string
  fromMe?: boolean
  timestampMs?: number
  messageBytes?: unknown
}

export type EventProcessorDeps = {
  env: Env
  instanceRepo: InstanceRepo
  messages: MessageStore
  chats: ChatStore
  contacts: ContactStore
  idempotency: EventIdempotencyStore
  webhooks: WebhookDispatcher
  mediaStorage: MediaStorage
  lidMap?: LidMapStore
  /** Optional pool for bulk reconcile after history import */
  pool?: import('pg').Pool
}

/**
 * Idempotent event processor: upsert messages/chats, fire webhooks once.
 *
 * Architecture choice (vs full event-sourcing):
 * - Messages are **upserted** by (instance, message_id) — idempotent by message id.
 * - Edits/acks/deletes **update the row**, they don't append a new event log.
 * - `processed_events` is a short-lived dedupe ledger for webhook/side-effects only.
 * Full event-sourcing would add write amp + complexity without UX benefit for chat history.
 */
export class EventProcessor {
  private readonly log = getLogger({ component: 'event-processor' })
  /** Process-wide cap on concurrent WA media downloads (live + history). */
  private readonly mediaSem: Semaphore
  /** Debounce timers for full mailbox import after history chunks. */
  private readonly historyImportTimers = new Map<string, ReturnType<typeof setTimeout>>()
  private readonly historyImportInFlight = new Set<string>()
  private readonly historyImportPending = new Set<string>()
  private readonly historyClients = new Map<string, WaClient>()

  constructor(private readonly deps: EventProcessorDeps) {
    this.mediaSem = new Semaphore(deps.env.MEDIA_DOWNLOAD_CONCURRENCY)
  }

  /**
   * Process inbound message. Prefer passing `client` so media can be decrypted
   * and stored before webhooks fire ( parity).
   */
  async onMessage(
    instanceName: string,
    event: unknown,
    source: 'live' | 'history' = 'live',
    client: WaClient | null = null,
  ): Promise<void> {
    const decoded = decodeIncomingMessage(event)
    if (!decoded) return

    // Persist LID↔PN from message key / remoteJidAlt
    if (decoded.lidPnPair && this.deps.lidMap) {
      await this.recordLidPn(instanceName, decoded.lidPnPair.lid, decoded.lidPnPair.pn)
    }

    const chatJid = await this.canonicalChatJid(instanceName, decoded.chatJid)
    const isNew = await this.deps.idempotency.tryClaim(instanceName, `msg:${decoded.messageId}`, 'message')

    let msg = await this.projectMessage(instanceName, decoded, chatJid, source)
    await this.projectChat(instanceName, decoded, chatJid)
    await this.projectContact(instanceName, decoded, chatJid)
    msg = await this.maybeDownloadMedia(instanceName, event, decoded, source, client, msg)

    if (!this.shouldEmit(isNew, source)) return

    const row = await this.deps.instanceRepo.getByName(instanceName)
    if (!row) return
    await this.emitMessage(row, instanceName, decoded, chatJid, msg)
  }

  /** Prefer the PN form via lid_map when the stanza only carried a LID. */
  private async canonicalChatJid(instanceName: string, chatJid: string): Promise<string> {
    if (this.deps.lidMap && isLidJid(chatJid)) {
      return this.deps.lidMap.resolveCanonical(instanceName, chatJid)
    }
    return chatJid
  }

  /** Upsert the message row. Seeds mediaUrl with the WA CDN url; storage may overwrite later. */
  private projectMessage(
    instanceName: string,
    decoded: DecodedMessage,
    chatJid: string,
    source: 'live' | 'history',
  ): Promise<AppMessage> {
    return this.deps.messages.upsert({
      instanceName,
      messageId: decoded.messageId,
      chatJid,
      senderJid: decoded.senderJid,
      participantJid: decoded.participantJid,
      fromMe: decoded.fromMe,
      timestampMs: decoded.timestampMs,
      type: decoded.type,
      body: decoded.body,
      caption: decoded.caption,
      hasMedia: decoded.hasMedia,
      mediaMime: decoded.mediaMime,
      mediaFilename: decoded.mediaFilename,
      mediaUrl: decoded.mediaDirectUrl,
      pushName: decoded.pushName,
      source,
      raw: decoded.raw,
    })
  }

  /** Bump chat preview for user-visible content; still upsert (name/group) for pure protocol. */
  private async projectChat(instanceName: string, decoded: DecodedMessage, chatJid: string): Promise<void> {
    const preview = previewFromDecoded(decoded)
    const base = { instanceName, chatJid, name: decoded.pushName, isGroup: chatJid.endsWith('@g.us') }
    if (preview || decoded.type !== 'protocol') {
      await this.deps.chats.upsert({
        ...base,
        lastMessageId: decoded.messageId,
        lastMessagePreview: preview ?? null,
        lastMessageTs: decoded.timestampMs,
      })
      return
    }
    await this.deps.chats.upsert(base)
  }

  /** Upsert the contact (LID/PN + phone) for inbound messages that carry a pushName. */
  private async projectContact(instanceName: string, decoded: DecodedMessage, chatJid: string): Promise<void> {
    if (!decoded.pushName || decoded.fromMe) return
    const contactJid = isPnJid(chatJid) ? chatJid : (decoded.lidPnPair?.pn ?? decoded.senderJid ?? chatJid)
    await this.deps.contacts.upsert({
      instanceName,
      jid: contactJid,
      pushName: decoded.pushName,
      lid: decoded.lidPnPair?.lid ?? (isLidJid(decoded.remoteJid) ? decoded.remoteJid : null),
      phoneNumber: decoded.lidPnPair?.pn
        ? (decoded.lidPnPair.pn.split('@')[0] ?? null)
        : isPnJid(chatJid)
          ? (chatJid.split('@')[0] ?? null)
          : null,
      lastUpdatedMs: decoded.timestampMs,
    })
  }

  /**
   * Media download pipeline + S3 object storage (when configured).
   * Live + history: async via a process-wide semaphore so the session queue
   * is not blocked by CDN/WA downloads.
   *
   * Two-stage realtime (live only):
   * 1. `message` already emitted with mediaStage=meta
   * 2. `message.media.stored` | `message.media.failed` after CAS (or failure)
   */
  private async maybeDownloadMedia(
    instanceName: string,
    event: unknown,
    decoded: DecodedMessage,
    source: 'live' | 'history',
    client: WaClient | null,
    msg: AppMessage,
  ): Promise<AppMessage> {
    if (!decoded.hasMedia || !this.deps.env.MEDIA_AUTO_DOWNLOAD || !client) return msg
    const emitMediaEvents = source === 'live'
    void this.mediaSem
      .run(() =>
        this.downloadAndStoreMedia(instanceName, client, event, decoded.messageId, {
          emitMediaEvents,
          chatJid: msg.chatJid,
          type: msg.type,
          fromMe: msg.fromMe,
          mediaMime: msg.mediaMime ?? decoded.mediaMime,
          mediaFilename: msg.mediaFilename ?? decoded.mediaFilename,
        }),
      )
      .catch((err) => {
        this.log.debug({ err, messageId: decoded.messageId, source }, 'media download failed')
      })
    return msg
  }

  /** First-claim gate: live replays skip webhooks; history never webhooks (flood control). */
  private shouldEmit(isNew: boolean, source: 'live' | 'history'): boolean {
    if (source === 'history') return false
    return isNew
  }

  private async emitMessage(
    row: InstanceRecord,
    instanceName: string,
    decoded: DecodedMessage,
    chatJid: string,
    msg: AppMessage,
  ): Promise<void> {
    const publicPayload = this.buildMessagePayload(instanceName, decoded, chatJid, msg, {
      mediaStage: msg.hasMedia ? 'meta' : null,
    })
    await this.deps.webhooks.emit(row, 'message', publicPayload)
    await this.deps.webhooks.emit(row, 'message.any', publicPayload)
    // legacy
    if (!decoded.fromMe) {
      await this.deps.webhooks.emit(row, 'message.inbound', publicPayload)
    }
  }

  private buildMessagePayload(
    instanceName: string,
    decoded: DecodedMessage,
    chatJid: string,
    msg: AppMessage,
    opts?: { mediaStage?: 'meta' | 'stored' | 'failed' | null },
  ) {
    const apiMediaPath = msg.hasMedia
      ? `/v1/instances/${encodeURIComponent(instanceName)}/messages/${encodeURIComponent(msg.messageId)}/media`
      : null
    return {
      id: msg.messageId,
      chatId: chatJid,
      from: msg.senderJid,
      participant: msg.participantJid,
      fromMe: msg.fromMe,
      timestamp: msg.timestampMs,
      type: msg.type,
      body: msg.body,
      caption: msg.caption,
      hasMedia: msg.hasMedia,
      mediaStage: opts?.mediaStage ?? (msg.mediaStorageKey ? 'stored' : msg.hasMedia ? 'meta' : null),
      mediaUrl: this.preferredMediaUrl(msg, decoded, apiMediaPath),
      mediaMime: msg.mediaMime ?? decoded.mediaMime,
      mediaFilename: msg.mediaFilename ?? decoded.mediaFilename,
      mediaStorageKey: msg.mediaStorageKey,
      mediaDirectUrl: decoded.mediaDirectUrl,
      pushName: msg.pushName,
      ack: msg.ack,
      lid: decoded.lidPnPair?.lid ?? null,
      pn: decoded.lidPnPair?.pn ?? (isPnJid(chatJid) ? chatJid : null),
      _data: msg.raw,
    }
  }

  /** Prefer permanent storage URL; fall back to API path (live decrypt); then WA CDN. */
  private preferredMediaUrl(msg: AppMessage, decoded: DecodedMessage, apiMediaPath: string | null): string | null {
    const storageUrl = msg.mediaUrl
    if (storageUrl && !storageUrl.includes('mmg.whatsapp.net')) return storageUrl
    if (msg.mediaStorageKey) return storageUrl ?? apiMediaPath
    return apiMediaPath ?? decoded.mediaDirectUrl ?? storageUrl
  }

  async onReceipt(instanceName: string, event: unknown): Promise<void> {
    // biome-ignore lint/suspicious/noExplicitAny: zapo receipt shape
    const e = event as any
    const ids = extractReceiptIds(e)
    const status = mapAck(e?.status ?? e?.type)
    if (!ids.length || status == null) return

    const row = await this.deps.instanceRepo.getByName(instanceName)
    for (const id of ids) {
      const claimed = await this.deps.idempotency.tryClaim(instanceName, `ack:${id}:${status}`, 'message.ack')
      const updated = await this.deps.messages.updateAck(instanceName, id, status)
      if (claimed && row && updated) {
        await this.deps.webhooks.emit(row, 'message.ack', {
          id,
          chatId: updated.chatJid,
          ack: status,
          fromMe: updated.fromMe,
        })
      }
    }
  }

  async onProtocol(instanceName: string, event: unknown): Promise<void> {
    // biome-ignore lint/suspicious/noExplicitAny: protocol message
    const e = event as any
    const protocol = e?.message?.protocolMessage ?? e?.protocolMessage
    if (!protocol) return

    const row = await this.deps.instanceRepo.getByName(instanceName)
    const type = protocol.type
    const keyId = protocol.key?.id as string | undefined

    // REVOKE
    if ((type === 0 || type === 'REVOKE') && keyId) {
      const claimed = await this.deps.idempotency.tryClaim(instanceName, `revoke:${keyId}`, 'message.revoked')
      const updated = await this.deps.messages.markDeleted(instanceName, keyId)
      if (claimed && row) {
        await this.deps.webhooks.emit(row, 'message.revoked', {
          revokedMessageId: keyId,
          after: updated,
        })
      }
      return
    }

    // EDIT
    if ((type === 14 || type === 'MESSAGE_EDIT') && keyId) {
      const edited = protocol.editedMessage
      const body =
        edited?.conversation ??
        edited?.extendedTextMessage?.text ??
        (typeof edited?.text === 'string' ? edited.text : null)
      if (body) {
        const claimed = await this.deps.idempotency.tryClaim(
          instanceName,
          `edit:${keyId}:${body.slice(0, 32)}`,
          'message.edited',
        )
        const updated = await this.deps.messages.markEdited(instanceName, keyId, String(body), e)
        if (claimed && row && updated) {
          await this.deps.webhooks.emit(row, 'message.edited', {
            id: keyId,
            body,
            editedMessageId: keyId,
            chatId: updated.chatJid,
          })
        }
      }
    }
  }

  async onHistorySync(instanceName: string, event: unknown, client: WaClient | null): Promise<void> {
    const row = await this.deps.instanceRepo.getByName(instanceName)
    if (row) {
      await this.deps.webhooks.emit(row, 'history.sync', event)
    }

    // Mirror zapo mailbox into app projections (debounced — every chunk used to
    // re-scan the entire mailbox on the live session queue).
    if (!client) return
    this.scheduleHistoryImport(instanceName, client)
  }

  /**
   * Coalesce rapid history_sync_chunk storms into one full import + reconcile.
   * Debounce window from HISTORY_IMPORT_DEBOUNCE_MS (0 = immediate, still serialised).
   */
  private scheduleHistoryImport(instanceName: string, client: WaClient): void {
    this.historyClients.set(instanceName, client)
    this.historyImportPending.add(instanceName)

    const debounceMs = this.deps.env.HISTORY_IMPORT_DEBOUNCE_MS
    const existing = this.historyImportTimers.get(instanceName)
    if (existing) clearTimeout(existing)

    if (debounceMs === 0) {
      void this.runHistoryImport(instanceName)
      return
    }

    const timer = setTimeout(() => {
      this.historyImportTimers.delete(instanceName)
      void this.runHistoryImport(instanceName)
    }, debounceMs)
    timer.unref?.()
    this.historyImportTimers.set(instanceName, timer)
  }

  private async runHistoryImport(instanceName: string): Promise<void> {
    if (this.historyImportInFlight.has(instanceName)) {
      // Another run is active — leave pending so we re-run after it finishes.
      this.historyImportPending.add(instanceName)
      return
    }

    const client = this.historyClients.get(instanceName)
    if (!client) return

    this.historyImportInFlight.add(instanceName)
    this.historyImportPending.delete(instanceName)
    try {
      await this.importFromZapoStore(instanceName, client)
      if (this.deps.lidMap && this.deps.pool) {
        const { reconcileLidChats } = await import('~/store/chat-reconcile')
        await reconcileLidChats(this.deps.pool, instanceName, {
          lidMap: this.deps.lidMap,
          chats: this.deps.chats,
          messages: this.deps.messages,
        })
      }
    } catch (err) {
      this.log.warn({ err, instanceName }, 'history import from zapo store failed')
    } finally {
      this.historyImportInFlight.delete(instanceName)
      if (this.historyImportPending.has(instanceName)) {
        // Chunks arrived during the run — schedule one more pass.
        const c = this.historyClients.get(instanceName)
        if (c) this.scheduleHistoryImport(instanceName, c)
      }
    }
  }

  /**
   * Copy recent threads/messages from zapo postgres mailbox into app_* tables.
   * Does NOT create empty LID contact-threads as chats (that inflated the list).
   * Contacts are imported first so lid_map can resolve PN before chats land.
   */
  async importFromZapoStore(instanceName: string, client: WaClient): Promise<{ chats: number; messages: number }> {
    // biome-ignore lint/suspicious/noExplicitAny: internal store access
    const store = (client as any).store ?? (client as any).options?.store
    if (!store) return { chats: 0, messages: 0 }

    const session = typeof store.session === 'function' ? store.session(instanceName) : store
    const contactStore = session?.contacts ?? session?.contactStore
    const threadStore = session?.threads ?? session?.threadStore
    const messageStore = session?.messages ?? session?.messageStore

    // Contacts first so lid_map can resolve PN before threads land.
    await this.importZapoContacts(instanceName, contactStore)
    const { chats, messages } = await this.importZapoThreads(instanceName, threadStore, messageStore)

    this.log.info({ instanceName, chats, messages }, 'imported from zapo store')
    return { chats, messages }
  }

  // biome-ignore lint/suspicious/noExplicitAny: zapo mailbox contact store
  private async importZapoContacts(instanceName: string, contactStore: any): Promise<void> {
    // WaContactStore (zapo-js / store-postgres) has getByJid/upsert — no list().
    // Older fakes and some backends may expose list(); otherwise read mailbox SQL.
    const contacts = await this.loadZapoMailboxContacts(instanceName, contactStore)
    for (const c of contacts) {
      if (!c?.jid) continue
      await this.deps.contacts.upsert({
        instanceName,
        jid: String(c.jid),
        displayName: c.displayName ?? null,
        pushName: c.pushName ?? null,
        lid: c.lid ?? null,
        phoneNumber: c.phoneNumber ?? null,
        lastUpdatedMs: c.lastUpdatedMs ?? null,
        raw: c,
      })
      await this.recordContactLidPn(instanceName, c)
    }
  }

  /**
   * Load mailbox contacts for history import.
   * Prefer store.list when present; fall back to `mailbox_contacts` via pool.
   */
  // biome-ignore lint/suspicious/noExplicitAny: zapo mailbox contact store
  private async loadZapoMailboxContacts(instanceName: string, contactStore: any): Promise<any[]> {
    if (typeof contactStore?.list === 'function') {
      const rows = await contactStore.list()
      return Array.isArray(rows) ? rows : []
    }
    if (!this.deps.pool) {
      this.log.debug({ instanceName }, 'contact store has no list() and no pool — skip contact import')
      return []
    }
    try {
      // Table name from @zapo-js/store-postgres (empty tablePrefix default).
      const { rows } = await this.deps.pool.query<{
        jid: string
        display_name: string | null
        push_name: string | null
        lid: string | null
        phone_number: string | null
        last_updated_ms: string | number | null
      }>(
        `SELECT jid, display_name, push_name, lid, phone_number, last_updated_ms
         FROM mailbox_contacts
         WHERE session_id = $1
         ORDER BY last_updated_ms DESC NULLS LAST
         LIMIT 5000`,
        [instanceName],
      )
      return rows.map((r) => ({
        jid: r.jid,
        displayName: r.display_name,
        pushName: r.push_name,
        lid: r.lid,
        phoneNumber: r.phone_number,
        lastUpdatedMs: r.last_updated_ms == null ? null : Number(r.last_updated_ms),
      }))
    } catch (err) {
      // Table may not exist yet on brand-new DB before first mailbox migrate.
      this.log.debug({ err, instanceName }, 'mailbox_contacts query failed — skip contact import')
      return []
    }
  }

  /** Derive a LID↔PN mapping from a zapo mailbox contact and persist it. */
  // biome-ignore lint/suspicious/noExplicitAny: zapo mailbox contact
  private async recordContactLidPn(instanceName: string, c: any): Promise<void> {
    if (!this.deps.lidMap || !c.phoneNumber) return
    const pn = String(c.phoneNumber).includes('@')
      ? String(c.phoneNumber)
      : `${String(c.phoneNumber).replace(/\D/g, '')}@s.whatsapp.net`
    if (!isPnJid(pn)) return
    if (c.lid) {
      const lid = String(c.lid).includes('@') ? String(c.lid) : `${c.lid}@lid`
      if (isLidJid(lid)) await this.recordLidPn(instanceName, lid, pn)
      return
    }
    if (isLidJid(c.jid)) await this.recordLidPn(instanceName, c.jid, pn)
  }

  /** Materialize only threads that already have mailbox messages (skip @lid ghosts). */
  private async importZapoThreads(
    instanceName: string,
    // biome-ignore lint/suspicious/noExplicitAny: zapo thread store
    threadStore: any,
    // biome-ignore lint/suspicious/noExplicitAny: zapo message store
    messageStore: any,
  ): Promise<{ chats: number; messages: number }> {
    // WaThreadStore.list exists; don't call it as a truthiness probe (that double-fires).
    if (typeof threadStore?.list !== 'function') return { chats: 0, messages: 0 }
    const threads = await threadStore.list()
    let chats = 0
    let messages = 0
    for (const t of threads ?? []) {
      const imported = await this.importZapoThread(instanceName, t, messageStore)
      chats += imported.chats
      messages += imported.messages
    }
    return { chats, messages }
  }

  private async importZapoThread(
    instanceName: string,
    // biome-ignore lint/suspicious/noExplicitAny: zapo thread row
    t: any,
    // biome-ignore lint/suspicious/noExplicitAny: zapo message store
    messageStore: any,
  ): Promise<{ chats: number; messages: number }> {
    const threadJid = String(t.jid)
    if (threadJid === '0@s.whatsapp.net' || threadJid.endsWith('@broadcast')) return { chats: 0, messages: 0 }

    const threadMsgs: readonly ZapoThreadMessage[] = messageStore?.listByThread
      ? ((await messageStore.listByThread(threadJid, 50)) ?? [])
      : []

    // Skip empty contact ghosts (majority of @lid noise)
    if (threadMsgs.length === 0 && !t.name && !t.unreadCount) return { chats: 0, messages: 0 }

    let chatJid = threadJid
    if (this.deps.lidMap && isLidJid(threadJid)) {
      chatJid = await this.deps.lidMap.resolveCanonical(instanceName, threadJid)
    }
    // Still LID with no PN and no real msgs → skip (don't pollute list)
    if (isLidJid(chatJid) && threadMsgs.length === 0) return { chats: 0, messages: 0 }

    const { lastId, lastTs, count } = await this.importThreadMessages(instanceName, threadMsgs, chatJid)

    if (threadMsgs.length === 0 && !t.name && !t.unreadCount) return { chats: 0, messages: count }
    await this.deps.chats.upsert({
      instanceName,
      chatJid,
      name: t.name ?? null,
      isGroup: chatJid.endsWith('@g.us'),
      unreadCount: t.unreadCount ?? 0,
      archived: t.archived ?? false,
      pinned: t.pinned ?? 0,
      muteEndMs: t.muteEndMs ?? null,
      markedAsUnread: t.markedAsUnread ?? false,
      lastMessageId: lastId,
      lastMessageTs: lastTs,
      lastMessagePreview: lastId ? '[histórico]' : null,
      raw: t,
    })
    return { chats: 1, messages: count }
  }

  private async importThreadMessages(
    instanceName: string,
    threadMsgs: readonly ZapoThreadMessage[],
    chatJid: string,
  ): Promise<{ lastId: string | null; lastTs: number | null; count: number }> {
    let lastId: string | null = null
    let lastTs: number | null = null
    let count = 0
    for (const m of threadMsgs) {
      const msgChat = await this.canonicalThreadJid(instanceName, m.threadJid, chatJid)
      await this.deps.messages.upsert({
        instanceName,
        messageId: m.id,
        chatJid: msgChat,
        senderJid: m.senderJid ?? null,
        participantJid: m.participantJid ?? null,
        fromMe: Boolean(m.fromMe),
        timestampMs: m.timestampMs ?? null,
        type: 'unknown',
        source: 'history',
        raw: { fromZapoStore: true, hasBytes: Boolean(m.messageBytes) },
      })
      count++
      if (m.timestampMs != null && (lastTs == null || m.timestampMs >= lastTs)) {
        lastTs = m.timestampMs
        lastId = m.id
      }
    }
    return { lastId, lastTs, count }
  }

  /** Per-message thread jid, canonicalized to PN when a lid_map is available. */
  private async canonicalThreadJid(
    instanceName: string,
    threadJid: string | undefined,
    fallback: string,
  ): Promise<string> {
    if (!threadJid) return fallback
    if (this.deps.lidMap) return this.deps.lidMap.resolveCanonical(instanceName, threadJid)
    return threadJid
  }

  /**
   * Record LID↔PN and re-key any historical messages/chats that used the LID.
   */
  async recordLidPn(instanceName: string, lid: string, pn: string): Promise<void> {
    if (!this.deps.lidMap) return
    const pnNorm = toPnJid(pn)
    await this.deps.lidMap.save(instanceName, lid, pnNorm)
    // Move messages + merge chat rows (multi-config)
    await this.deps.messages.rekeyChat(instanceName, lid, pnNorm)
    await this.deps.chats.mergeLidIntoPn(instanceName, lid, pnNorm)
  }

  /**
   * Download media with retries (retry with backoff pattern: 5×, 1–3s backoff).
   * On success: store in local/S3, set media_url, emit `message.media.stored` (live).
   * On failure: leave WA CDN url fallback; emit `message.media.failed` (live).
   */
  async downloadAndStoreMedia(
    instanceName: string,
    client: WaClient,
    event: unknown,
    messageId: string,
    opts?: {
      emitMediaEvents?: boolean
      chatJid?: string | null
      type?: string
      fromMe?: boolean
      mediaMime?: string | null
      mediaFilename?: string | null
    },
  ): Promise<void> {
    const retries = 5
    let lastErr: unknown
    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        const buf = await client.message.downloadBytes(event as never)
        // biome-ignore lint/suspicious/noExplicitAny: media meta
        const msg = (event as any)?.message
        const mime =
          opts?.mediaMime ??
          msg?.imageMessage?.mimetype ??
          msg?.videoMessage?.mimetype ??
          msg?.audioMessage?.mimetype ??
          msg?.documentMessage?.mimetype ??
          msg?.stickerMessage?.mimetype ??
          undefined
        const filename = opts?.mediaFilename ?? (msg?.documentMessage?.fileName as string | undefined) ?? undefined
        // Content-addressed put: same bytes on this instance → one object (inbound + outbound share).
        const stored = await this.deps.mediaStorage.put(instanceName, buf, {
          mimeType: mime,
          filename,
          messageId,
        })
        if (stored.deduped) {
          this.log.debug(
            { instanceName, messageId, sha256: stored.sha256, storageKey: stored.storageKey },
            'inbound media deduped (reused existing CAS object)',
          )
        }
        // Prefer browser-fetchable permanent URL; R2 S3 API hosts are private → use API path
        // (GET with X-Api-Key; may 302 to a presigned URL when MEDIA_REDIRECT_DOWNLOADS=true).
        const apiMediaPath = `/v1/instances/${encodeURIComponent(instanceName)}/messages/${encodeURIComponent(messageId)}/media`
        const url = browserFetchableMediaUrl(stored.url) ?? apiMediaPath
        await this.deps.messages.setMedia(instanceName, messageId, {
          url,
          storageKey: stored.storageKey,
          mime: stored.mimeType ?? mime ?? null,
          filename: filename ?? null,
        })
        if (opts?.emitMediaEvents) {
          await this.emitMediaStored(instanceName, messageId, {
            chatJid: opts.chatJid,
            type: opts.type,
            fromMe: opts.fromMe,
            mediaUrl: url,
            mediaStorageKey: stored.storageKey,
            mediaMime: stored.mimeType ?? mime ?? null,
            mediaFilename: filename ?? null,
            sizeBytes: stored.sizeBytes ?? buf.byteLength,
            sha256: stored.sha256 ?? null,
          })
        }
        return
      } catch (err) {
        lastErr = err
        if (attempt < retries) {
          const delay = Math.min(3000, 1000 * attempt)
          await new Promise((r) => setTimeout(r, delay))
        }
      }
    }
    this.log.warn({ err: lastErr, messageId, instanceName }, 'downloadAndStoreMedia failed after retries')
    if (opts?.emitMediaEvents) {
      await this.emitMediaFailed(instanceName, messageId, {
        chatJid: opts.chatJid,
        type: opts.type,
        fromMe: opts.fromMe,
        error: lastErr instanceof Error ? lastErr.message : String(lastErr ?? 'download failed'),
      })
    }
  }

  /** Stage-2 success: media is in CAS / projection updated. Idempotent via processed_events. */
  private async emitMediaStored(
    instanceName: string,
    messageId: string,
    data: {
      chatJid?: string | null
      type?: string
      fromMe?: boolean
      mediaUrl: string
      mediaStorageKey: string
      mediaMime: string | null
      mediaFilename: string | null
      sizeBytes: number | null
      sha256: string | null
    },
  ): Promise<void> {
    const claimed = await this.deps.idempotency.tryClaim(
      instanceName,
      `media-store:${messageId}`,
      'message.media.stored',
    )
    if (!claimed) return
    const row = await this.deps.instanceRepo.getByName(instanceName)
    if (!row) return
    const payload = {
      id: messageId,
      chatId: data.chatJid ?? null,
      type: data.type ?? null,
      fromMe: data.fromMe ?? false,
      hasMedia: true,
      mediaStage: 'stored' as const,
      mediaUrl: data.mediaUrl,
      mediaStorageKey: data.mediaStorageKey,
      mediaMime: data.mediaMime,
      mediaFilename: data.mediaFilename,
      sizeBytes: data.sizeBytes,
      sha256: data.sha256,
    }
    await this.deps.webhooks.emit(row, 'message.media.stored', payload)
    await this.deps.webhooks.emit(row, 'message.any', payload)
  }

  /** Stage-2 failure after all download retries. */
  private async emitMediaFailed(
    instanceName: string,
    messageId: string,
    data: {
      chatJid?: string | null
      type?: string
      fromMe?: boolean
      error: string
    },
  ): Promise<void> {
    const claimed = await this.deps.idempotency.tryClaim(
      instanceName,
      `media-fail:${messageId}`,
      'message.media.failed',
    )
    if (!claimed) return
    const row = await this.deps.instanceRepo.getByName(instanceName)
    if (!row) return
    const payload = {
      id: messageId,
      chatId: data.chatJid ?? null,
      type: data.type ?? null,
      fromMe: data.fromMe ?? false,
      hasMedia: true,
      mediaStage: 'failed' as const,
      error: data.error.slice(0, 500),
    }
    await this.deps.webhooks.emit(row, 'message.media.failed', payload)
    await this.deps.webhooks.emit(row, 'message.any', payload)
  }
}

// zapo-js WaIncomingReceiptEvent uses `messageIds`; older shapes used `ids`/`id`/`stanzaId`.
// biome-ignore lint/suspicious/noExplicitAny: zapo receipt shape
function extractReceiptIds(e: any): string[] {
  if (Array.isArray(e?.messageIds)) return e.messageIds.map(String)
  if (Array.isArray(e?.ids)) return e.ids.map(String)
  if (e?.id) return [String(e.id)]
  if (e?.stanzaId) return [String(e.stanzaId)]
  return []
}

/**
 * Storage backends sometimes return a "public" URL that is only the private S3 API
 * endpoint (e.g. `*.r2.cloudflarestorage.com` without a public custom domain). Those
 * are not usable in a browser/webhook consumer without signing — prefer the API path.
 */
export function browserFetchableMediaUrl(url: string | null | undefined): string | null {
  if (!url) return null
  if (url.startsWith('/')) return url
  try {
    const host = new URL(url).hostname.toLowerCase()
    if (host.endsWith('.r2.cloudflarestorage.com')) return null
    if (host === 's3.amazonaws.com' || /^s3[.-]/.test(host) || host.includes('.s3.')) {
      // Unsigned AWS S3 console/API hosts without public-read are often useless; keep
      // custom CDN/domains (CloudFront, etc.) that do not look like raw S3 API.
      if (host.endsWith('.amazonaws.com')) return null
    }
    return url
  } catch {
    return null
  }
}

function mapAck(status: unknown): number | null {
  if (typeof status === 'number') return status
  if (typeof status !== 'string') return null
  // WaReceiptStatus: delivered  | read | played | inactive (+ legacy aliases)
  const map: Record<string, number> = {
    error: -1,
    pending: 0,
    inactive: 0,
    server: 1,
    device: 1,
    delivery: 2,
    delivered: 2,
    read: 3,
    played: 4,
    DEVICE: 1,
    SERVER_ACK: 1,
    DELIVERY_ACK: 2,
    READ: 3,
    PLAYED: 4,
  }
  return map[status] ?? map[status.toLowerCase()] ?? null
}
