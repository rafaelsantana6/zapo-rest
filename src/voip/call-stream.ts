import type { WebSocket } from 'ws'
import { type AuthDeps, resolveActor } from '~/auth/plugin'
import { canAccessInstance } from '~/auth/types'
import type { Env } from '~/config/env'
import { getEnv } from '~/config/env'
import type { InstanceManager } from '~/instances/manager'
import type { InstanceRepo } from '~/instances/repo'
import { asVoipClient } from '~/instances/wa-client'
import { getLogger } from '~/lib/logger'

export type AttachCallStreamOpts = {
  socket: WebSocket
  manager: InstanceManager
  env: Env
  instanceName: string
  callId: string
  apiKey: string
  /** Required for instance-key auth (lookup by plaintext api_key). */
  instanceRepo: InstanceRepo
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
  const { socket, manager, env, instanceName, callId, apiKey, instanceRepo, callRecording } = opts

  // Authorize like the rest of /v1 — admin env key or instance key via hash lookup.
  // NEVER compare the query key to instance.apiKey from GET (that field is masked "***").
  const authDeps: AuthDeps = { env, instanceRepo }
  const actor = await resolveActor(authDeps, apiKey)
  if (!actor || !canAccessInstance(actor, instanceName)) {
    socket.close(4403, 'forbidden')
    return
  }

  let client: ReturnType<typeof asVoipClient>
  try {
    client = asVoipClient(manager.getClient(instanceName))
  } catch {
    socket.close(4503, 'instance not connected')
    return
  }

  // Resolve callId (case-insensitive) — UI may uppercase hex ids
  let resolvedId = callId
  let call = client.voip.getCall(callId)
  if (!call) {
    const all = client.voip.getCalls() as { callId?: string }[]
    const hit = all.find((c) => c.callId?.toLowerCase() === callId.toLowerCase())
    if (hit?.callId) {
      resolvedId = hit.callId
      call = client.voip.getCall(resolvedId)
    }
  }
  if (!call) {
    socket.close(4404, 'call not found')
    return
  }

  client.voip.setExternalAudioMode(resolvedId, true)

  socket.send(
    JSON.stringify({
      op: 'ready',
      sampleRate: 16_000,
      channels: 1,
      format: 'f32le',
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
    const copy = Buffer.from(pcm.buffer, pcm.byteOffset, pcm.byteLength)
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
    if (typeof data === 'string') return
    // Be defensive: some stacks omit isBinary or deliver Buffer for binary
    const looksBinary =
      isBinary === true || Buffer.isBuffer(data) || data instanceof ArrayBuffer || ArrayBuffer.isView(data)
    if (!looksBinary) return

    let buf: Buffer
    if (Buffer.isBuffer(data)) {
      buf = data
    } else if (data instanceof ArrayBuffer) {
      buf = Buffer.from(data)
    } else if (ArrayBuffer.isView(data)) {
      buf = Buffer.from(data.buffer, data.byteOffset, data.byteLength)
    } else {
      return
    }

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
