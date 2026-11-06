import type { FastifyPluginAsync, FastifyRequest } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import { z } from 'zod'
import { resolveInstanceName, scopedInstancePaths } from '~/auth/plugin'
import type { Env } from '~/config/env'
import {
  NewsletterAdminSchema,
  NewsletterCountSchema,
  NewsletterCreateSchema,
  NewsletterDirectorySchema,
  NewsletterFollowersSchema,
  NewsletterInviteSchema,
  NewsletterListSchema,
  NewsletterMessageParams,
  NewsletterMetadataSchema,
  NewsletterNodeSchema,
  NewsletterParams,
  NewsletterPublishResultSchema,
  NewsletterPublishSchema,
  NewsletterRangeSchema,
  NewsletterServerMessageParams,
  NewsletterStanzaSchema,
  NewsletterUpdateSchema,
  NewsletterUpdatesQuerySchema,
  NewsletterUserSchema,
  NewsletterVoteSchema,
} from '~/http/newsletter-schemas'
import { ErrorBodySchema, MEDIA_INPUT_HELP, OkSchema } from '~/http/openapi-schemas'
import type { InstanceManager } from '~/instances/manager'
import { mediaPreValidation } from '~/media/request-media'
import { decodeNewsletterPicture, resolveNewsletterAdminUser } from '~/newsletters/admin-input'
import { lookupNewsletter } from '~/newsletters/lookup'
import { publishNewsletter } from '~/newsletters/publish'
import {
  serializeAdmin,
  serializeDirectory,
  serializeFollowers,
  serializeNewsletter,
  serializeNewsletterNode,
  serializePublish,
} from '~/newsletters/serialize'
import type { CacheClient } from '~/redis/client'

export type NewsletterRoutesDeps = { manager: InstanceManager; env: Env; cache?: CacheClient }

export const newsletterRoutes: FastifyPluginAsync<NewsletterRoutesDeps> = async (fastify, { manager, env, cache }) => {
  const app = fastify.withTypeProvider<ZodTypeProvider>()
  const client = (request: FastifyRequest) => manager.requireRegisteredClient(resolveInstanceName(request))
  const paths = (suffix = '') => scopedInstancePaths(`/newsletters${suffix}`)
  const common = { tags: ['Newsletters'], security: [{ apiKey: [] }, { bearerAuth: [] }] as const }
  const response = <T extends z.ZodType>(schema: T) => ({
    200: schema,
    400: ErrorBodySchema,
    401: ErrorBodySchema,
    403: ErrorBodySchema,
    404: ErrorBodySchema,
    503: ErrorBodySchema,
  })

  // Invalid multipart bodies and failed sends must also release the helper's temporary upload.
  app.addHook('onResponse', async (request) => {
    await request.resolvedMedia?.cleanup()
  })

  app.get(
    paths(),
    { schema: { ...common, summary: 'List followed channels', response: response(NewsletterListSchema) } },
    async (request) => ({
      newsletters: (await client(request).newsletter.listSubscribed()).map(serializeNewsletter),
    }),
  )
  app.get(
    paths('/search'),
    {
      schema: {
        ...common,
        summary: 'Search channel directory',
        querystring: z.object({
          q: z.string().trim().min(1),
          limit: NewsletterCountSchema,
          cursor: z.string().min(1).optional(),
        }),
        response: response(NewsletterDirectorySchema),
      },
    },
    async (request) =>
      serializeDirectory(
        await client(request).newsletter.searchDirectory({
          searchText: request.query.q,
          limit: request.query.limit,
          startCursor: request.query.cursor,
        }),
      ),
  )
  app.get(
    paths('/recommended'),
    {
      schema: {
        ...common,
        summary: 'List recommended channels',
        querystring: z.object({ limit: NewsletterCountSchema }),
        response: response(NewsletterListSchema),
      },
    },
    async (request) => ({
      newsletters: (await client(request).newsletter.fetchRecommended({ limit: request.query.limit })).map(
        serializeNewsletter,
      ),
    }),
  )
  app.get(
    paths('/by-invite/:code'),
    {
      schema: {
        ...common,
        summary: 'Get channel by invite code',
        params: z.object({ code: z.string().min(1) }),
        response: response(NewsletterMetadataSchema),
      },
    },
    async (request) => lookupNewsletter(() => client(request).newsletter.fetchByInvite(request.params.code)),
  )
  app.get(
    paths('/:jid'),
    {
      schema: {
        ...common,
        summary: 'Get channel metadata',
        params: NewsletterParams,
        response: response(NewsletterMetadataSchema),
      },
    },
    async (request) => lookupNewsletter(() => client(request).newsletter.fetch(request.params.jid)),
  )
  app.get(
    paths('/:jid/messages'),
    {
      schema: {
        ...common,
        summary: 'Fetch channel message page',
        params: NewsletterParams,
        querystring: NewsletterRangeSchema,
        description:
          'Upstream returns a transport envelope, not decoded messages. Bytes are base64. No local chat projection. Use at most one cursor: before or after.',
        response: response(NewsletterNodeSchema),
      },
    },
    async (request) =>
      serializeNewsletterNode(
        await client(request).newsletter.fetchMessages({ newsletterJid: request.params.jid, ...request.query }),
      ),
  )
  app.get(
    paths('/:jid/updates'),
    {
      schema: {
        ...common,
        summary: 'Fetch channel message updates',
        params: NewsletterParams,
        description:
          'Upstream transport envelope with base64 bytes. Exactly one of before or after is required; since is an optional Unix timestamp in seconds.',
        querystring: NewsletterUpdatesQuerySchema,
        response: response(NewsletterNodeSchema),
      },
    },
    async (request) =>
      serializeNewsletterNode(
        await client(request).newsletter.fetchMessageUpdates({ newsletterJid: request.params.jid, ...request.query }),
      ),
  )

  for (const action of ['follow', 'unfollow'] as const) {
    app.post(
      paths(`/:jid/${action}`),
      {
        schema: {
          ...common,
          summary: `${action === 'follow' ? 'Follow' : 'Unfollow'} channel`,
          params: NewsletterParams,
          response: response(OkSchema),
        },
      },
      async (request) => {
        await client(request).newsletter[action](request.params.jid)
        return { ok: true as const }
      },
    )
  }
  app.post(
    paths('/:jid/mute'),
    {
      schema: {
        ...common,
        summary: 'Mute or unmute channel',
        params: NewsletterParams,
        body: z.object({ muted: z.boolean(), type: z.enum(['admin', 'follower']).optional() }),
        response: response(OkSchema),
      },
    },
    async (request) => {
      await client(request).newsletter.mute({
        newsletterJid: request.params.jid,
        mute: request.body.muted,
        type: request.body.type,
      })
      return { ok: true as const }
    },
  )
  app.post(
    paths('/:jid/live-updates'),
    {
      schema: {
        ...common,
        summary: 'Subscribe to temporary channel live updates',
        params: NewsletterParams,
        description:
          'Following persists membership; this temporary subscription must be renewed by the caller before durationSeconds expires.',
        response: response(z.object({ durationSeconds: z.number().int().positive() })),
      },
    },
    async (request) => client(request).newsletter.subscribeLiveUpdates(request.params.jid),
  )
  app.post(
    paths('/:jid/messages/:messageId/react'),
    {
      schema: {
        ...common,
        summary: 'React to channel message',
        params: NewsletterServerMessageParams,
        body: z.object({ reaction: z.string().max(64).describe('Emoji; empty string removes the reaction') }),
        response: response(NewsletterStanzaSchema),
      },
    },
    async (request) =>
      client(request).newsletter.react({
        newsletterJid: request.params.jid,
        parentMessageServerId: Number(request.params.messageId),
        reactionCode: request.body.reaction,
        revoke: request.body.reaction === '',
      }),
  )
  app.post(
    paths('/:jid/messages/:messageId/vote'),
    {
      schema: {
        ...common,
        summary: 'Vote on channel poll',
        params: NewsletterServerMessageParams,
        body: NewsletterVoteSchema,
        response: response(NewsletterStanzaSchema),
      },
    },
    async (request) =>
      client(request).newsletter.votePoll({
        newsletterJid: request.params.jid,
        parentMessageServerId: Number(request.params.messageId),
        votes: request.body.options.map((hash) => Buffer.from(hash, 'base64')),
      }),
  )
  app.post(
    paths('/:jid/messages/:messageId/view'),
    {
      schema: {
        ...common,
        summary: 'Send channel message view receipt',
        params: NewsletterServerMessageParams,
        response: response(NewsletterStanzaSchema),
      },
    },
    async (request) =>
      client(request).newsletter.sendViewReceipt({
        newsletterJid: request.params.jid,
        itemServerIds: [Number(request.params.messageId)],
      }),
  )

  app.post(
    paths(),
    {
      schema: {
        ...common,
        summary: 'Create channel',
        body: NewsletterCreateSchema,
        response: response(NewsletterMetadataSchema),
        description:
          'Creates an owned channel. Upstream automatically accepts the channel creation terms. picture is a decodable JPEG as base64, at most 256 KiB decoded and 16 megapixels.',
      },
    },
    async (request) =>
      serializeNewsletter(
        await client(request).newsletter.create({
          ...request.body,
          picture: (await decodeNewsletterPicture(request.body.picture)) ?? undefined,
        }),
      ),
  )
  app.patch(
    paths('/:jid'),
    {
      schema: {
        ...common,
        summary: 'Update channel metadata',
        params: NewsletterParams,
        body: NewsletterUpdateSchema,
        response: response(NewsletterMetadataSchema),
      },
    },
    async (request) =>
      serializeNewsletter(
        await client(request).newsletter.update(request.params.jid, {
          ...request.body,
          picture: await decodeNewsletterPicture(request.body.picture),
        }),
      ),
  )
  app.delete(
    paths('/:jid'),
    {
      schema: {
        ...common,
        summary: 'Delete channel permanently',
        params: NewsletterParams,
        response: response(OkSchema),
        description: 'Irreversible upstream deletion: detaches followers and drops channel history.',
      },
    },
    async (request) => {
      await client(request).newsletter.delete(request.params.jid)
      return { ok: true as const }
    },
  )
  app.get(
    paths('/:jid/admin'),
    {
      schema: {
        ...common,
        summary: 'Get channel admin information and capabilities',
        params: NewsletterParams,
        response: response(NewsletterAdminSchema),
      },
    },
    async (request) => {
      const newsletter = client(request).newsletter
      const [info, capabilities] = await Promise.all([
        newsletter.fetchAdminInfo(request.params.jid),
        newsletter.fetchAdminCapabilities(request.params.jid),
      ])
      return serializeAdmin(info, capabilities)
    },
  )
  app.get(
    paths('/:jid/followers'),
    {
      schema: {
        ...common,
        summary: 'Get channel followers',
        params: NewsletterParams,
        querystring: z.object({ count: NewsletterCountSchema }),
        response: response(NewsletterFollowersSchema),
        description: 'Returns the upstream follower page. zapo-js 1.11 exposes count only; no follower cursor.',
      },
    },
    async (request) =>
      serializeFollowers(await client(request).newsletter.fetchFollowers(request.params.jid, request.query)),
  )
  app.get(
    paths('/:jid/pending-invites'),
    {
      schema: {
        ...common,
        summary: 'Get pending channel admin invitations',
        params: NewsletterParams,
        response: response(z.object({ users: z.array(z.string()) })),
      },
    },
    async (request) => ({ users: [...(await client(request).newsletter.fetchPendingInvites(request.params.jid))] }),
  )
  app.post(
    paths('/:jid/admins/invite'),
    {
      schema: {
        ...common,
        summary: 'Invite channel admin',
        params: NewsletterParams,
        body: NewsletterUserSchema,
        response: response(NewsletterInviteSchema),
      },
    },
    async (request) => {
      const wa = client(request)
      return wa.newsletter.createAdminInvite({
        newsletterJid: request.params.jid,
        userJid: await resolveNewsletterAdminUser(wa, request.body.user, cache),
      })
    },
  )
  app.post(
    paths('/:jid/admins/invite/accept'),
    {
      schema: {
        ...common,
        summary: 'Accept channel admin invitation',
        params: NewsletterParams,
        response: response(OkSchema),
        description: 'Accepts for the current account; upstream automatically accepts admin invitation terms.',
      },
    },
    async (request) => {
      await client(request).newsletter.acceptAdminInvite(request.params.jid)
      return { ok: true as const }
    },
  )
  for (const [suffix, method, summary] of [
    ['admins/invite/revoke', 'revokeAdminInvite', 'Revoke channel admin invitation'],
    ['admins/demote', 'demoteAdmin', 'Demote channel admin'],
    ['owner', 'changeOwner', 'Transfer channel ownership to an invited admin'],
  ] as const) {
    app.post(
      paths(`/:jid/${suffix}`),
      {
        schema: {
          ...common,
          summary,
          params: NewsletterParams,
          body: NewsletterUserSchema,
          response: response(OkSchema),
        },
      },
      async (request) => {
        const wa = client(request)
        await wa.newsletter[method]({
          newsletterJid: request.params.jid,
          userJid: await resolveNewsletterAdminUser(wa, request.body.user, cache),
        })
        return { ok: true as const }
      },
    )
  }

  app.post(
    paths('/:jid/messages'),
    {
      preValidation: mediaPreValidation(env),
      schema: {
        ...common,
        summary: 'Publish channel text or media',
        params: NewsletterParams,
        description:
          MEDIA_INPUT_HELP +
          'Use client.newsletter.send (channel publishing), with type text/image/video/audio/document. No local projection.',
        body: NewsletterPublishSchema,
        response: response(NewsletterPublishResultSchema),
      },
    },
    async (request) =>
      serializePublish(
        await publishNewsletter(client(request).newsletter, request, {
          env,
          jid: request.params.jid,
          body: request.body,
        }),
      ),
  )
  app.patch(
    paths('/:jid/messages/:messageId'),
    {
      preValidation: mediaPreValidation(env),
      schema: {
        ...common,
        summary: 'Edit published channel text or media',
        params: NewsletterMessageParams,
        description:
          MEDIA_INPUT_HELP +
          'messageId is the original publishing stanza id, not the numeric server id used for reactions/votes/views.',
        body: NewsletterPublishSchema,
        response: response(NewsletterPublishResultSchema),
      },
    },
    async (request) =>
      serializePublish(
        await publishNewsletter(client(request).newsletter, request, {
          env,
          jid: request.params.jid,
          messageId: request.params.messageId,
          body: request.body,
        }),
      ),
  )
  app.delete(
    paths('/:jid/messages/:messageId'),
    {
      schema: {
        ...common,
        summary: 'Revoke published channel message',
        params: NewsletterMessageParams,
        response: response(NewsletterStanzaSchema),
        description: 'messageId is the original publishing stanza id.',
      },
    },
    async (request) =>
      client(request).newsletter.revoke({
        newsletterJid: request.params.jid,
        originalMessageId: request.params.messageId,
      }),
  )
}
