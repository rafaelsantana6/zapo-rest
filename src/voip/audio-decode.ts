import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { badRequest } from '~/lib/errors'
import { getLogger } from '~/lib/logger'
import { assertPublicUrl } from '~/lib/ssrf-guard'

const log = getLogger({ component: 'audio-decode' })

export const TARGET_SAMPLE_RATE = 16_000
const TARGET_CHANNELS = 1

/** Hard cap for a blast audio download (bytes). ~3 min of 16 kHz mono 16-bit WAV. */
export const MAX_BLAST_AUDIO_BYTES = 20 * 1024 * 1024
/** Abort a URL download that stalls past this window. */
export const BLAST_DOWNLOAD_TIMEOUT_MS = 30_000

function floatToInt16(s: number): number {
  const x = Math.max(-1, Math.min(1, s))
  return Math.max(-32768, Math.min(32767, Math.round(x * 32767)))
}

function int16ToFloat(s: number): number {
  return Math.max(-1, Math.min(1, s / 32768))
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t
}

function resampleToMono(samples: Float32Array, inputChannels: number, inputSampleRate: number): Float32Array {
  if (inputSampleRate === TARGET_SAMPLE_RATE && inputChannels === TARGET_CHANNELS) {
    return samples
  }

  const inputLength = Math.floor(samples.length / inputChannels)
  const ratio = inputSampleRate / TARGET_SAMPLE_RATE
  const outputLength = Math.ceil(inputLength / ratio)
  const out = new Float32Array(outputLength)

  for (let i = 0; i < outputLength; i++) {
    const srcIndex = i * ratio
    const srcFloor = Math.floor(srcIndex)
    const srcFrac = srcIndex - srcFloor

    if (inputChannels === 1) {
      const a = samples[srcFloor] ?? 0
      const b = samples[srcFloor + 1] ?? a
      out[i] = lerp(a, b, srcFrac)
    } else {
      const idx0 = srcFloor * inputChannels
      const a0 = samples[idx0] ?? 0
      const a1 = samples[idx0 + 1] ?? 0
      const b0 = samples[idx0 + inputChannels] ?? a0
      const b1 = samples[idx0 + inputChannels + 1] ?? a1
      const left = lerp(a0, b0, srcFrac)
      const right = lerp(a1, b1, srcFrac)
      out[i] = (left + right) / 2
    }
  }

  return out
}

export function decodeWavPcm(buffer: Buffer): Float32Array {
  if (buffer.length < 44) throw new Error('WAV file too small (min 44 bytes)')
  if (buffer.toString('ascii', 0, 4) !== 'RIFF') throw new Error('not a RIFF file')
  if (buffer.toString('ascii', 8, 12) !== 'WAVE') throw new Error('not a WAVE file')

  let fmtOffset = 12
  let dataOffset = -1
  let dataSize = 0
  let audioFormat = 1
  let channels = 1
  let sampleRate = 16000
  let bitsPerSample = 16

  while (fmtOffset + 8 <= buffer.length) {
    const chunkId = buffer.toString('ascii', fmtOffset, fmtOffset + 4)
    const chunkSize = buffer.readUInt32LE(fmtOffset + 4)
    if (chunkId === 'fmt ') {
      audioFormat = buffer.readUInt16LE(fmtOffset + 8)
      channels = buffer.readUInt16LE(fmtOffset + 10)
      sampleRate = buffer.readUInt32LE(fmtOffset + 12)
      bitsPerSample = buffer.readUInt16LE(fmtOffset + 22)
    } else if (chunkId === 'data') {
      dataOffset = fmtOffset + 8
      dataSize = chunkSize
      break
    }
    fmtOffset += 8 + chunkSize
  }

  if (dataOffset < 0) throw new Error('no data chunk found in WAV')

  const bytesPerSample = Math.ceil(bitsPerSample / 8)
  const totalFrames = Math.floor(dataSize / (channels * bytesPerSample))

  if (audioFormat === 3 && bitsPerSample === 32) {
    const out = new Float32Array(totalFrames * channels)
    for (let i = 0; i < totalFrames * channels; i++) {
      out[i] = buffer.readFloatLE(dataOffset + i * 4)
    }
    return resampleToMono(out, channels, sampleRate)
  }

  if (audioFormat !== 1) throw new Error(`unsupported WAV format: ${audioFormat} (only PCM=1 and float=3)`)

  const raw = new Float32Array(totalFrames * channels)
  for (let i = 0; i < totalFrames * channels; i++) {
    const byteOff = dataOffset + i * bytesPerSample
    if (bitsPerSample === 8) {
      raw[i] = (buffer.readUInt8(byteOff) - 128) / 128
    } else if (bitsPerSample === 16) {
      raw[i] = int16ToFloat(buffer.readInt16LE(byteOff))
    } else if (bitsPerSample === 24) {
      const lo = buffer.readUInt16LE(byteOff)
      const hi = buffer.readInt8(byteOff + 2)
      const v = lo | (hi << 16)
      raw[i] = v / 8388608
    } else if (bitsPerSample === 32) {
      raw[i] = buffer.readInt32LE(byteOff) / 2147483648
    } else {
      throw new Error(`unsupported bits per sample: ${bitsPerSample}`)
    }
  }
  return resampleToMono(raw, channels, sampleRate)
}

export function encodeResponseWav(samples: Float32Array, sampleRate: number): Buffer {
  const int16 = new Int16Array(samples.length)
  for (let i = 0; i < samples.length; i++) {
    int16[i] = floatToInt16(samples[i] ?? 0)
  }
  const dataBytes = int16.byteLength
  const buf = Buffer.alloc(44 + dataBytes)
  buf.write('RIFF', 0)
  buf.writeUInt32LE(36 + dataBytes, 4)
  buf.write('WAVE', 8)
  buf.write('fmt ', 12)
  buf.writeUInt32LE(16, 16)
  buf.writeUInt16LE(1, 20)
  buf.writeUInt16LE(1, 22)
  buf.writeUInt32LE(sampleRate, 24)
  buf.writeUInt32LE(sampleRate * 2, 28)
  buf.writeUInt16LE(2, 32)
  buf.writeUInt16LE(16, 34)
  buf.write('data', 36)
  buf.writeUInt32LE(dataBytes, 40)
  Buffer.from(int16.buffer, int16.byteOffset, int16.byteLength).copy(buf, 44)
  return buf
}

export async function removeTempDir(path: string): Promise<void> {
  await rm(path, { recursive: true, force: true }).catch(() => {})
}

/**
 * Download a user-supplied audio URL with SSRF vetting, no redirects, timeout, and size cap.
 * Decodes WAV → 16 kHz mono Float32 PCM.
 */
export async function downloadAndDecode(audioUrl: string): Promise<{ pcm: Float32Array; tempDir: string }> {
  await assertPublicUrl(audioUrl)

  const tempDir = await mkdtemp(join(tmpdir(), 'zapo-blast-'))
  const dest = join(tempDir, 'input-audio')
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), BLAST_DOWNLOAD_TIMEOUT_MS)

  try {
    const res = await fetch(audioUrl, { redirect: 'error', signal: controller.signal })
    if (!res.ok) throw badRequest(`download failed: ${res.status} ${res.statusText}`)

    const declared = res.headers.get('content-length')
    if (declared != null) {
      const n = Number(declared)
      if (Number.isFinite(n) && n > MAX_BLAST_AUDIO_BYTES) {
        throw badRequest(`audioUrl exceeds max size (${MAX_BLAST_AUDIO_BYTES} bytes)`)
      }
    }

    const buf = Buffer.from(await res.arrayBuffer())
    if (buf.length > MAX_BLAST_AUDIO_BYTES) {
      throw badRequest(`audioUrl exceeds max size (${MAX_BLAST_AUDIO_BYTES} bytes)`)
    }

    await writeFile(dest, buf)
    log.debug({ audioUrl, bytes: buf.length }, 'audio downloaded')

    const pcm = decodeWavPcm(buf)
    log.debug(
      { samples: pcm.length, durationMs: Math.round((pcm.length / TARGET_SAMPLE_RATE) * 1000) },
      'audio decoded',
    )
    return { pcm, tempDir }
  } catch (err) {
    await removeTempDir(tempDir)
    if (err instanceof Error && err.name === 'AbortError') {
      throw badRequest(`audioUrl download timed out after ${BLAST_DOWNLOAD_TIMEOUT_MS}ms`)
    }
    throw err
  } finally {
    clearTimeout(timeout)
  }
}
