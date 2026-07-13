const KEY_STORAGE = 'zapo_rest_api_key'
const HINT_STORAGE = 'zapo_rest_instance_hint'

export type Instance = {
  name: string
  /** Present only on create/rotate responses; list/get omit the key (stored hashed). */
  apiKey?: string
  webhookUrl: string | null
  webhookEvents: string[]
  status: string
  meJid: string | null
  pairPhone: string | null
  lastQr: string | null
  lastQrAt: string | null
  createdAt: string
  updatedAt: string
}

export type Chat = {
  id: string
  name: string | null
  isGroup: boolean
  unreadCount: number
  archived: boolean
  pinned: number
  lastMessage: { id: string; preview: string | null; timestamp: number | null } | null
  /** LID aliases collapsed into this chat (when list merge is on) */
  altJids?: string[]
}

export type Message = {
  id: string
  chatId: string
  from: string | null
  participant: string | null
  fromMe: boolean
  timestamp: number | null
  ack: number
  type: string
  body: string | null
  caption: string | null
  hasMedia: boolean
  mediaUrl: string | null
  mediaMime?: string | null
  mediaFilename?: string | null
  isDeleted: boolean
  isEdited: boolean
  pushName: string | null
  _data?: unknown
}

export type WebhookConfig = {
  id: string
  url: string
  events: string[]
  hmac: { key: string } | null
  retries: { policy: string; delaySeconds: number; attempts: number }
  customHeaders: { name: string; value: string }[]
  enabled: boolean
  createdAt: string
  updatedAt: string
}

export type Contact = {
  id: string
  name: string | null
  pushName: string | null
  lid: string | null
  phoneNumber: string | null
  profilePictureUrl: string | null
  blocked: boolean
}

export type Group = {
  id?: string
  jid?: string
  subject?: string
  desc?: string
  size?: number
  participants?: unknown[]
  [k: string]: unknown
}

export function getStoredKey(): string | null {
  return sessionStorage.getItem(KEY_STORAGE)
}

export function setStoredKey(key: string): void {
  sessionStorage.setItem(KEY_STORAGE, key)
}

export function clearStoredKey(): void {
  sessionStorage.removeItem(KEY_STORAGE)
  sessionStorage.removeItem(HINT_STORAGE)
}

export function setInstanceHint(name: string) {
  sessionStorage.setItem(HINT_STORAGE, name)
}

export function getInstanceHint(): string | null {
  return sessionStorage.getItem(HINT_STORAGE)
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const key = getStoredKey()
  if (!key) throw new Error('Not authenticated')

  const headers = new Headers(init.headers)
  headers.set('X-Api-Key', key)
  if (init.body && !headers.has('content-type')) {
    headers.set('content-type', 'application/json')
  }

  const res = await fetch(path, { ...init, headers })
  const text = await res.text()
  let data: unknown = null
  try {
    data = text ? JSON.parse(text) : null
  } catch {
    data = { error: { message: text || res.statusText } }
  }

  if (!res.ok) {
    const msg = (data as { error?: { message?: string } })?.error?.message ?? res.statusText
    throw new Error(msg)
  }
  return data as T
}

// ── Auth ────────────────────────────────────────────────────────────────────
export function me() {
  return request<{ role: 'admin' } | { role: 'instance'; instance: Instance }>('/v1/me')
}

// ── Instances ───────────────────────────────────────────────────────────────
export function listInstances() {
  return request<{ instances: Instance[] }>('/v1/instances')
}

export function getInstance(name: string) {
  return request<{ instance: Instance }>(`/v1/instances/${enc(name)}`)
}

export function createInstance(body: {
  name: string
  webhookUrl?: string
  webhookEvents?: string[]
  pairPhone?: string
}) {
  return request<{ instance: Instance }>('/v1/instances', {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

export function deleteInstance(name: string) {
  return request<{ ok: boolean }>(`/v1/instances/${enc(name)}`, { method: 'DELETE' })
}

export function connectInstance(name: string) {
  return request<{ instance: Instance }>(`/v1/instances/${enc(name)}/connect`, { method: 'POST' })
}

export function disconnectInstance(name: string) {
  return request<{ instance: Instance }>(`/v1/instances/${enc(name)}/disconnect`, {
    method: 'POST',
  })
}

export function restartInstance(name: string) {
  return request<{ instance: Instance }>(`/v1/instances/${enc(name)}/restart`, { method: 'POST' })
}

export function getQr(name: string) {
  return request<{ qr: string | null; status: string; expiresAt?: string | null }>(`/v1/instances/${enc(name)}/qr`)
}

export function requestPairing(name: string, phone: string) {
  return request<{ code: string; phone: string }>(`/v1/instances/${enc(name)}/pairing-code`, {
    method: 'POST',
    body: JSON.stringify({ phone }),
  })
}

export function rotateKey(name: string) {
  return request<{ instance: Instance }>(`/v1/instances/${enc(name)}/keys/rotate`, {
    method: 'POST',
  })
}

// ── Chats / messages ────────────────────────────────────────────────────────
export function listChats(name: string, limit = 100) {
  return request<{ chats: Chat[] }>(`/v1/instances/${enc(name)}/chats?limit=${limit}`)
}

export function listMessages(name: string, chatId: string, limit = 80) {
  return request<{ messages: Message[] }>(`/v1/instances/${enc(name)}/chats/${enc(chatId)}/messages?limit=${limit}`)
}

export function markChatRead(name: string, chatId: string, messageIds: string[]) {
  return request<{ ok: boolean }>(`/v1/instances/${enc(name)}/chats/${enc(chatId)}/messages/read`, {
    method: 'POST',
    body: JSON.stringify({ messageIds }),
  })
}

export function archiveChat(name: string, chatId: string, archive = true) {
  return request(`/v1/instances/${enc(name)}/chats/${enc(chatId)}/${archive ? 'archive' : 'unarchive'}`, {
    method: 'POST',
  })
}

// ── Send ────────────────────────────────────────────────────────────────────
export function sendText(name: string, to: string, text: string, opts?: { mentions?: string[] }) {
  return request<{ id: string }>(`/v1/instances/${enc(name)}/messages/text`, {
    method: 'POST',
    body: JSON.stringify({ to, text, ...opts }),
  })
}

export function sendMedia(
  name: string,
  kind: 'image' | 'video' | 'audio' | 'document' | 'sticker',
  body: Record<string, unknown>,
) {
  return request<{ id: string }>(`/v1/instances/${enc(name)}/messages/${kind}`, {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

export function sendLocation(
  name: string,
  body: { to: string; latitude: number; longitude: number; name?: string; address?: string },
) {
  return request<{ id: string }>(`/v1/instances/${enc(name)}/messages/location`, {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

export function sendPoll(
  name: string,
  body: { to: string; name: string; options: string[]; selectableCount?: number },
) {
  return request<{ id: string }>(`/v1/instances/${enc(name)}/messages/poll`, {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

export function sendContact(
  name: string,
  body: {
    to: string
    contacts: { fullName: string; phoneNumber: string; organization?: string; email?: string }[]
  },
) {
  return request<{ id: string }>(`/v1/instances/${enc(name)}/messages/contact`, {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

export function sendReact(name: string, body: { to: string; messageId: string; emoji: string; fromMe?: boolean }) {
  return request<{ id: string }>(`/v1/instances/${enc(name)}/messages/react`, {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

// ── Contacts / resolve ──────────────────────────────────────────────────────
export function listContacts(name: string, limit = 200) {
  return request<{ contacts: Contact[] }>(`/v1/instances/${enc(name)}/contacts?limit=${limit}`)
}

export function resolveNumbers(name: string, numbers: string[]) {
  return request<{ results: unknown[] }>(`/v1/instances/${enc(name)}/contacts/resolve`, {
    method: 'POST',
    body: JSON.stringify({ numbers }),
  })
}

export function checkNumbers(name: string, phones: string[]) {
  return request<{ results: unknown[] }>(`/v1/instances/${enc(name)}/contacts/check`, {
    method: 'POST',
    body: JSON.stringify({ phones }),
  })
}

export function getProfilePicture(
  name: string,
  phone: string,
  type: 'preview' | 'image' = 'preview',
  opts?: { refresh?: boolean },
) {
  const q = new URLSearchParams({ type })
  if (opts?.refresh) q.set('refresh', 'true')
  return request<{
    picture: unknown
    jid?: string
    reason?: string | null
    status?: 'ok' | 'none' | 'privacy'
    revalidated?: boolean
    fromStorage?: boolean
    storageKey?: string | null
    sha256?: string | null
    url?: string | null
    cacheTtlSeconds?: number
    lastCheckedAt?: string
    lastFetchedAt?: string | null
    cached?: boolean
    cachedAt?: string
  }>(`/v1/instances/${enc(name)}/contacts/${enc(phone)}/profile-picture?${q}`)
}

export function getAbout(name: string, phone: string) {
  return request<{ status: string | null; jid?: string }>(`/v1/instances/${enc(name)}/contacts/${enc(phone)}/about`)
}

export function createJidLocal(name: string, numbers: string[]) {
  return request<{ results: unknown[] }>(`/v1/instances/${enc(name)}/contacts/jid`, {
    method: 'POST',
    body: JSON.stringify({ numbers }),
  })
}

// ── Groups ──────────────────────────────────────────────────────────────────
export function listGroups(name: string) {
  return request<{ groups: Group[] }>(`/v1/instances/${enc(name)}/groups`)
}

export function getGroup(name: string, groupId: string) {
  return request<{ group: Group }>(`/v1/instances/${enc(name)}/groups/${enc(groupId)}`)
}

export function createGroup(name: string, body: { subject: string; participants: string[]; description?: string }) {
  return request<{ group: Group }>(`/v1/instances/${enc(name)}/groups`, {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

export function leaveGroup(name: string, groupId: string) {
  return request<{ ok: boolean }>(`/v1/instances/${enc(name)}/groups/${enc(groupId)}/leave`, {
    method: 'POST',
  })
}

export function groupInviteCode(name: string, groupId: string) {
  return request<{ code: string; inviteLink: string }>(`/v1/instances/${enc(name)}/groups/${enc(groupId)}/invite-code`)
}

export function joinGroup(name: string, code: string) {
  return request<{ group: Group }>(`/v1/instances/${enc(name)}/groups/join`, {
    method: 'POST',
    body: JSON.stringify({ code }),
  })
}

// ── Webhooks ────────────────────────────────────────────────────────────────
export function listWebhooks(name: string) {
  return request<{ webhooks: WebhookConfig[]; availableEvents: string[] }>(`/v1/instances/${enc(name)}/webhooks`)
}

export function createWebhook(
  name: string,
  body: {
    url: string
    events?: string[]
    hmac?: { key: string }
    enabled?: boolean
    retries?: { policy?: string; delaySeconds?: number; attempts?: number }
  },
) {
  return request<{ webhook: WebhookConfig }>(`/v1/instances/${enc(name)}/webhooks`, {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

export function updateWebhook(name: string, id: string, body: Record<string, unknown>) {
  return request<{ webhook: WebhookConfig }>(`/v1/instances/${enc(name)}/webhooks/${enc(id)}`, {
    method: 'PUT',
    body: JSON.stringify(body),
  })
}

export function deleteWebhook(name: string, id: string) {
  return request<{ ok: boolean }>(`/v1/instances/${enc(name)}/webhooks/${enc(id)}`, {
    method: 'DELETE',
  })
}

// ── Profile ─────────────────────────────────────────────────────────────────
export function getProfile(name: string) {
  return request<{ profile: unknown }>(`/v1/instances/${enc(name)}/profile`)
}

export function setProfileName(name: string, displayName: string) {
  return request(`/v1/instances/${enc(name)}/profile/name`, {
    method: 'PUT',
    body: JSON.stringify({ name: displayName }),
  })
}

export function setProfileStatus(name: string, status: string) {
  return request(`/v1/instances/${enc(name)}/profile/status`, {
    method: 'PUT',
    body: JSON.stringify({ status }),
  })
}

// ── Labels ──────────────────────────────────────────────────────────────────
export function listLabels(name: string) {
  return request<{ labels: { id: string; name: string; color: number; isActive: boolean }[] }>(
    `/v1/instances/${enc(name)}/labels`,
  )
}

export function createLabel(name: string, body: { name: string; color?: number; id?: string }) {
  return request(`/v1/instances/${enc(name)}/labels`, {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

export function deleteLabel(name: string, labelId: string) {
  return request(`/v1/instances/${enc(name)}/labels/${enc(labelId)}`, { method: 'DELETE' })
}

// ── Presence ────────────────────────────────────────────────────────────────
export function setPresence(name: string, type: 'available' | 'unavailable') {
  return request(`/v1/instances/${enc(name)}/presence`, {
    method: 'POST',
    body: JSON.stringify({ type }),
  })
}

export function setChatstate(name: string, jid: string, state: 'composing' | 'paused' | 'recording') {
  return request(`/v1/instances/${enc(name)}/chats/${enc(jid)}/chatstate`, {
    method: 'POST',
    body: JSON.stringify({ state }),
  })
}

// ── Events SSE (server → client only) ───────────────────────────────────────
/**
 * Live SSE handle (fetch + ReadableStream so we can send X-Api-Key header).
 * Prefer this over native EventSource (which only allows ?apiKey= in the URL).
 */
export type EventsSseSubscription = {
  /** Abort the stream */
  close: () => void
  /**
   * EventSource-compatible hooks — assign before the first network tick if needed;
   * openEventsSse wires them after construction so set handlers immediately.
   */
  onopen: ((ev?: Event) => void) | null
  onerror: ((ev?: Event) => void) | null
  onmessage: ((ev: MessageEvent) => void) | null
  readonly readyState: 0 | 1 | 2
}

/**
 * Subscribe to `GET /v1/events` with **header auth** (not query string).
 *
 * Uses fetch()+stream instead of EventSource so the key stays out of URLs/logs.
 */
export function openEventsSse(instance?: string): EventsSseSubscription {
  const key = getStoredKey()
  if (!key) throw new Error('Not authenticated')

  const params = new URLSearchParams()
  if (instance) params.set('instance', instance)
  const url = `/v1/events${params.size ? `?${params}` : ''}`

  const ac = new AbortController()
  let readyState: 0 | 1 | 2 = 0 // CONNECTING || OPEN || CLOSED
  let closedByUser = false

  const sub: EventsSseSubscription = {
    onopen: null,
    onerror: null,
    onmessage: null,
    get readyState() {
      return readyState
    },
    close: () => {
      closedByUser = true
      readyState = 2
      ac.abort()
    },
  }

  void (async () => {
    try {
      const res = await fetch(url, {
        method: 'GET',
        headers: {
          'X-Api-Key': key,
          Accept: 'text/event-stream',
          'Cache-Control': 'no-cache',
        },
        signal: ac.signal,
      })
      if (!res.ok || !res.body) {
        readyState = 2
        sub.onerror?.(new Event('error'))
        return
      }
      readyState = 1
      sub.onopen?.(new Event('open'))

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''

      while (!closedByUser) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })

        // SSE frames separated by blank line
        let sep = buffer.indexOf('\n\n')
        while (sep >= 0) {
          const frame = buffer.slice(0, sep)
          buffer = buffer.slice(sep + 2)
          sep = buffer.indexOf('\n\n')
          // ignore comment/keepalive lines (`: ping …`)
          const dataLines = frame
            .split('\n')
            .filter((l) => l.startsWith('data:'))
            .map((l) => l.slice(5).replace(/^ /, ''))
          if (!dataLines.length) continue
          const data = dataLines.join('\n')
          sub.onmessage?.(
            new MessageEvent('message', {
              data,
            }),
          )
        }
      }
      readyState = 2
      if (!closedByUser) sub.onerror?.(new Event('error'))
    } catch (err) {
      readyState = 2
      if (!closedByUser && !(err instanceof DOMException && err.name === 'AbortError')) {
        sub.onerror?.(new Event('error'))
      }
    }
  })()

  return sub
}

/** @deprecated use openEventsSse */
export function openEventsSocket(instance?: string): EventsSseSubscription {
  return openEventsSse(instance)
}

function enc(s: string) {
  return encodeURIComponent(s)
}

export function shortPhone(jid: string | null | undefined): string {
  if (!jid) return '—'
  if (jid.includes('@lid')) {
    // Don't format raw LID as a phone — looks like +11 huge numbers
    const user = jid.split('@')[0]?.split(':')[0] ?? jid
    return user.length > 12 ? `LID …${user.slice(-6)}` : `LID ${user}`
  }
  const user = jid.split('@')[0]?.split(':')[0] ?? jid
  if (user.length >= 12 && user.startsWith('55')) {
    return `+${user.slice(0, 2)} ${user.slice(2, 4)} ${user.slice(4)}`
  }
  if (/^\d+$/.test(user) && user.length >= 10) {
    return user.startsWith('+') ? user : `+${user}`
  }
  return user
}

export function statusLabel(status: string): string {
  const map: Record<string, string> = {
    open: 'Conectado',
    close: 'Desconectado',
    created: 'Criado',
    connecting: 'Conectando',
    qr: 'Aguardando QR',
    pairing: 'Pareando',
    logged_out: 'Deslogado',
  }
  return map[status] ?? status
}

// ── Media ───────────────────────────────────────────────────────────────────
export function getMessageMediaUrl(name: string, messageId: string): string {
  return `/v1/instances/${enc(name)}/messages/${enc(messageId)}/media`
}

export function getBase64FromMedia(name: string, messageId: string) {
  return request<{
    base64: string
    mimetype: string | null
    fileName: string | null
    mediaType: string
    size: number
    mediaUrl: string | null
    source: string
  }>(`/v1/instances/${enc(name)}/media/getBase64FromMediaMessage`, {
    method: 'POST',
    body: JSON.stringify({ messageId }),
  })
}

// ── Metrics ─────────────────────────────────────────────────────────────────
export type MetricsSummary = {
  instance: string
  range: { from: string; to: string }
  messages: { sent: number; received: number; total: number; withMedia: number }
  calls: {
    outbound: number
    inbound: number
    total: number
    answered: number
    outboundAnswered: number
    outboundMissedOrRejected: number
    inboundAnswered: number
    inboundMissedOrRejected: number
    avgDurationSecs: number | null
    totalDurationSecs: number
    recordingsReady: number
    recordingBytes: number
  }
  media: {
    objects: number
    bytes: number
    byType: { mime: string; category: string; count: number; bytes: number }[]
  }
  storage: {
    mediaObjectsBytes: number
    mediaObjectsCount: number
    callRecordingBytes: number
    messagesCount: number
    chatsCount: number
    contactsCount: number
    estimatedTotalBytes: number
  }
  generatedAt: string
}

export type MetricsTimeseries = {
  instance: string
  range: { from: string; to: string }
  bucket: 'hour' | 'day'
  messages: { t: string; sent: number; received: number }[]
  calls: { t: string; outbound: number; inbound: number; answered: number; missedOrRejected: number }[]
  generatedAt: string
}

export type MetricsResources = {
  instance: string
  live: boolean
  process: {
    pid: number
    uptimeSecs: number
    memory: {
      rssBytes: number
      heapUsedBytes: number
      heapTotalBytes: number
      externalBytes: number
    }
    cpu: {
      userMicros: number
      systemMicros: number
      percentSinceLastSample: number | null
    }
    sampledAt: string
  }
  liveSessions: number
  estimatedHeapShareBytes: number | null
  estimatedRssShareBytes: number | null
  storage: {
    mediaObjectsBytes: number
    callRecordingBytes: number
    estimatedTotalBytes: number
    messagesCount: number
    chatsCount: number
    contactsCount: number
  }
  cache: { kind: string; note: string }
  notes: string[]
  generatedAt: string
}

export function getInstanceMetrics(name: string, opts?: { from?: string; to?: string }) {
  const q = new URLSearchParams()
  if (opts?.from) q.set('from', opts.from)
  if (opts?.to) q.set('to', opts.to)
  const qs = q.toString()
  return request<MetricsSummary>(`/v1/instances/${enc(name)}/metrics${qs ? `?${qs}` : ''}`)
}

export function getInstanceMetricsTimeseries(
  name: string,
  opts?: { from?: string; to?: string; bucket?: 'hour' | 'day' },
) {
  const q = new URLSearchParams()
  if (opts?.from) q.set('from', opts.from)
  if (opts?.to) q.set('to', opts.to)
  if (opts?.bucket) q.set('bucket', opts.bucket)
  const qs = q.toString()
  return request<MetricsTimeseries>(`/v1/instances/${enc(name)}/metrics/timeseries${qs ? `?${qs}` : ''}`)
}

export function getInstanceMetricsResources(name: string) {
  return request<MetricsResources>(`/v1/instances/${enc(name)}/metrics/resources`)
}

// ── Privacy / business ──────────────────────────────────────────────────────
export function getPrivacy(name: string) {
  return request<{ settings: unknown; privacy?: unknown }>(`/v1/instances/${enc(name)}/privacy`)
}

export function updatePrivacy(name: string, body: { setting: string; value: string } | Record<string, unknown>) {
  // Accept either {setting,value} or a single-key map from the dashboard form
  let payload: { setting: string; value: string }
  if ('setting' in body && 'value' in body) {
    payload = { setting: String(body.setting), value: String(body.value) }
  } else {
    const [setting, value] = Object.entries(body)[0] ?? ['last', 'all']
    payload = { setting, value: String(value) }
  }
  return request(`/v1/instances/${enc(name)}/privacy`, {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

export function getBlocklist(name: string) {
  return request<{ blocklist: string[] }>(`/v1/instances/${enc(name)}/blocklist`)
}

export function getBusinessProfile(name: string, phone?: string) {
  const q = phone ? `?phone=${enc(phone)}` : ''
  return request<{ profile: unknown }>(`/v1/instances/${enc(name)}/business/profile${q}`)
}

// ── Status / stories ────────────────────────────────────────────────────────
export function sendStatusText(name: string, body: { text: string; recipients: string[] }) {
  return request(`/v1/instances/${enc(name)}/status/send`, {
    method: 'POST',
    body: JSON.stringify({ type: 'text', ...body }),
  })
}

export function sendStatusMedia(
  name: string,
  body: { mediaUrl?: string; mediaBase64?: string; caption?: string; recipients: string[]; type?: string },
) {
  return request(`/v1/instances/${enc(name)}/status/send`, {
    method: 'POST',
    body: JSON.stringify({ type: body.type ?? 'image', ...body }),
  })
}

export function revokeStatus(name: string, messageId: string, recipients: string[] = []) {
  return request(`/v1/instances/${enc(name)}/status/revoke`, {
    method: 'POST',
    body: JSON.stringify({ messageId, recipients: recipients.length ? recipients : ['status@broadcast'] }),
  })
}

// ── LIDs ────────────────────────────────────────────────────────────────────
export function listLids(name: string, limit = 100, offset = 0) {
  return request<{ lids: { lid: string; pn: string }[]; total?: number }>(
    `/v1/instances/${enc(name)}/lids?limit=${limit}&offset=${offset}`,
  )
}

export function countLids(name: string) {
  return request<{ count: number }>(`/v1/instances/${enc(name)}/lids/count`)
}

export function getLid(name: string, lid: string) {
  return request(`/v1/instances/${enc(name)}/lids/${enc(lid)}`)
}

export function getLidByPn(name: string, phone: string) {
  return request(`/v1/instances/${enc(name)}/lids/pn/${enc(phone)}`)
}

export function reconcileLids(name: string) {
  return request(`/v1/instances/${enc(name)}/chats/reconcile-lids`, { method: 'POST' })
}

// ── Generic API probe (dashboard explorer) ──────────────────────────────────
export async function apiProbe(
  method: string,
  path: string,
  body?: unknown,
): Promise<{ status: number; data: unknown }> {
  const key = getStoredKey()
  if (!key) throw new Error('Not authenticated')
  const headers = new Headers({ 'X-Api-Key': key })
  if (body !== undefined) headers.set('content-type', 'application/json')
  const res = await fetch(path, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  const text = await res.text()
  let data: unknown = text
  try {
    data = text ? JSON.parse(text) : null
  } catch {
    /* keep text */
  }
  return { status: res.status, data }
}

// ── Softphone / calls extended ──────────────────────────────────────────────
export type LiveCall = {
  callId: string
  /** Best display JID — phone when known (server prefers PN over @lid). */
  peerJid?: string | null
  /** Original WA peer (often @lid). */
  peerJidRaw?: string | null
  peerLid?: string | null
  /** Phone from WA call stanza when peer is LID. */
  callerPn?: string | null
  direction?: string
  state?: string | null
  isActive?: boolean
  isRinging?: boolean
  isEnded?: boolean
  canAccept?: boolean
  audioMuted?: boolean
  durationSecs?: number | null
  endReason?: string | null
}

/** Prefer phone number over opaque LID for softphone / history labels. */
export function callDisplayJid(
  call:
    | {
        peerJid?: string | null
        peerJidRaw?: string | null
        callerPn?: string | null
      }
    | null
    | undefined,
): string | null {
  if (!call) return null
  if (call.callerPn && !String(call.callerPn).includes('@lid')) {
    const pn = String(call.callerPn).trim()
    if (pn) return pn.includes('@') ? pn : `${pn.replace(/\D/g, '')}@s.whatsapp.net`
  }
  if (call.peerJid && !call.peerJid.includes('@lid')) return call.peerJid
  if (call.peerJidRaw && !call.peerJidRaw.includes('@lid')) return call.peerJidRaw
  return call.peerJid ?? call.peerJidRaw ?? null
}

export type CallHistoryItem = {
  callId: string
  peerJid: string | null
  direction: string
  state: string | null
  startedAt: string
  endedAt: string | null
  durationSecs: number | null
  recording: {
    enabled: boolean
    status: string
    mime: string | null
    bytes: number | null
    url: string | null
    downloadPath: string | null
    error: string | null
  }
}

export function startCall(name: string, to: string) {
  return request<{ callId: string; peerJid: string }>(`/v1/instances/${enc(name)}/calls`, {
    method: 'POST',
    body: JSON.stringify({ to }),
  })
}

export function listLiveCalls(name: string) {
  return request<{ calls: LiveCall[] }>(`/v1/instances/${enc(name)}/calls`)
}

/** @deprecated prefer listLiveCalls */
export function listCalls(name: string) {
  return listLiveCalls(name)
}

export function listCallHistory(name: string, opts?: { limit?: number; offset?: number; withRecording?: boolean }) {
  const q = new URLSearchParams()
  if (opts?.limit) q.set('limit', String(opts.limit))
  if (opts?.offset) q.set('offset', String(opts.offset))
  if (opts?.withRecording) q.set('withRecording', 'true')
  const qs = q.toString()
  return request<{ calls: CallHistoryItem[] }>(`/v1/instances/${enc(name)}/calls/history${qs ? `?${qs}` : ''}`)
}

export function acceptCall(name: string, callId: string) {
  return request(`/v1/instances/${enc(name)}/calls/${enc(callId)}/accept`, { method: 'POST' })
}

export function rejectCall(name: string, callId: string) {
  return request(`/v1/instances/${enc(name)}/calls/${enc(callId)}/reject`, { method: 'POST' })
}

export function endCall(name: string, callId: string) {
  return request(`/v1/instances/${enc(name)}/calls/${enc(callId)}/end`, { method: 'POST' })
}

export function muteCall(name: string, callId: string, muted: boolean) {
  return request(`/v1/instances/${enc(name)}/calls/${enc(callId)}/mute`, {
    method: 'POST',
    body: JSON.stringify({ muted }),
  })
}

export function getCallRecordingSettings(name: string) {
  return request<{ callRecordingEnabled: boolean; storageReady: boolean }>(
    `/v1/instances/${enc(name)}/settings/call-recording`,
  )
}

export function setCallRecording(name: string, enabled: boolean) {
  return request<{ callRecordingEnabled: boolean; storageReady: boolean }>(
    `/v1/instances/${enc(name)}/settings/call-recording`,
    { method: 'PUT', body: JSON.stringify({ enabled }) },
  )
}

export function callRecordingDownloadUrl(name: string, callId: string) {
  return `/v1/instances/${enc(name)}/calls/${enc(callId)}/recording`
}

export function subscribePresence(name: string, jid: string) {
  return request(`/v1/instances/${enc(name)}/presence/subscribe`, {
    method: 'POST',
    body: JSON.stringify({ jid }),
  })
}

/** Fetch media (or any API path) with API key → blob URL for <img>/<audio>. */
export async function fetchAuthedBlobUrl(path: string): Promise<string | null> {
  const key = getStoredKey()
  if (!key) return null
  const url = path.startsWith('http') ? path : path
  try {
    const res = await fetch(url, { headers: { 'X-Api-Key': key } })
    if (!res.ok) return null
    const blob = await res.blob()
    return URL.createObjectURL(blob)
  } catch {
    return null
  }
}

export async function resolveProfilePictureUrl(name: string, phoneOrJid: string): Promise<string | null> {
  try {
    const r = await getProfilePicture(name, phoneOrJid, 'preview')
    const pic = r.picture as { url?: string } | string | null
    if (typeof pic === 'string' && pic.startsWith('http')) return pic
    if (pic && typeof pic === 'object' && typeof pic.url === 'string') return pic.url
    return null
  } catch {
    return null
  }
}
