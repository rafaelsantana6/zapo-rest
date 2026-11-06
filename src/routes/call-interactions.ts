import type { FastifyPluginAsync } from 'fastify'
import type { z } from 'zod'
import { resolveInstanceName, scopedInstancePaths } from '~/auth/plugin'
import {
  CallParamsSchema,
  CallReactionBodySchema,
  ErrorBodySchema,
  HandBodySchema,
  OkSchema,
  ParticipantMuteBodySchema,
  ScreenShareBodySchema,
  VideoEnabledBodySchema,
  VideoUpgradeResponseSchema,
} from '~/http/openapi-schemas'
import type { InstanceManager } from '~/instances/manager'
import { asVoipClient } from '~/instances/wa-client'
import { conflict, notFound, serviceUnavailable } from '~/lib/errors'
import { sendCallReaction, setCallHand } from '~/voip/call-interactions'
import {
  answerVideoUpgrade,
  requestVideoUpgrade,
  setGroupVideo,
  setScreenShare,
  type UpgradeAnswer,
} from '~/voip/call-video-controls'
import { joinGroupCall, leaveGroupCall, requestParticipantMute } from '~/voip/group-call'

export type CallInteractionRoutesDeps = {
  manager: InstanceManager
}

type CallParams = { Params: z.infer<typeof CallParamsSchema> }

const ERRORS = {
  400: ErrorBodySchema,
  401: ErrorBodySchema,
  403: ErrorBodySchema,
  404: ErrorBodySchema,
  503: ErrorBodySchema,
}

/**
 * Raise hand + emoji reactions on a live call, plus group-call leave / join / participant mute.
 * Peer side arrives as `call.hand_raise` / `call.reaction` / `call.participants_changed`.
 */
export const callInteractionRoutes: FastifyPluginAsync<CallInteractionRoutesDeps> = async (app, deps) => {
  const { manager } = deps

  app.post<CallParams & { Body: z.infer<typeof HandBodySchema> }>(
    scopedInstancePaths('/calls/:callId/hand'),
    {
      schema: {
        tags: ['Calls'],
        summary: 'Raise / lower hand',
        description:
          'Raises or lowers the local hand and announces it to the peer. Durable: the peer keeps ' +
          'seeing it until lowered. Inactive calls are a no-op.\n\n```json\n{ "raised": true }\n```',
        security: [{ apiKey: [] }, { bearerAuth: [] }],
        params: CallParamsSchema,
        body: HandBodySchema,
        response: { 200: OkSchema, ...ERRORS },
      },
    },
    async (request) => {
      const client = asVoipClient(manager.requireRegisteredClient(resolveInstanceName(request)))
      // Upstream throws when the call ends mid-request or the stanza fails to send.
      const callId = await setCallHand(client, request.params.callId, request.body.raised).catch((err: unknown) => {
        throw serviceUnavailable(`hand announcement failed: ${err instanceof Error ? err.message : String(err)}`)
      })
      if (!callId) throw notFound(`call ${request.params.callId} not found`)
      return { ok: true as const }
    },
  )

  app.post<CallParams & { Body: z.infer<typeof CallReactionBodySchema> }>(
    scopedInstancePaths('/calls/:callId/reaction'),
    {
      schema: {
        tags: ['Calls'],
        summary: 'Send in-call emoji reaction',
        description:
          'Sends an emoji reaction during a live call. Momentary: nothing is stored on the call. ' +
          '`409` when the call is not active yet or its app-data stream is not open.\n\n' +
          '```json\n{ "reaction": "👍" }\n```',
        security: [{ apiKey: [] }, { bearerAuth: [] }],
        params: CallParamsSchema,
        body: CallReactionBodySchema,
        response: { 200: OkSchema, 409: ErrorBodySchema, ...ERRORS },
      },
    },
    async (request) => {
      const client = asVoipClient(manager.requireRegisteredClient(resolveInstanceName(request)))
      const result = sendCallReaction(client, request.params.callId, request.body.reaction)
      if (!result) throw notFound(`call ${request.params.callId} not found`)
      if (!result.sent) throw conflict(`call ${result.callId} is not active or its reaction channel is not open yet`)
      return { ok: true as const }
    },
  )

  /** Upstream throws for a non-group call or a failed send; both are the caller's state, not ours. */
  const asConflict = (err: unknown) => {
    const message = err instanceof Error ? err.message : String(err)
    // The call ended between our lookup and the upstream call
    if (/^no call with id /i.test(message)) throw notFound(message)
    throw conflict(message)
  }

  app.post<CallParams>(
    scopedInstancePaths('/calls/:callId/leave'),
    {
      schema: {
        tags: ['Calls'],
        summary: 'Leave group call',
        description:
          'Leaves a group call; the others stay on it and it can be rejoined with `join`. ' +
          '`409` on a 1:1 call (use `end`).',
        security: [{ apiKey: [] }, { bearerAuth: [] }],
        params: CallParamsSchema,
        response: { 200: OkSchema, 409: ErrorBodySchema, ...ERRORS },
      },
    },
    async (request) => {
      const client = asVoipClient(manager.requireRegisteredClient(resolveInstanceName(request)))
      const callId = await leaveGroupCall(client, request.params.callId).catch(asConflict)
      if (!callId) throw notFound(`call ${request.params.callId} not found`)
      return { ok: true as const }
    },
  )

  app.post<CallParams>(
    scopedInstancePaths('/calls/:callId/join'),
    {
      schema: {
        tags: ['Calls'],
        summary: 'Join group call',
        description:
          'Joins a group call going on without this side (missed ring, or left earlier). ' +
          '`409` when the call is not joinable, already joined, or the join fails.',
        security: [{ apiKey: [] }, { bearerAuth: [] }],
        params: CallParamsSchema,
        response: { 200: OkSchema, 409: ErrorBodySchema, ...ERRORS },
      },
    },
    async (request) => {
      const client = asVoipClient(manager.requireRegisteredClient(resolveInstanceName(request)))
      await joinGroupCall(client, request.params.callId).catch(asConflict)
      return { ok: true as const }
    },
  )

  app.post<CallParams & { Body: z.infer<typeof ParticipantMuteBodySchema> }>(
    scopedInstancePaths('/calls/:callId/participants/mute'),
    {
      schema: {
        tags: ['Calls'],
        summary: 'Ask a group participant to mute',
        description:
          'Asks one participant of a group call to mute. Nothing is forced: their client decides. ' +
          'The other side receives it as `call.mute_requested`.\n\n```json\n{ "participant": "123456789012345@lid" }\n```',
        security: [{ apiKey: [] }, { bearerAuth: [] }],
        params: CallParamsSchema,
        body: ParticipantMuteBodySchema,
        response: { 200: OkSchema, 409: ErrorBodySchema, ...ERRORS },
      },
    },
    async (request) => {
      const client = asVoipClient(manager.requireRegisteredClient(resolveInstanceName(request)))
      const callId = await requestParticipantMute(client, request.params.callId, request.body.participant).catch(
        asConflict,
      )
      if (!callId) throw notFound(`call ${request.params.callId} not found`)
      return { ok: true as const }
    },
  )

  app.post<CallParams>(
    scopedInstancePaths('/calls/:callId/video/upgrade'),
    {
      schema: {
        tags: ['Calls'],
        summary: 'Upgrade audio call to video',
        description:
          'Turns an audio call into video. **1:1:** a handshake — waits for the peer (about 5 s) and returns ' +
          'its `result`; send frames on `.../video` only after `accepted`. **Group:** asks the server to make the ' +
          'whole call video; everyone gets `call.video_upgraded` and each turns its own camera on. `409` when ' +
          'the call cannot be upgraded.',
        security: [{ apiKey: [] }, { bearerAuth: [] }],
        params: CallParamsSchema,
        response: { 200: VideoUpgradeResponseSchema, 409: ErrorBodySchema, ...ERRORS },
      },
    },
    async (request) => {
      const client = asVoipClient(manager.requireRegisteredClient(resolveInstanceName(request)))
      const res = await requestVideoUpgrade(client, request.params.callId).catch(asConflict)
      if (!res) throw notFound(`call ${request.params.callId} not found`)
      return { ok: true as const, result: res.result }
    },
  )

  const ANSWER_DOCS: Record<UpgradeAnswer, { summary: string; description: string }> = {
    accept: {
      summary: 'Accept a video upgrade',
      description:
        "Accepts the peer's request to turn the call into video (`call.video_state` with " +
        '`upgradeRequested: true`). Answer within about 5 s, then send camera frames on `.../video`.',
    },
    reject: {
      summary: 'Reject a video upgrade',
      description: "Rejects the peer's request to turn the call into video. Answer within about 5 s.",
    },
    cancel: {
      summary: 'Cancel our video upgrade',
      description:
        'Withdraws an upgrade request this side sent before the peer answers; the pending request resolves `cancelled`.',
    },
  }

  for (const answer of ['accept', 'reject', 'cancel'] as const) {
    app.post<CallParams>(
      scopedInstancePaths(`/calls/:callId/video/upgrade/${answer}`),
      {
        schema: {
          tags: ['Calls'],
          ...ANSWER_DOCS[answer],
          security: [{ apiKey: [] }, { bearerAuth: [] }],
          params: CallParamsSchema,
          response: { 200: OkSchema, 409: ErrorBodySchema, ...ERRORS },
        },
      },
      async (request) => {
        const client = asVoipClient(manager.requireRegisteredClient(resolveInstanceName(request)))
        const callId = await answerVideoUpgrade(client, request.params.callId, answer).catch(asConflict)
        if (!callId) throw notFound(`call ${request.params.callId} not found`)
        return { ok: true as const }
      },
    )
  }

  app.post<CallParams & { Body: z.infer<typeof VideoEnabledBodySchema> }>(
    scopedInstancePaths('/calls/:callId/video'),
    {
      schema: {
        tags: ['Calls'],
        summary: 'Turn the camera on / off (group call)',
        description:
          'Group calls only: turns our camera on or off. On a 1:1 call video starts with `video/upgrade` ' +
          '(`409` here).\n\n```json\n{ "enabled": true }\n```',
        security: [{ apiKey: [] }, { bearerAuth: [] }],
        params: CallParamsSchema,
        body: VideoEnabledBodySchema,
        response: { 200: OkSchema, 409: ErrorBodySchema, ...ERRORS },
      },
    },
    async (request) => {
      const client = asVoipClient(manager.requireRegisteredClient(resolveInstanceName(request)))
      const callId = await setGroupVideo(client, request.params.callId, request.body.enabled).catch(asConflict)
      if (!callId) throw notFound(`call ${request.params.callId} not found`)
      return { ok: true as const }
    },
  )

  app.post<CallParams & { Body: z.infer<typeof ScreenShareBodySchema> }>(
    scopedInstancePaths('/calls/:callId/screen-share'),
    {
      schema: {
        tags: ['Calls'],
        summary: 'Start / stop screen share',
        description:
          'Announces a screen share. The screen replaces the camera on the same video stream: stop sending ' +
          'camera frames on `.../video`, send the screen frames, and resume the camera after stopping. `409` on a ' +
          'call with no video yet (upgrade it, or turn the group camera on, first).\n\n```json\n{ "sharing": true }\n```',
        security: [{ apiKey: [] }, { bearerAuth: [] }],
        params: CallParamsSchema,
        body: ScreenShareBodySchema,
        response: { 200: OkSchema, 409: ErrorBodySchema, ...ERRORS },
      },
    },
    async (request) => {
      const client = asVoipClient(manager.requireRegisteredClient(resolveInstanceName(request)))
      const callId = await setScreenShare(client, request.params.callId, request.body.sharing).catch(asConflict)
      if (!callId) throw notFound(`call ${request.params.callId} not found`)
      return { ok: true as const }
    },
  )
}
