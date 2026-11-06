/** Human-readable + JSON output for call quality runs (`.cache/call-harness/reports/`). */
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { DirectionReport, ScenarioReport } from './call-scenario'
import { CACHE_DIR } from './media-fixture'

function row(name: string, dir: string, d: DirectionReport): string {
  const v = d.video
  const a = d.audio
  const cells = [
    name,
    dir,
    `${v.framesReceived}/${v.framesSent}`,
    v.fps,
    `${v.decodableFrames} (${v.decodableFps} fps)`,
    v.longestVisualFreezeMs,
    `${v.latencyMs.p50} / ${v.latencyMs.p95}`,
    v.jitterMs,
    `${v.freezes} (${v.longestFreezeMs})`,
    `${v.keyFramesFlagged}/${v.idrReceived}`,
    `${a.beepsDetected}/${a.beepsSent}`,
    `${a.latencyMs.p50} / ${a.latencyMs.p95}`,
    `${a.gaps} (${a.longestGapMs})`,
    `${d.avSync.skewMs.p50Signed}`,
  ]
  return `| ${cells.join(' | ')} |`
}

export function formatReports(reports: ScenarioReport[]): string {
  const header = [
    '| scenario | direction | frames | fps | decodable | visual freeze ms | video ms p50/p95 | jitter | freezes (max ms) | key flagged/IDR | beeps | audio ms p50/p95 | audio gaps (max ms) | A/V skew ms |',
    '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |',
  ]
  const rows = reports.flatMap((r) => [
    row(r.name, 'phone→zapo', r.phoneToZapo),
    row(r.name, 'zapo→phone', r.zapoToPhone),
  ])
  const relay = reports.map(
    (r) =>
      `- **${r.name}**: setup ${r.setupMs} ms · relay→zapo lost ${r.relay.toZapo.lost} / queue-dropped ${r.relay.toZapo.queueDropped} · relay→phone lost ${r.relay.toPhone.lost} / queue-dropped ${r.relay.toPhone.queueDropped}`,
  )
  return [...header, ...rows, '', ...relay].join('\n')
}

export async function writeReports(reports: ScenarioReport[]): Promise<string> {
  const dir = path.join(CACHE_DIR, 'reports')
  await mkdir(dir, { recursive: true })
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const file = path.join(dir, `call-quality-${stamp}`)
  await writeFile(`${file}.json`, JSON.stringify(reports, null, 2))
  await writeFile(`${file}.md`, `# Call quality — ${new Date().toISOString()}\n\n${formatReports(reports)}\n`)
  return `${file}.md`
}
