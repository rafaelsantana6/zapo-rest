/**
 * VoIP control WebSocket client (signaling).
 * Multi-subscriber: Softphone + Calls page can listen together (no polling).
 */

import { getStoredKey, type LiveCall } from '../api/client'

export type VoipConnectionState = 'disconnected' | 'connecting' | 'connected'

export type VoipDeviceStatus = {
  status: string
  meJid?: string | null
}

type AckOk = { ok: true; data?: unknown }
type AckErr = { ok: false; code: string; message: string }
type Pending = {
  resolve: (v: AckOk | AckErr) => void
  timer: ReturnType<typeof setTimeout>
}

export type VoipHandlers = {
  onConnection?: (s: VoipConnectionState) => void
  onDeviceStatus?: (s: VoipDeviceStatus) => void
  onCallsSnapshot?: (calls: LiveCall[]) => void
  onCallOffer?: (call: LiveCall) => void
  onCallRinging?: (call: LiveCall) => void
  onCallAccepted?: (call: LiveCall) => void
  onCallState?: (call: LiveCall) => void
  onCallEnded?: (call: LiveCall) => void
  onError?: (message: string) => void
}

let seq = 0
function nextId() {
  seq += 1
  return `r${seq}-${Date.now().toString(36)}`
}

export class VoipControlSocket {
  private ws: WebSocket | null = null
  private instance: string | null = null
  private pending = new Map<string, Pending>()
  private listeners = new Set<VoipHandlers>()
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private closedByUser = false
  private conn: VoipConnectionState = 'disconnected'
  private refCount = 0
  private openWaiters: Array<{
    resolve: () => void
    reject: (err: Error) => void
    timer: ReturnType<typeof setTimeout>
  }> = []
  private lastError: string | null = null
  private reconnectAttempt = 0

  /** Register handlers; returns unsubscribe. */
  subscribe(h: VoipHandlers): () => void {
    this.listeners.add(h)
    h.onConnection?.(this.conn)
    return () => {
      this.listeners.delete(h)
    }
  }

  /** @deprecated use subscribe */
  setHandlers(h: VoipHandlers) {
    this.listeners.clear()
    if (Object.keys(h).length) this.listeners.add(h)
  }

  get connection() {
    return this.conn
  }

  get attachedInstance() {
    return this.instance
  }

  get lastErrorMessage() {
    return this.lastError
  }

  /** Acquire a user of the socket (Softphone / Calls page). */
  acquire(instanceName: string) {
    this.refCount += 1
    this.closedByUser = false
    if (this.instance !== instanceName) {
      this.instance = instanceName
      this.forceReconnect()
    } else if (!this.ws || this.ws.readyState === WebSocket.CLOSED || this.ws.readyState === WebSocket.CLOSING) {
      this.open()
    } else if (this.ws.readyState === WebSocket.OPEN) {
      void this.command('instance:attach', { instance: instanceName }).catch(() => undefined)
    }
    // CONNECTING: wait — open already in flight
  }

  release() {
    this.refCount = Math.max(0, this.refCount - 1)
    if (this.refCount === 0) {
      // delay disconnect slightly to allow navigation Softphone↔Calls
      setTimeout(() => {
        if (this.refCount === 0) this.disconnect()
      }, 1500)
    }
  }

  connect(instanceName: string) {
    this.acquire(instanceName)
  }

  /** Manual reconnect from UI */
  reconnect() {
    if (!this.instance) {
      this.emit('onError', 'Sem instância ativa')
      return
    }
    this.closedByUser = false
    if (this.refCount === 0) this.refCount = 1
    this.forceReconnect()
  }

  disconnect() {
    this.closedByUser = true
    this.refCount = 0
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer)
    this.reconnectTimer = null
    this.rejectAll('disconnected')
    this.rejectOpenWaiters(new Error('disconnected'))
    try {
      this.ws?.close()
    } catch {
      /* */
    }
    this.ws = null
    this.setConn('disconnected')
  }

  private forceReconnect() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
    try {
      this.ws?.close()
    } catch {
      /* */
    }
    this.ws = null
    this.open()
  }

  private emit<K extends keyof VoipHandlers>(key: K, ...args: Parameters<NonNullable<VoipHandlers[K]>>) {
    for (const h of this.listeners) {
      const fn = h[key] as ((...a: unknown[]) => void) | undefined
      try {
        fn?.(...args)
      } catch {
        /* listener error */
      }
    }
  }

  private setConn(s: VoipConnectionState) {
    this.conn = s
    this.emit('onConnection', s)
  }

  private resolveOpenWaiters() {
    for (const w of this.openWaiters) {
      clearTimeout(w.timer)
      w.resolve()
    }
    this.openWaiters = []
  }

  private rejectOpenWaiters(err: Error) {
    for (const w of this.openWaiters) {
      clearTimeout(w.timer)
      w.reject(err)
    }
    this.openWaiters = []
  }

  /**
   * Wait until the control WebSocket is OPEN (or fail).
   * Starts a connect attempt if needed.
   */
  ensureConnected(timeoutMs = 12_000): Promise<void> {
    if (this.ws?.readyState === WebSocket.OPEN) return Promise.resolve()

    if (!this.instance) {
      return Promise.reject(new Error('Sem instância — abra uma linha (instances/… )'))
    }
    if (!getStoredKey()) {
      return Promise.reject(new Error('Não autenticado'))
    }

    if (!this.ws || this.ws.readyState === WebSocket.CLOSED || this.ws.readyState === WebSocket.CLOSING) {
      this.open()
    }

    return new Promise((resolve, reject) => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        resolve()
        return
      }
      const timer = setTimeout(() => {
        this.openWaiters = this.openWaiters.filter((w) => w.timer !== timer)
        reject(
          new Error(
            this.lastError
              ? `VoIP não conectou: ${this.lastError}`
              : 'VoIP socket não conectou a tempo (verifique API / proxy WS /apiKey)',
          ),
        )
      }, timeoutMs)
      this.openWaiters.push({ resolve, reject, timer })
    })
  }

  private open() {
    const key = getStoredKey()
    if (!key || !this.instance) {
      this.lastError = !key ? 'Not authenticated' : 'No instance'
      this.emit('onError', this.lastError)
      this.rejectOpenWaiters(new Error(this.lastError))
      return
    }
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      if (this.ws.readyState === WebSocket.OPEN) {
        void this.sendRaw('instance:attach', { instance: this.instance })
      }
      return
    }

    this.setConn('connecting')
    const proto = window.location.protocol === 'https:' ? 'wss' : 'ws'
    const params = new URLSearchParams({
      apiKey: key,
      instance: this.instance,
    })
    // Prefer same host (dashboard served by API or vite proxy with ws:true)
    const url = `${proto}://${window.location.host}/v1/voip?${params}`
    let ws: WebSocket
    try {
      ws = new WebSocket(url)
    } catch (err) {
      this.lastError = err instanceof Error ? err.message : 'WebSocket construct failed'
      this.setConn('disconnected')
      this.emit('onError', this.lastError)
      this.rejectOpenWaiters(new Error(this.lastError))
      this.scheduleReconnect()
      return
    }
    this.ws = ws

    ws.onopen = () => {
      this.reconnectAttempt = 0
      this.lastError = null
      this.setConn('connected')
      this.resolveOpenWaiters()
      // attach is also done server-side via ?instance=; re-assert for safety
      void this.sendRaw('instance:attach', { instance: this.instance })
    }

    ws.onclose = (ev) => {
      const wasOurs = this.ws === ws
      if (!wasOurs) return
      this.ws = null
      this.setConn('disconnected')
      this.rejectAll('socket closed')
      if (ev.code && ev.code !== 1000) {
        this.lastError = `WS closed ${ev.code}${ev.reason ? `: ${ev.reason}` : ''}`
      }
      if (!this.closedByUser && this.refCount > 0) {
        this.scheduleReconnect()
      } else {
        this.rejectOpenWaiters(new Error(this.lastError ?? 'socket closed'))
      }
    }

    ws.onerror = () => {
      this.lastError = 'Falha no WebSocket /v1/voip (rede, proxy ou API offline)'
      // onclose follows and schedules reconnect
    }

    ws.onmessage = (ev) => {
      try {
        this.dispatch(JSON.parse(String(ev.data)) as Record<string, unknown>)
      } catch {
        /* */
      }
    }
  }

  private scheduleReconnect() {
    if (this.closedByUser || this.refCount <= 0) return
    if (this.reconnectTimer) return
    this.reconnectAttempt += 1
    const delay = Math.min(10_000, 800 * 2 ** Math.min(this.reconnectAttempt, 4))
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      if (!this.closedByUser && this.refCount > 0) this.open()
    }, delay)
  }

  private dispatch(msg: Record<string, unknown>) {
    const op = msg.op as string
    if (op === 'ack') {
      const id = msg.id as string
      const p = this.pending.get(id)
      if (!p) return
      clearTimeout(p.timer)
      this.pending.delete(id)
      if (msg.ok) p.resolve({ ok: true, data: msg.data })
      else
        p.resolve({
          ok: false,
          code: String(msg.code ?? 'ERROR'),
          message: String(msg.message ?? 'error'),
        })
      return
    }
    if (op === 'pong') return
    if (op === 'ready') {
      // Server auto-attach ready — treat as connected confirmation
      if (this.conn !== 'connected') this.setConn('connected')
      this.resolveOpenWaiters()
      return
    }
    if (op === 'error') {
      const message = String(msg.message ?? msg.code ?? 'VoIP error')
      this.lastError = message
      this.emit('onError', message)
      return
    }

    if (op === 'device:status') {
      this.emit('onDeviceStatus', {
        status: String(msg.status ?? 'unknown'),
        meJid: (msg.meJid as string) ?? null,
      })
      return
    }
    if (op === 'calls:snapshot') {
      this.emit('onCallsSnapshot', (msg.calls as LiveCall[]) ?? [])
      return
    }

    const call = msg.call as LiveCall | undefined
    if (!call?.callId) return

    if (op === 'call:offer') this.emit('onCallOffer', call)
    else if (op === 'call:ringing') this.emit('onCallRinging', call)
    else if (op === 'call:accepted') this.emit('onCallAccepted', call)
    else if (op === 'call:state') this.emit('onCallState', call)
    else if (op === 'call:ended') this.emit('onCallEnded', call)
  }

  /** Fire-and-forget without waiting for ack (attach on open). */
  private sendRaw(op: string, payload: Record<string, unknown> = {}) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return
    const id = nextId()
    this.ws.send(JSON.stringify({ op, id, ...payload }))
  }

  private async command(
    op: string,
    payload: Record<string, unknown> = {},
    timeoutMs = 12_000,
  ): Promise<AckOk | AckErr> {
    try {
      await this.ensureConnected(Math.min(timeoutMs, 12_000))
    } catch (err) {
      return {
        ok: false,
        code: 'DISCONNECTED',
        message: err instanceof Error ? err.message : 'VoIP socket not connected',
      }
    }

    return new Promise((resolve) => {
      const id = nextId()
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
        resolve({ ok: false, code: 'DISCONNECTED', message: 'VoIP socket not connected' })
        return
      }
      const timer = setTimeout(() => {
        this.pending.delete(id)
        resolve({ ok: false, code: 'TIMEOUT', message: `timeout waiting for ${op}` })
      }, timeoutMs)
      this.pending.set(id, { resolve, timer })
      try {
        this.ws.send(JSON.stringify({ op, id, ...payload }))
      } catch (err) {
        clearTimeout(timer)
        this.pending.delete(id)
        resolve({
          ok: false,
          code: 'SEND_FAILED',
          message: err instanceof Error ? err.message : 'send failed',
        })
      }
    })
  }

  private rejectAll(reason: string) {
    for (const [id, p] of this.pending) {
      clearTimeout(p.timer)
      p.resolve({ ok: false, code: 'DISCONNECTED', message: reason })
      this.pending.delete(id)
    }
  }

  async startCall(phone: string) {
    // Server may resolve usync + initMedia; keep above that path (15s) + network cushion.
    return this.command('call:start', { phone }, 25_000)
  }

  async acceptCall(callId: string) {
    // Server acks within ~2.5s even if relay connect is slow; keep a cushion.
    return this.command('call:accept', { callId }, 20_000)
  }

  async rejectCall(callId: string) {
    return this.command('call:reject', { callId })
  }

  async endCall(callId: string) {
    return this.command('call:end', { callId })
  }

  async muteCall(callId: string, muted: boolean) {
    return this.command('call:mute', { callId, muted })
  }

  async listCalls() {
    return this.command('calls:list', {})
  }

  async ping() {
    return this.command('ping', {}, 3000)
  }
}

export const voipSocket = new VoipControlSocket()
