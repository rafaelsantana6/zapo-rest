import { clientMediaMode } from '~/voip/media-mode'
import type { FastifyPluginAsync, FastifyRequest } from 'fastify'
import type { WebSocket } from 'ws'
import { z } from 'zod'
import { resolveInstanceName, scopedInstancePaths } from '~/auth/plugin'
import type { Env } from '~/config/env'
import {
  CallGetResponseSchema,
  CallListResponseSchema,
  CallParamsSchema,
  CallReasonBodyOptionalSchema,
  type CallReasonBodySchema,
  ErrorBodySchema,
  EXAMPLES,
  type InstanceNameParams,
  MuteBodySchema,
  OkSchema,
  StartCallBodySchema,
  StartCallResponseSchema,
  StreamQuerySchema,
} from '~/http/openapi-schemas'
import type { InstanceManager } from '~/instances/manager'
import type { InstanceRepo } from '~/instances/repo'
import { asVoipClient } from '~/instances/wa-client'
import { conflict, badRequest, notFound } from '~/lib/errors'
import { toRecipientJid } from '~/lib/phone'
import { resolveRecipientJid } from '~/lib/phone-resolve'
import type { MediaStorage } from '~/media/storage'
import type { CacheClient } from '~/redis/client'
import type { CallStore } from '~/store/calls'
import { toPublicCall } from '~/store/calls'
import { resolveLiveCall, serializeCallInfo } from '~/voip/call-serialize'
import { resolveParticipantLids, startGroupCall } from '~/voip/group-call'
import { attachCallStream } from '~/voip/call-stream'
import { attachCallVideoStream } from '~/voip/call-video-stream'
import { isNotOnWhatsAppError } from '~/voip/start-call-error'
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
    scopedInstancePaths('/calls'),
    {
      schema: {
        tags: ['Calls'],
        summary: 'Start outbound voice or video call',
        description:
          'Places a WhatsApp call (`client.voip.startCall`). Audio by default; `isVideo: true` ' +
          'negotiates H.264 video too (frames over `.../calls/:callId/video`).\n\n' +
          '**Group call:** send `groupId` + `participants` instead of `to`. Participants are resolved ' +
          'to LIDs; any without one → `400` with `details.missing`. Roster changes arrive as ' +
          '`call.participants_changed`.\n\n' +
          'Returns `callId` immediately after the offer is sent. Progress continues via webhooks ' +
          '`call.state` / `call.ended` and the live PCM WebSocket.\n\n' +
          'Local media: use `/stream` for PCM or `POST /calls/:callId/audio` for a file. Remote media: use the browser host over `/v1/voip`.\n\n' +
          '**Example body**\n' +
          '```json\n' +
          `${JSON.stringify(EXAMPLES.startCall, null, 2)}\n` +
          '```\n\n' +
          '```bash\n' +
          'curl -s -X POST "$BASE/v1/calls" \\\n' +
          '  -H "X-Api-Key: $KEY" -H "content-type: application/json" \\\n' +
          `  -d '${JSON.stringify(EXAMPLES.startCall)}'\n` +
          '```',
        security: [{ apiKey: [] }, { bearerAuth: [] }],
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
      const name = resolveInstanceName(request)
      const body = request.body
      const client = asVoipClient(manager.requireRegisteredClient(name))
      const isVideo = body.isVideo === true
      const mediaType = isVideo ? 'video' : 'audio'
      let peerJid: string
      let callId: string
      let group: { groupJid: string; participants: string[] } | null = null
      if (body.groupId && body.participants) {
        const groupJid = toRecipientJid(body.groupId.includes('@') ? body.groupId : `${body.groupId}@g.us`)
        if (!groupJid.endsWith('@g.us')) throw badRequest('groupId must be a group (@g.us)')
        // Group offers name participants by LID
        const { lids, missing } = await resolveParticipantLids(client, body.participants, cache)
        if (missing.length) throw badRequest('participants without a WhatsApp LID', { missing })
        callId = await startGroupCall(client, groupJid, lids, { isVideo })
        peerJid = groupJid
        group = { groupJid, participants: lids }
      } else {
        // 55 + nono dígito via usync (e.g. 68981159096 → 556881159096@…)
        const peer = await resolveRecipientJid(client, body.to ?? '', cache)
        peerJid = peer
        callId = await client.voip.startCall({ peerJid: peer, isVideo }).catch((err: unknown) => {
          if (isNotOnWhatsAppError(err))
            throw notFound(`${peer} is not on WhatsApp (no devices found) — check the number`)
          throw err
        })
      }
      try {
        if (clientMediaMode(client) === 'local') client.voip.setExternalAudioMode(callId, true)
      } catch {
        /* */
      }
      if (callRecording) {
        await callRecording.onCallStarted(name, {
          callId,
          peerJid,
          direction: 'outbound',
          mediaType,
          state: 'calling',
        })
      }
      return group ? { callId, peerJid, mediaType, ...group } : { callId, peerJid, mediaType }
    },
  )

  // Static paths before :callId
  app.get<InstanceParams & { Querystring: { limit?: number; offset?: number; withRecording: boolean } }>(
    scopedInstancePaths('/calls/history'),
    {
      schema: {
        tags: ['Calls'],
        summary: 'List call history (DB)',
        description:
          'Persisted calls for the instance. Use `withRecording=true` to only list calls with downloadable recordings.',
        security: [{ apiKey: [] }, { bearerAuth: [] }],
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
      const name = resolveInstanceName(request)
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
    scopedInstancePaths('/settings/call-recording'),
    {
      schema: {
        tags: ['Calls'],
        summary: 'Get call recording setting',
        security: [{ apiKey: [] }, { bearerAuth: [] }],
      },
    },
    async (request) => {
      const name = resolveInstanceName(request)
      if (!callRecording) {
        return { callRecordingEnabled: false, storageReady: false }
      }
      return callRecording.getConfig(name)
    },
  )

  app.put<InstanceParams & { Body: { enabled: boolean } }>(
    scopedInstancePaths('/settings/call-recording'),
    {
      schema: {
        tags: ['Calls'],
        summary: 'Enable/disable call recording',
        description:
          'Requires local media mode (remote mode returns 409) and media storage (`MEDIA_STORAGE=local|s3`). Recordings are WAV stereo (local | remote leg) stored in object storage.',
        security: [{ apiKey: [] }, { bearerAuth: [] }],
        body: z.object({ enabled: z.boolean() }),
        response: { 409: ErrorBodySchema },
      },
    },
    async (request) => {
      const name = resolveInstanceName(request)
      const body = request.body
      if (env.VOIP_MEDIA_MODE === 'remote')
        throw conflict('Call recording is unavailable in remote media mode; media runs on the host')
      if (!callRecording) throw badRequest('call recording not available')
      try {
        return await callRecording.setRecordingEnabled(name, body.enabled)
      } catch (err) {
        throw badRequest(err instanceof Error ? err.message : 'cannot set recording')
      }
    },
  )

  app.get<InstanceParams>(
    scopedInstancePaths('/calls'),
    {
      schema: {
        tags: ['Calls'],
        summary: 'List active calls',
        description: 'Lists in-memory calls for the instance (`client.voip.getCalls()`), including ringing and active.',
        security: [{ apiKey: [] }, { bearerAuth: [] }],
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
      const name = resolveInstanceName(request)
      const client = asVoipClient(manager.requireRegisteredClient(name))
      const live = client.voip.getCalls()
      return { calls: live.map((c) => serializeCallInfo(c, { mediaMode: clientMediaMode(client) })) }
    },
  )

  app.get<CallParams>(
    scopedInstancePaths('/calls/:callId'),
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
      const name = resolveInstanceName(request)
      const client = asVoipClient(manager.requireRegisteredClient(name))
      const call = client.voip.getCall(params.callId)
      if (!call) {
        return { call: null }
      }
      return { call: serializeCallInfo(call, { mediaMode: clientMediaMode(client) }) }
    },
  )

  app.post<CallParams>(
    scopedInstancePaths('/calls/:callId/accept'),
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
      const log = request.log.child({ component: 'calls', op: 'accept' })
      const name = resolveInstanceName(request)
      const client = asVoipClient(manager.requireRegisteredClient(name))
      const resolved = resolveLiveCall(client, params.callId)
      if (!resolved) {
        log.warn({ callId: params.callId }, 'accept — call not found')
        throw notFound(`call ${params.callId} not found (not ringing anymore?)`)
      }
      const snap = serializeCallInfo(resolved, { mediaMode: clientMediaMode(client) })
      // canAccept is only true for state === incoming_ringing (not outbound "ringing")
      if (!snap.canAccept) {
        log.warn({ callId: resolved.callId, state: snap.state, direction: snap.direction }, 'accept — not acceptable')
        throw badRequest(
          `cannot accept call in state "${snap.state}" (direction=${snap.direction}). ` +
            `Only incoming calls in "incoming_ringing" can be accepted. ` +
            `If this is an outbound call, wait for the peer to answer — do not press Atender.`,
          snap,
        )
      }
      // Without encryption key the plugin skips the accept stanza — peer keeps ringing
      if (!resolved.encryptionKey) {
        log.error({ callId: resolved.callId }, 'accept — missing encryptionKey')
        throw badRequest(
          'call encryption key missing (offer decrypt failed) — cannot complete accept; hang up and retry',
          snap,
        )
      }
      try {
        if (clientMediaMode(client) === 'local') client.voip.setExternalAudioMode(resolved.callId, true)
      } catch (err) {
        log.warn({ err, callId: resolved.callId }, 'setExternalAudioMode failed')
      }
      log.info({ callId: resolved.callId, peer: snap.peerJid }, 'accept — kicking off acceptCall')
      // Do not await acceptCall: it blocks on SCTP relay connect (10–60s+).
      // Defer to setImmediate so this HTTP response flushes first even if the
      // sync prelude of acceptCall is heavy (SRTP keying / native).
      const callId = resolved.callId
      setImmediate(() => {
        try {
          const acceptP = client.voip.acceptCall(callId)
          void acceptP
            .then(() => {
              log.info({ callId }, 'acceptCall finished (relays connected)')
            })
            .catch((err: unknown) => {
              log.error({ err, callId }, 'acceptCall background failed')
            })
        } catch (err) {
          log.error({ err, callId }, 'acceptCall threw synchronously')
        }
      })
      // Response shape stays OkSchema ({ ok: true }); softphone uses WS ack for call state.
      return { ok: true as const }
    },
  )

  app.post<CallParams & { Body: z.infer<typeof CallReasonBodySchema> }>(
    scopedInstancePaths('/calls/:callId/reject'),
    {
      schema: {
        tags: ['Calls'],
        summary: 'Reject incoming call',
        description: 'Rejects a ringing inbound call. Optional body `{ "reason": "..." }`.',
        security: [{ apiKey: [] }, { bearerAuth: [] }],
        params: CallParamsSchema,
        body: CallReasonBodyOptionalSchema,
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
      const name = resolveInstanceName(request)
      const client = asVoipClient(manager.requireRegisteredClient(name))
      await client.voip.rejectCall(params.callId)
      return { ok: true as const }
    },
  )

  app.post<CallParams & { Body: z.infer<typeof CallReasonBodySchema> }>(
    scopedInstancePaths('/calls/:callId/end'),
    {
      schema: {
        tags: ['Calls'],
        summary: 'End active call',
        description: 'Hangs up an active/connecting call. Optional body `{ "reason": "..." }`.',
        security: [{ apiKey: [] }, { bearerAuth: [] }],
        params: CallParamsSchema,
        body: CallReasonBodyOptionalSchema,
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
      const name = resolveInstanceName(request)
      const client = asVoipClient(manager.requireRegisteredClient(name))
      await client.voip.endCall(params.callId)
      return { ok: true as const }
    },
  )

  app.post<CallParams & { Body: z.infer<typeof MuteBodySchema> }>(
    scopedInstancePaths('/calls/:callId/mute'),
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
      const name = resolveInstanceName(request)
      const body = request.body
      const client = asVoipClient(manager.requireRegisteredClient(name))
      client.voip.setMute(params.callId, body.muted)
      return { ok: true as const }
    },
  )

  app.get<CallParams>(
    scopedInstancePaths('/calls/:callId/recording'),
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
      const name = resolveInstanceName(request)
      if (!calls || !mediaStorage) throw notFound('recording store unavailable')
      const row = await calls.get(name, params.callId)
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
    scopedInstancePaths('/calls/:callId/stream'),
    {
      websocket: true,
      schema: {
        tags: ['Calls'],
        summary: 'WebSocket live PCM audio stream',
        description:
          '**WebSocket upgrade** for bidirectional live audio (real VoIP).\n\n' +
          '### URL\n' +
          '```\n' +
          'ws(s)://<host>/v1/calls/{callId}/stream?apiKey=<key>\n' +
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
          'Opt-in `?participants=1` requires `VOIP_PARTICIPANT_AUDIO=true` (local only; otherwise close 4409). ' +
          'Every server binary frame then has a 4-byte header: u8 version=1, u8 reserved=0, u16 BE stream id, followed by f32le PCM. ' +
          'Id 0 is the mix; participant ids are announced as JSON `{ op: "stream", streamId, participantJid }` and retired with `stream_end`. ' +
          'Client binary frames remain raw PCM. Without the flag the protocol is unchanged.\n\n' +
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
      const target = callSocketTarget(socket, request)
      if (!target) return
      void attachCallStream({
        ...target,
        socket,
        manager,
        env,
        instanceRepo,
        callRecording,
        participants: (request.query as { participants?: string }).participants === '1',
      })
    },
  )

  app.get(
    scopedInstancePaths('/calls/:callId/video'),
    {
      websocket: true,
      schema: {
        tags: ['Calls'],
        summary: 'WebSocket live H.264 video stream',
        description:
          '**WebSocket upgrade** for bidirectional video on calls with `mediaType: "video"` ' +
          '(start with `isVideo: true`). Audio stays on `.../stream` — open both.\n\n' +
          '### URL\n' +
          '```\n' +
          'ws(s)://<host>/v1/calls/{callId}/video?apiKey=<key>\n' +
          '```\n\n' +
          '### Protocol\n' +
          '1. Server sends JSON text frame:\n' +
          '```json\n' +
          '{ "op": "ready", "callId": "...", "codec": "h264", "format": "annexb", "headerBytes": 12, "mediaType": "video", "videoOff": false }\n' +
          '```\n' +
          '2. Binary frames (both directions): 12-byte header + one H.264 **Annex-B** access unit. ' +
          'Header: `u8 version=1`, `u8 flags` (bit0 = key frame), `u16 BE stream id`, `u64 BE timestamp µs`. ' +
          'Stream id = one remote sender (several on a group call), announced first by ' +
          '`{ "op": "stream", "streamId", "ssrc", "participantJid" }` and retired by `{ "op": "stream_end", "streamId" }` ' +
          '(left the call, switched device). Ids are never reused; the client sends `0`.\n' +
          '3. Client → server: encoded camera frames (Constrained Baseline recommended). The peer cannot ' +
          'request key frames through the API — send an IDR at least every 1 s (~350 kbps; see `pnpm test:call-quality`).\n' +
          '4. Server → client: peer frames; timestamps start at 0. When the socket lags, frames are dropped ' +
          'until the next key frame.\n' +
          '5. State JSON: `{ "op": "state", "state": "active", "isActive": true, "videoOff": false }` ' +
          '(`videoOff` = peer camera off)\n' +
          '6. On end: `{ "op": "ended", "callId": "..." }` then close. Closing this socket does **not** end the call.\n\n' +
          'Opens on audio calls too: they can turn into video mid-call (`.../video/upgrade`).\n\n' +
          'Close codes: `4403` forbidden · `4404` call not found · `4503` instance offline.',
        security: [{ apiKey: [] }, { bearerAuth: [] }],
        params: CallParamsSchema,
        querystring: StreamQuerySchema,
      },
    },
    (socket, request) => {
      const target = callSocketTarget(socket, request)
      if (!target) return
      void attachCallVideoStream({ ...target, socket, manager, env, instanceRepo })
    },
  )
}

/** Parse params + API key for a per-call media socket; closes the socket and returns null on failure. */
function callSocketTarget(
  socket: WebSocket,
  request: FastifyRequest,
): { instanceName: string; callId: string; apiKey: string } | null {
  const params = CallParamsSchema.parse(request.params)
  const q = StreamQuerySchema.parse(request.query)
  const headerKey = typeof request.headers['x-api-key'] === 'string' ? request.headers['x-api-key'] : null
  const apiKey = q.apiKey ?? headerKey
  if (!apiKey) {
    socket.close(4401, 'missing api key')
    return null
  }
  try {
    return { instanceName: resolveInstanceName(request), callId: params.callId, apiKey }
  } catch {
    socket.close(4403, 'forbidden')
    return null
  }
}
