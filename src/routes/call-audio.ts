import { requireLocalMedia } from '~/voip/media-mode'
import type { FastifyPluginAsync } from 'fastify'
import type { z } from 'zod'
import { resolveInstanceName, scopedInstancePaths } from '~/auth/plugin'
import type { Env } from '~/config/env'
import { CallAudioBodySchema, CallParamsSchema, ErrorBodySchema, OkSchema } from '~/http/openapi-schemas'
import type { InstanceManager } from '~/instances/manager'
import { asVoipClient } from '~/instances/wa-client'
import { badRequest, conflict, notFound, serviceUnavailable } from '~/lib/errors'
import { mediaPreValidation, requireMediaFromRequest } from '~/media/request-media'
import { resolveLiveCall } from '~/voip/call-serialize'

export const callAudioRoutes: FastifyPluginAsync<{ manager: InstanceManager; env: Env }> = async (
  app,
  { manager, env },
) => {
  app.post<{ Params: z.infer<typeof CallParamsSchema>; Body: z.infer<typeof CallAudioBodySchema> }>(
    scopedInstancePaths('/calls/:callId/audio'),
    {
      preValidation: mediaPreValidation(env),
      // The shared multipart hook may create a file before schema validation fails.
      onResponse: async (request) => {
        await request.resolvedMedia?.cleanup()
      },
      schema: {
        tags: ['Calls'],
        summary: 'Play an audio file into a live call',
        description:
          'Accepts mediaUrl / mediaBase64 or multipart file (same inputs as message media). ' +
          'Requires ffmpeg on PATH (503 if missing). Disables external PCM audio mode before decoding (also on decode failure); ' +
          'stop the softphone microphone stream first. Opening /stream again switches back to external audio. ' +
          'Returns once decoded and queued, not when playback ends (call.audio_finished). ' +
          'Temporary files are removed after decoding or on error. Remote media mode returns 409.',
        security: [{ apiKey: [] }, { bearerAuth: [] }],
        params: CallParamsSchema,
        body: CallAudioBodySchema,
        response: {
          200: OkSchema,
          400: ErrorBodySchema,
          401: ErrorBodySchema,
          403: ErrorBodySchema,
          404: ErrorBodySchema,
          409: ErrorBodySchema,
          503: ErrorBodySchema,
        },
      },
    },
    async (request) => {
      const client = asVoipClient(manager.requireRegisteredClient(resolveInstanceName(request)))
      requireLocalMedia(client, 'loadAudio')
      const call = resolveLiveCall(client, request.params.callId)
      if (!call) throw notFound(`call ${request.params.callId} not found`)
      if (call.isEnded || call.stateData?.state === 'ended') throw conflict(`call ${call.callId} has ended`)
      const { media } = await requireMediaFromRequest(request, env)
      try {
        // Upstream clears the live ring on this transition, so switch BEFORE loading.
        client.voip.setExternalAudioMode(call.callId, false)
        await client.voip.loadAudio(call.callId, media.path)
        return { ok: true as const }
      } catch (err) {
        const message = err instanceof Error ? err.message : ''
        // Upstream probes ffmpeg itself; audio-blast only decodes WAV and has no ffmpeg probe.
        if (/ffmpeg (not found|not available)/i.test(message) || /spawn ffmpeg ENOENT/i.test(message)) {
          throw serviceUnavailable('ffmpeg not found on PATH; install ffmpeg to load call audio')
        }
        if (/no call with id/i.test(message)) throw notFound(`call ${call.callId} not found`)
        throw badRequest('Could not decode or load call audio; verify the audio file and call state')
      } finally {
        await media.cleanup()
      }
    },
  )
}
