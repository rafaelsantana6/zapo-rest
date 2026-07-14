import type { FastifyPluginAsync } from 'fastify'
import fp from 'fastify-plugin'
import { hasZodFastifySchemaValidationErrors, isResponseSerializationError } from 'fastify-type-provider-zod'
import { ZodError } from 'zod'
import { AppError } from '~/lib/errors'
import { getLogger } from '~/lib/logger'
import { parseWaIqError } from '~/lib/wa-iq-error'

/** Pathname only — strip `?apiKey=` and other query secrets from client-facing errors. */
export function safeRequestPath(url: string | undefined): string {
  if (!url) return ''
  const q = url.indexOf('?')
  return q === -1 ? url : url.slice(0, q)
}

const plugin: FastifyPluginAsync = async (app) => {
  app.setErrorHandler((err, request, reply) => {
    const log = getLogger({ component: 'http', reqId: request.id })

    if (err instanceof AppError) {
      return reply.status(err.statusCode).send({
        error: {
          code: err.code,
          message: err.message,
          details: err.details,
        },
      })
    }

    // @fastify/rate-limit throws Error with statusCode 429 (+ optional code RATE_LIMITED)
    if (err && typeof err === 'object' && 'statusCode' in err && (err as { statusCode?: number }).statusCode === 429) {
      const e = err as unknown as { message?: string; details?: unknown }
      return reply.status(429).send({
        error: {
          code: 'RATE_LIMITED',
          message: e.message || 'Rate limit exceeded',
          details: e.details,
        },
      })
    }

    if (err instanceof ZodError) {
      return reply.status(400).send({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid request',
          details: err.flatten(),
        },
      })
    }

    // Request validation from fastify-type-provider-zod (Zod v4)
    if (hasZodFastifySchemaValidationErrors(err)) {
      return reply.status(400).send({
        error: {
          code: 'VALIDATION_ERROR',
          message: "Request doesn't match the schema",
          details: {
            issues: err.validation,
            method: request.method,
            url: safeRequestPath(request.url),
          },
        },
      })
    }

    if (isResponseSerializationError(err)) {
      log.error({ err }, 'response serialization failed')
      return reply.status(500).send({
        error: {
          code: 'INTERNAL',
          message: "Response doesn't match the schema",
          details: {
            method: err.method,
            url: safeRequestPath(err.url),
          },
        },
      })
    }

    // Fastify / AJV-style validation fallback
    if (err && typeof err === 'object' && 'validation' in err) {
      const message =
        'message' in err && typeof (err as { message?: unknown }).message === 'string'
          ? (err as { message: string }).message
          : 'Validation failed'
      return reply.status(400).send({
        error: {
          code: 'VALIDATION_ERROR',
          message,
          details: (err as { validation?: unknown }).validation,
        },
      })
    }

    // @fastify/multipart / busboy limits (413 / 400) — not opaque Cloudflare 502s
    if (err && typeof err === 'object' && 'code' in err) {
      const e = err as { code?: unknown; message?: unknown }
      const code = String(e.code ?? '')
      const message = typeof e.message === 'string' ? e.message : undefined
      if (
        code === 'FST_REQ_FILE_TOO_LARGE' ||
        code === 'FST_FILES_LIMIT' ||
        code === 'FST_PARTS_LIMIT' ||
        code === 'FST_FIELDS_LIMIT'
      ) {
        return reply.status(413).send({
          error: {
            code: 'PAYLOAD_TOO_LARGE',
            message: message || 'Upload too large',
            details: { code },
          },
        })
      }
      if (code === 'FST_MP_PREMATURE_CLOSE' || code === 'FST_INVALID_MULTIPART_CONTENT_TYPE') {
        return reply.status(400).send({
          error: {
            code: 'BAD_REQUEST',
            message: message || 'Invalid multipart upload',
            details: { code },
          },
        })
      }
    }

    // Map common zapo protocol errors to actionable API responses
    if (err instanceof Error) {
      const msg = err.message
      if (msg.includes('requires registered meJid') || msg.includes('not registered')) {
        return reply.status(503).send({
          error: {
            code: 'NOT_REGISTERED',
            message:
              'WhatsApp session is not registered yet (no meJid). Connect the instance, scan the QR or enter the pairing code, wait until status is "open", then retry.',
            details: { original: msg },
          },
        })
      }

      // WhatsApp IQ stanzas (privacy / missing resource) — not INTERNAL 500s
      const iq = parseWaIqError(err)
      if (iq) {
        if (iq.kind === 'privacy') {
          return reply.status(403).send({
            error: {
              code: 'WA_NOT_AUTHORIZED',
              message: iq.message,
              details: { waCode: iq.code, original: msg },
            },
          })
        }
        if (iq.kind === 'not_found') {
          return reply.status(404).send({
            error: {
              code: 'WA_NOT_FOUND',
              message: iq.message,
              details: { waCode: iq.code, original: msg },
            },
          })
        }
        if (iq.kind === 'unavailable') {
          return reply.status(503).send({
            error: {
              code: 'WA_UNAVAILABLE',
              message: iq.message,
              details: { waCode: iq.code, original: msg },
            },
          })
        }
        // unknown iq failure — still client-facing, not a crash
        log.warn({ err }, 'whatsapp iq failed')
        return reply.status(502).send({
          error: {
            code: 'WA_IQ_FAILED',
            message: iq.message,
            details: { waCode: iq.code },
          },
        })
      }
    }

    const statusCode =
      err && typeof err === 'object' && 'statusCode' in err && typeof err.statusCode === 'number' ? err.statusCode : 500

    // 5xx: never echo the internal error message to the client — it can leak
    // stack details, SQL, or config. Keep the specifics in the structured log only.
    if (statusCode >= 500) {
      log.error({ err }, 'unhandled error')
      return reply.status(statusCode).send({
        error: {
          code: 'INTERNAL',
          message: 'Internal Server Error',
        },
      })
    }

    return reply.status(statusCode).send({
      error: {
        code: 'ERROR',
        message: (err as Error).message,
      },
    })
  })
}

export const errorHandlerPlugin = fp(plugin, { name: 'error-handler' })
