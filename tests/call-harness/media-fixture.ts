/**
 * Real sample media for call tests: downloads a short clip once (cached under `.cache/`),
 * transcodes it with ffmpeg into what a phone camera/mic would produce (H.264 Constrained
 * Baseline Annex-B access units + 16 kHz mono PCM) and adds measurement markers:
 *
 * - every access unit gets an SEI (user_data_unregistered) carrying stream id + frame index,
 *   so the receiver can match frames 1:1 without decoding pixels;
 * - the audio gets a 1 kHz beep every second, aligned with a "sync" video frame, so the
 *   receiver can measure audio latency and A/V skew from the same timeline.
 */
import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { promisify } from 'node:util'

const run = promisify(execFile)

export const CACHE_DIR = path.resolve(import.meta.dirname, '../../.cache/call-harness')
export const AUDIO_RATE = 16_000
export const BEEP_INTERVAL_MS = 1000
export const BEEP_MS = 80
export const BEEP_HZ = 1000

/** Clips with audio first; the silent one still gives real video. */
const SAMPLE_SOURCES = [
  { name: 'samplelib-10s.mp4', url: 'https://download.samplelib.com/mp4/sample-10s.mp4' },
  {
    name: 'bbb-360-10s.mp4',
    url: 'https://test-videos.co.uk/vids/bigbuckbunny/mp4/h264/360/Big_Buck_Bunny_360_10s_1MB.mp4',
  },
]

export type MediaFixture = {
  source: string
  fps: number
  width: number
  height: number
  /** Annex-B access units (AUD stripped), one per frame. */
  accessUnits: Uint8Array[]
  /** 16 kHz mono PCM, same duration as the video, with sync beeps mixed in. */
  pcm: Float32Array
  durationMs: number
}

export type FixtureOptions = {
  fps?: number
  width?: number
  height?: number
  bitrateKbps?: number
  seconds?: number
  /** IDR interval (the dashboard encoder's KEY_FRAME_INTERVAL). */
  gopSeconds?: number
}

async function hasFfmpeg(): Promise<boolean> {
  try {
    await run('ffmpeg', ['-hide_banner', '-version'])
    return true
  } catch {
    return false
  }
}

export async function ffmpegAvailable(): Promise<boolean> {
  return hasFfmpeg()
}

async function downloadSample(): Promise<string | null> {
  await mkdir(CACHE_DIR, { recursive: true })
  for (const source of SAMPLE_SOURCES) {
    const file = path.join(CACHE_DIR, source.name)
    if (existsSync(file)) return file
    try {
      const res = await fetch(source.url, { signal: AbortSignal.timeout(30_000) })
      if (!res.ok) continue
      await writeFile(`${file}.part`, new Uint8Array(await res.arrayBuffer()))
      await rename(`${file}.part`, file)
      return file
    } catch {
      // offline / blocked — try the next source, then fall back to synthetic media
    }
  }
  return null
}

async function hasAudioStream(file: string): Promise<boolean> {
  const { stdout } = await run('ffprobe', [
    '-v',
    'error',
    '-select_streams',
    'a',
    '-show_entries',
    'stream=index',
    '-of',
    'csv=p=0',
    file,
  ])
  return stdout.trim().length > 0
}

/** Loads (or builds + caches) the fixture. Throws when ffmpeg is missing. */
export async function loadMediaFixture(opts: FixtureOptions = {}): Promise<MediaFixture> {
  // Defaults mirror the dashboard encoder (dashboard/src/voip/call-video.ts)
  const { fps = 15, width = 480, height = 360, bitrateKbps = 350, seconds = 10, gopSeconds = 1 } = opts
  if (!(await hasFfmpeg())) throw new Error('ffmpeg not found on PATH')
  const source = await downloadSample()
  const key = `${path.basename(source ?? 'synthetic')}-${width}x${height}@${fps}-${bitrateKbps}k-g${gopSeconds}-${seconds}s`
  const h264File = path.join(CACHE_DIR, `${key}.h264`)
  const pcmFile = path.join(CACHE_DIR, `${key}.f32`)

  if (!existsSync(h264File) || !existsSync(pcmFile)) {
    await mkdir(CACHE_DIR, { recursive: true })
    await encodeVideo({ source, out: h264File, fps, width, height, bitrateKbps, seconds, gopSeconds })
    await encodeAudio({ source, out: pcmFile, seconds })
  }

  const accessUnits = splitAccessUnits(new Uint8Array(await readFile(h264File)))
  const raw = await readFile(pcmFile)
  const pcm = new Float32Array(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength))
  const durationMs = (accessUnits.length * 1000) / fps
  return {
    source: `${source ? path.basename(source) : 'synthetic (ffmpeg testsrc2)'} ${width}x${height}@${fps} ${bitrateKbps}k gop ${gopSeconds}s`,
    fps,
    width,
    height,
    accessUnits,
    pcm: mixSyncBeeps(fitLength(pcm, Math.round((durationMs / 1000) * AUDIO_RATE))),
    durationMs,
  }
}

async function encodeVideo(o: {
  source: string | null
  out: string
  fps: number
  width: number
  height: number
  bitrateKbps: number
  seconds: number
  gopSeconds: number
}) {
  const gop = String(Math.max(1, Math.round(o.fps * o.gopSeconds)))
  const input = o.source
    ? ['-i', o.source]
    : ['-f', 'lavfi', '-i', `testsrc2=size=${o.width}x${o.height}:rate=${o.fps}`]
  await run('ffmpeg', [
    '-hide_banner',
    '-loglevel',
    'error',
    '-y',
    ...input,
    '-t',
    String(o.seconds),
    '-an',
    '-vf',
    `scale=${o.width}:${o.height},fps=${o.fps}`,
    // What a phone uplink looks like: CBP, fixed GOP, no scene-cut IDRs, headers on every IDR
    '-c:v',
    'libx264',
    '-profile:v',
    'baseline',
    '-level',
    '3.1',
    '-preset',
    'veryfast',
    '-tune',
    'zerolatency',
    '-b:v',
    `${o.bitrateKbps}k`,
    '-maxrate',
    `${o.bitrateKbps}k`,
    '-bufsize',
    `${o.bitrateKbps}k`,
    '-g',
    gop,
    '-keyint_min',
    gop,
    '-sc_threshold',
    '0',
    '-x264-params',
    'aud=1:repeat-headers=1',
    '-bsf:v',
    'h264_mp4toannexb',
    '-f',
    'h264',
    o.out,
  ])
}

async function encodeAudio(o: { source: string | null; out: string; seconds: number }) {
  const useSource = o.source && (await hasAudioStream(o.source))
  const input = useSource
    ? ['-i', o.source as string]
    : ['-f', 'lavfi', '-i', 'anoisesrc=color=pink:amplitude=0.25:sample_rate=16000']
  await run('ffmpeg', [
    '-hide_banner',
    '-loglevel',
    'error',
    '-y',
    ...input,
    '-t',
    String(o.seconds),
    '-vn',
    '-ac',
    '1',
    '-ar',
    String(AUDIO_RATE),
    '-f',
    'f32le',
    o.out,
  ])
}

function fitLength(pcm: Float32Array, samples: number): Float32Array {
  const out = new Float32Array(samples)
  out.set(pcm.subarray(0, samples))
  return out
}

/** Program audio at -14 dB plus full-scale-ish 1 kHz beeps on every BEEP_INTERVAL_MS boundary (from 1 s). */
export function mixSyncBeeps(pcm: Float32Array): Float32Array {
  const out = new Float32Array(pcm.length)
  for (let i = 0; i < pcm.length; i++) out[i] = (pcm[i] ?? 0) * 0.2
  const beepSamples = Math.round((BEEP_MS / 1000) * AUDIO_RATE)
  const every = Math.round((BEEP_INTERVAL_MS / 1000) * AUDIO_RATE)
  for (let start = every; start + beepSamples < out.length; start += every) {
    for (let i = 0; i < beepSamples; i++) {
      out[start + i] = 0.7 * Math.sin((2 * Math.PI * BEEP_HZ * i) / AUDIO_RATE)
    }
  }
  return out
}

/** Split an Annex-B elementary stream on access-unit delimiters (NAL 9), dropping the AUDs. */
export function splitAccessUnits(stream: Uint8Array): Uint8Array[] {
  const nals = splitNals(stream)
  const units: Uint8Array[][] = []
  for (const nal of nals) {
    if (((nal[0] ?? 0) & 0x1f) === 9 || units.length === 0) units.push([])
    if (((nal[0] ?? 0) & 0x1f) !== 9) units[units.length - 1]?.push(nal)
  }
  return units.filter((u) => u.length > 0).map(joinAnnexB)
}

export function splitNals(stream: Uint8Array): Uint8Array[] {
  const starts: { at: number; len: number }[] = []
  for (let i = 0; i + 2 < stream.length; i++) {
    if (stream[i] === 0 && stream[i + 1] === 0 && stream[i + 2] === 1) {
      const four = i > 0 && stream[i - 1] === 0
      starts.push({ at: four ? i - 1 : i, len: four ? 4 : 3 })
      i += 2
    }
  }
  return starts.map((s, idx) => {
    const end = starts[idx + 1]?.at ?? stream.length
    return stream.subarray(s.at + s.len, end)
  })
}

function joinAnnexB(nals: Uint8Array[]): Uint8Array {
  const size = nals.reduce((n, nal) => n + 4 + nal.length, 0)
  const out = new Uint8Array(size)
  let off = 0
  for (const nal of nals) {
    out.set([0, 0, 0, 1], off)
    out.set(nal, off + 4)
    off += 4 + nal.length
  }
  return out
}

// ---- per-frame markers (SEI user_data_unregistered) ----

/** 16-byte UUID with no 0x00 bytes → no emulation-prevention needed inside the SEI. */
const MARKER_UUID = Uint8Array.from([
  0x7a, 0x61, 0x70, 0x6f, 0x2d, 0x63, 0x61, 0x6c, 0x6c, 0x2d, 0x68, 0x61, 0x72, 0x6e, 0x65, 0x73,
])

export type FrameMarker = { stream: string; index: number }

/** Prepend an SEI NAL tagging this access unit (ASCII payload, so never contains 0x00). */
export function tagAccessUnit(au: Uint8Array, marker: FrameMarker): Uint8Array {
  const text = new TextEncoder().encode(`${marker.stream}:${String(marker.index).padStart(8, '0')}`)
  const payloadSize = MARKER_UUID.length + text.length
  const sei = new Uint8Array(4 + 1 + 2 + payloadSize + 1)
  sei.set([0, 0, 0, 1, 0x06, 0x05, payloadSize], 0)
  sei.set(MARKER_UUID, 7)
  sei.set(text, 7 + MARKER_UUID.length)
  sei[sei.length - 1] = 0x80 // rbsp trailing bits
  const out = new Uint8Array(sei.length + au.length)
  out.set(sei)
  out.set(au, sei.length)
  return out
}

export function readMarker(au: Uint8Array): FrameMarker | null {
  for (const nal of splitNals(au)) {
    if (((nal[0] ?? 0) & 0x1f) !== 6 || nal[1] !== 0x05) continue
    const size = nal[2] ?? 0
    const body = nal.subarray(3, 3 + size)
    if (body.length !== size || !MARKER_UUID.every((b, i) => body[i] === b)) continue
    const [stream, index] = new TextDecoder().decode(body.subarray(MARKER_UUID.length)).split(':')
    if (stream && index) return { stream, index: Number(index) }
  }
  return null
}

export function isIdrAccessUnit(au: Uint8Array): boolean {
  return splitNals(au).some((nal) => ((nal[0] ?? 0) & 0x1f) === 5)
}
