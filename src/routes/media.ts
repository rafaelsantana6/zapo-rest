import type { FastifyPluginAsync, FastifyReply } from 'fastify'
import { z } from 'zod'
import { requireInstanceAccess, resolveInstanceName, scopedInstancePaths } from '~/auth/plugin'
import type { Env } from '~/config/env'
import { ErrorBodySchema } from '~/http/openapi-schemas'
import type { InstanceManager } from '~/instances/manager'
import { badRequest, notFound } from '~/lib/errors'
import { getLogger } from '~/lib/logger'
import { contentDisposition, resolveDownloadFilename } from '~/media/filename'
import { prepareMediaDownloadSource } from '~/media/revive-raw'
import type { MediaStorage } from '~/media/storage'
import type { AppMessage, MessageStore } from '~/store/messages'

export type MediaRoutesDeps = {
  manager: InstanceManager
  mediaStorage: MediaStorage
  messages?: MessageStore
  env: Env
}

type EnsuredMedia = {
  storageKey: string
  mime: string | null
  fileName: string
  mediaFilename: string | null
  source: 'storage' | 'rehydrated'
  /** Resolved message row (reused by callers so they don't re-`get` it). */
  message: AppMessage
  /** Bytes only when rehydrated (avoid re-reading storage when we already have them). */
  bytes?: Buffer
}

export const mediaRoutes: FastifyPluginAsync<MediaRoutesDeps> = async (app, deps) => {
  const { mediaStorage, messages, manager } = deps
  const log = getLogger({ component: 'media-routes' })

  /**
   * Ensure bytes exist in object storage for this message.
   * If the CAS object was deleted, re-download from WhatsApp (msg.raw), store again, update row.
   * Only throws when storage is empty AND WhatsApp cannot provide the media.
   */
  async function ensureStoredMedia(instanceName: string, messageId: string, rawHint?: unknown): Promise<EnsuredMedia> {
    if (!messages) throw notFound('messages store unavailable')
    const msg = await messages.get(instanceName, messageId)
    if (!msg) throw notFound('media message not found')
    if (!msg.hasMedia && !msg.raw && !rawHint) throw notFound('media message not found')

    const fileName = resolveDownloadFilename({
      mediaFilename: msg.mediaFilename,
      mimeType: msg.mediaMime,
      messageType: msg.type,
      messageId,
    })

    // 1) Prefer existing CAS object when present on disk/S3
    if (msg.mediaStorageKey && (await mediaStorage.exists(msg.mediaStorageKey))) {
      return {
        storageKey: msg.mediaStorageKey,
        mime: msg.mediaMime,
        fileName,
        mediaFilename: msg.mediaFilename,
        source: 'storage',
        message: msg,
      }
    }

    if (msg.mediaStorageKey) {
      log.warn(
        { instanceName, messageId, storageKey: msg.mediaStorageKey },
        'media missing from storage — rehydrating from WhatsApp',
      )
    }

    // 2) Rehydrate from WhatsApp stanza (raw) and put back into CAS
    return rehydrateFromWhatsApp(instanceName, messageId, msg, fileName, rawHint)
  }

  async function rehydrateFromWhatsApp(
    instanceName: string,
    messageId: string,
    msg: AppMessage,
    fileName: string,
    rawHint?: unknown,
  ): Promise<EnsuredMedia> {
    if (!messages) throw notFound('messages store unavailable')
    try {
      const client = manager.requireRegisteredClient(instanceName)
      const raw = msg.raw ?? rawHint
      if (!raw) throw notFound(`no raw message payload to rehydrate media for message ${messageId}`)
      // JSONB round-trip turns mediaKey/hashes into plain objects — revive to Uint8Array
      // and pass the proto `message` (not the full event) so zapo resolveMediaPayload works.
      const downloadSource = prepareMediaDownloadSource(raw)
      const bytes = Buffer.from(await client.message.downloadBytes(downloadSource as never))
      const stored = await mediaStorage.put(instanceName, bytes, {
        mimeType: msg.mediaMime ?? undefined,
        filename: msg.mediaFilename ?? fileName,
        messageId,
      })
      const url =
        stored.url ??
        `/v1/instances/${encodeURIComponent(instanceName)}/messages/${encodeURIComponent(messageId)}/media`
      await messages.setMedia(instanceName, messageId, {
        url,
        storageKey: stored.storageKey,
        mime: stored.mimeType ?? msg.mediaMime,
        filename: msg.mediaFilename ?? fileName,
      })
      log.info(
        { instanceName, messageId, storageKey: stored.storageKey, deduped: stored.deduped },
        'media rehydrated from WhatsApp into storage',
      )
      return {
        storageKey: stored.storageKey,
        mime: stored.mimeType ?? msg.mediaMime,
        fileName: msg.mediaFilename ?? fileName,
        mediaFilename: msg.mediaFilename,
        source: 'rehydrated',
        message: msg,
        bytes,
      }
    } catch (err) {
      log.warn({ err, instanceName, messageId }, 'media rehydrate from WhatsApp failed')
      throw notFound(
        'media not available in storage and could not be re-downloaded from WhatsApp (object deleted and WA download failed)',
      )
    }
  }

  async function deliverMedia(
    reply: FastifyReply,
    ensured: EnsuredMedia,
    opts: { preferRedirect: boolean; download?: boolean; presignTtl: number },
  ) {
    if (opts.preferRedirect && mediaStorage.createDownloadUrl) {
      const direct = await mediaStorage.createDownloadUrl(ensured.storageKey, {
        filename: ensured.fileName,
        mimeType: ensured.mime,
        download: opts.download,
        expiresInSeconds: opts.presignTtl,
      })
      if (direct) {
        reply.header('x-media-storage-key', ensured.storageKey)
        if (ensured.mediaFilename) reply.header('x-media-filename', ensured.mediaFilename)
        reply.header('x-media-delivery', 'redirect')
        reply.header('x-media-source', ensured.source)
        return reply.redirect(direct)
      }
    }

    if (ensured.mime) reply.header('content-type', ensured.mime)
    reply.header('content-disposition', contentDisposition(ensured.fileName, opts.download ? 'attachment' : 'inline'))
    reply.header('x-media-storage-key', ensured.storageKey)
    if (ensured.mediaFilename) reply.header('x-media-filename', ensured.mediaFilename)
    reply.header('x-media-delivery', 'proxy')
    reply.header('x-media-source', ensured.source)
    if (ensured.bytes) return reply.send(ensured.bytes)
    const stream = await mediaStorage.getStream(ensured.storageKey)
    return reply.send(stream)
  }

  async function resolveBase64(instanceName: string, messageId: string, rawHint?: unknown) {
    const ensured = await ensureStoredMedia(instanceName, messageId, rawHint)
    const buf = ensured.bytes ?? (await mediaStorage.getBuffer(ensured.storageKey))
    return {
      mediaType: ensured.message.type,
      fileName: ensured.fileName,
      mimetype: ensured.mime,
      base64: buf.toString('base64'),
      size: buf.byteLength,
      mediaUrl: ensured.message.mediaUrl,
      source: ensured.source,
    }
  }

  app.get(
    scopedInstancePaths('/messages/:messageId/media'),
    {
      schema: {
        tags: ['Media'],
        summary: 'Download media for a message (original filename)',
        description: [
          'Authorizes access, ensures the object exists in storage, then **redirects (302)** to storage',
          'when possible (default) so file bytes do not transit the API.',
          '',
          'If the CAS object was deleted from storage, the API **re-downloads from WhatsApp** (using',
          'the stored message `raw`), re-uploads to storage, then redirects/streams. Only fails if',
          'WhatsApp can no longer provide the media.',
          '',
          '- **S3/MinIO:** presigned GET with original filename (ResponseContentDisposition).',
          '- **`?proxy=1`:** stream through the API (no redirect).',
          '- **`?download=1`:** attachment disposition.',
        ].join('\n'),
        security: [{ apiKey: [] }, { bearerAuth: [] }],
        params: z.object({ messageId: z.string().min(1) }),
        querystring: z.object({
          download: z
            .union([z.boolean(), z.enum(['true', 'false', '1', '0'])])
            .optional()
            .transform((v) => v === true || v === 'true' || v === '1'),
          /** Force streaming through the API (skip storage redirect). */
          proxy: z
            .union([z.boolean(), z.enum(['true', 'false', '1', '0'])])
            .optional()
            .transform((v) => v === true || v === 'true' || v === '1'),
        }),
        response: { 404: ErrorBodySchema },
      },
    },
    async (request, reply) => {
      const params = z.object({ messageId: z.string() }).parse(request.params)
      const q = z
        .object({
          download: z
            .union([z.boolean(), z.enum(['true', 'false', '1', '0'])])
            .optional()
            .transform((v) => v === true || v === 'true' || v === '1'),
          proxy: z
            .union([z.boolean(), z.enum(['true', 'false', '1', '0'])])
            .optional()
            .transform((v) => v === true || v === 'true' || v === '1'),
        })
        .parse(request.query ?? {})
      const name = resolveInstanceName(request)

      const preferRedirect = deps.env.MEDIA_REDIRECT_DOWNLOADS !== false && !q.proxy
      // Ensure object exists (storage hit, or rehydrate from WA if deleted)
      const ensured = await ensureStoredMedia(name, params.messageId)
      return deliverMedia(reply, ensured, {
        preferRedirect,
        download: q.download,
        presignTtl: deps.env.MEDIA_PRESIGN_TTL_SECONDS,
      })
    },
  )

  // Public-ish media by storage key (still requires API key)
  app.get(
    '/v1/media/:instance/:key',
    {
      schema: {
        tags: ['Media'],
        summary: 'Get media by storage key',
        security: [{ apiKey: [] }, { bearerAuth: [] }],
        params: z.object({
          instance: z.string(),
          key: z.string(),
        }),
      },
    },
    async (request, reply) => {
      const params = z.object({ instance: z.string(), key: z.string() }).parse(request.params)
      const name = resolveInstanceName(request)
      // Path prefix must match the instance that owns the API key
      requireInstanceAccess(request, params.instance)
      if (params.instance !== name) {
        throw badRequest(`media instance mismatch: expected ${name}`)
      }
      // Fastify already URL-decodes path params; a 2nd decode would smuggle traversal.
      if (!/^[a-zA-Z0-9._/-]+$/.test(params.key) || params.key.includes('..')) {
        throw badRequest(`invalid media key: ${params.key}`)
      }
      const storageKey = `${name}/${params.key}`
      try {
        const stream = await mediaStorage.getStream(storageKey)
        return reply.send(stream)
      } catch {
        throw notFound('media not found')
      }
    },
  )

  /**
   *-compatible: POST.../media/getBase64FromMediaMessage
   * Body: { messageId } or { message: { key: { id } } }
   * Returns base64 + mimetype (and stores media if not yet stored).
   */
  app.post(
    scopedInstancePaths('/media/getBase64FromMediaMessage'),
    {
      schema: {
        tags: ['Media'],
        summary: 'Get media as base64 (API parity)',
        description:
          'Downloads media for a message id (from storage if present, else live decrypt via client). ' +
          'Mirrors `chat/getBase64FromMediaMessage`.',
        security: [{ apiKey: [] }, { bearerAuth: [] }],
        body: z.object({
          messageId: z.string().min(1).optional(),
          message: z
            .object({
              key: z.object({ id: z.string().min(1) }).passthrough(),
            })
            .passthrough()
            .optional(),
          convertToMp4: z.boolean().optional(),
        }),
        response: { 404: ErrorBodySchema },
      },
    },
    async (request) => {
      const name = resolveInstanceName(request)
      const body = z
        .object({
          messageId: z.string().optional(),
          message: z
            .object({ key: z.object({ id: z.string() }).passthrough() })
            .passthrough()
            .optional(),
        })
        .parse(request.body ?? {})

      const messageId = body.messageId ?? body.message?.key?.id
      if (!messageId) throw notFound('messageId required')
      return resolveBase64(name, messageId, body.message)
    },
  )

  // legacy path alias: chat/getBase64FromMediaMessage
  app.post(
    scopedInstancePaths('/chat/getBase64FromMediaMessage'),
    {
      schema: {
        tags: ['Media'],
        summary: 'Alias: getBase64FromMediaMessage (legacy path)',
        security: [{ apiKey: [] }, { bearerAuth: [] }],
        body: z.object({
          messageId: z.string().min(1).optional(),
          message: z
            .object({ key: z.object({ id: z.string().min(1) }).passthrough() })
            .passthrough()
            .optional(),
        }),
      },
    },
    async (request) => {
      const name = resolveInstanceName(request)
      const body = z
        .object({
          messageId: z.string().optional(),
          message: z
            .object({ key: z.object({ id: z.string() }).passthrough() })
            .passthrough()
            .optional(),
        })
        .parse(request.body ?? {})
      const messageId = body.messageId ?? body.message?.key?.id
      if (!messageId) throw notFound('messageId required')
      return resolveBase64(name, messageId, body.message)
    },
  )
}
