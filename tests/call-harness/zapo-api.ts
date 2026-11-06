/**
 * The zapo-rest side of the call harness: our real auth plugin + call routes (REST accept,
 * `/stream` PCM WS, `/video` H.264 WS) served on an ephemeral port, plus a Node client that
 * plays the dashboard's role on both sockets.
 */
import websocket from '@fastify/websocket'
import Fastify, { type FastifyInstance } from 'fastify'
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod'
import WebSocket from 'ws'
import { authPlugin } from '~/auth/plugin'
import type { InstanceManager } from '~/instances/manager'
import type { InstanceRepo } from '~/instances/repo'
import { callRoutes } from '~/routes/calls'
import { VIDEO_MAX_FRAME_BYTES } from '~/voip/call-video-stream'
import { decodeVideoFrame, encodeVideoFrame, VIDEO_FRAME_HEADER_BYTES } from '~/voip/video-frame'
import { makeEnv } from '../helpers/fixtures'

// biome-ignore lint/suspicious/noExplicitAny: WaClient with plugin surface
type Any = any

export const HARNESS_INSTANCE = 'call-harness'
/** Call routes are instance-scoped (`/v1/calls/...`, name from the key) — admin keys can't use them. */
export const HARNESS_INSTANCE_KEY = 'zr_call_harness_instance_key'
const ADMIN_KEY = 'test-admin-api-key-min-16'

export type ZapoApi = { app: FastifyInstance; baseUrl: string; wsUrl: string }

export async function startZapoApi(client: Any): Promise<ZapoApi> {
  const env = makeEnv({ ADMIN_API_KEY: ADMIN_KEY, VOIP_END_CALL_ON_WS_CLOSE: false })
  const instance = { name: HARNESS_INSTANCE, apiKey: HARNESS_INSTANCE_KEY }
  const instanceRepo = {
    getByApiKey: async (key: string) => (key === HARNESS_INSTANCE_KEY ? instance : null),
  } as unknown as InstanceRepo
  const manager = {
    getClient: () => client,
    requireRegisteredClient: () => client,
  } as unknown as InstanceManager

  const app = Fastify({ logger: false })
  app.setValidatorCompiler(validatorCompiler)
  app.setSerializerCompiler(serializerCompiler)
  await app.register(websocket, { options: { maxPayload: VIDEO_MAX_FRAME_BYTES + VIDEO_FRAME_HEADER_BYTES } })
  await app.register(authPlugin, { env, instanceRepo })
  await app.register(callRoutes, { manager, env, instanceRepo })
  const address = await app.listen({ host: '127.0.0.1', port: 0 })
  return { app, baseUrl: address, wsUrl: address.replace('http', 'ws') }
}

export async function acceptViaRest(api: ZapoApi, callId: string): Promise<void> {
  const res = await fetch(`${api.baseUrl}/v1/calls/${callId}/accept`, {
    method: 'POST',
    headers: { 'x-api-key': HARNESS_INSTANCE_KEY },
  })
  if (!res.ok) throw new Error(`accept failed: ${res.status} ${await res.text()}`)
}

export type DashboardVideoFrame = { keyFrame: boolean; timestampUs: number; data: Uint8Array; receivedAt: number }

/** What the dashboard does over our two per-call sockets, minus WebCodecs. */
export class DashboardClient {
  private readonly audioListeners = new Set<(pcm: Float32Array, at: number) => void>()
  private readonly videoListeners = new Set<(frame: DashboardVideoFrame) => void>()
  readonly backpressure: { pause: boolean; bufferedMs: number; at: number }[] = []

  private constructor(
    readonly stream: WebSocket,
    readonly video: WebSocket,
  ) {
    stream.on('message', (data, isBinary) => {
      const at = performance.now()
      if (!isBinary) {
        const msg = JSON.parse(String(data))
        if (msg.op === 'backpressure') this.backpressure.push({ pause: msg.pause, bufferedMs: msg.bufferedMs, at })
        return
      }
      const buf = data as Buffer
      const pcm = new Float32Array(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength))
      for (const l of this.audioListeners) l(pcm, at)
    })
    video.on('message', (data, isBinary) => {
      if (!isBinary) return
      const frame = decodeVideoFrame(data as Buffer)
      if (!frame) return
      const receivedAt = performance.now()
      for (const l of this.videoListeners) l({ ...frame, data: frame.data.slice(), receivedAt })
    })
  }

  static async open(api: ZapoApi, callId: string): Promise<DashboardClient> {
    const base = `${api.wsUrl}/v1/calls/${callId}`
    const q = `?apiKey=${HARNESS_INSTANCE_KEY}`
    const [stream, video] = await Promise.all([openReady(`${base}/stream${q}`), openReady(`${base}/video${q}`)])
    return new DashboardClient(stream, video)
  }

  sendPcm(pcm: Float32Array) {
    if (this.stream.readyState !== WebSocket.OPEN) return
    this.stream.send(Buffer.from(pcm.buffer, pcm.byteOffset, pcm.byteLength))
  }

  sendVideo(au: Uint8Array, timestampUs: number, keyFrame: boolean) {
    if (this.video.readyState !== WebSocket.OPEN) return
    this.video.send(encodeVideoFrame({ keyFrame, timestampUs, data: au }))
  }

  onAudio(listener: (pcm: Float32Array, at: number) => void) {
    this.audioListeners.add(listener)
  }

  onVideo(listener: (frame: DashboardVideoFrame) => void) {
    this.videoListeners.add(listener)
  }

  close() {
    this.stream.close()
    this.video.close()
  }
}

/** Resolve once the server's `{ op: "ready" }` arrives; reject on early close. */
function openReady(url: string): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url)
    const onMessage = (data: WebSocket.RawData, isBinary: boolean) => {
      if (isBinary) return
      if (JSON.parse(String(data)).op !== 'ready') return
      ws.off('message', onMessage)
      resolve(ws)
    }
    ws.on('message', onMessage)
    ws.once('close', (code, reason) => reject(new Error(`${url} closed before ready: ${code} ${reason}`)))
    ws.once('error', reject)
  })
}
