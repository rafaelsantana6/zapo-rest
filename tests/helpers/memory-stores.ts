import type { AppCall, CallRecordingStatus } from '~/store/calls'
import type { AppChat } from '~/store/chats'
import type { AppContact } from '~/store/contacts'
import type { AppMessage, UpsertMessageInput } from '~/store/messages'

function baseMessage(input: UpsertMessageInput): AppMessage {
  const now = new Date()
  return {
    instanceName: input.instanceName,
    messageId: input.messageId,
    chatJid: input.chatJid,
    senderJid: input.senderJid ?? null,
    participantJid: input.participantJid ?? null,
    fromMe: input.fromMe ?? false,
    timestampMs: input.timestampMs ?? null,
    ack: input.ack ?? 0,
    type: input.type ?? 'text',
    body: input.body ?? null,
    caption: input.caption ?? null,
    mediaUrl: input.mediaUrl ?? null,
    mediaMime: input.mediaMime ?? null,
    mediaFilename: input.mediaFilename ?? null,
    mediaStorageKey: null,
    hasMedia: input.hasMedia ?? false,
    isDeleted: false,
    isEdited: false,
    starred: false,
    pushName: input.pushName ?? null,
    source: input.source ?? 'live',
    raw: input.raw ?? null,
    createdAt: now,
    updatedAt: now,
  }
}

export class MemoryMessageStore {
  readonly byKey = new Map<string, AppMessage>()

  private key(instance: string, id: string) {
    return `${instance}::${id}`
  }

  async upsert(input: UpsertMessageInput): Promise<AppMessage> {
    const k = this.key(input.instanceName, input.messageId)
    const prev = this.byKey.get(k)
    if (!prev) {
      const msg = baseMessage(input)
      this.byKey.set(k, msg)
      return msg
    }
    Object.assign(prev, {
      chatJid: input.chatJid ?? prev.chatJid,
      senderJid: input.senderJid !== undefined ? input.senderJid : prev.senderJid,
      body: input.body !== undefined ? input.body : prev.body,
      caption: input.caption !== undefined ? input.caption : prev.caption,
      type: input.type ?? prev.type,
      hasMedia: input.hasMedia ?? prev.hasMedia,
      mediaUrl: input.mediaUrl !== undefined ? input.mediaUrl : prev.mediaUrl,
      mediaMime: input.mediaMime !== undefined ? input.mediaMime : prev.mediaMime,
      mediaFilename: input.mediaFilename !== undefined ? input.mediaFilename : prev.mediaFilename,
      pushName: input.pushName !== undefined ? input.pushName : prev.pushName,
      timestampMs: input.timestampMs !== undefined ? input.timestampMs : prev.timestampMs,
      raw: input.raw !== undefined ? input.raw : prev.raw,
      updatedAt: new Date(),
    })
    return prev
  }

  async get(instanceName: string, messageId: string): Promise<AppMessage | null> {
    return this.byKey.get(this.key(instanceName, messageId)) ?? null
  }

  async updateAck(instanceName: string, messageId: string, ack: number): Promise<AppMessage | null> {
    const msg = await this.get(instanceName, messageId)
    if (!msg) return null
    msg.ack = Math.max(msg.ack, ack)
    msg.updatedAt = new Date()
    return msg
  }

  async markDeleted(instanceName: string, messageId: string): Promise<AppMessage | null> {
    const msg = await this.get(instanceName, messageId)
    if (!msg) return null
    msg.isDeleted = true
    msg.updatedAt = new Date()
    return msg
  }

  async markEdited(instanceName: string, messageId: string, body: string, raw?: unknown): Promise<AppMessage | null> {
    const msg = await this.get(instanceName, messageId)
    if (!msg) return null
    msg.body = body
    msg.isEdited = true
    if (raw !== undefined) msg.raw = raw
    msg.updatedAt = new Date()
    return msg
  }

  async setMedia(
    instanceName: string,
    messageId: string,
    media: { url: string; storageKey: string; mime?: string | null; filename?: string | null },
  ): Promise<void> {
    const msg = await this.get(instanceName, messageId)
    if (!msg) return
    msg.mediaUrl = media.url
    msg.mediaStorageKey = media.storageKey
    if (media.mime !== undefined) msg.mediaMime = media.mime
    if (media.filename !== undefined) msg.mediaFilename = media.filename
    msg.hasMedia = true
    msg.updatedAt = new Date()
  }

  async rekeyChat(instanceName: string, fromJid: string, toJid: string): Promise<number> {
    let n = 0
    for (const msg of this.byKey.values()) {
      if (msg.instanceName === instanceName && msg.chatJid === fromJid) {
        msg.chatJid = toJid
        n++
      }
    }
    return n
  }

  async listByChat(
    instanceName: string,
    chatJid: string,
    opts: {
      limit?: number
      beforeTs?: number
      afterTs?: number
      fromMe?: boolean
      chatJids?: string[]
    } = {},
  ): Promise<AppMessage[]> {
    const jids = new Set([chatJid, ...(opts.chatJids ?? [])])
    let rows = [...this.byKey.values()].filter((m) => m.instanceName === instanceName && jids.has(m.chatJid))
    if (opts.beforeTs != null) {
      const before = opts.beforeTs
      rows = rows.filter((m) => (m.timestampMs ?? 0) < before)
    }
    if (opts.afterTs != null) {
      const after = opts.afterTs
      rows = rows.filter((m) => (m.timestampMs ?? 0) > after)
    }
    if (opts.fromMe != null) rows = rows.filter((m) => m.fromMe === opts.fromMe)
    rows.sort((a, b) => (b.timestampMs ?? 0) - (a.timestampMs ?? 0))
    return rows.slice(0, Math.min(opts.limit ?? 50, 200))
  }
}

export class MemoryChatStore {
  readonly byKey = new Map<string, AppChat>()

  private key(instance: string, jid: string) {
    return `${instance}::${jid}`
  }

  async upsert(input: {
    instanceName: string
    chatJid: string
    name?: string | null
    isGroup?: boolean
    lastMessageId?: string | null
    lastMessagePreview?: string | null
    lastMessageTs?: number | null
    unreadCount?: number
    archived?: boolean
    pinned?: number
    muteEndMs?: number | null
    markedAsUnread?: boolean
    raw?: unknown
  }): Promise<AppChat> {
    const k = this.key(input.instanceName, input.chatJid)
    const prev = this.byKey.get(k)
    const now = new Date()
    if (!prev) {
      const chat = {
        instanceName: input.instanceName,
        chatJid: input.chatJid,
        name: input.name ?? null,
        isGroup: input.isGroup ?? false,
        unreadCount: input.unreadCount ?? 0,
        archived: input.archived ?? false,
        pinned: input.pinned ?? 0,
        muteEndMs: input.muteEndMs ?? null,
        markedAsUnread: input.markedAsUnread ?? false,
        lastMessageId: input.lastMessageId ?? null,
        lastMessagePreview: input.lastMessagePreview ?? null,
        lastMessageTs: input.lastMessageTs ?? null,
        raw: input.raw ?? null,
        createdAt: now,
        updatedAt: now,
      } as AppChat
      this.byKey.set(k, chat)
      return chat
    }
    Object.assign(prev, {
      name: input.name !== undefined ? input.name : prev.name,
      lastMessageId: input.lastMessageId !== undefined ? input.lastMessageId : prev.lastMessageId,
      lastMessagePreview: input.lastMessagePreview !== undefined ? input.lastMessagePreview : prev.lastMessagePreview,
      lastMessageTs: input.lastMessageTs !== undefined ? input.lastMessageTs : prev.lastMessageTs,
      updatedAt: now,
    })
    return prev
  }

  async mergeLidIntoPn(instanceName: string, lid: string, pn: string): Promise<void> {
    const lidKey = this.key(instanceName, lid)
    const pnKey = this.key(instanceName, pn)
    const lidChat = this.byKey.get(lidKey)
    if (!lidChat) return
    const pnChat = this.byKey.get(pnKey)
    if (!pnChat) {
      lidChat.chatJid = pn
      this.byKey.delete(lidKey)
      this.byKey.set(pnKey, lidChat)
      return
    }
    this.byKey.delete(lidKey)
  }

  async list(
    instanceName: string,
    opts: { limit?: number; offset?: number; archived?: boolean; merge?: boolean } = {},
  ): Promise<AppChat[]> {
    let rows = [...this.byKey.values()].filter((c) => c.instanceName === instanceName)
    if (opts.archived != null) rows = rows.filter((c) => c.archived === opts.archived)
    rows.sort((a, b) => (b.lastMessageTs ?? 0) - (a.lastMessageTs ?? 0))
    const offset = opts.offset ?? 0
    const limit = Math.min(opts.limit ?? 50, 200)
    return rows.slice(offset, offset + limit)
  }

  async get(instanceName: string, chatJid: string): Promise<AppChat | null> {
    return this.byKey.get(this.key(instanceName, chatJid)) ?? null
  }

  async markRead(instanceName: string, chatJid: string): Promise<AppChat | null> {
    const chat = await this.get(instanceName, chatJid)
    if (!chat) return null
    chat.unreadCount = 0
    chat.markedAsUnread = false
    chat.updatedAt = new Date()
    return chat
  }

  async setArchived(instanceName: string, chatJid: string, archived: boolean): Promise<AppChat | null> {
    const chat = await this.get(instanceName, chatJid)
    if (!chat) return null
    chat.archived = archived
    chat.updatedAt = new Date()
    return chat
  }

  async setUnread(instanceName: string, chatJid: string, unreadCount: number): Promise<AppChat | null> {
    const chat = await this.get(instanceName, chatJid)
    if (!chat) return null
    chat.unreadCount = unreadCount
    chat.markedAsUnread = unreadCount > 0
    chat.updatedAt = new Date()
    return chat
  }
}

export class MemoryContactStore {
  readonly byKey = new Map<string, AppContact>()

  async upsert(input: {
    instanceName: string
    jid: string
    displayName?: string | null
    pushName?: string | null
    lid?: string | null
    phoneNumber?: string | null
    lastUpdatedMs?: number | null
    raw?: unknown
  }): Promise<AppContact> {
    const k = `${input.instanceName}::${input.jid}`
    const now = new Date()
    const prev = this.byKey.get(k)
    if (!prev) {
      const c: AppContact = {
        instanceName: input.instanceName,
        jid: input.jid,
        displayName: input.displayName ?? null,
        pushName: input.pushName ?? null,
        lid: input.lid ?? null,
        phoneNumber: input.phoneNumber ?? null,
        profilePictureUrl: null,
        blocked: false,
        lastUpdatedMs: input.lastUpdatedMs ?? null,
        raw: input.raw ?? null,
        createdAt: now,
        updatedAt: now,
      }
      this.byKey.set(k, c)
      return c
    }
    Object.assign(prev, {
      pushName: input.pushName ?? prev.pushName,
      lid: input.lid ?? prev.lid,
      phoneNumber: input.phoneNumber ?? prev.phoneNumber,
      updatedAt: now,
    })
    return prev
  }

  async list(instanceName: string, opts: { limit?: number; offset?: number } = {}): Promise<AppContact[]> {
    const rows = [...this.byKey.values()].filter((c) => c.instanceName === instanceName)
    const offset = opts.offset ?? 0
    const limit = Math.min(opts.limit ?? 100, 500)
    return rows.slice(offset, offset + limit)
  }

  async get(instanceName: string, jid: string): Promise<AppContact | null> {
    return this.byKey.get(`${instanceName}::${jid}`) ?? null
  }
}

/** In-memory processed_events ledger (no SQL). */
export class MemoryIdempotencyStore {
  private claimed = new Set<string>()

  async tryClaim(instanceName: string, eventKey: string, _eventType: string): Promise<boolean> {
    const k = `${instanceName}::${eventKey}`
    if (this.claimed.has(k)) return false
    this.claimed.add(k)
    return true
  }

  async has(instanceName: string, eventKey: string): Promise<boolean> {
    return this.claimed.has(`${instanceName}::${eventKey}`)
  }

  async prune(): Promise<number> {
    const n = this.claimed.size
    this.claimed.clear()
    return n
  }
}

export class MemoryLidMapStore {
  private map = new Map<string, string>()

  private key(instance: string, lid: string) {
    return `${instance}::${lid}`
  }

  async save(instanceName: string, lid: string, pn: string): Promise<void> {
    this.map.set(this.key(instanceName, lid), pn)
  }

  async resolveCanonical(instanceName: string, jid: string): Promise<string> {
    return this.map.get(this.key(instanceName, jid)) ?? jid
  }

  async expandAliases(instanceName: string, jid: string): Promise<string[]> {
    const out = new Set<string>([jid])
    for (const [k, pn] of this.map) {
      if (!k.startsWith(`${instanceName}::`)) continue
      const lid = k.slice(instanceName.length + 2)
      if (pn === jid || lid === jid) {
        out.add(lid)
        out.add(pn)
      }
    }
    return [...out]
  }
}

export class MemoryLabelStore {
  private rows = new Map<string, import('~/store/labels').AppLabel>()

  private key(instance: string, id: string) {
    return `${instance}::${id}`
  }

  async list(instanceName: string) {
    return [...this.rows.values()]
      .filter((r) => r.instanceName === instanceName)
      .sort((a, b) => a.name.localeCompare(b.name))
  }

  async get(instanceName: string, labelId: string) {
    return this.rows.get(this.key(instanceName, labelId)) ?? null
  }

  async upsert(input: {
    instanceName: string
    labelId?: string
    name: string
    color?: number
    isActive?: boolean
    predefinedId?: string | null
    raw?: unknown
  }) {
    const id = input.labelId ?? `lbl_${this.rows.size + 1}`
    const now = new Date()
    const prev = this.rows.get(this.key(input.instanceName, id))
    const row = {
      instanceName: input.instanceName,
      labelId: id,
      name: input.name,
      color: input.color ?? prev?.color ?? 0,
      isActive: input.isActive ?? prev?.isActive ?? true,
      predefinedId: input.predefinedId ?? prev?.predefinedId ?? null,
      raw: input.raw ?? prev?.raw ?? {},
      createdAt: prev?.createdAt ?? now,
      updatedAt: now,
    }
    this.rows.set(this.key(input.instanceName, id), row)
    return row
  }

  async delete(instanceName: string, labelId: string) {
    return this.rows.delete(this.key(instanceName, labelId))
  }

  async listChats(_instanceName: string, _labelId: string) {
    return [] as string[]
  }

  async listLabelsForChat(instanceName: string, _chatJid: string) {
    return this.list(instanceName)
  }
}

export class MemoryLidStore {
  private rows: import('~/store/lids').LidMapping[] = []

  seed(row: import('~/store/lids').LidMapping) {
    this.rows.push(row)
  }

  async list(_instanceName: string, opts: { limit?: number; offset?: number } = {}) {
    const offset = opts.offset ?? 0
    const limit = Math.min(opts.limit ?? 100, 500)
    return this.rows.slice(offset, offset + limit)
  }

  async count(_instanceName: string) {
    return this.rows.length
  }
}

export class MemoryMediaStorage {
  readonly kind = 'local' as const
  readonly objects = new Map<string, Buffer>()

  async put(
    instanceName: string,
    data: Buffer | Uint8Array,
    opts?: { mimeType?: string; filename?: string; messageId?: string },
  ) {
    const { contentAddressedKey, contentAddressedHashPrefix, guessStorageExt, sha256Hex } = await import(
      '~/media/storage'
    )
    const buf = Buffer.isBuffer(data) ? data : Buffer.from(data)
    const hash = sha256Hex(buf)
    const ext = guessStorageExt(opts?.mimeType, opts?.filename)
    const preferred = contentAddressedKey(instanceName, hash, ext)
    const prefix = contentAddressedHashPrefix(instanceName, hash)
    const existing = [...this.objects.keys()].find((k) => k === preferred || k === prefix || k.startsWith(`${prefix}.`))
    if (existing) {
      return {
        storageKey: existing,
        url: `http://media.test/${existing}`,
        sizeBytes: buf.byteLength,
        mimeType: opts?.mimeType,
        sha256: hash,
        deduped: true,
      }
    }
    this.objects.set(preferred, buf)
    return {
      storageKey: preferred,
      url: `http://media.test/${preferred}`,
      sizeBytes: buf.byteLength,
      mimeType: opts?.mimeType,
      sha256: hash,
      deduped: false,
    }
  }

  async putAt(storageKey: string, data: Buffer | Uint8Array, opts?: { mimeType?: string }) {
    const { sha256Hex } = await import('~/media/storage')
    const buf = Buffer.isBuffer(data) ? data : Buffer.from(data)
    this.objects.set(storageKey, buf)
    return {
      storageKey,
      url: `http://media.test/${storageKey}`,
      sizeBytes: buf.byteLength,
      mimeType: opts?.mimeType,
      sha256: sha256Hex(buf),
      deduped: false,
    }
  }

  async getBuffer(storageKey: string) {
    const b = this.objects.get(storageKey)
    if (!b) throw new Error(`missing ${storageKey}`)
    return b
  }

  async getStream(storageKey: string) {
    const { Readable } = await import('node:stream')
    return Readable.from(await this.getBuffer(storageKey))
  }

  async delete(storageKey: string) {
    this.objects.delete(storageKey)
  }

  async deleteInstance(instanceName: string) {
    const { instanceStoragePrefix } = await import('~/media/storage')
    const prefix = instanceStoragePrefix(instanceName)
    let deleted = 0
    for (const key of [...this.objects.keys()]) {
      if (key.startsWith(prefix)) {
        this.objects.delete(key)
        deleted++
      }
    }
    return { deleted }
  }

  async exists(storageKey: string) {
    return this.objects.has(storageKey)
  }

  async findByContentHash(instanceName: string, sha256Hex: string) {
    const { contentAddressedHashPrefix } = await import('~/media/storage')
    const prefix = contentAddressedHashPrefix(instanceName, sha256Hex)
    return [...this.objects.keys()].find((k) => k === prefix || k.startsWith(`${prefix}.`)) ?? null
  }

  async createDownloadUrl(storageKey: string) {
    return `http://media.test/${storageKey}`
  }

  publicUrl(storageKey: string) {
    return `http://media.test/${storageKey}`
  }
}

/** In-memory CallStore for blast/recording tests. */
export class MemoryCallStore {
  readonly byKey = new Map<string, AppCall>()

  private key(instanceName: string, callId: string) {
    return `${instanceName}::${callId}`
  }

  async get(instanceName: string, callId: string): Promise<AppCall | null> {
    return this.byKey.get(this.key(instanceName, callId)) ?? null
  }

  async upsertStart(input: {
    instanceName: string
    callId: string
    peerJid?: string | null
    direction?: string
    mediaType?: string
    state?: string | null
    recordingEnabled?: boolean
  }): Promise<AppCall> {
    const k = this.key(input.instanceName, input.callId)
    const prev = this.byKey.get(k)
    const now = new Date()
    if (prev) {
      if (input.peerJid != null) prev.peerJid = input.peerJid
      if (input.direction != null) prev.direction = input.direction
      if (input.state != null) prev.state = input.state
      prev.recordingEnabled = prev.recordingEnabled || Boolean(input.recordingEnabled)
      return prev
    }
    const row: AppCall = {
      instanceName: input.instanceName,
      callId: input.callId,
      peerJid: input.peerJid ?? null,
      direction: input.direction ?? 'unknown',
      mediaType: input.mediaType ?? 'audio',
      state: input.state ?? null,
      endReason: null,
      startedAt: now,
      endedAt: null,
      durationSecs: null,
      recordingEnabled: Boolean(input.recordingEnabled),
      recordingStatus: 'none',
      recordingStorageKey: null,
      recordingUrl: null,
      recordingMime: null,
      recordingBytes: null,
      recordingError: null,
    }
    this.byKey.set(k, row)
    return row
  }

  async markRecordingStarted(instanceName: string, callId: string): Promise<void> {
    const row = this.byKey.get(this.key(instanceName, callId))
    if (!row) return
    if (row.recordingEnabled && (row.recordingStatus === 'none' || row.recordingStatus === 'disabled')) {
      row.recordingStatus = 'recording'
    }
  }

  async updateState(
    instanceName: string,
    callId: string,
    patch: { state?: string | null; endReason?: string | null },
  ): Promise<void> {
    const row = this.byKey.get(this.key(instanceName, callId))
    if (!row) return
    if (patch.state !== undefined) row.state = patch.state
    if (patch.endReason !== undefined) row.endReason = patch.endReason
  }

  async markEnded(
    instanceName: string,
    callId: string,
    opts: { endReason?: string | null; durationSecs?: number | null; state?: string | null },
  ): Promise<AppCall | null> {
    const row = this.byKey.get(this.key(instanceName, callId))
    if (!row) return null
    row.endedAt = row.endedAt ?? new Date()
    if (opts.durationSecs != null) row.durationSecs = opts.durationSecs
    if (opts.endReason !== undefined) row.endReason = opts.endReason
    row.state = opts.state ?? row.state ?? 'ended'
    return row
  }

  async setRecordingResult(
    instanceName: string,
    callId: string,
    result:
      | { status: 'ready'; storageKey: string; url: string | null; mime: string; bytes: number }
      | { status: 'failed'; error: string }
      | { status: 'disabled' | 'none' },
  ): Promise<void> {
    const row = this.byKey.get(this.key(instanceName, callId))
    if (!row) return
    row.recordingStatus = result.status as CallRecordingStatus
    if (result.status === 'ready') {
      row.recordingStorageKey = result.storageKey
      row.recordingUrl = result.url
      row.recordingMime = result.mime
      row.recordingBytes = result.bytes
      row.recordingError = null
    } else if (result.status === 'failed') {
      row.recordingError = result.error
    }
  }
}
