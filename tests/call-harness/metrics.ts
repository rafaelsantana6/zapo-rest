/**
 * Quality probes for one media direction. All times are `performance.now()` ms on the same
 * process clock, so sender and receiver timestamps are directly comparable.
 */
import { AUDIO_RATE, BEEP_HZ, BEEP_INTERVAL_MS } from './media-fixture'

export type Percentiles = { p50: number; p95: number; max: number }

export type VideoReport = {
  framesSent: number
  framesReceived: number
  lossPct: number
  /** Distinct frames delivered per second over the receive window. */
  fps: number
  latencyMs: Percentiles
  /** Std-dev of inter-arrival gaps vs. the nominal frame interval. */
  jitterMs: number
  /** Gaps between delivered frames longer than FREEZE_MS. */
  freezes: number
  longestFreezeMs: number
  /** First frame at the receiver, relative to the first frame sent. */
  firstFrameMs: number | null
  /** IDRs that arrived / how many the receiver was told were key frames. */
  idrReceived: number
  keyFramesFlagged: number
  /**
   * Frames a real decoder can show: byte-intact and with an unbroken reference chain back to
   * the last IDR (no NACK/PLI path, so one lost P-frame spoils the rest of the GOP).
   */
  decodableFrames: number
  decodableFps: number
  /** Longest stretch with no decodable frame (what the viewer sees as a freeze). */
  longestVisualFreezeMs: number
}

export type AudioReport = {
  beepsSent: number
  beepsDetected: number
  latencyMs: Percentiles
  /** Receive gaps > AUDIO_GAP_MS inside the send window (audible dropouts). */
  gaps: number
  longestGapMs: number
}

export type AvSyncReport = {
  /** audio latency − video latency per sync point; positive = audio behind video. */
  skewMs: Percentiles & { p50Signed: number }
  pairs: number
}

const FREEZE_MS = 200
const AUDIO_GAP_MS = 150

export function percentiles(values: number[]): Percentiles {
  if (!values.length) return { p50: Number.NaN, p95: Number.NaN, max: Number.NaN }
  const sorted = [...values].sort((a, b) => a - b)
  const at = (q: number) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] ?? Number.NaN
  return { p50: round(at(0.5)), p95: round(at(0.95)), max: round(sorted[sorted.length - 1] ?? Number.NaN) }
}

function round(n: number): number {
  return Math.round(n * 10) / 10
}

export class VideoProbe {
  private readonly sentAt = new Map<number, number>()
  private readonly received = new Map<number, number>()
  private readonly intact = new Map<number, boolean>()
  private readonly idrIndexes = new Set<number>()
  private idr = 0
  private flagged = 0

  constructor(private readonly fps: number) {}

  sent(index: number, opts: { at?: number; isIdr: boolean }) {
    this.sentAt.set(index, opts.at ?? performance.now())
    if (opts.isIdr) this.idrIndexes.add(index)
  }

  delivered(index: number, opts: { at?: number; isIdr: boolean; flaggedKey: boolean; intact: boolean }) {
    if (this.received.has(index)) return
    this.received.set(index, opts.at ?? performance.now())
    this.intact.set(index, opts.intact)
    if (opts.isIdr) this.idr += 1
    if (opts.flaggedKey) this.flagged += 1
  }

  /** Arrival time of a frame (for A/V sync), or undefined if it never arrived. */
  arrival(index: number): number | undefined {
    return this.received.get(index)
  }

  sendTime(index: number): number | undefined {
    return this.sentAt.get(index)
  }

  report(): VideoReport {
    const latencies: number[] = []
    for (const [index, at] of this.received) {
      const sent = this.sentAt.get(index)
      if (sent !== undefined) latencies.push(at - sent)
    }
    const arrivals = [...this.received.values()].sort((a, b) => a - b)
    const gaps = arrivals.slice(1).map((t, i) => t - (arrivals[i] ?? t))
    const nominal = 1000 / this.fps
    const jitter = gaps.length ? Math.sqrt(gaps.reduce((s, g) => s + (g - nominal) ** 2, 0) / gaps.length) : 0
    const freezes = gaps.filter((g) => g > FREEZE_MS)
    const window = arrivals.length > 1 ? ((arrivals.at(-1) ?? 0) - (arrivals[0] ?? 0)) / 1000 : 0
    const firstSent = Math.min(...this.sentAt.values())
    const decodable = this.decodableArrivals()
    const decodableGaps = decodable.slice(1).map((t, i) => t - (decodable[i] ?? t))
    const decodableWindow = decodable.length > 1 ? ((decodable.at(-1) ?? 0) - (decodable[0] ?? 0)) / 1000 : 0
    return {
      framesSent: this.sentAt.size,
      framesReceived: this.received.size,
      lossPct: round(this.sentAt.size ? (1 - this.received.size / this.sentAt.size) * 100 : 0),
      fps: round(window > 0 ? (arrivals.length - 1) / window : 0),
      latencyMs: percentiles(latencies),
      jitterMs: round(jitter),
      freezes: freezes.length,
      longestFreezeMs: round(Math.max(0, ...freezes)),
      firstFrameMs: arrivals.length ? round((arrivals[0] ?? 0) - firstSent) : null,
      idrReceived: this.idr,
      keyFramesFlagged: this.flagged,
      decodableFrames: decodable.length,
      decodableFps: round(decodableWindow > 0 ? (decodable.length - 1) / decodableWindow : 0),
      // Nothing decodable = frozen for the whole call
      longestVisualFreezeMs: round(decodable.length ? Math.max(0, ...decodableGaps) : this.sendSpanMs()),
    }
  }

  private sendSpanMs(): number {
    const times = [...this.sentAt.values()]
    return times.length ? Math.max(...times) - Math.min(...times) : 0
  }

  /** Arrival times of frames a decoder would display, in send order. */
  private decodableArrivals(): number[] {
    const out: number[] = []
    let chainOk = false
    const indexes = [...this.sentAt.keys()].sort((a, b) => a - b)
    for (const index of indexes) {
      const ok = this.received.has(index) && this.intact.get(index) === true
      chainOk = this.idrIndexes.has(index) ? ok : chainOk && ok
      const at = this.received.get(index)
      if (chainOk && at !== undefined) out.push(at)
    }
    return out.sort((a, b) => a - b)
  }
}

/**
 * Detects the 1 kHz sync beeps in a received PCM stream (Goertzel on 10 ms blocks) and maps
 * each onset to the beep that was sent, by its position on the sender's capture timeline.
 */
export class AudioProbe {
  private readonly beepSentAt = new Map<number, number>()
  private readonly beepDetectedAt = new Map<number, number>()
  private readonly arrivals: number[] = []
  private window: [number, number] = [0, Number.POSITIVE_INFINITY]
  private block = new Float32Array(0)
  private blockReceivedAt = 0
  private toneRun = 0
  private quietRun = 100
  private quietBeforeRun = 0

  /** The sender captured beep `k` (k = 1, 2, …) at time `at`. */
  beepSent(k: number, at: number) {
    this.beepSentAt.set(k, at)
  }

  /** Only arrivals inside [from, to] count for gap stats (the sender streams continuously there). */
  setWindow(from: number, to: number) {
    this.window = [from, to]
  }

  /** Feed received PCM (16 kHz mono) as it arrives. */
  received(pcm: Float32Array, receivedAt = performance.now()) {
    this.arrivals.push(receivedAt)
    const merged = new Float32Array(this.block.length + pcm.length)
    merged.set(this.block)
    merged.set(pcm, this.block.length)
    const blockLen = AUDIO_RATE / 100
    let offset = 0
    for (; offset + blockLen <= merged.length; offset += blockLen) {
      // Time the block's first sample would play, if chunks play back-to-back from arrival
      const at = receivedAt - ((merged.length - offset) / AUDIO_RATE) * 1000
      this.onBlock(merged.subarray(offset, offset + blockLen), Math.max(at, this.blockReceivedAt))
    }
    this.block = merged.slice(offset)
    this.blockReceivedAt = receivedAt
  }

  private onBlock(block: Float32Array, at: number) {
    const tone = isBeep(block)
    if (tone) {
      if (this.toneRun === 0) this.quietBeforeRun = this.quietRun
      this.toneRun += 1
      // 2 consecutive tone blocks after ≥ 300 ms of no tone = one beep onset
      if (this.toneRun === 2 && this.quietBeforeRun >= 30) this.matchOnset(at - 10)
      this.quietRun = 0
    } else {
      this.toneRun = 0
      this.quietRun += 1
    }
  }

  private matchOnset(at: number) {
    // Closest sent beep that happened before this onset and is still unmatched
    let best: number | null = null
    for (const [k, sentAt] of this.beepSentAt) {
      if (this.beepDetectedAt.has(k) || sentAt > at) continue
      if (best === null || sentAt > (this.beepSentAt.get(best) ?? 0)) best = k
    }
    if (best !== null && at - (this.beepSentAt.get(best) ?? 0) < BEEP_INTERVAL_MS) {
      this.beepDetectedAt.set(best, at)
    }
  }

  private gapStats(): { gaps: number; longestGapMs: number } {
    const [from, to] = this.window
    const inWindow = this.arrivals.filter((t) => t >= from && t <= to)
    const gaps = inWindow.slice(1).map((t, i) => t - (inWindow[i] ?? t))
    const long = gaps.filter((g) => g > AUDIO_GAP_MS)
    return { gaps: long.length, longestGapMs: round(Math.max(0, ...gaps)) }
  }

  detectedAt(k: number): number | undefined {
    return this.beepDetectedAt.get(k)
  }

  sentAt(k: number): number | undefined {
    return this.beepSentAt.get(k)
  }

  report(): AudioReport {
    const latencies = [...this.beepDetectedAt].map(([k, at]) => at - (this.beepSentAt.get(k) ?? at))
    return {
      beepsSent: this.beepSentAt.size,
      beepsDetected: this.beepDetectedAt.size,
      latencyMs: percentiles(latencies),
      ...this.gapStats(),
    }
  }
}

/** Goertzel power at BEEP_HZ vs. total block energy. */
function isBeep(block: Float32Array): boolean {
  const k = (2 * Math.PI * BEEP_HZ) / AUDIO_RATE
  const coeff = 2 * Math.cos(k)
  let s1 = 0
  let s2 = 0
  let energy = 0
  for (let i = 0; i < block.length; i++) {
    const x = block[i] ?? 0
    energy += x * x
    const s = x + coeff * s1 - s2
    s2 = s1
    s1 = s
  }
  const power = s1 * s1 + s2 * s2 - coeff * s1 * s2
  const rms = Math.sqrt(energy / block.length)
  // power ≈ (N·A/2)² for a pure tone; normalise by N²·energy/N/2
  const ratio = energy > 0 ? power / ((block.length * energy) / 2) : 0
  return rms > 0.08 && ratio > 0.5
}

/** Pair beep k with video sync frame k·fps and compare the two latencies. */
export function avSync(opts: { audio: AudioProbe; video: VideoProbe; fps: number }): AvSyncReport {
  const skews: number[] = []
  for (let k = 1; k < 1000; k++) {
    const audioAt = opts.audio.detectedAt(k)
    const audioSent = opts.audio.sentAt(k)
    if (audioSent === undefined) break
    const frame = k * opts.fps
    const videoAt = opts.video.arrival(frame)
    const videoSent = opts.video.sendTime(frame)
    if (audioAt === undefined || videoAt === undefined || videoSent === undefined) continue
    skews.push(audioAt - audioSent - (videoAt - videoSent))
  }
  const p = percentiles(skews.map(Math.abs))
  const signed = percentiles(skews)
  return { skewMs: { ...p, p50Signed: signed.p50 }, pairs: skews.length }
}
