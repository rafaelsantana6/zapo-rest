import type { InstanceManager } from '~/instances/manager'
import { asVoipClient } from '~/instances/wa-client'
import { getLogger } from '~/lib/logger'
import { resolveRecipientJid } from '~/lib/phone-resolve'
import type { MediaStorage } from '~/media/storage'
import type { CacheClient } from '~/redis/client'
import type { CallStore } from '~/store/calls'
import {
  decodeLocalWav,
  downloadAndDecode,
  encodeResponseWav,
  removeTempDir,
  TARGET_SAMPLE_RATE,
} from '~/voip/audio-decode'
import { transcribeAudio } from '~/voip/audio-transcribe'
import { isAnsweredCallState } from '~/voip/recording-manager'

export type AudioBlastSttOpts = {
  enabled: boolean
  apiUrl: string
  apiKey: string
  model?: string
  temperature?: number
  language?: string
}

export type AudioBlastRequest = {
  manager: InstanceManager
  instanceName: string
  to: string
  /** Remote WAV URL (SSRF-guarded). Mutually exclusive with `audioPath`. */
  audioUrl?: string
  /** Local WAV path (multipart / base64 temp). Mutually exclusive with `audioUrl`. */
  audioPath?: string
  responseTimeoutMs: number
  callTimeoutMs: number
  recordResponse: boolean
  /** Cap captured inbound PCM duration (seconds). Defaults to CALL_RECORDING_MAX_SECONDS. */
  maxCaptureSeconds?: number
  mediaStorage?: MediaStorage
  cache?: CacheClient
  calls?: CallStore
  stt?: AudioBlastSttOpts
}

export type AudioBlastResult = {
  callId: string
  peerJid: string
  audioPlayed: boolean
  recordingUrl: string | null
  responseDurationMs: number
  totalDurationMs: number
  transcription: string | null
  error?: string
}

type VoipClient = ReturnType<typeof asVoipClient>
type ClientEmitter = {
  on: (e: string, fn: (...args: unknown[]) => void) => void
  off: (e: string, fn: (...args: unknown[]) => void) => void
}

async function sleep(ms: number): Promise<void> {
  await new Promise((r) => setTimeout(r, ms))
}

function asEmitter(client: VoipClient): ClientEmitter {
  return client as unknown as ClientEmitter
}

async function waitForCallAnswered(
  client: VoipClient,
  callId: string,
  timeoutMs: number,
  signal: AbortSignal,
): Promise<boolean> {
  const log = getLogger({ component: 'blast-wait-answer', callId })
  const deadline = Date.now() + timeoutMs

  const pending = client.voip.getCall(callId)
  if (pending && isAnsweredCallState((pending as { stateData?: { state?: string } }).stateData?.state)) {
    return true
  }

  type CallInfo = { callId?: string; stateData?: { state?: string }; isEnded?: boolean }

  return new Promise((resolve) => {
    const emitter = asEmitter(client)
    let resolved = false

    const onState = (c: CallInfo) => {
      if ((c.callId ?? '').toLowerCase() !== callId.toLowerCase()) return
      if (c.isEnded) {
        log.warn({ state: c.stateData?.state }, 'call ended before answer')
        done(false)
        return
      }
      if (isAnsweredCallState(c.stateData?.state)) {
        log.info({ state: c.stateData?.state }, 'call answered')
        done(true)
      }
    }

    const onEnded = (c: CallInfo) => {
      if ((c.callId ?? '').toLowerCase() !== callId.toLowerCase()) return
      log.warn('call ended before answer')
      done(false)
    }

    const cleanup = () => {
      try {
        emitter.off('voip_call_state', onState as (...args: unknown[]) => void)
        emitter.off('voip_call_ended', onEnded as (...args: unknown[]) => void)
      } catch {
        /* */
      }
    }

    const done = (answered: boolean) => {
      if (resolved) return
      resolved = true
      clearInterval(timer)
      cleanup()
      resolve(answered)
    }

    emitter.on('voip_call_state', onState as (...args: unknown[]) => void)
    emitter.on('voip_call_ended', onEnded as (...args: unknown[]) => void)

    const timer = setInterval(() => {
      if (signal.aborted) {
        log.warn('blast aborted while waiting for answer')
        done(false)
        return
      }
      if (Date.now() >= deadline) {
        log.warn('call answer timeout')
        done(false)
      }
    }, 250)

    signal.addEventListener('abort', () => done(false), { once: true })
  })
}

type InboundCapture = {
  chunks: Float32Array[]
  samples: number
  stop: () => void
}

/** Subscribe to inbound PCM; stop() must be called to unsubscribe. */
function startInboundCapture(
  client: VoipClient,
  callId: string,
  signal: AbortSignal,
  maxSamples: number,
): InboundCapture {
  const chunks: Float32Array[] = []
  let samples = 0
  let stopped = false
  const emitter = asEmitter(client)

  // biome-ignore lint/suspicious/noExplicitAny: plugin event payload
  const onAudio = ({ call, pcm }: { call: any; pcm: Float32Array }) => {
    if (stopped || signal.aborted) return
    if ((call?.callId ?? '').toLowerCase() !== callId.toLowerCase()) return
    if (samples >= maxSamples) return
    const room = maxSamples - samples
    const take = Math.min(pcm.length, room)
    chunks.push(new Float32Array(pcm.subarray(0, take)))
    samples += take
  }

  const handler = onAudio as (...args: unknown[]) => void
  emitter.on('voip_call_inbound_audio', handler)

  return {
    chunks,
    get samples() {
      return samples
    },
    stop() {
      if (stopped) return
      stopped = true
      try {
        emitter.off('voip_call_inbound_audio', handler)
      } catch {
        /* */
      }
    },
  }
}

async function feedAudio(
  client: VoipClient,
  callId: string,
  samples: Float32Array,
  signal: AbortSignal,
): Promise<boolean> {
  const log = getLogger({ component: 'blast-feed', callId })
  const watermarks = client.voip.getFeedWatermarksMs()
  const SAFE_MS = Math.max(watermarks.resumeMs * 2, 200)
  let offset = 0

  // Phase 1 — pre-fill buffer so playback doesn't starve
  while (offset < samples.length && !signal.aborted) {
    const bufferedMs = client.voip.getLiveBufferMs(callId)
    if (bufferedMs >= SAFE_MS) break

    const neededMs = Math.max(20, SAFE_MS - Math.max(0, bufferedMs))
    const neededSamples = Math.round((neededMs / 1000) * TARGET_SAMPLE_RATE)
    const remaining = samples.length - offset
    const take = Math.min(neededSamples, remaining)
    if (take <= 0) break

    const chunk = samples.subarray(offset, offset + take)
    offset += take
    client.voip.feedLiveAudio(callId, chunk)
    await sleep(0)
  }

  log.debug({ prefillSamples: offset, bufferMs: client.voip.getLiveBufferMs(callId) }, 'pre-fill complete')

  // Phase 2 — maintain: feed when buffer has room, wait when full
  while (offset < samples.length && !signal.aborted) {
    const bufferedMs = client.voip.getLiveBufferMs(callId)

    if (bufferedMs >= watermarks.pauseMs) {
      await sleep(15)
      continue
    }

    const roomMs = Math.max(0, watermarks.pauseMs - bufferedMs)
    if (roomMs < 10) {
      await sleep(5)
      continue
    }

    const roomSamples = Math.round((roomMs / 1000) * TARGET_SAMPLE_RATE)
    const remaining = samples.length - offset
    const take = Math.min(roomSamples, remaining)
    const chunk = samples.subarray(offset, offset + take)
    offset += take
    client.voip.feedLiveAudio(callId, chunk)
    await sleep(0)
  }

  if (signal.aborted || offset < samples.length) {
    log.warn({ offset, total: samples.length, aborted: signal.aborted }, 'audio feed incomplete')
    return false
  }

  // Drain remaining buffer
  while (client.voip.getLiveBufferMs(callId) > 15 && !signal.aborted) {
    await sleep(30)
  }

  log.debug({ totalSamples: samples.length }, 'audio feed complete')
  return true
}

export async function executeAudioBlast(opts: AudioBlastRequest): Promise<AudioBlastResult> {
  const log = getLogger({ component: 'audio-blast', instance: opts.instanceName })
  const startedAt = Date.now()
  let tempDir = ''
  let callId = ''
  let capture: InboundCapture | null = null

  try {
    const {
      manager,
      instanceName,
      to,
      audioUrl,
      audioPath,
      responseTimeoutMs,
      callTimeoutMs,
      recordResponse,
      mediaStorage,
      cache,
      calls,
      stt,
    } = opts

    if (!audioUrl && !audioPath) {
      throw new Error('audioUrl or audioPath is required')
    }

    const maxCaptureSeconds = opts.maxCaptureSeconds ?? 120
    const maxSamples = Math.max(1, Math.floor(maxCaptureSeconds * TARGET_SAMPLE_RATE))

    const client = asVoipClient(await manager.requireOpenClient(instanceName))

    log.info({ to }, 'starting blast call')
    const peerJid = await resolveRecipientJid(client, to, cache)

    const decoded = audioPath ? await decodeLocalWav(audioPath) : await downloadAndDecode(audioUrl as string)
    const { pcm } = decoded
    tempDir = decoded.tempDir
    const audioDurationMs = Math.round((pcm.length / TARGET_SAMPLE_RATE) * 1000)
    log.info({ audioDurationMs, samples: pcm.length }, 'audio ready')

    callId = await client.voip.startCall({ peerJid })
    client.voip.setExternalAudioMode(callId, true)
    log.info({ callId, peerJid }, 'call started')

    if (calls) {
      await calls.upsertStart({
        instanceName,
        callId,
        peerJid,
        direction: 'outgoing',
        mediaType: 'audio',
        state: 'ringing',
        recordingEnabled: recordResponse,
      })
    }

    const abort = new AbortController()

    const answered = await waitForCallAnswered(client, callId, callTimeoutMs, abort.signal)
    if (!answered) {
      abort.abort()
      try {
        await client.voip.endCall(callId)
      } catch {
        /* */
      }
      if (calls) {
        await calls.markEnded(instanceName, callId, { endReason: 'not_answered', state: 'ended' })
      }
      return {
        callId,
        peerJid,
        audioPlayed: false,
        recordingUrl: null,
        responseDurationMs: 0,
        totalDurationMs: Date.now() - startedAt,
        transcription: null,
        error: 'call not answered',
      }
    }

    if (calls) {
      await calls.updateState(instanceName, callId, { state: 'active' })
      if (recordResponse) {
        await calls.markRecordingStarted(instanceName, callId)
      }
    }

    capture = startInboundCapture(client, callId, abort.signal, maxSamples)

    const played = await feedAudio(client, callId, pcm, abort.signal)
    log.info({ played }, 'audio playback finished')

    if (recordResponse && played) {
      log.info({ waitMs: responseTimeoutMs }, 'waiting for response')
      await sleep(responseTimeoutMs)
    }

    abort.abort()
    capture.stop()

    try {
      await client.voip.endCall(callId)
    } catch {
      /* */
    }

    const inboundChunks = capture.chunks
    let totalSamples = 0
    for (const c of inboundChunks) {
      totalSamples += c.length
    }
    const merged = new Float32Array(totalSamples)
    let off = 0
    for (const c of inboundChunks) {
      merged.set(c, off)
      off += c.length
    }

    const responseMs = Math.round((totalSamples / TARGET_SAMPLE_RATE) * 1000)
    if (calls) {
      await calls.markEnded(instanceName, callId, {
        endReason: 'completed',
        durationSecs: Math.round((Date.now() - startedAt) / 1000),
        state: 'ended',
      })
    }

    let recordingUrl: string | null = null
    let storedWav: Buffer | null = null
    if (recordResponse && totalSamples > 0 && mediaStorage) {
      try {
        storedWav = encodeResponseWav(merged, TARGET_SAMPLE_RATE)
        const stored = await mediaStorage.put(instanceName, storedWav, {
          mimeType: 'audio/wav',
          filename: `blast-${callId}.wav`,
          messageId: `blast-${callId}`,
        })
        const downloadPath = `/v1/instances/${encodeURIComponent(instanceName)}/calls/${encodeURIComponent(callId)}/recording`
        recordingUrl = stored.url ?? downloadPath
        if (calls) {
          await calls.setRecordingResult(instanceName, callId, {
            status: 'ready',
            storageKey: stored.storageKey,
            url: recordingUrl,
            mime: 'audio/wav',
            bytes: stored.sizeBytes,
          })
        }
        log.info({ recordingUrl, bytes: stored.sizeBytes }, 'response recording saved')
      } catch (err) {
        log.warn({ err }, 'failed to save response recording')
        if (calls) {
          await calls.setRecordingResult(instanceName, callId, {
            status: 'failed',
            error: err instanceof Error ? err.message : 'recording save failed',
          })
        }
      }
    } else if (recordResponse && calls && totalSamples === 0) {
      await calls.setRecordingResult(instanceName, callId, {
        status: 'failed',
        error: 'no inbound audio captured',
      })
    }

    let transcription: string | null = null
    if (stt?.enabled && storedWav) {
      try {
        log.info('transcribing response audio')
        const result = await transcribeAudio({
          apiUrl: stt.apiUrl,
          apiKey: stt.apiKey,
          model: stt.model,
          temperature: stt.temperature,
          language: stt.language,
          audioBytes: storedWav,
          filename: `blast-${callId}.wav`,
        })
        transcription = result.text
        log.info({ text: result.text?.slice(0, 80) }, 'transcription complete')
      } catch (err) {
        log.warn({ err }, 'transcription failed')
      }
    }

    return {
      callId,
      peerJid,
      audioPlayed: played,
      recordingUrl: totalSamples > 0 ? recordingUrl : null,
      responseDurationMs: responseMs,
      totalDurationMs: Date.now() - startedAt,
      transcription,
    }
  } finally {
    capture?.stop()
    if (tempDir) {
      await removeTempDir(tempDir)
    }
  }
}
