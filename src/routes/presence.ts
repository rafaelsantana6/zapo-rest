import type { FastifyPluginAsync } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import { z } from 'zod'
import { resolveInstanceName, scopedInstancePaths } from '~/auth/plugin'
import {
  ChatstateBodySchema,
  ChatstateParamsSchema,
  ErrorBodySchema,
  InstanceNameParams,
  OkSchema,
  PresenceBodySchema,
} from '~/http/openapi-schemas'
import type { InstanceManager } from '~/instances/manager'
import { resolveRecipientJid } from '~/lib/phone-resolve'
import type { CacheClient } from '~/redis/client'

export type PresenceRoutesDeps = {
  manager: InstanceManager
  cache?: CacheClient
}

export const presenceRoutes: FastifyPluginAsync<PresenceRoutesDeps> = async (fastify, deps) => {
  const app = fastify.withTypeProvider<ZodTypeProvider>()
  const { manager, cache } = deps

  app.post(
    scopedInstancePaths('/presence'),
    {
      schema: {
        tags: ['Presence'],
        summary: 'Set online presence',
        description:
          'Broadcasts account presence: `available` (online) or `unavailable`.\n\n' +
          '```json\n{ "type": "available" }\n```',
        security: [{ apiKey: [] }, { bearerAuth: [] }],
        params: InstanceNameParams,
        body: PresenceBodySchema,
        response: {
          200: OkSchema,
          400: ErrorBodySchema,
          401: ErrorBodySchema,
          403: ErrorBodySchema,
          404: ErrorBodySchema,
          503: ErrorBodySchema,
        },
      },
    },
    async (request) => {
      const name = resolveInstanceName(request, request.params.name)
      const body = request.body
      const client = manager.requireRegisteredClient(name)
      await client.presence.send(body.type)
      return { ok: true as const }
    },
  )

  app.post(
    scopedInstancePaths('/chats/:jid/chatstate'),
    {
      schema: {
        tags: ['Presence'],
        summary: 'Send typing / recording indicator',
        description:
          'Sends a chat-state into a conversation:\n\n' +
          '| state | Meaning |\n|-------|---------|\n' +
          '| `composing` | Typing… |\n' +
          '| `recording` | Recording voice note |\n' +
          '| `paused` | Stopped |\n\n' +
          'Path param `jid` may be digits or a full JID (URL-encode `@` as `%40`).\n\n' +
          '```bash\n' +
          'curl -s -X POST "$BASE/v1/instances/sales-1/chats/5511999999999/chatstate" \\\n' +
          '  -H "X-Api-Key: $KEY" -H "content-type: application/json" \\\n' +
          '  -d \'{ "state": "composing" }\'\n' +
          '```',
        security: [{ apiKey: [] }, { bearerAuth: [] }],
        params: ChatstateParamsSchema,
        body: ChatstateBodySchema,
        response: {
          200: OkSchema,
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
      const name = resolveInstanceName(request, params.name)
      const body = request.body
      const client = manager.requireRegisteredClient(name)
      const jid = await resolveRecipientJid(client, decodeURIComponent(params.jid), cache)
      const state = body.state === 'paused' ? 'paused' : 'composing'
      await client.presence.sendChatstate(jid, {
        state,
        ...(body.state === 'recording' ? { media: 'audio' as const } : {}),
      })
      return { ok: true as const }
    },
  )

  /**
   * Subscribe to peer presence + chatstate (typing/recording).
   * Required before the dashboard receives `presence.update` / `chatstate` events.
   */
  app.post(
    scopedInstancePaths('/presence/subscribe'),
    {
      schema: {
        tags: ['Presence'],
        summary: 'Subscribe to peer presence & chatstate',
        description:
          'Subscribes to online/offline and typing/recording indicators for a chat JID. ' +
          'Must be re-subscribed after reconnect. Events: `presence.update`, `chatstate`.',
        security: [{ apiKey: [] }, { bearerAuth: [] }],
        params: InstanceNameParams,
        body: z.object({
          jid: z.string().min(1).describe('Phone or JID to subscribe'),
        }),
      },
    },
    async (request) => {
      const name = resolveInstanceName(request, request.params.name)
      const body = request.body
      // Subscribes PN + all LID aliases and marks us available (55 + nono dígito inside manager)
      const { jids } = await manager.subscribePresence(name, body.jid)
      return { ok: true as const, jid: jids[0] ?? body.jid, jids }
    },
  )
}
