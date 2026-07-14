/**
 * Resolve media for JSON or multipart POST/PUT.
 *
 * JSON: `mediaUrl` and/or `mediaBase64` (+ optional mimetype/fileName).
 * Multipart: field `file` (or `media` / `audio` / …) + text fields matching JSON body keys.
 *
 * Size cap: env `MEDIA_UPLOAD_MAX_BYTES` (default 100 MiB).
 *
 * Use `mediaPreValidation(env)` on routes that declare a Zod `body` schema so multipart
 * fields are attached to `request.body` before validation (stream is consumed once).
 */

import type { FastifyRequest, preValidationHookHandler } from 'fastify'
import { badRequest } from '~/lib/errors'
import { type MediaSizeEnv, type ResolvedMedia, resolveMediaToFile, saveUploadStreamToFile } from '~/media/fetch'

declare module 'fastify' {
  interface FastifyRequest {
    /** Set by mediaPreValidation when the request was multipart. */
    resolvedMedia?: ResolvedMedia | null
    /** True after mediaPreValidation ran for this request. */
    mediaRequestParsed?: boolean
  }
}

export type ParsedMediaRequest<TFields extends Record<string, unknown> = Record<string, unknown>> = {
  fields: TFields
  media: ResolvedMedia | null
}

function coerceFieldValue(value: unknown): unknown {
  if (typeof value !== 'string') return value
  const v = value.trim()
  if (v === 'true') return true
  if (v === 'false') return false
  if (v === 'null') return null
  // Only short numeric form fields (timeouts, flags) — never coerce phone JIDs / long ids
  if (/^-?\d+(\.\d+)?$/.test(v) && v.length <= 10) {
    const n = Number(v)
    if (Number.isFinite(n)) return n
  }
  if ((v.startsWith('[') && v.endsWith(']')) || (v.startsWith('{') && v.endsWith('}'))) {
    try {
      return JSON.parse(v) as unknown
    } catch {
      return value
    }
  }
  return value
}

function isMultipartRequest(request: FastifyRequest): boolean {
  return typeof request.isMultipart === 'function' && request.isMultipart()
}

/**
 * preValidation hook: for multipart, parse once into `request.body` + `request.resolvedMedia`.
 * JSON requests are left untouched (handler resolves media from body).
 */
export function mediaPreValidation(env: MediaSizeEnv): preValidationHookHandler {
  return async (request) => {
    if (!isMultipartRequest(request)) return
    const { fields, media } = await parseMultipart(request, env, env.MEDIA_UPLOAD_MAX_BYTES)
    request.body = fields
    request.resolvedMedia = media
    request.mediaRequestParsed = true
  }
}

/**
 * Parse JSON body or multipart form into fields + optional resolved media file.
 * Prefer this in handlers (works with or without mediaPreValidation).
 */
export async function parseMediaRequest(
  request: FastifyRequest,
  env: MediaSizeEnv,
  opts?: { maxBytes?: number },
): Promise<ParsedMediaRequest> {
  if (request.mediaRequestParsed) {
    return {
      fields: (request.body ?? {}) as Record<string, unknown>,
      media: request.resolvedMedia ?? null,
    }
  }

  if (isMultipartRequest(request)) {
    const limit = opts?.maxBytes ?? env.MEDIA_UPLOAD_MAX_BYTES
    return parseMultipart(request, env, limit)
  }

  const body = (request.body ?? {}) as Record<string, unknown>
  const fields = { ...body }
  let media: ResolvedMedia | null = null
  if (typeof body.mediaUrl === 'string' || typeof body.mediaBase64 === 'string') {
    media = await resolveMediaToFile(
      {
        mediaUrl: typeof body.mediaUrl === 'string' ? body.mediaUrl : undefined,
        mediaBase64: typeof body.mediaBase64 === 'string' ? body.mediaBase64 : undefined,
        mimetype: typeof body.mimetype === 'string' ? body.mimetype : undefined,
        fileName: typeof body.fileName === 'string' ? body.fileName : undefined,
      },
      env,
    )
  }
  return { fields, media }
}

/**
 * Like parseMediaRequest but requires a media payload (url, base64, or file).
 */
export async function requireMediaFromRequest(
  request: FastifyRequest,
  env: MediaSizeEnv,
  opts?: { maxBytes?: number },
): Promise<ParsedMediaRequest & { media: ResolvedMedia }> {
  const parsed = await parseMediaRequest(request, env, opts)
  if (!parsed.media) {
    throw badRequest('mediaUrl, mediaBase64, or multipart file field is required')
  }
  return parsed as ParsedMediaRequest & { media: ResolvedMedia }
}

async function parseMultipart(request: FastifyRequest, env: MediaSizeEnv, limit: number): Promise<ParsedMediaRequest> {
  const fields: Record<string, unknown> = {}
  let media: ResolvedMedia | null = null

  try {
    const parts = request.parts({ limits: { fileSize: limit, files: 1, fields: 40 } })
    for await (const part of parts) {
      if (part.type === 'file') {
        if (media) {
          part.file.resume()
          throw badRequest('only one media file is allowed per request')
        }
        const filename = part.filename || undefined
        const mimetype = part.mimetype || undefined
        try {
          media = await saveUploadStreamToFile(part.file, {
            env,
            mimetype,
            fileName: filename,
            maxBytes: limit,
          })
        } catch (err) {
          if (part.file.truncated) {
            throw badRequest(`multipart file too large: exceeds limit ${limit} bytes`)
          }
          throw err
        }
        if (part.file.truncated) {
          await media.cleanup()
          media = null
          throw badRequest(`multipart file too large: exceeds limit ${limit} bytes`)
        }
        if (filename && media) media = { ...media, fileName: filename }
        if (mimetype && media) media = { ...media, mimetype }
      } else {
        fields[part.fieldname] = coerceFieldValue(part.value)
      }
    }
  } catch (err) {
    if (media) await media.cleanup().catch(() => undefined)
    if (err && typeof err === 'object' && 'code' in err) {
      const code = String((err as { code?: string }).code ?? '')
      if (
        code === 'FST_REQ_FILE_TOO_LARGE' ||
        code.includes('LIMIT') ||
        code.includes('FILE_TOO_LARGE') ||
        code === 'FST_FILES_LIMIT'
      ) {
        throw badRequest(`multipart file too large: exceeds limit ${limit} bytes`)
      }
    }
    throw err
  }

  if (media) {
    if (typeof fields.mimetype === 'string' && fields.mimetype) {
      media = { ...media, mimetype: fields.mimetype }
    }
    if (typeof fields.fileName === 'string' && fields.fileName) {
      media = { ...media, fileName: fields.fileName }
    }
  }

  // Multipart form may still carry mediaUrl/mediaBase64 without a file part
  if (!media && (typeof fields.mediaUrl === 'string' || typeof fields.mediaBase64 === 'string')) {
    media = await resolveMediaToFile(
      {
        mediaUrl: typeof fields.mediaUrl === 'string' ? fields.mediaUrl : undefined,
        mediaBase64: typeof fields.mediaBase64 === 'string' ? fields.mediaBase64 : undefined,
        mimetype: typeof fields.mimetype === 'string' ? fields.mimetype : undefined,
        fileName: typeof fields.fileName === 'string' ? fields.fileName : undefined,
      },
      env,
    )
  }

  return { fields, media }
}
