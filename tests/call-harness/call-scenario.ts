/**
 * One realistic video call, both directions at real-time pace:
 *
 *   phone (FakePhone) ──UDP──▶ FakeFnaRelay ──UDP──▶ voip plugin ──▶ /stream + /video WS ──▶ dashboard (Node)
 *   phone ◀────────────────────────────────────────────── the same path, reversed ◀─────── dashboard
 *
 * Returns per-direction video / audio / A-V sync reports plus relay stats.
 */
import { FakeFnaRelay, type NetworkProfile, type RelayDirectionStats } from './fake-relay'
import { FakePhone } from './fake-phone'
import { type PairedZapoClient, startPairedZapoClient } from './fake-wa'
import {
  AUDIO_RATE,
  BEEP_INTERVAL_MS,
  isIdrAccessUnit,
  type MediaFixture,
  readMarker,
  tagAccessUnit,
} from './media-fixture'
import { type AudioReport, AudioProbe, type AvSyncReport, avSync, type VideoReport, VideoProbe } from './metrics'
import { acceptViaRest, DashboardClient, HARNESS_INSTANCE_KEY, startZapoApi, type ZapoApi } from './zapo-api'

/** MLow frame on the phone; ~85 ms ScriptProcessor chunk (4096 @ 48 kHz) on the dashboard. */
const PHONE_AUDIO_CHUNK = 960
const DASHBOARD_AUDIO_CHUNK = 1365
const DRAIN_MS = 1500

export type DirectionReport = { video: VideoReport; audio: AudioReport; avSync: AvSyncReport }

export type ScenarioReport = {
  name: string
  network: { toZapo: NetworkProfile; toPhone: NetworkProfile }
  fixture: string
  durationMs: number
  /** Offer pushed → plugin reports `active`. */
  setupMs: number
  phoneToZapo: DirectionReport
  zapoToPhone: DirectionReport
  relay: Record<'toZapo' | 'toPhone', RelayDirectionStats>
  audioBackpressureEvents: number
}

export type ScenarioOptions = {
  name: string
  toZapo: NetworkProfile
  toPhone: NetworkProfile
  durationMs?: number
}

export type CallHarness = {
  zapo: PairedZapoClient
  api: ZapoApi
  relay: FakeFnaRelay
  stop: () => Promise<void>
}

export async function startCallHarness(): Promise<CallHarness> {
  const zapo = await startPairedZapoClient()
  const api = await startZapoApi(zapo.client)
  const relay = await FakeFnaRelay.start({ seed: 42 })
  return {
    zapo,
    api,
    relay,
    stop: async () => {
      await api.app.close()
      await relay.stop()
      await zapo.stop()
    },
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, Math.max(0, ms)))

async function waitFor(check: () => boolean, timeoutMs: number, what: string) {
  const deadline = performance.now() + timeoutMs
  while (!check()) {
    if (performance.now() > deadline) throw new Error(`timed out waiting for ${what}`)
    await sleep(20)
  }
}

/** Calls `tick(i)` at `start + i·intervalMs` for `count` ticks, correcting timer drift. */
async function pace(start: number, intervalMs: number, count: number, tick: (i: number) => void) {
  for (let i = 0; i < count; i++) {
    await sleep(start + i * intervalMs - performance.now())
    tick(i)
  }
}

type DirectionProbes = { video: VideoProbe; audio: AudioProbe }

function probes(fps: number): DirectionProbes {
  return { video: new VideoProbe(fps), audio: new AudioProbe() }
}

function directionReport(p: DirectionProbes, fps: number): DirectionReport {
  return { video: p.video.report(), audio: p.audio.report(), avSync: avSync({ audio: p.audio, video: p.video, fps }) }
}

export async function runCallScenario(
  harness: CallHarness,
  fixture: MediaFixture,
  opts: ScenarioOptions,
): Promise<ScenarioReport> {
  const { zapo, api, relay } = harness
  const durationMs = opts.durationMs ?? fixture.durationMs
  relay.setProfile('toZapo', opts.toZapo)
  relay.setProfile('toPhone', opts.toPhone)
  const before = relay.stats()

  const phone = new FakePhone({
    server: zapo.server,
    pipeline: zapo.pipeline,
    relay,
    zapoDeviceJid: zapo.selfDeviceJid,
  })
  const ringAt = performance.now()
  const callId = await phone.ring({ video: true })
  await waitFor(() => Boolean(zapo.client.voip.getCall(callId)?.canAccept), 5_000, 'incoming call')
  await acceptViaRest(api, callId)
  await waitFor(() => Boolean(zapo.client.voip.getCall(callId)?.isActive), 10_000, 'call active')
  await phone.announceMicState()
  const setupMs = performance.now() - ringAt
  const dashboard = await DashboardClient.open(api, callId)

  const toZapo = probes(fixture.fps)
  const toPhone = probes(fixture.fps)
  dashboard.onVideo((f) => {
    const marker = readMarker(f.data)
    if (marker?.stream !== 'P') return
    toZapo.video.delivered(marker.index, {
      at: f.receivedAt,
      isIdr: isIdrAccessUnit(f.data),
      flaggedKey: f.keyFrame,
      intact: f.data.length === expectedLength(fixture, 'P', marker.index),
    })
  })
  dashboard.onAudio((pcm, at) => toZapo.audio.received(pcm, at))
  const debugAudio: { dir: string; at: number; pcm: Float32Array }[] = []
  if (process.env.CALL_HARNESS_DUMP) {
    dashboard.onAudio((pcm, at) => debugAudio.push({ dir: 'toZapo', at, pcm }))
    phone.onAudio((c) => debugAudio.push({ dir: 'toPhone', at: c.receivedAt, pcm: c.pcm }))
  }
  phone.onVideo((f) => {
    const marker = readMarker(f.data)
    if (marker?.stream !== 'Z') return
    toPhone.video.delivered(marker.index, {
      at: f.receivedAt,
      isIdr: isIdrAccessUnit(f.data),
      flaggedKey: f.keyFrame,
      intact: f.data.length === expectedLength(fixture, 'Z', marker.index),
    })
  })
  phone.onAudio((c) => toPhone.audio.received(c.pcm, c.receivedAt))

  const start = performance.now() + 100
  registerBeeps(fixture, durationMs, start, [toZapo.audio, toPhone.audio])
  // First audio lands ~1 chunk after start; stop judging continuity when senders stop
  for (const probe of [toZapo.audio, toPhone.audio]) probe.setWindow(start + 500, start + durationMs)
  await Promise.all([
    streamVideo(fixture, durationMs, start, 'P', toZapo.video, (au, tsUs) => phone.sendVideo(au, tsUs)),
    streamVideo(fixture, durationMs, start, 'Z', toPhone.video, (au, tsUs, key) => dashboard.sendVideo(au, tsUs, key)),
    streamAudio(fixture, durationMs, start, PHONE_AUDIO_CHUNK, (pcm) => phone.sendAudio(pcm)),
    streamAudio(fixture, durationMs, start, DASHBOARD_AUDIO_CHUNK, (pcm) => dashboard.sendPcm(pcm)),
  ])
  await sleep(DRAIN_MS)

  if (process.env.CALL_HARNESS_DUMP) {
    const { writeFileSync } = await import('node:fs')
    for (const dir of ['toZapo', 'toPhone']) {
      const parts = debugAudio.filter((d) => d.dir === dir)
      const total = parts.reduce((n, d) => n + d.pcm.length, 0)
      const all = new Float32Array(total)
      let o = 0
      for (const d of parts) {
        all.set(d.pcm, o)
        o += d.pcm.length
      }
      writeFileSync(`${process.env.CALL_HARNESS_DUMP}/${dir}.f32`, Buffer.from(all.buffer))
      writeFileSync(
        `${process.env.CALL_HARNESS_DUMP}/${dir}.json`,
        JSON.stringify({ start, chunks: parts.map((d) => [d.at, d.pcm.length]) }),
      )
    }
  }
  const after = relay.stats()
  await fetch(`${api.baseUrl}/v1/calls/${callId}/end`, {
    method: 'POST',
    headers: { 'x-api-key': HARNESS_INSTANCE_KEY, 'content-type': 'application/json' },
    body: '{}',
  }).catch(() => undefined)
  dashboard.close()
  await phone.hangUp()

  return {
    name: opts.name,
    network: { toZapo: opts.toZapo, toPhone: opts.toPhone },
    fixture: fixture.source,
    durationMs,
    setupMs: Math.round(setupMs),
    phoneToZapo: directionReport(toZapo, fixture.fps),
    zapoToPhone: directionReport(toPhone, fixture.fps),
    relay: { toZapo: diff(after.toZapo, before.toZapo), toPhone: diff(after.toPhone, before.toPhone) },
    audioBackpressureEvents: dashboard.backpressure.filter((b) => b.pause).length,
  }
}

/** Byte length the receiver must see for frame `index` (tagged AU; depacketizers re-add 4-byte start codes). */
function expectedLength(fixture: MediaFixture, stream: string, index: number): number {
  const au = fixture.accessUnits[index % fixture.accessUnits.length] as Uint8Array
  return tagAccessUnit(au, { stream, index }).length
}

function diff(a: RelayDirectionStats, b: RelayDirectionStats): RelayDirectionStats {
  return {
    forwarded: a.forwarded - b.forwarded,
    lost: a.lost - b.lost,
    queueDropped: a.queueDropped - b.queueDropped,
    bytes: a.bytes - b.bytes,
  }
}

async function streamVideo(
  fixture: MediaFixture,
  durationMs: number,
  start: number,
  stream: string,
  probe: VideoProbe,
  send: (au: Uint8Array, timestampUs: number, keyFrame: boolean) => void,
) {
  const frameMs = 1000 / fixture.fps
  const count = Math.floor(durationMs / frameMs)
  await pace(start, frameMs, count, (i) => {
    const au = fixture.accessUnits[i % fixture.accessUnits.length] as Uint8Array
    probe.sent(i, { isIdr: isIdrAccessUnit(au) })
    send(tagAccessUnit(au, { stream, index: i }), Math.round(i * frameMs * 1000), isIdrAccessUnit(au))
  })
}

/** Chunk j carries samples captured during [j, j+1)·chunk — sent right after capture, like a mic. */
async function streamAudio(
  fixture: MediaFixture,
  durationMs: number,
  start: number,
  chunk: number,
  send: (pcm: Float32Array) => void,
) {
  const chunkMs = (chunk / AUDIO_RATE) * 1000
  const count = Math.floor(durationMs / chunkMs)
  const src = fixture.pcm
  await pace(start + chunkMs, chunkMs, count, (j) => {
    const pcm = new Float32Array(chunk)
    for (let i = 0; i < chunk; i++) pcm[i] = src[(j * chunk + i) % src.length] ?? 0
    send(pcm)
  })
}

/** Beep k sits at sample k·interval of the (looped) fixture, i.e. capture time start + k·interval. */
function registerBeeps(fixture: MediaFixture, durationMs: number, start: number, targets: AudioProbe[]) {
  const every = (BEEP_INTERVAL_MS / 1000) * AUDIO_RATE
  for (let k = 1; k * BEEP_INTERVAL_MS < durationMs - 200; k++) {
    // The fixture has no beep on its own loop boundary (sample 0)
    if ((k * every) % fixture.pcm.length === 0) continue
    for (const probe of targets) probe.beepSent(k, start + k * BEEP_INTERVAL_MS)
  }
}
