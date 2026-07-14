import type { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'
import { resolveInstanceName, scopedInstancePaths } from '~/auth/plugin'
import type { Env } from '~/config/env'
import type { InstanceManager } from '~/instances/manager'
import { notFound } from '~/lib/errors'
import { assertPublicUrl } from '~/lib/ssrf-guard'
import type { WebhookConfigRepo } from '~/webhooks/repo'
import { toPublicWebhook, WEBHOOK_EVENTS } from '~/webhooks/types'

const WebhookBody = z.object({
  url: z.string().url(),
  events: z.array(z.string()).optional().describe('Empty = all events. Use * for all.'),
  hmac: z
    .object({
      key: z.string().min(8).optional(),
    })
    .optional()
    .nullable(),
  retries: z
    .object({
      policy: z.enum(['linear', 'exponential', 'constant']).optional(),
      delaySeconds: z.number().int().positive().optional(),
      attempts: z.number().int().positive().max(20).optional(),
    })
    .optional(),
  customHeaders: z.array(z.object({ name: z.string().min(1), value: z.string() })).optional(),
  enabled: z.boolean().optional(),
})

const WebhookIdParams = z.object({
  webhookId: z.string().min(1),
})

export type WebhookRoutesDeps = {
  manager: InstanceManager
  webhookRepo: WebhookConfigRepo
  env?: Pick<Env, 'NODE_ENV'>
}

export const webhookRoutes: FastifyPluginAsync<WebhookRoutesDeps> = async (app, deps) => {
  const { manager, webhookRepo } = deps
  // Block registering internal/loopback destinations up front; plain http is
  // only tolerated outside production. Delivery re-validates defensively too.
  const allowHttp = (deps.env?.NODE_ENV ?? process.env.NODE_ENV) !== 'production'

  app.get(
    scopedInstancePaths('/webhooks'),
    {
      schema: {
        tags: ['Webhooks'],
        summary: 'List webhooks (multi-config multi-config)',
        description: 'Multiple webhook endpoints per instance with per-URL events, HMAC, retries, and custom headers.',
        security: [{ apiKey: [] }, { bearerAuth: [] }],
        response: {
          200: z.object({
            webhooks: z.array(z.record(z.string(), z.any())),
            availableEvents: z.array(z.string()),
          }),
        },
      },
    },
    async (request) => {
      const name = resolveInstanceName(request)
      await manager.get(name) // 404 if missing
      const rows = await webhookRepo.list(name)
      return {
        webhooks: rows.map(toPublicWebhook),
        availableEvents: [...WEBHOOK_EVENTS],
      }
    },
  )

  app.post(
    scopedInstancePaths('/webhooks'),
    {
      schema: {
        tags: ['Webhooks'],
        summary: 'Create webhook config',
        security: [{ apiKey: [] }, { bearerAuth: [] }],
        body: WebhookBody,
      },
    },
    async (request) => {
      const name = resolveInstanceName(request)
      await manager.get(name)
      const body = WebhookBody.parse(request.body)
      await assertPublicUrl(body.url, { allowHttp })
      const row = await webhookRepo.create(name, {
        url: body.url,
        events: body.events,
        hmacKey: body.hmac?.key ?? null,
        retries: body.retries,
        customHeaders: body.customHeaders,
        enabled: body.enabled,
      })
      return { webhook: toPublicWebhook(row) }
    },
  )

  app.get(
    scopedInstancePaths('/webhooks/:webhookId'),
    {
      schema: {
        tags: ['Webhooks'],
        summary: 'Get webhook',
        security: [{ apiKey: [] }, { bearerAuth: [] }],
        params: WebhookIdParams,
      },
    },
    async (request) => {
      const params = WebhookIdParams.parse(request.params)
      const name = resolveInstanceName(request)
      const row = await webhookRepo.get(name, params.webhookId)
      if (!row) throw notFound('webhook not found')
      return { webhook: toPublicWebhook(row) }
    },
  )

  app.put(
    scopedInstancePaths('/webhooks/:webhookId'),
    {
      schema: {
        tags: ['Webhooks'],
        summary: 'Update webhook',
        security: [{ apiKey: [] }, { bearerAuth: [] }],
        params: WebhookIdParams,
        body: WebhookBody.partial(),
      },
    },
    async (request) => {
      const params = WebhookIdParams.parse(request.params)
      const name = resolveInstanceName(request)
      const body = WebhookBody.partial().parse(request.body)
      if (body.url !== undefined) await assertPublicUrl(body.url, { allowHttp })
      const row = await webhookRepo.update(name, params.webhookId, {
        url: body.url,
        events: body.events,
        hmacKey: body.hmac === null ? null : body.hmac?.key,
        retries: body.retries,
        customHeaders: body.customHeaders,
        enabled: body.enabled,
      })
      if (!row) throw notFound('webhook not found')
      return { webhook: toPublicWebhook(row) }
    },
  )

  app.delete(
    scopedInstancePaths('/webhooks/:webhookId'),
    {
      schema: {
        tags: ['Webhooks'],
        summary: 'Delete webhook',
        security: [{ apiKey: [] }, { bearerAuth: [] }],
        params: WebhookIdParams,
      },
    },
    async (request) => {
      const params = WebhookIdParams.parse(request.params)
      const name = resolveInstanceName(request)
      const ok = await webhookRepo.delete(name, params.webhookId)
      if (!ok) throw notFound('webhook not found')
      return { ok: true as const }
    },
  )
}
