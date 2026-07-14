import type { FastifyPluginAsync } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import type { Pool } from 'pg'
import { z } from 'zod'
import { resolveInstanceName, scopedInstancePaths } from '~/auth/plugin'
import type { Env } from '~/config/env'
import { getEnv } from '~/config/env'
import {
  CheckContactsBodySchema,
  CheckContactsResponseSchema,
  ErrorBodySchema,
  ProfilePictureParamsSchema,
  ProfilePictureQuerySchema,
  ProfilePictureResponseSchema,
} from '~/http/openapi-schemas'
import type { InstanceManager } from '~/instances/manager'
import { resolveContactAvatar } from '~/lib/avatar-resolve'
import { notFound } from '~/lib/errors'
import { createJid, inspectPhone, toRecipientJid } from '~/lib/phone'
import { resolveRecipientJid, resolveWhatsAppNumbers } from '~/lib/phone-resolve'
import { PROFILE_PICTURE_CACHE_TTL_DEFAULT, type ProfilePictureType } from '~/lib/profile-picture-cache'
import { isSoftProfileQueryFailure, parseWaIqError } from '~/lib/wa-iq-error'
import type { MediaStorage } from '~/media/storage'
import type { CacheClient } from '~/redis/client'
import { AvatarStore } from '~/store/avatars'
import type { ContactStore } from '~/store/contacts'
import { toPublicContact } from '~/store/contacts'
import type { LidMapStore } from '~/store/lid-map'

export type ContactRoutesDeps = {
  manager: InstanceManager
  contacts?: ContactStore
  cache?: CacheClient
  lidMap?: LidMapStore
  env?: Env
  pool?: Pool
  mediaStorage?: MediaStorage
}

const ResolveBody = z.object({
  numbers: z
    .array(z.string().min(1))
    .min(1)
    .max(50)
    .describe('Phone numbers with country code (BR 9th digit optional). Max 50.'),
  skipCache: z.boolean().optional(),
})

export const contactRoutes: FastifyPluginAsync<ContactRoutesDeps> = async (fastify, deps) => {
  const app = fastify.withTypeProvider<ZodTypeProvider>()
  const { manager, contacts, cache, lidMap, mediaStorage, pool } = deps
  const env = deps.env ?? getEnv()
  const ppTtl =
    env.PROFILE_PICTURE_CACHE_TTL_SECONDS > 0
      ? env.PROFILE_PICTURE_CACHE_TTL_SECONDS
      : PROFILE_PICTURE_CACHE_TTL_DEFAULT
  const avatars = pool ? new AvatarStore(pool) : null

  app.get(
    scopedInstancePaths('/contacts'),
    {
      schema: {
        tags: ['Contacts'],
        summary: 'List stored contacts',
        security: [{ apiKey: [] }, { bearerAuth: [] }],
        querystring: z.object({
          limit: z.coerce.number().int().positive().max(500).optional(),
          offset: z.coerce.number().int().nonnegative().optional(),
        }),
      },
    },
    async (request) => {
      const name = resolveInstanceName(request)
      const q = request.query
      if (!contacts) return { contacts: [] }
      const rows = await contacts.list(name, { limit: q.limit, offset: q.offset })
      return { contacts: rows.map(toPublicContact) }
    },
  )

  /**
   * Local JID builder (no WhatsApp round-trip) — local createJid rules
   * including BR 9th digit / MX-AR prefixes.
   */
  app.post(
    scopedInstancePaths('/contacts/jid'),
    {
      schema: {
        tags: ['Contacts'],
        summary: 'Build JID locally (createJid)',
        description:
          'Applies local phone normalization (BR 9th digit, MX/AR) **without** calling WhatsApp.\n\n' +
          'For the **server-confirmed** JID, use `POST.../contacts/resolve` or `.../check`.\n\n' +
          'Example: `5568981159096` → `556881159096@s.whatsapp.net`',
        security: [{ apiKey: [] }, { bearerAuth: [] }],
        body: z.object({
          numbers: z.array(z.string().min(1)).min(1).max(100),
        }),
      },
    },
    async (request) => {
      const name = resolveInstanceName(request)
      await manager.get(name)
      const body = request.body
      return {
        results: body.numbers.map((n) => {
          const info = inspectPhone(n)
          return {
            input: n,
            jid: info.jid,
            digits: info.digits,
            variants: info.variants,
            countryHint: info.countryHint,
          }
        }),
      }
    },
  )

  /**
   * Resolve correct WhatsApp JID (whatsappNumbers + BR/MX/AR variants).
   * Single batched usync via zapo getLidsByPhoneNumbers.
   */
  app.post(
    scopedInstancePaths('/contacts/resolve'),
    {
      schema: {
        tags: ['Contacts'],
        summary: 'Resolve correct WhatsApp JID for numbers',
        description:
          'Like `POST /chat/whatsappNumbers`:\n' +
          '- expands BR **nono dígito** / MX-AR variants\n' +
          '- **one** `getLidsByPhoneNumbers` batch (no spam)\n' +
          '- returns the WA-confirmed `jid` when `exists`\n' +
          '- caches results (Redis/memory) for 24h',
        security: [{ apiKey: [] }, { bearerAuth: [] }],
        body: ResolveBody,
      },
    },
    async (request) => {
      const name = resolveInstanceName(request)
      const body = request.body
      const client = manager.requireRegisteredClient(name)
      const results = await resolveWhatsAppNumbers(client, body.numbers, {
        cache,
        skipCache: body.skipCache,
        lidMap,
        instanceName: name,
      })

      // Upsert confirmed contacts into projection (parallel; ≤50 by ResolveBody + pg pool bound)
      if (contacts) {
        const store = contacts
        await Promise.all(
          results
            .filter((r) => r.exists)
            .map((r) =>
              store.upsert({
                instanceName: name,
                jid: r.jid,
                lid: r.lid,
                phoneNumber: r.matchedNumber,
                lastUpdatedMs: Date.now(),
              }),
            ),
        )
      }

      return {
        results: results.map((r) => ({
          input: r.input,
          query: r.query,
          exists: r.exists,
          jid: r.jid,
          lid: r.lid,
          matchedNumber: r.matchedNumber,
          localJid: r.localJid,
          variantsChecked: r.variantsChecked,
          cached: r.cached,
        })),
      }
    },
  )

  app.post(
    scopedInstancePaths('/contacts/check'),
    {
      schema: {
        tags: ['Contacts'],
        summary: 'Check if numbers exist on WhatsApp (batch)',
        description:
          'Batch existence check with BR/MX/AR digit variants. Uses a **single** usync call for all numbers+variants.\n\n' +
          'Alias of resolve with a flatter response shape ( compatible fields).',
        security: [{ apiKey: [] }, { bearerAuth: [] }],
        body: CheckContactsBodySchema,
        response: {
          200: CheckContactsResponseSchema,
          400: ErrorBodySchema,
          503: ErrorBodySchema,
        },
      },
    },
    async (request) => {
      const name = resolveInstanceName(request)
      const body = request.body
      const client = manager.requireRegisteredClient(name)
      const resolved = await resolveWhatsAppNumbers(client, body.phones, {
        cache,
        lidMap,
        instanceName: name,
      })
      return {
        results: resolved.map((r) => ({
          input: r.input,
          phoneJid: r.jid,
          lidJid: r.lid,
          exists: r.exists,
          matchedNumber: r.matchedNumber,
          numberExists: r.exists,
          chatId: r.exists ? r.jid : null,
        })),
      }
    },
  )

  /** multi-config single-number check */
  app.get(
    scopedInstancePaths('/contacts/check'),
    {
      schema: {
        tags: ['Contacts'],
        summary: 'Check one number (query)',
        description: 'single-number check: `?phone=5568981159096`',
        security: [{ apiKey: [] }, { bearerAuth: [] }],
        querystring: z.object({
          phone: z.string().min(1),
        }),
      },
    },
    async (request) => {
      const name = resolveInstanceName(request)
      const q = request.query
      const client = manager.requireRegisteredClient(name)
      const [r] = await resolveWhatsAppNumbers(client, [q.phone], {
        cache,
        lidMap,
        instanceName: name,
      })
      return {
        numberExists: Boolean(r?.exists),
        exists: Boolean(r?.exists),
        chatId: r?.exists ? r.jid : null,
        jid: r?.jid ?? createJid(q.phone),
        lid: r?.lid ?? null,
        matchedNumber: r?.matchedNumber ?? null,
        input: q.phone,
      }
    },
  )

  // Legacy alias path used by some clients
  app.post(
    scopedInstancePaths('/contacts/whatsapp-numbers'),
    {
      schema: {
        tags: ['Contacts'],
        summary: 'whatsappNumbers alias',
        description: 'Same as `POST.../contacts/resolve` (legacy naming).',
        security: [{ apiKey: [] }, { bearerAuth: [] }],
        body: ResolveBody,
      },
    },
    async (request) => {
      const name = resolveInstanceName(request)
      const body = request.body
      const client = manager.requireRegisteredClient(name)
      const results = await resolveWhatsAppNumbers(client, body.numbers, {
        cache,
        skipCache: body.skipCache,
        lidMap,
        instanceName: name,
      })
      return {
        results: results.map((r) => ({
          jid: r.jid,
          exists: r.exists,
          number: r.input,
          lid: r.lid,
          matchedNumber: r.matchedNumber,
        })),
      }
    },
  )

  app.get(
    scopedInstancePaths('/contacts/:jid'),
    {
      schema: {
        tags: ['Contacts'],
        summary: 'Get contact',
        security: [{ apiKey: [] }, { bearerAuth: [] }],
        params: z.object({ jid: z.string() }),
      },
    },
    async (request) => {
      const params = request.params
      const name = resolveInstanceName(request)
      if (!contacts) return { contact: null }
      const client = manager.tryGetClient(name)
      const jid = await resolveRecipientJid(client, params.jid, cache)
      const row = await contacts.get(name, jid)
      return { contact: row ? toPublicContact(row) : null }
    },
  )

  app.get(
    scopedInstancePaths('/contacts/:phone/profile-picture'),
    {
      schema: {
        tags: ['Contacts'],
        summary: 'Get profile picture (durable storage + TTL revalidation)',
        description:
          'Returns contact avatar with **bytes in object storage** (deterministic key, overwrite on change).\n\n' +
          '- Within TTL: serve our stored file **without** hitting WhatsApp.\n' +
          '- After TTL (or `refresh=true`): revalidate via IQ; compare `id`/sha256; download+overwrite only if changed.\n' +
          '- Privacy / no pic: delete stored object (no orphans).\n' +
          '- Binary stream: `GET.../profile-picture/file`.\n' +
          'Do not spam `refresh` (WhatsApp rate-overlimit).',
        security: [{ apiKey: [] }, { bearerAuth: [] }],
        params: ProfilePictureParamsSchema,
        querystring: ProfilePictureQuerySchema,
        response: {
          200: ProfilePictureResponseSchema,
          400: ErrorBodySchema,
          503: ErrorBodySchema,
        },
      },
    },
    async (request) => {
      const params = request.params
      const name = resolveInstanceName(request)
      const query = request.query
      const picType = (query.type ?? 'preview') as ProfilePictureType
      const refresh = Boolean(query.refresh)
      const client = manager.requireRegisteredClient(name)
      const [resolved] = await resolveWhatsAppNumbers(client, [params.phone], { cache })
      const jid = resolved?.exists ? resolved.jid : toRecipientJid(params.phone)

      if (avatars && mediaStorage) {
        const result = await resolveContactAvatar({
          instanceName: name,
          jid,
          picType,
          refresh,
          client,
          mediaStorage,
          avatars,
          contacts,
          env,
        })
        return {
          picture: result.picture,
          jid: result.jid,
          reason: result.reason,
          status: result.status,
          revalidated: result.revalidated,
          fromStorage: result.fromStorage,
          storageKey: result.storageKey,
          sha256: result.sha256,
          url: result.url,
          cacheTtlSeconds: ppTtl,
          lastCheckedAt: result.lastCheckedAt,
          lastFetchedAt: result.lastFetchedAt,
          cached: result.fromStorage && !result.revalidated,
          cachedAt: result.lastFetchedAt ?? result.lastCheckedAt,
        }
      }

      // Fallback without storage: live IQ only (soft-fail)
      try {
        const picture = await client.profile.getProfilePicture(jid, picType)
        return { picture, jid, reason: null, revalidated: true, fromStorage: false }
      } catch (err) {
        if (isSoftProfileQueryFailure(err)) {
          const soft = parseWaIqError(err)
          return {
            picture: null,
            jid,
            reason: soft?.code ?? soft?.kind ?? 'unavailable',
            revalidated: true,
            fromStorage: false,
          }
        }
        throw err
      }
    },
  )

  /** Stream durable avatar bytes (auth required). */
  app.get(
    scopedInstancePaths('/contacts/:phone/profile-picture/file'),
    {
      schema: {
        tags: ['Contacts'],
        summary: 'Stream stored profile picture bytes',
        description:
          'Streams the durable avatar from object storage. Triggers resolve (with TTL) first so the file exists when possible.',
        security: [{ apiKey: [] }, { bearerAuth: [] }],
        params: ProfilePictureParamsSchema,
        querystring: ProfilePictureQuerySchema,
        response: { 404: ErrorBodySchema, 503: ErrorBodySchema },
      },
    },
    async (request, reply) => {
      const params = request.params
      const name = resolveInstanceName(request)
      if (!avatars || !mediaStorage) throw notFound('avatar storage not configured')
      const query = request.query
      const picType = (query.type ?? 'preview') as ProfilePictureType
      const client = manager.requireRegisteredClient(name)
      const [resolved] = await resolveWhatsAppNumbers(client, [params.phone], { cache })
      const jid = resolved?.exists ? resolved.jid : toRecipientJid(params.phone)

      const result = await resolveContactAvatar({
        instanceName: name,
        jid,
        picType,
        refresh: Boolean(query.refresh),
        client,
        mediaStorage,
        avatars,
        contacts,
        env,
      })
      if (result.status !== 'ok' || !result.storageKey) {
        throw notFound(result.reason ?? 'avatar not available')
      }
      try {
        const stream = await mediaStorage.getStream(result.storageKey)
        if (result.mimeType) reply.header('content-type', result.mimeType)
        reply.header('cache-control', `private, max-age=${Math.min(ppTtl, 3600)}`)
        if (result.sha256) reply.header('etag', `"${result.sha256}"`)
        // Only 404/503 are declared in the response schema; the 200 body is a raw
        // binary stream that Fastify pipes without Zod serialization, so escape the type.
        return reply.send(stream as never)
      } catch {
        throw notFound('avatar file missing')
      }
    },
  )

  app.get(
    scopedInstancePaths('/contacts/:phone/about'),
    {
      schema: {
        tags: ['Contacts'],
        summary: 'Get contact about status',
        security: [{ apiKey: [] }, { bearerAuth: [] }],
        params: ProfilePictureParamsSchema,
      },
    },
    async (request) => {
      const params = request.params
      const name = resolveInstanceName(request)
      const client = manager.requireRegisteredClient(name)
      const [resolved] = await resolveWhatsAppNumbers(client, [params.phone], { cache })
      const jid = resolved?.exists ? resolved.jid : toRecipientJid(params.phone)
      try {
        const status = await client.profile.getStatus(jid)
        return { status: status.status, jid }
      } catch (err) {
        if (isSoftProfileQueryFailure(err)) {
          const soft = parseWaIqError(err)
          return {
            status: null,
            jid,
            reason: soft?.code ?? soft?.kind ?? 'unavailable',
          }
        }
        throw err
      }
    },
  )

  app.post(
    scopedInstancePaths('/contacts/block'),
    {
      schema: {
        tags: ['Contacts'],
        summary: 'Block contact',
        security: [{ apiKey: [] }, { bearerAuth: [] }],
        body: z.object({ jid: z.string().min(1) }),
      },
    },
    async (request) => {
      const name = resolveInstanceName(request)
      const body = request.body
      const client = manager.requireRegisteredClient(name)
      const jid = await resolveRecipientJid(client, body.jid, cache)
      await client.privacy.blockUser(jid)
      if (contacts) await contacts.setBlocked(name, jid, true)
      return { ok: true as const, jid }
    },
  )

  app.post(
    scopedInstancePaths('/contacts/unblock'),
    {
      schema: {
        tags: ['Contacts'],
        summary: 'Unblock contact',
        security: [{ apiKey: [] }, { bearerAuth: [] }],
        body: z.object({ jid: z.string().min(1) }),
      },
    },
    async (request) => {
      const name = resolveInstanceName(request)
      const body = request.body
      const client = manager.requireRegisteredClient(name)
      const jid = await resolveRecipientJid(client, body.jid, cache)
      await client.privacy.unblockUser(jid)
      if (contacts) await contacts.setBlocked(name, jid, false)
      return { ok: true as const, jid }
    },
  )

  app.get(
    scopedInstancePaths('/blocklist'),
    {
      schema: {
        tags: ['Contacts'],
        summary: 'Get blocklist',
        security: [{ apiKey: [] }, { bearerAuth: [] }],
      },
    },
    async (request) => {
      const name = resolveInstanceName(request)
      const client = manager.requireRegisteredClient(name)
      const result = await client.privacy.getBlocklist()
      return { blocklist: result }
    },
  )
}
