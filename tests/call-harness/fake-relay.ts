/**
 * Local stand-in for a WhatsApp "FNA" media relay: plain UDP, no DTLS/SCTP.
 *
 * The voip plugin dials FNA endpoints with a connected dgram socket and marks the relay
 * connected immediately, so a relay only has to forward SRTP/SRTCP between the two call legs.
 * Each direction runs through a network model (latency, jitter, random loss, bandwidth with a
 * bounded queue) so tests can reproduce "bad Wi-Fi / 4G" conditions deterministically.
 */
import dgram from 'node:dgram'

export type NetworkProfile = {
  /** One-way base latency. */
  latencyMs: number
  /** Uniform ± jitter added to each packet (order is preserved, like most real paths). */
  jitterMs: number
  /** 0..1 random packet loss. */
  lossRate: number
  /** Link rate; omit for unlimited. */
  bandwidthKbps?: number
  /** Tail-drop once queued data exceeds this much airtime (default 400 ms). */
  queueLimitMs?: number
}

export const CLEAN_NETWORK: NetworkProfile = { latencyMs: 0, jitterMs: 0, lossRate: 0 }

export type RelayDirection = 'toZapo' | 'toPhone'

export type RelayDirectionStats = { forwarded: number; lost: number; queueDropped: number; bytes: number }

type Endpoint = { address: string; port: number }

/** mulberry32 — tiny seeded PRNG so impaired runs are repeatable. */
function seededRandom(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** STUN starts with 0b00; RTP/RTCP with version 2 (0b10). */
function isStun(msg: Buffer): boolean {
  return msg.length >= 20 && (msg[0] ?? 0) >> 6 === 0
}

class NetworkLane {
  readonly stats: RelayDirectionStats = { forwarded: 0, lost: 0, queueDropped: 0, bytes: 0 }
  private linkFreeAt = 0
  private lastDeliverAt = 0

  constructor(
    private profile: NetworkProfile,
    private readonly random: () => number,
  ) {}

  setProfile(profile: NetworkProfile) {
    this.profile = profile
  }

  /** Returns the delay (ms) before delivery, or null when the packet is dropped. */
  schedule(bytes: number, now: number): number | null {
    const { latencyMs, jitterMs, lossRate, bandwidthKbps, queueLimitMs = 400 } = this.profile
    if (lossRate > 0 && this.random() < lossRate) {
      this.stats.lost += 1
      return null
    }
    let departAt = now
    if (bandwidthKbps && bandwidthKbps > 0) {
      const start = Math.max(now, this.linkFreeAt)
      if (start - now > queueLimitMs) {
        this.stats.queueDropped += 1
        return null
      }
      this.linkFreeAt = start + (bytes * 8) / bandwidthKbps
      departAt = this.linkFreeAt
    }
    const jitter = jitterMs > 0 ? (this.random() * 2 - 1) * jitterMs : 0
    const deliverAt = Math.max(departAt + latencyMs + jitter, this.lastDeliverAt)
    this.lastDeliverAt = deliverAt
    this.stats.forwarded += 1
    this.stats.bytes += bytes
    return Math.max(0, deliverAt - now)
  }
}

export class FakeFnaRelay {
  private phone: Endpoint | null = null
  private readonly zapoLegs = new Map<string, Endpoint>()
  private readonly lanes: Record<RelayDirection, NetworkLane>
  private readonly timers = new Set<NodeJS.Timeout>()

  private constructor(
    private readonly socket: dgram.Socket,
    seed: number,
  ) {
    const random = seededRandom(seed)
    this.lanes = { toZapo: new NetworkLane(CLEAN_NETWORK, random), toPhone: new NetworkLane(CLEAN_NETWORK, random) }
    socket.on('message', (msg, rinfo) => this.onMessage(msg, rinfo))
  }

  static async start(opts: { seed?: number } = {}): Promise<FakeFnaRelay> {
    const socket = dgram.createSocket('udp4')
    await new Promise<void>((resolve) => socket.bind(0, '127.0.0.1', resolve))
    return new FakeFnaRelay(socket, opts.seed ?? 1)
  }

  get port(): number {
    return this.socket.address().port
  }

  /** The harness phone's UDP source — everything else is treated as the zapo leg. */
  setPhoneEndpoint(endpoint: Endpoint) {
    this.phone = endpoint
  }

  setProfile(direction: RelayDirection, profile: NetworkProfile) {
    this.lanes[direction].setProfile(profile)
  }

  stats(): Record<RelayDirection, RelayDirectionStats> {
    return { toZapo: { ...this.lanes.toZapo.stats }, toPhone: { ...this.lanes.toPhone.stats } }
  }

  async stop(): Promise<void> {
    for (const t of this.timers) clearTimeout(t)
    this.timers.clear()
    await new Promise<void>((resolve) => this.socket.close(() => resolve()))
  }

  private onMessage(msg: Buffer, from: dgram.RemoteInfo) {
    const fromPhone = this.phone?.port === from.port && this.phone.address === from.address
    if (!fromPhone) this.zapoLegs.set(`${from.address}:${from.port}`, { address: from.address, port: from.port })
    // Relay control (allocate / binding / keepalive) is consumed here, never forwarded
    if (isStun(msg)) return

    if (fromPhone) {
      for (const leg of this.zapoLegs.values()) this.forward('toZapo', msg, leg)
    } else if (this.phone) {
      this.forward('toPhone', msg, this.phone)
    }
  }

  private forward(direction: RelayDirection, msg: Buffer, to: Endpoint) {
    const delay = this.lanes[direction].schedule(msg.length, performance.now())
    if (delay === null) return
    if (delay < 1) {
      this.socket.send(msg, to.port, to.address)
      return
    }
    const timer = setTimeout(() => {
      this.timers.delete(timer)
      this.socket.send(msg, to.port, to.address)
    }, delay)
    this.timers.add(timer)
  }
}
