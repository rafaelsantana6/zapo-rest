import type { FastifyPluginAsync } from 'fastify'
import type { z } from 'zod'
import { resolveInstanceName, scopedInstancePaths } from '~/auth/plugin'
import type { Env } from '~/config/env'
import {
  BlastBodySchema,
  BlastResponseSchema,
  CallParamsSchema,
  ErrorBodySchema,
  type InstanceNameParams,
  TranscribeResponseSchema,
} from '~/http/openapi-schemas'
import type { InstanceManager } from '~/instances/manager'
import type { InstanceRepo } from '~/instances/repo'
import { badRequest, notFound, serviceUnavailable } from '~/lib/errors'
import { mediaPreValidation, parseMediaRequest } from '~/media/request-media'
import type { MediaStorage } from '~/media/storage'
import type { CacheClient } from '~/redis/client'
import type { CallStore } from '~/store/calls'
import { executeAudioBlast } from '~/voip/audio-blast'
import { transcribeAudio } from '~/voip/audio-transcribe'

export type BlastRoutesDeps = {
  manager: InstanceManager
  env: Env
  instanceRepo: InstanceRepo
  mediaStorage?: MediaStorage
  cache?: CacheClient
  calls?: CallStore
}

type InstanceParams = { Params: z.infer<typeof InstanceNameParams> }
type CallParams = { Params: z.infer<typeof CallParamsSchema> }

export const blastRoutes: FastifyPluginAsync<BlastRoutesDeps> = async (app, deps) => {
  const { manager, mediaStorage, cache, env, calls } = deps

  app.post<InstanceParams & { Body: z.infer<typeof BlastBodySchema> }>(
    scopedInstancePaths('/calls/blast'),
    {
      preValidation: mediaPreValidation(env),
      schema: {
        tags: ['Calls'],
        summary: 'Audio blast — call + play predefined audio + record response',
        description:
          'Outbound VoIP **audio blast**: dial → wait for answer → play WAV → optional remote-leg record + Whisper STT.\n\n' +
          '### Audio\n' +
          '- **WAV only** (PCM 8/16/24/32-bit or float32). Any rate/channels → resampled to **16 kHz mono**.\n' +
          '- Provide **one** of: `audioUrl` (HTTPS, SSRF-guarded), `mediaBase64`, or multipart field `file` / `audio`.\n' +
          '- Size caps: blast WAV download limit (~20 MiB) and env `MEDIA_UPLOAD_MAX_BYTES` for uploads.\n\n' +
          '### Recording & STT\n' +
          '- With `recordResponse` (default true) the remote PCM is stored and linked on the call row — ' +
          '`GET .../calls/{callId}/recording` and `POST .../transcribe` work afterwards.\n' +
          '- Transcription runs when `transcribe` is not false **and** `STT_ENABLED` + `STT_API_URL` + `STT_API_KEY` are set ' +
          '(Groq Whisper recommended).\n\n' +
          '### Timeouts\n' +
          'The HTTP request stays open until the blast finishes. Raise your client timeout for long WAVs ' +
          '(`callTimeoutMs` + audio duration + `responseTimeoutMs`).\n\n' +
          '**Example**\n' +
          '```bash\n' +
          'curl -s -X POST "$BASE/v1/instances/sales-1/calls/blast" \\\n' +
          '  -H "X-Api-Key: $KEY" -H "content-type: application/json" \\\n' +
          '  -d \'{"to":"5511999999999","audioUrl":"https://cdn.example.com/prompt.wav",' +
          '"responseTimeoutMs":5000,"recordResponse":true,"transcribe":true,"sttLanguage":"pt"}\'\n' +
          '```',
        security: [{ apiKey: [] }, { bearerAuth: [] }],
        body: BlastBodySchema,
        response: {
          200: BlastResponseSchema,
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
      const { media } = await parseMediaRequest(request, env)
      const audioUrl = typeof body.audioUrl === 'string' ? body.audioUrl : undefined
      if (!media && !audioUrl) {
        throw badRequest('audioUrl, mediaBase64, or multipart file is required')
      }

      try {
        const result = await executeAudioBlast({
          manager,
          instanceName: name,
          to: body.to,
          // Prefer resolved local file (multipart / mediaBase64); else remote audioUrl
          audioUrl: media ? undefined : audioUrl,
          audioPath: media?.path,
          responseTimeoutMs: body.responseTimeoutMs ?? 5000,
          callTimeoutMs: body.callTimeoutMs ?? 30000,
          recordResponse: body.recordResponse ?? true,
          maxCaptureSeconds: env.CALL_RECORDING_MAX_SECONDS,
          mediaStorage,
          cache,
          calls,
          stt:
            body.transcribe !== false && env.STT_ENABLED && env.STT_API_URL && env.STT_API_KEY
              ? {
                  enabled: true,
                  apiUrl: env.STT_API_URL,
                  apiKey: env.STT_API_KEY,
                  model: env.STT_MODEL,
                  temperature: env.STT_TEMPERATURE,
                  language: body.sttLanguage ?? env.STT_LANGUAGE,
                }
              : undefined,
        })
        return result
      } finally {
        if (media) await media.cleanup()
      }
    },
  )

  app.post<CallParams>(
    scopedInstancePaths('/calls/:callId/transcribe'),
    {
      schema: {
        tags: ['Calls'],
        summary: 'Transcribe a call recording (STT via Groq / OpenAI-compatible)',
        description:
          'Runs speech-to-text on a **stored call recording** (`recordingStatus=ready`) via a Groq/OpenAI-compatible API.\n\n' +
          '### Env\n' +
          '| Var | Role |\n| --- | --- |\n' +
          '| `STT_ENABLED` | must be `true` |\n' +
          '| `STT_API_URL` | base URL, e.g. `https://api.groq.com/openai` |\n' +
          '| `STT_API_KEY` | Bearer token |\n' +
          '| `STT_MODEL` | default `whisper-large-v3` |\n' +
          '| `STT_LANGUAGE` | optional ISO 639-1 hint |\n\n' +
          'Recordings come from **audio blast** (`POST .../calls/blast`) or softphone call-recording.\n\n' +
          '**Example**\n' +
          '```bash\n' +
          'curl -s -X POST "$BASE/v1/instances/sales-1/calls/$CALL_ID/transcribe" \\\n' +
          '  -H "X-Api-Key: $KEY"\n' +
          '```',
        security: [{ apiKey: [] }, { bearerAuth: [] }],
        params: CallParamsSchema,
        response: {
          200: TranscribeResponseSchema,
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

      if (!env.STT_ENABLED || !env.STT_API_URL || !env.STT_API_KEY) {
        throw serviceUnavailable('STT not configured — set STT_ENABLED=true, STT_API_URL, and STT_API_KEY')
      }

      if (!calls || !mediaStorage) {
        throw serviceUnavailable('call store or media storage unavailable')
      }

      const row = await calls.get(name, params.callId)
      if (!row) {
        throw notFound(`call ${params.callId} not found`)
      }

      if (row.recordingStatus !== 'ready' || !row.recordingStorageKey) {
        throw badRequest('no recording available for this call')
      }

      const stream = await mediaStorage.getStream(row.recordingStorageKey)
      const chunks: Buffer[] = []
      for await (const chunk of stream) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
      }
      const audioBytes = Buffer.concat(chunks)

      const result = await transcribeAudio({
        apiUrl: env.STT_API_URL,
        apiKey: env.STT_API_KEY,
        model: env.STT_MODEL,
        temperature: env.STT_TEMPERATURE,
        language: env.STT_LANGUAGE,
        audioBytes,
        filename: `call-${params.callId}.wav`,
      })

      return {
        text: result.text,
        language: result.language ?? null,
        durationSecs: result.durationSecs ?? null,
        callId: params.callId,
      }
    },
  )
}
