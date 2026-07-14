import { getLogger } from '~/lib/logger'

const log = getLogger({ component: 'audio-transcribe' })

export type TranscribeOpts = {
  apiUrl: string
  apiKey: string
  model?: string
  temperature?: number
  language?: string
  audioBytes: Buffer
  filename?: string
}

export type TranscribeResult = {
  text: string
  language?: string
  durationSecs?: number
}

export async function transcribeAudio(opts: TranscribeOpts): Promise<TranscribeResult> {
  const { apiUrl, apiKey, model = 'whisper-large-v3', temperature = 0.5, language, audioBytes, filename } = opts

  const form = new FormData()
  const audioData = new Uint8Array(audioBytes)
  const blob = new Blob([audioData], { type: 'audio/wav' })
  form.append('file', blob, filename ?? 'audio.wav')
  form.append('model', model)
  form.append('temperature', String(temperature))
  form.append('response_format', 'json')
  if (language) form.append('language', language)

  const url = apiUrl.endsWith('/') ? `${apiUrl}v1/audio/transcriptions` : `${apiUrl}/v1/audio/transcriptions`

  log.debug({ url, bytes: audioBytes.length, model, language }, 'sending audio for transcription')

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
    body: form,
  })

  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`STT API returned ${res.status}: ${body.slice(0, 200)}`)
  }

  const json = (await res.json()) as {
    text?: string
    language?: string
    duration?: number
  }

  return {
    text: json.text ?? '',
    language: json.language ?? language,
    durationSecs: json.duration,
  }
}
