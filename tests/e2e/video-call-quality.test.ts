/**
 * Video call quality, both directions, through the real stack:
 * FakePhone ⇄ FakeFnaRelay (network model) ⇄ @zapo-js/voip ⇄ our /stream + /video WS ⇄ dashboard client.
 *
 * Needs ffmpeg (sample media). Downloads a 10 s clip once into `.cache/call-harness/`
 * (falls back to ffmpeg test signals offline). Every run writes a markdown + JSON report to
 * `.cache/call-harness/reports/`.
 *
 *   pnpm test:e2e tests/e2e/video-call-quality.test.ts
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  type CallHarness,
  runCallScenario,
  type ScenarioOptions,
  type ScenarioReport,
  startCallHarness,
} from '../call-harness/call-scenario'
import { CLEAN_NETWORK, type NetworkProfile } from '../call-harness/fake-relay'
import { ffmpegAvailable, loadMediaFixture, type MediaFixture } from '../call-harness/media-fixture'
import { formatReports, writeReports } from '../call-harness/report'

const WIFI: NetworkProfile = { latencyMs: 20, jitterMs: 5, lossRate: 0.002 }
const MOBILE_4G: NetworkProfile = { latencyMs: 60, jitterMs: 20, lossRate: 0.01, bandwidthKbps: 3000 }
const LOSSY: NetworkProfile = { latencyMs: 40, jitterMs: 10, lossRate: 0.03 }
/** Below the ~650 kbps of video + audio: models a weak uplink from the zapo host. */
const CONGESTED: NetworkProfile = { latencyMs: 30, jitterMs: 5, lossRate: 0, bandwidthKbps: 450 }

const SCENARIOS: ScenarioOptions[] = [
  { name: 'clean', toZapo: CLEAN_NETWORK, toPhone: CLEAN_NETWORK },
  { name: 'wifi', toZapo: WIFI, toPhone: WIFI },
  { name: '4g', toZapo: MOBILE_4G, toPhone: MOBILE_4G },
  { name: 'lossy-3pct', toZapo: LOSSY, toPhone: LOSSY },
  { name: 'congested-uplink', toZapo: WIFI, toPhone: CONGESTED },
]

describe('video call quality (fake phone ⇄ fake relay ⇄ voip plugin ⇄ zapo-rest WS)', () => {
  let harness: CallHarness | null = null
  let fixture: MediaFixture | null = null
  let skipReason = ''
  const reports = new Map<string, ScenarioReport>()

  beforeAll(async () => {
    if (!(await ffmpegAvailable())) {
      skipReason = 'ffmpeg not on PATH'
      return
    }
    try {
      // CALL_HARNESS_FIXTURE='{"bitrateKbps":350,"gopSeconds":1}' to compare encoder settings
      fixture = await loadMediaFixture(JSON.parse(process.env.CALL_HARNESS_FIXTURE ?? '{}'))
      harness = await startCallHarness()
    } catch (err) {
      skipReason = `call harness unavailable: ${err instanceof Error ? err.message : String(err)}`
    }
  }, 120_000)

  afterAll(async () => {
    await harness?.stop()
    if (!reports.size) return
    const ordered = SCENARIOS.map((s) => reports.get(s.name)).filter((r): r is ScenarioReport => Boolean(r))
    const file = await writeReports(ordered)
    console.info(`\n${formatReports(ordered)}\n\nreport: ${file}`)
  })

  async function run(name: string): Promise<ScenarioReport> {
    const scenario = SCENARIOS.find((s) => s.name === name)
    if (!harness || !fixture || !scenario) throw new Error(skipReason)
    const report = await runCallScenario(harness, fixture, scenario)
    reports.set(name, report)
    return report
  }

  it('clean network: full frame rate, low latency, lip-sync both ways', async (ctx) => {
    ctx.skip(!harness, skipReason)
    const r = await run('clean')
    expect(r.phoneToZapo.video.lossPct).toBe(0)
    // voip 1.4 holds our first frames until the phone's first <mute_v2> (+150 ms), then opens
    // the stream on the next key frame: up to one 1 s GOP of startup frames never leave.
    expect(r.zapoToPhone.video.lossPct).toBeLessThanOrEqual(12)
    for (const dir of [r.phoneToZapo, r.zapoToPhone]) {
      expect(dir.video.fps).toBeGreaterThanOrEqual(14)
      expect(dir.video.latencyMs.p95).toBeLessThan(50)
      expect(dir.video.freezes).toBe(0)
      // Every frame that left decodes: nothing broken past the startup hold
      expect(dir.video.decodableFrames).toBe(dir.video.framesReceived)
      expect(dir.audio.beepsDetected).toBeGreaterThanOrEqual(dir.audio.beepsSent - 1)
      expect(dir.audio.latencyMs.p95).toBeLessThan(200)
      expect(dir.audio.gaps).toBe(0)
      expect(Math.abs(dir.avSync.skewMs.p50Signed)).toBeLessThan(150)
    }
  }, 60_000)

  it('phone key frames reach the dashboard flagged as key', async (ctx) => {
    ctx.skip(!harness, skipReason)
    const r = reports.get('clean') ?? (await run('clean'))
    const v = r.phoneToZapo.video
    expect(v.idrReceived).toBeGreaterThan(0)
    // voip-media 0.3 flags WhatsApp-packed SPS+PPS+IDR as key; before, the browser decoder never started
    expect(v.keyFramesFlagged).toBe(v.idrReceived)
  }, 60_000)

  /**
   * Floors for the direction we control (dashboard encoder → phone), ~30% under what the
   * harness measured with 350 kbps / 1 s GOP. 600 kbps / 2 s GOP fails all of them.
   */
  const ZAPO_UPLINK_FLOORS: Record<string, { decodableFps: number; visualFreezeMs: number; latencyP95Ms: number }> = {
    wifi: { decodableFps: 10, visualFreezeMs: 1500, latencyP95Ms: 100 },
    '4g': { decodableFps: 6, visualFreezeMs: 2500, latencyP95Ms: 250 },
    'lossy-3pct': { decodableFps: 2, visualFreezeMs: 3000, latencyP95Ms: 150 },
    'congested-uplink': { decodableFps: 10, visualFreezeMs: 1500, latencyP95Ms: 500 },
  }

  for (const [name, floor] of Object.entries(ZAPO_UPLINK_FLOORS)) {
    it(`${name}: dashboard video stays watchable on the phone; both directions keep flowing`, async (ctx) => {
      ctx.skip(!harness, skipReason)
      const r = await run(name)
      for (const dir of [r.phoneToZapo, r.zapoToPhone]) {
        expect(dir.video.framesReceived).toBeGreaterThan(0)
        expect(dir.audio.beepsDetected).toBeGreaterThan(0)
      }
      const up = r.zapoToPhone.video
      expect(up.decodableFps).toBeGreaterThanOrEqual(floor.decodableFps)
      expect(up.longestVisualFreezeMs).toBeLessThanOrEqual(floor.visualFreezeMs)
      expect(up.latencyMs.p95).toBeLessThanOrEqual(floor.latencyP95Ms)
    }, 60_000)
  }
})
