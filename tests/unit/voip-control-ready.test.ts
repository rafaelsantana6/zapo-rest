import { beforeAll, afterEach, describe, expect, it, vi } from 'vitest'

type Control = {
  acquire(name: string): void
  disconnect(): void
  ensureConnected(): Promise<void>
  connection: string
  mediaMode: string
}
let VoipControlSocket: new () => Control
vi.mock('../../dashboard/src/api/client', () => ({ getStoredKey: () => 'fake-instance-key' }))
beforeAll(async () => {
  const browserModule = '../../dashboard/src/voip/voip-socket'
  VoipControlSocket = (await import(browserModule)).VoipControlSocket
})
class FakeControlWebSocket {
  static OPEN = 1
  static CLOSED = 3
  static CLOSING = 2
  static sockets: FakeControlWebSocket[] = []
  readyState = 0
  onopen?: () => void
  onclose?: (event: { code: number; reason: string }) => void
  onmessage?: (event: { data: string }) => void
  sent: string[] = []
  constructor(_url: string) {
    FakeControlWebSocket.sockets.push(this)
  }
  send(text: string) {
    this.sent.push(text)
  }
  close() {
    this.readyState = 3
    this.onclose?.({ code: 1000, reason: '' })
  }
  open() {
    this.readyState = 1
    this.onopen?.()
  }
  receive(payload: object) {
    this.onmessage?.({ data: JSON.stringify(payload) })
  }
}
afterEach(() => {
  vi.unstubAllGlobals()
  FakeControlWebSocket.sockets.length = 0
})

describe('VoIP control media negotiation', () => {
  it('waits for authenticated ready and its media mode, even when the socket is already OPEN', async () => {
    vi.stubGlobal('WebSocket', FakeControlWebSocket)
    vi.stubGlobal('window', { location: { protocol: 'https:', host: 'example.test' } })
    const control = new VoipControlSocket()
    control.acquire('sales')
    const ws = FakeControlWebSocket.sockets[0]
    ws?.open()
    let resolved = false
    const ready = control.ensureConnected().then(() => {
      resolved = true
    })
    await Promise.resolve()
    try {
      expect(control.connection).toBe('connecting')
      expect(resolved).toBe(false)
      ws?.receive({ op: 'ready', mediaMode: 'remote', mlowRed: true })
      await ready
      expect(control.connection).toBe('connected')
      expect(control.mediaMode).toBe('remote')
    } finally {
      control.disconnect()
      await ready.catch(() => undefined)
    }
  })
})
