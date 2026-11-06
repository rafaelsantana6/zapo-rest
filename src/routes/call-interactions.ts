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
} from '~/http/openapi-schemas'
import type { InstanceManager } from '~/instances/manager'
import { asVoipClient } from '~/instances/wa-client'
import { conflict, notFound, serviceUnavailable } from '~/lib/errors'
import { sendCallReaction, setCallHand } from '~/voip/call-interactions'
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
    throw conflict(err instanceof Error ? err.message : String(err))
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
}
