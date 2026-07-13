import type { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'
import { requireInstanceAccess } from '~/auth/plugin'
import type { Env } from '~/config/env'
import {
  CallGetResponseSchema,
  CallListResponseSchema,
  CallParamsSchema,
  CallReasonBodySchema,
  ErrorBodySchema,
  EXAMPLES,
  InstanceNameParams,
  MuteBodySchema,
  OkSchema,
  StartCallBodySchema,
  StartCallResponseSchema,
  StreamQuerySchema,
} from '~/http/openapi-schemas'
import type { InstanceManager } from '~/instances/manager'
import type { InstanceRepo } from '~/instances/repo'
import { asVoipClient } from '~/instances/wa-client'
import { badRequest, notFound } from '~/lib/errors'
import { resolveRecipientJid } from '~/lib/phone-resolve'
import type { MediaStorage } from '~/media/storage'
import type { CacheClient } from '~/redis/client'
import type { CallStore } from '~/store/calls'
import { toPublicCall } from '~/store/calls'
import { resolveLiveCall, serializeCallInfo } from '~/voip/call-serialize'
import { attachCallStream } from '~/voip/call-stream'
import type { CallRecordingManager } from '~/voip/recording-manager'

export type CallRoutesDeps = {
  manager: InstanceManager
  env: Env
  instanceRepo: InstanceRepo
  calls?: CallStore
  callRecording?: CallRecordingManager
  mediaStorage?: MediaStorage
  cache?: CacheClient
}

type InstanceParams = { Params: z.infer<typeof InstanceNameParams> }
type CallParams = { Params: z.infer<typeof CallParamsSchema> }

export const callRoutes: FastifyPluginAsync<CallRoutesDeps> = async (app, deps) => {
  const { manager, env, instanceRepo, calls, callRecording, mediaStorage, cache } = deps

  app.post<InstanceParams & { Body: z.infer<typeof StartCallBodySchema> }>(
    '/v1/instances/:name/calls',
    {
      schema: {
        tags: ['Calls'],
        summary: 'Start outbound voice call',
        description:
          'Places an **audio-only** WhatsApp voice call (`client.voip.startCall`).\n\n' +
          'Returns `callId` immediately after the offer is sent. Progress continues via webhooks ' +
          '`call.state` / `call.ended` and the live PCM WebSocket.\n\n' +
          '**No file / audioUrl playback** — open the stream and send live mic PCM.\n\n' +
          '**Example body**\n' +
          '```json\n' +
          `${JSON.stringify(EXAMPLES.startCall, null, 2)}\n` +
          '```\n\n' +
          '```bash\n' +
          'curl -s -X POST "$BASE/v1/instances/sales-1/calls" \\\n' +
          '  -H "X-Api-Key: $KEY" -H "content-type: application/json" \\\n' +
          `  -d '${JSON.stringify(EXAMPLES.startCall)}'\n` +
          '```',
        security: [{ apiKey: [] }, { bearerAuth: [] }],
        params: InstanceNameParams,
        body: StartCallBodySchema,
        response: {
          200: StartCallResponseSchema,
          400: ErrorBodySchema,
          401: ErrorBodySchema,
          403: ErrorBodySchema,
          404: ErrorBodySchema,
          503: ErrorBodySchema,
        },
      },
    },
    async (request) => {
      const { name } = request.params
      requireInstanceAccess(request, name)
      const body = request.body
      const client = asVoipClient(manager.requireRegisteredClient(name))
      // 55 + nono dígito via usync (e.g. 68981159096 → 556881159096@…)
      const peerJid = await resolveRecipientJid(client, body.to, cache)
      const callId = await client.voip.startCall({ peerJid })
      try {
        client.voip.setExternalAudioMode(callId, true)
      } catch {
        /* */
      }
      if (callRecording) {
        await callRecording.onCallStarted(name, {
          callId,
          peerJid,
          direction: 'outbound',
          mediaType: 'audio',
          state: 'calling',
        })
      }
      return { callId, peerJid }
    },
  )

  // Static paths before :callId
  app.get<InstanceParams & { Querystring: { limit?: number; offset?: number; withRecording: boolean } }>(
    '/v1/instances/:name/calls/history',
    {
      schema: {
        tags: ['Calls'],
        summary: 'List call history (DB)',
        description:
          'Persisted calls for the instance. Use `withRecording=true` to only list calls with downloadable recordings.',
        security: [{ apiKey: [] }, { bearerAuth: [] }],
        params: InstanceNameParams,
        querystring: z.object({
          limit: z.coerce.number().int().positive().max(200).optional(),
          offset: z.coerce.number().int().nonnegative().optional(),
          withRecording: z
            .union([z.boolean(), z.enum(['true', 'false', '1', '0'])])
            .optional()
            .transform((v) => v === true || v === 'true' || v === '1'),
        }),
      },
    },
    async (request) => {
      const { name } = request.params
      requireInstanceAccess(request, name)
      if (!calls) return { calls: [] }
      const q = request.query
      const rows = await calls.list(name, {
        limit: q.limit,
        offset: q.offset,
        withRecordingOnly: q.withRecording,
      })
      return { calls: rows.map((c) => toPublicCall(c, { instanceName: name })) }
    },
  )

  app.get<InstanceParams>(
    '/v1/instances/:name/settings/call-recording',
    {
      schema: {
        tags: ['Calls'],
        summary: 'Get call recording setting',
        security: [{ apiKey: [] }, { bearerAuth: [] }],
        params: InstanceNameParams,
      },
    },
    async (request) => {
      const { name } = request.params
      requireInstanceAccess(request, name)
      if (!callRecording) {
        return { callRecordingEnabled: false, storageReady: false }
      }
      return callRecording.getConfig(name)
    },
  )

  app.put<InstanceParams & { Body: { enabled: boolean } }>(
    '/v1/instances/:name/settings/call-recording',
    {
      schema: {
        tags: ['Calls'],
        summary: 'Enable/disable call recording',
        description:
          'Requires media storage (`MEDIA_STORAGE=local|s3`). Recordings are WAV stereo (local | remote) stored in object storage.',
        security: [{ apiKey: [] }, { bearerAuth: [] }],
        params: InstanceNameParams,
        body: z.object({ enabled: z.boolean() }),
      },
    },
    async (request) => {
      const { name } = request.params
      requireInstanceAccess(request, name)
      const body = request.body
      if (!callRecording) throw badRequest('call recording not available')
      try {
        return await callRecording.setRecordingEnabled(name, body.enabled)
      } catch (err) {
        throw badRequest(err instanceof Error ? err.message : 'cannot set recording')
      }
    },
  )

  app.get<InstanceParams>(
    '/v1/instances/:name/calls',
    {
      schema: {
        tags: ['Calls'],
        summary: 'List active calls',
        description: 'Lists in-memory calls for the instance (`client.voip.getCalls()`), including ringing and active.',
        security: [{ apiKey: [] }, { bearerAuth: [] }],
        params: InstanceNameParams,
        response: {
          200: CallListResponseSchema,
          401: ErrorBodySchema,
          403: ErrorBodySchema,
          404: ErrorBodySchema,
          503: ErrorBodySchema,
        },
      },
    },
    async (request) => {
      const { name } = request.params
      requireInstanceAccess(request, name)
      const client = asVoipClient(manager.requireRegisteredClient(name))
      const live = client.voip.getCalls()
      return { calls: live.map((c) => serializeCallInfo(c)) }
    },
  )

  app.get<CallParams>(
    '/v1/instances/:name/calls/:callId',
    {
      schema: {
        tags: ['Calls'],
        summary: 'Get call snapshot',
        description: 'Returns a single call snapshot, or `{ "call": null }` if unknown / already GC’d.',
        security: [{ apiKey: [] }, { bearerAuth: [] }],
        params: CallParamsSchema,
        response: {
          200: CallGetResponseSchema,
          401: ErrorBodySchema,
          403: ErrorBodySchema,
          404: ErrorBodySchema,
          503: ErrorBodySchema,
        },
      },
    },
    async (request) => {
      const params = request.params
      requireInstanceAccess(request, params.name)
      const client = asVoipClient(manager.requireRegisteredClient(params.name))
      const call = client.voip.getCall(params.callId)
      if (!call) {
        return { call: null }
      }
      return { call: serializeCallInfo(call) }
    },
  )

  app.post<CallParams>(
    '/v1/instances/:name/calls/:callId/accept',
    {
      schema: {
        tags: ['Calls'],
        summary: 'Accept incoming call',
        description:
          'Accepts a ringing inbound call (`canAccept: true` on the call snapshot / `call.incoming` webhook).',
        security: [{ apiKey: [] }, { bearerAuth: [] }],
        params: CallParamsSchema,
        response: {
          200: OkSchema,
          401: ErrorBodySchema,
          403: ErrorBodySchema,
          404: ErrorBodySchema,
          503: ErrorBodySchema,
        },
      },
    },
    async (request) => {
      const params = request.params
      requireInstanceAccess(request, params.name)
      const client = asVoipClient(manager.requireRegisteredClient(params.name))
      const resolved = resolveLiveCall(client, params.callId)
      if (!resolved) {
        throw notFound(`call ${params.callId} not found (not ringing anymore?)`)
      }
      const snap = serializeCallInfo(resolved)
      // canAccept is only true for state === incoming_ringing (not outbound "ringing")
      if (!snap.canAccept) {
        throw badRequest(
          `cannot accept call in state "${snap.state}" (direction=${snap.direction}). ` +
            `Only incoming calls in "incoming_ringing" can be accepted. ` +
            `If this is an outbound call, wait for the peer to answer — do not press Atender.`,
          snap,
        )
      }
      try {
        client.voip.setExternalAudioMode(resolved.callId, true)
      } catch {
        /* */
      }
      await client.voip.acceptCall(resolved.callId)
      return { ok: true as const }
    },
  )

  app.post<CallParams & { Body: z.infer<typeof CallReasonBodySchema> }>(
    '/v1/instances/:name/calls/:callId/reject',
    {
      schema: {
        tags: ['Calls'],
        summary: 'Reject incoming call',
        description: 'Rejects a ringing inbound call. Optional body `{ "reason": "..." }`.',
        security: [{ apiKey: [] }, { bearerAuth: [] }],
        params: CallParamsSchema,
        body: CallReasonBodySchema,
        response: {
          200: OkSchema,
          401: ErrorBodySchema,
          403: ErrorBodySchema,
          404: ErrorBodySchema,
          503: ErrorBodySchema,
        },
      },
    },
    async (request) => {
      const params = request.params
      requireInstanceAccess(request, params.name)
      const client = asVoipClient(manager.requireRegisteredClient(params.name))
      await client.voip.rejectCall(params.callId)
      return { ok: true as const }
    },
  )

  app.post<CallParams & { Body: z.infer<typeof CallReasonBodySchema> }>(
    '/v1/instances/:name/calls/:callId/end',
    {
      schema: {
        tags: ['Calls'],
        summary: 'End active call',
        description: 'Hangs up an active/connecting call. Optional body `{ "reason": "..." }`.',
        security: [{ apiKey: [] }, { bearerAuth: [] }],
        params: CallParamsSchema,
        body: CallReasonBodySchema,
        response: {
          200: OkSchema,
          401: ErrorBodySchema,
          403: ErrorBodySchema,
          404: ErrorBodySchema,
          503: ErrorBodySchema,
        },
      },
    },
    async (request) => {
      const params = request.params
      requireInstanceAccess(request, params.name)
      const client = asVoipClient(manager.requireRegisteredClient(params.name))
      await client.voip.endCall(params.callId)
      return { ok: true as const }
    },
  )

  app.post<CallParams & { Body: z.infer<typeof MuteBodySchema> }>(
    '/v1/instances/:name/calls/:callId/mute',
    {
      schema: {
        tags: ['Calls'],
        summary: 'Mute / unmute local audio',
        description: 'Mutes or unmutes the local outbound audio track.\n\n```json\n{ "muted": true }\n```',
        security: [{ apiKey: [] }, { bearerAuth: [] }],
        params: CallParamsSchema,
        body: MuteBodySchema,
        response: {
          200: OkSchema,
          400: ErrorBodySchema,
          401: ErrorBodySchema,
          403: ErrorBodySchema,
          404: ErrorBodySchema,
          503: ErrorBodySchema,
        },
      },
    },
    async (request) => {
      const params = request.params
      requireInstanceAccess(request, params.name)
      const body = request.body
      const client = asVoipClient(manager.requireRegisteredClient(params.name))
      client.voip.setMute(params.callId, body.muted)
      return { ok: true as const }
    },
  )

  app.get<CallParams>(
    '/v1/instances/:name/calls/:callId/recording',
    {
      schema: {
        tags: ['Calls'],
        summary: 'Download call recording (WAV)',
        description:
          'Streams the stored WAV when call recording was enabled and capture completed. ' +
          'Requires media storage and softphone/stream to capture the local leg.',
        security: [{ apiKey: [] }, { bearerAuth: [] }],
        params: CallParamsSchema,
        response: { 404: ErrorBodySchema },
      },
    },
    async (request, reply) => {
      const params = request.params
      requireInstanceAccess(request, params.name)
      if (!calls || !mediaStorage) throw notFound('recording store unavailable')
      const row = await calls.get(params.name, params.callId)
      if (!row?.recordingStorageKey || row.recordingStatus !== 'ready') {
        throw notFound('recording not available for this call')
      }
      const stream = await mediaStorage.getStream(row.recordingStorageKey)
      reply.header('content-type', row.recordingMime ?? 'audio/wav')
      reply.header('content-disposition', `attachment; filename="call-${params.callId}.wav"`)
      return reply.send(stream)
    },
  )

  // WebSocket PCM stream — documented for OpenAPI (upgrade path)
  app.get(
    '/v1/instances/:name/calls/:callId/stream',
    {
      websocket: true,
      schema: {
        tags: ['Calls'],
        summary: 'WebSocket live PCM audio stream',
        description:
          '**WebSocket upgrade** for bidirectional live audio (real VoIP).\n\n' +
          '### URL\n' +
          '```\n' +
          'ws(s)://<host>/v1/instances/{name}/calls/{callId}/stream?apiKey=<key>\n' +
          '```\n\n' +
          'Auth: query `apiKey` (browsers) or header `X-Api-Key`.\n\n' +
          '### Protocol\n' +
          '1. Server sends JSON text frame:\n' +
          '```json\n' +
          '{ "op": "ready", "sampleRate": 16000, "channels": 1, "format": "f32le", "callId": "..." }\n' +
          '```\n' +
          '2. **Client → server** binary frames: Float32 little-endian mono PCM @ 16 kHz (mic)\n' +
          '3. **Server → client** binary frames: same format (peer audio)\n' +
          '4. Backpressure JSON: `{ "op": "backpressure", "pause": true  | false, "bufferedMs": N }`\n' +
          '5. On end: `{ "op": "ended", "callId": "..." }` then close\n\n' +
          'Engine enables `setExternalAudioMode(callId, true)` — no file autoplay.\n\n' +
          'If `VOIP_END_CALL_ON_WS_CLOSE=true`, closing the socket ends the call.\n\n' +
          'When call recording is enabled, mic frames are also written to the dual-channel WAV.',
        security: [{ apiKey: [] }, { bearerAuth: [] }],
        params: CallParamsSchema,
        querystring: StreamQuerySchema,
        // WebSocket upgrade — no JSON response body; documented in description
      },
    },
    (socket, request) => {
      const params = CallParamsSchema.parse(request.params)
      const q = StreamQuerySchema.parse(request.query)
      const headerKey = typeof request.headers['x-api-key'] === 'string' ? request.headers['x-api-key'] : null
      const apiKey = q.apiKey ?? headerKey
      if (!apiKey) {
        socket.close(4401, 'missing api key')
        return
      }

      void attachCallStream({
        socket,
        manager,
        env,
        instanceName: params.name,
        callId: params.callId,
        apiKey,
        instanceRepo,
        callRecording,
      })
    },
  )
}
