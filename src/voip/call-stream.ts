import type { EventEmitter } from 'node:events'
import { getEnv } from '~/config/env'
import { getLogger } from '~/lib/logger'
import {
  attachParticipantAudio,
  encodeParticipantAudio,
  PARTICIPANT_AUDIO_HEADER_BYTES,
} from '~/voip/participant-audio'
import { binaryMessage, type CallSocketOpts, openCallSocket } from '~/voip/call-socket'

export type AttachCallStreamOpts = CallSocketOpts & {
  participants?: boolean
  callRecording?: import('~/voip/recording-manager').CallRecordingManager
}

/**
 * Bridge WebSocket binary PCM (Float32 LE, 16 kHz mono) ↔ client.voip feedLiveAudio / inbound events.
 * No file playback — live phone-style audio only.
 */
export async function attachCallStream(opts: AttachCallStreamOpts): Promise<void> {
  const log = getLogger({
    component: 'call-stream',
    instance: opts.instanceName,
    callId: opts.callId,
  })
  const { socket, instanceName, callRecording } = opts

  const opened = await openCallSocket(opts)
  if (!opened) return
  const { client, callId: resolvedId, call } = opened

  if (opts.participants && !opts.env.VOIP_PARTICIPANT_AUDIO) {
    socket.close(4409, 'participant audio disabled; set VOIP_PARTICIPANT_AUDIO=true (local media)')
    return
  }
  const detachParticipants = opts.participants
    ? attachParticipantAudio(client as unknown as EventEmitter, socket, resolvedId)
    : undefined
  client.voip.setExternalAudioMode(resolvedId, true)

  socket.send(
    JSON.stringify({
      op: 'ready',
      sampleRate: 16_000,
      channels: 1,
      format: 'f32le',
      ...(opts.participants
        ? { headerBytes: PARTICIPANT_AUDIO_HEADER_BYTES, participants: true, mixedStreamId: 0 }
        : {}),
      callId: resolvedId,
      state: (call as { stateData?: { state?: string } }).stateData?.state,
    }),
  )

  const watermarks = client.voip.getFeedWatermarksMs()
  let paused = false

  const sameCall = (id: string | undefined) => Boolean(id && id.toLowerCase() === resolvedId.toLowerCase())

  // Inbound peer audio → WS binary (+ recording remote leg is also handled in manager)
  // biome-ignore lint/suspicious/noExplicitAny: plugin event
  const onInbound = ({ call: c, pcm }: { call: any; pcm: Float32Array }) => {
    if (!sameCall(c?.callId)) return
    if (socket.readyState !== socket.OPEN) return
    // Copy — pcm buffer may be reused by the codec
    const copy = opts.participants
      ? encodeParticipantAudio(0, pcm)
      : Buffer.from(new Uint8Array(pcm.buffer, pcm.byteOffset, pcm.byteLength))
    socket.send(copy)
  }

  // biome-ignore lint/suspicious/noExplicitAny: plugin event
  const onState = (c: any) => {
    if (!sameCall(c?.callId)) return
    if (socket.readyState !== socket.OPEN) return
    try {
      socket.send(
        JSON.stringify({
          op: 'state',
          callId: resolvedId,
          state: c?.stateData?.state,
          isActive: Boolean(c?.isActive),
        }),
      )
    } catch {
      /* */
    }
  }

  // biome-ignore lint/suspicious/noExplicitAny: plugin event
  const onEnded = (c: any) => {
    if (!sameCall(c?.callId)) return
    if (socket.readyState === socket.OPEN) {
      socket.send(JSON.stringify({ op: 'ended', callId: resolvedId }))
      socket.close(1000, 'call ended')
    }
  }

  // biome-ignore lint/suspicious/noExplicitAny: plugin event map
  ;(client as any).on('voip_call_inbound_audio', onInbound)
  // biome-ignore lint/suspicious/noExplicitAny: plugin event map
  ;(client as any).on('voip_call_state', onState)
  // biome-ignore lint/suspicious/noExplicitAny: plugin event map
  ;(client as any).on('voip_call_ended', onEnded)

  socket.on('message', (data, isBinary) => {
    // Text control frames (JSON) — ignore for now
    const buf = binaryMessage(data, isBinary)
    if (!buf) return

    // Align to float32 frame size
    const usable = buf.byteLength - (buf.byteLength % 4)
    if (usable < 4) return

    // Copy into a dedicated Float32Array (Buffer pool slices must not be shared)
    const samples = new Float32Array(usable / 4)
    for (let i = 0; i < samples.length; i++) {
      samples[i] = buf.readFloatLE(i * 4)
    }

    // Local mic → recorder (remote leg captured via voip_call_inbound_audio)
    callRecording?.appendLocal(instanceName, resolvedId, samples)
    // feedLiveAudio no-ops if external mode is off (returns 0) — mode is set once above
    const bufferedMs = client.voip.feedLiveAudio(resolvedId, samples)

    if (!paused && bufferedMs >= watermarks.pauseMs) {
      paused = true
      socket.send(JSON.stringify({ op: 'backpressure', pause: true, bufferedMs }))
    } else if (paused && client.voip.getLiveBufferMs(resolvedId) <= watermarks.resumeMs) {
      paused = false
      socket.send(JSON.stringify({ op: 'backpressure', pause: false, bufferedMs }))
    }
  })

  socket.on('close', () => {
    detachParticipants?.()
    // biome-ignore lint/suspicious/noExplicitAny: plugin event map
    ;(client as any).off?.('voip_call_inbound_audio', onInbound)
    // biome-ignore lint/suspicious/noExplicitAny: plugin event map
    ;(client as any).off?.('voip_call_state', onState)
    // biome-ignore lint/suspicious/noExplicitAny: plugin event map
    ;(client as any).off?.('voip_call_ended', onEnded)

    if (getEnv().VOIP_END_CALL_ON_WS_CLOSE) {
      void client.voip.endCall(resolvedId).catch((err: unknown) => {
        log.warn({ err }, 'endCall on ws close failed')
      })
    }
    log.info('call stream closed')
  })

  socket.on('error', (err) => {
    log.warn({ err }, 'call stream socket error')
  })
}
