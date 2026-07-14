const KEY_STORAGE = 'zapo_rest_api_key'
const HINT_STORAGE = 'zapo_rest_instance_hint'
/** When admin opens an instance page, we switch the request key to that instance's apiKey. */
const ADMIN_BACKUP_STORAGE = 'zapo_rest_admin_key_backup'

export type Instance = {
  name: string
  /** Plaintext instance API key — always present on list/get/create/rotate. */
  apiKey: string
  webhookUrl: string | null
  webhookEvents: string[]
  status: string
  meJid: string | null
  pushName?: string | null
  avatarUrl?: string | null
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
  sessionStorage.removeItem(ADMIN_BACKUP_STORAGE)
}

export function setInstanceHint(name: string) {
  sessionStorage.setItem(HINT_STORAGE, name)
}

export function getInstanceHint(): string | null {
  return sessionStorage.getItem(HINT_STORAGE)
}

/**
 * Admin opens an instance: operational routes need the **instance** API key.
 * Backs up the admin key so leaving the instance can restore it.
 */
/** Switch request key to an instance token (backs up admin key once). Not a React hook. */
export function setInstanceApiKey(instanceApiKey: string): void {
  const cur = getStoredKey()
  if (cur && !sessionStorage.getItem(ADMIN_BACKUP_STORAGE)) {
    sessionStorage.setItem(ADMIN_BACKUP_STORAGE, cur)
  }
  setStoredKey(instanceApiKey)
}

/** Restore admin key after leaving an instance (if we had backed it up). */
export function restoreAdminApiKey(): void {
  const admin = sessionStorage.getItem(ADMIN_BACKUP_STORAGE)
  if (admin) {
    setStoredKey(admin)
    sessionStorage.removeItem(ADMIN_BACKUP_STORAGE)
  }
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

export function getInstance(_name: string) {
  return request<{ instance: Instance }>(`/v1/instance`)
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

export function connectInstance(_name: string) {
  return request<{ instance: Instance }>(`/v1/instance/connect`, { method: 'POST' })
}

export function disconnectInstance(_name: string) {
  return request<{ instance: Instance }>(`/v1/instance/disconnect`, {
    method: 'POST',
  })
}

export function restartInstance(_name: string) {
  return request<{ instance: Instance }>(`/v1/instance/restart`, { method: 'POST' })
}

export function getQr(_name: string) {
  return request<{ qr: string | null; status: string; expiresAt?: string | null }>(`/v1/instance/qr`)
}

export function requestPairing(_name: string, phone: string) {
  return request<{ code: string; phone: string }>(`/v1/instance/pairing-code`, {
    method: 'POST',
    body: JSON.stringify({ phone }),
  })
}

export function rotateKey(name: string) {
  // Admin-only collection route (still names the target instance)
  return request<{ instance: Instance }>(`/v1/instances/${enc(name)}/keys/rotate`, {
    method: 'POST',
  })
}

// ── Chats / messages ────────────────────────────────────────────────────────
export function listChats(_name: string, limit = 100) {
  return request<{ chats: Chat[] }>(`/v1/chats?limit=${limit}`)
}

export function listMessages(_name: string, chatId: string, limit = 80) {
  return request<{ messages: Message[] }>(`/v1/chats/${enc(chatId)}/messages?limit=${limit}`)
}

export function markChatRead(_name: string, chatId: string, messageIds: string[]) {
  return request<{ ok: boolean }>(`/v1/chats/${enc(chatId)}/messages/read`, {
    method: 'POST',
    body: JSON.stringify({ messageIds }),
  })
}

export function archiveChat(_name: string, chatId: string, archive = true) {
  return request(`/v1/chats/${enc(chatId)}/${archive ? 'archive' : 'unarchive'}`, {
    method: 'POST',
  })
}

// ── Send ────────────────────────────────────────────────────────────────────
export function sendText(_name: string, to: string, text: string, opts?: { mentions?: string[] }) {
  return request<{ id: string }>(`/v1/messages/text`, {
    method: 'POST',
    body: JSON.stringify({ to, text, ...opts }),
  })
}

export function sendMedia(
  _name: string,
  kind: 'image' | 'video' | 'audio' | 'document' | 'sticker',
  body: Record<string, unknown>,
) {
  return request<{ id: string }>(`/v1/messages/${kind}`, {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

export function sendLocation(
  _name: string,
  body: { to: string; latitude: number; longitude: number; name?: string; address?: string },
) {
  return request<{ id: string }>(`/v1/messages/location`, {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

export function sendPoll(
  _name: string,
  body: { to: string; name: string; options: string[]; selectableCount?: number },
) {
  return request<{ id: string }>(`/v1/messages/poll`, {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

export function sendContact(
  _name: string,
  body: {
    to: string
    contacts: { fullName: string; phoneNumber: string; organization?: string; email?: string }[]
  },
) {
  return request<{ id: string }>(`/v1/messages/contact`, {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

export function sendReact(_name: string, body: { to: string; messageId: string; emoji: string; fromMe?: boolean }) {
  return request<{ id: string }>(`/v1/messages/react`, {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

// ── Contacts / resolve ──────────────────────────────────────────────────────
export function listContacts(_name: string, limit = 200) {
  return request<{ contacts: Contact[] }>(`/v1/contacts?limit=${limit}`)
}

export function resolveNumbers(_name: string, numbers: string[]) {
  return request<{ results: unknown[] }>(`/v1/contacts/resolve`, {
    method: 'POST',
    body: JSON.stringify({ numbers }),
  })
}

export function checkNumbers(_name: string, phones: string[]) {
  return request<{ results: unknown[] }>(`/v1/contacts/check`, {
    method: 'POST',
    body: JSON.stringify({ phones }),
  })
}

export function getProfilePicture(
  _name: string,
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
  }>(`/v1/contacts/${enc(phone)}/profile-picture?${q}`)
}

export function getAbout(_name: string, phone: string) {
  return request<{ status: string | null; jid?: string }>(`/v1/contacts/${enc(phone)}/about`)
}

export function createJidLocal(_name: string, numbers: string[]) {
  return request<{ results: unknown[] }>(`/v1/contacts/jid`, {
    method: 'POST',
    body: JSON.stringify({ numbers }),
  })
}

// ── Groups ──────────────────────────────────────────────────────────────────
export function listGroups(_name: string) {
  return request<{ groups: Group[] }>(`/v1/groups`)
}

export function getGroup(_name: string, groupId: string) {
  return request<{ group: Group }>(`/v1/groups/${enc(groupId)}`)
}

export function createGroup(_name: string, body: { subject: string; participants: string[]; description?: string }) {
  return request<{ group: Group }>(`/v1/groups`, {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

export function leaveGroup(_name: string, groupId: string) {
  return request<{ ok: boolean }>(`/v1/groups/${enc(groupId)}/leave`, {
    method: 'POST',
  })
}

export function groupInviteCode(_name: string, groupId: string) {
  return request<{ code: string; inviteLink: string }>(`/v1/groups/${enc(groupId)}/invite-code`)
}

export function joinGroup(_name: string, code: string) {
  return request<{ group: Group }>(`/v1/groups/join`, {
    method: 'POST',
    body: JSON.stringify({ code }),
  })
}

// ── Webhooks ────────────────────────────────────────────────────────────────
export function listWebhooks(_name: string) {
  return request<{ webhooks: WebhookConfig[]; availableEvents: string[] }>(`/v1/webhooks`)
}

export function createWebhook(
  _name: string,
  body: {
    url: string
    events?: string[]
    hmac?: { key: string }
    enabled?: boolean
    retries?: { policy?: string; delaySeconds?: number; attempts?: number }
  },
) {
  return request<{ webhook: WebhookConfig }>(`/v1/webhooks`, {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

export function updateWebhook(_name: string, id: string, body: Record<string, unknown>) {
  return request<{ webhook: WebhookConfig }>(`/v1/webhooks/${enc(id)}`, {
    method: 'PUT',
    body: JSON.stringify(body),
  })
}

export function deleteWebhook(_name: string, id: string) {
  return request<{ ok: boolean }>(`/v1/webhooks/${enc(id)}`, {
    method: 'DELETE',
  })
}

// ── Profile ─────────────────────────────────────────────────────────────────
export function getProfile(_name: string) {
  return request<{ profile: unknown }>(`/v1/profile`)
}

export function setProfileName(_name: string, displayName: string) {
  return request(`/v1/profile/name`, {
    method: 'PUT',
    body: JSON.stringify({ name: displayName }),
  })
}

export function setProfileStatus(_name: string, status: string) {
  return request(`/v1/profile/status`, {
    method: 'PUT',
    body: JSON.stringify({ status }),
  })
}

// ── Labels ──────────────────────────────────────────────────────────────────
export function listLabels(_name: string) {
  return request<{ labels: { id: string; name: string; color: number; isActive: boolean }[] }>(`/v1/labels`)
}

export function createLabel(_name: string, body: { name: string; color?: number; id?: string }) {
  return request(`/v1/labels`, {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

export function deleteLabel(_name: string, labelId: string) {
  return request(`/v1/labels/${enc(labelId)}`, { method: 'DELETE' })
}

// ── Presence ────────────────────────────────────────────────────────────────
export function setPresence(_name: string, type: 'available' | 'unavailable') {
  return request(`/v1/presence`, {
    method: 'POST',
    body: JSON.stringify({ type }),
  })
}

export function setChatstate(_name: string, jid: string, state: 'composing' | 'paused' | 'recording') {
  return request(`/v1/chats/${enc(jid)}/chatstate`, {
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
export function getMessageMediaUrl(_name: string, messageId: string): string {
  return `/v1/messages/${enc(messageId)}/media`
}

export function getBase64FromMedia(_name: string, messageId: string) {
  return request<{
    base64: string
    mimetype: string | null
    fileName: string | null
    mediaType: string
    size: number
    mediaUrl: string | null
    source: string
  }>(`/v1/media/getBase64FromMediaMessage`, {
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

export function getInstanceMetrics(_name: string, opts?: { from?: string; to?: string }) {
  const q = new URLSearchParams()
  if (opts?.from) q.set('from', opts.from)
  if (opts?.to) q.set('to', opts.to)
  const qs = q.toString()
  return request<MetricsSummary>(`/v1/metrics${qs ? `?${qs}` : ''}`)
}

export function getInstanceMetricsTimeseries(
  _name: string,
  opts?: { from?: string; to?: string; bucket?: 'hour' | 'day' },
) {
  const q = new URLSearchParams()
  if (opts?.from) q.set('from', opts.from)
  if (opts?.to) q.set('to', opts.to)
  if (opts?.bucket) q.set('bucket', opts.bucket)
  const qs = q.toString()
  return request<MetricsTimeseries>(`/v1/metrics/timeseries${qs ? `?${qs}` : ''}`)
}

export function getInstanceMetricsResources(_name: string) {
  return request<MetricsResources>(`/v1/metrics/resources`)
}

// ── Privacy / business ──────────────────────────────────────────────────────
export function getPrivacy(_name: string) {
  return request<{ settings: unknown; privacy?: unknown }>(`/v1/privacy`)
}

export function updatePrivacy(_name: string, body: { setting: string; value: string } | Record<string, unknown>) {
  // Accept either {setting,value} or a single-key map from the dashboard form
  let payload: { setting: string; value: string }
  if ('setting' in body && 'value' in body) {
    payload = { setting: String(body.setting), value: String(body.value) }
  } else {
    const [setting, value] = Object.entries(body)[0] ?? ['last', 'all']
    payload = { setting, value: String(value) }
  }
  return request(`/v1/privacy`, {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

export function getBlocklist(_name: string) {
  return request<{ blocklist: string[] }>(`/v1/blocklist`)
}

export function getBusinessProfile(_name: string, phone?: string) {
  const q = phone ? `?phone=${enc(phone)}` : ''
  return request<{ profile: unknown }>(`/v1/business/profile${q}`)
}

// ── Status / stories ────────────────────────────────────────────────────────
export function sendStatusText(_name: string, body: { text: string; recipients: string[] }) {
  return request(`/v1/status/send`, {
    method: 'POST',
    body: JSON.stringify({ type: 'text', ...body }),
  })
}

export function sendStatusMedia(
  _name: string,
  body: { mediaUrl?: string; mediaBase64?: string; caption?: string; recipients: string[]; type?: string },
) {
  return request(`/v1/status/send`, {
    method: 'POST',
    body: JSON.stringify({ type: body.type ?? 'image', ...body }),
  })
}

export function revokeStatus(_name: string, messageId: string, recipients: string[] = []) {
  return request(`/v1/status/revoke`, {
    method: 'POST',
    body: JSON.stringify({ messageId, recipients: recipients.length ? recipients : ['status@broadcast'] }),
  })
}

// ── LIDs ────────────────────────────────────────────────────────────────────
export function listLids(_name: string, limit = 100, offset = 0) {
  return request<{ lids: { lid: string; pn: string }[]; total?: number }>(`/v1/lids?limit=${limit}&offset=${offset}`)
}

export function countLids(_name: string) {
  return request<{ count: number }>(`/v1/lids/count`)
}

export function getLid(_name: string, lid: string) {
  return request(`/v1/lids/${enc(lid)}`)
}

export function getLidByPn(_name: string, phone: string) {
  return request(`/v1/lids/pn/${enc(phone)}`)
}

export function reconcileLids(_name: string) {
  return request(`/v1/chats/reconcile-lids`, { method: 'POST' })
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

export function startCall(_name: string, to: string) {
  return request<{ callId: string; peerJid: string }>(`/v1/calls`, {
    method: 'POST',
    body: JSON.stringify({ to }),
  })
}

export function listLiveCalls(_name: string) {
  return request<{ calls: LiveCall[] }>(`/v1/calls`)
}

/** @deprecated prefer listLiveCalls */
export function listCalls(name: string) {
  return listLiveCalls(name)
}

export function listCallHistory(_name: string, opts?: { limit?: number; offset?: number; withRecording?: boolean }) {
  const q = new URLSearchParams()
  if (opts?.limit) q.set('limit', String(opts.limit))
  if (opts?.offset) q.set('offset', String(opts.offset))
  if (opts?.withRecording) q.set('withRecording', 'true')
  const qs = q.toString()
  return request<{ calls: CallHistoryItem[] }>(`/v1/calls/history${qs ? `?${qs}` : ''}`)
}

export function acceptCall(_name: string, callId: string) {
  return request(`/v1/calls/${enc(callId)}/accept`, { method: 'POST' })
}

export function rejectCall(_name: string, callId: string) {
  return request(`/v1/calls/${enc(callId)}/reject`, { method: 'POST' })
}

export function endCall(_name: string, callId: string) {
  return request(`/v1/calls/${enc(callId)}/end`, { method: 'POST' })
}

export function muteCall(_name: string, callId: string, muted: boolean) {
  return request(`/v1/calls/${enc(callId)}/mute`, {
    method: 'POST',
    body: JSON.stringify({ muted }),
  })
}

export function getCallRecordingSettings(_name: string) {
  return request<{ callRecordingEnabled: boolean; storageReady: boolean }>(`/v1/settings/call-recording`)
}

export function setCallRecording(_name: string, enabled: boolean) {
  return request<{ callRecordingEnabled: boolean; storageReady: boolean }>(`/v1/settings/call-recording`, {
    method: 'PUT',
    body: JSON.stringify({ enabled }),
  })
}

export function callRecordingDownloadUrl(_name: string, callId: string) {
  return `/v1/calls/${enc(callId)}/recording`
}

export function subscribePresence(_name: string, jid: string) {
  return request(`/v1/presence/subscribe`, {
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
