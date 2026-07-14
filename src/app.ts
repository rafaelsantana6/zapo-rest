import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import cors from '@fastify/cors'
import rateLimit from '@fastify/rate-limit'
import fastifyStatic from '@fastify/static'
import websocket from '@fastify/websocket'
import Fastify from 'fastify'
import { serializerCompiler, validatorCompiler, type ZodTypeProvider } from 'fastify-type-provider-zod'
import type { Pool } from 'pg'
import { authPlugin } from '~/auth/plugin'
import type { Env } from '~/config/env'
import { isRateLimitEnabled, isV1ApiPath, resolveCorsOrigin } from '~/http/cors'
import type { InstanceManager } from '~/instances/manager'
import type { InstanceRepo } from '~/instances/repo'
import type { MediaStorage } from '~/media/storage'
import { errorHandlerPlugin } from '~/plugins/error-handler'
import { securityHeadersPlugin } from '~/plugins/security-headers'
import { swaggerPlugin } from '~/plugins/swagger'
import type { CacheClient } from '~/redis/client'
import { blastRoutes } from '~/routes/blast'
import { callRoutes } from '~/routes/calls'
import { chatRoutes } from '~/routes/chats'
import { contactRoutes } from '~/routes/contacts'
import { eventsSseRoutes } from '~/routes/events-sse'
import { groupRoutes } from '~/routes/groups'
import { healthRoutes } from '~/routes/health'
import { instanceRoutes } from '~/routes/instances'
import { labelRoutes } from '~/routes/labels'
import { lidRoutes } from '~/routes/lids'
import { meRoutes } from '~/routes/me'
import { mediaRoutes } from '~/routes/media'
import { messageRoutes } from '~/routes/messages'
import { metricsRoutes } from '~/routes/metrics'
import { presenceRoutes } from '~/routes/presence'
import { privacyRoutes } from '~/routes/privacy'
import { profileRoutes } from '~/routes/profile'
import { statusRoutes } from '~/routes/status'
import { voipWsRoutes } from '~/routes/voip-ws'
import { webhookRoutes } from '~/routes/webhooks'
import type { CallStore } from '~/store/calls'
import type { ChatStore } from '~/store/chats'
import type { ContactStore } from '~/store/contacts'
import type { LabelStore } from '~/store/labels'
import type { LidMapStore } from '~/store/lid-map'
import type { LidStore } from '~/store/lids'
import type { MessageStore } from '~/store/messages'
import type { CallRecordingManager } from '~/voip/recording-manager'
import type { WebhookConfigRepo } from '~/webhooks/repo'

export type BuildAppDeps = {
  env: Env
  pool: Pool
  instanceRepo: InstanceRepo
  manager: InstanceManager
  messages?: MessageStore
  chats?: ChatStore
  contacts?: ContactStore
  labels?: LabelStore
  lids?: LidStore
  lidMap?: LidMapStore
  webhookRepo?: WebhookConfigRepo
  mediaStorage?: MediaStorage
  cache?: CacheClient
  calls?: CallStore
  callRecording?: CallRecordingManager
}

export async function buildApp(deps: BuildAppDeps) {
  const trustProxy = deps.env.TRUST_PROXY ? deps.env.TRUST_PROXY_HOPS : false
  const app = Fastify({
    logger: false,
    trustProxy,
  }).withTypeProvider<ZodTypeProvider>()

  app.setValidatorCompiler(validatorCompiler)
  app.setSerializerCompiler(serializerCompiler)

  await app.register(errorHandlerPlugin)
  await app.register(securityHeadersPlugin)
  await app.register(cors, {
    origin: resolveCorsOrigin(deps.env),
    credentials: true,
  })

  if (isRateLimitEnabled(deps.env)) {
    await app.register(rateLimit, {
      global: true,
      max: deps.env.RATE_LIMIT_MAX,
      timeWindow: deps.env.RATE_LIMIT_TIME_WINDOW_MS,
      // Only count /v1/* — health, docs, guide, dashboard stay unlimited at app layer
      allowList: (req) => !isV1ApiPath(req.url),
      skipOnError: true,
      addHeaders: {
        'x-ratelimit-limit': true,
        'x-ratelimit-remaining': true,
        'x-ratelimit-reset': true,
        'retry-after': true,
      },
      // Must return an Error with statusCode (plugin throws the return value)
      errorResponseBuilder: (_req, context) => {
        const err = new Error(`Rate limit exceeded — retry after ${context.after}`) as Error & {
          statusCode: number
          code: string
          details: Record<string, unknown>
        }
        err.statusCode = context.statusCode
        err.code = 'RATE_LIMITED'
        err.details = { max: context.max, ttlMs: context.ttl }
        return err
      },
    })
  }

  await app.register(websocket)
  await app.register(swaggerPlugin)

  await app.register(authPlugin, {
    env: deps.env,
    instanceRepo: deps.instanceRepo,
  })

  await app.register(healthRoutes, { pool: deps.pool, cache: deps.cache })
  await app.register(meRoutes, { manager: deps.manager })
  await app.register(instanceRoutes, { manager: deps.manager })
  await app.register(metricsRoutes, {
    manager: deps.manager,
    pool: deps.pool,
    cache: deps.cache,
  })
  await app.register(messageRoutes, {
    manager: deps.manager,
    env: deps.env,
    messages: deps.messages,
    cache: deps.cache,
  })
  await app.register(contactRoutes, {
    manager: deps.manager,
    contacts: deps.contacts,
    cache: deps.cache,
    lidMap: deps.lidMap,
    env: deps.env,
    pool: deps.pool,
    mediaStorage: deps.mediaStorage,
  })
  await app.register(presenceRoutes, { manager: deps.manager, cache: deps.cache })
  await app.register(callRoutes, {
    manager: deps.manager,
    env: deps.env,
    instanceRepo: deps.instanceRepo,
    calls: deps.calls,
    callRecording: deps.callRecording,
    mediaStorage: deps.mediaStorage,
    cache: deps.cache,
  })
  await app.register(blastRoutes, {
    manager: deps.manager,
    env: deps.env,
    instanceRepo: deps.instanceRepo,
    mediaStorage: deps.mediaStorage,
    cache: deps.cache,
    calls: deps.calls,
  })

  if (deps.chats && deps.messages) {
    await app.register(chatRoutes, {
      manager: deps.manager,
      chats: deps.chats,
      messages: deps.messages,
      lidMap: deps.lidMap,
      cache: deps.cache,
    })
  }

  await app.register(groupRoutes, { manager: deps.manager, env: deps.env, cache: deps.cache })
  await app.register(profileRoutes, { manager: deps.manager, env: deps.env })
  await app.register(privacyRoutes, { manager: deps.manager, cache: deps.cache })
  await app.register(statusRoutes, { manager: deps.manager, env: deps.env, cache: deps.cache })

  if (deps.labels) {
    await app.register(labelRoutes, {
      manager: deps.manager,
      labels: deps.labels,
      cache: deps.cache,
    })
  }
  if (deps.lids) {
    await app.register(lidRoutes, { manager: deps.manager, lids: deps.lids })
  }

  if (deps.webhookRepo) {
    await app.register(webhookRoutes, {
      manager: deps.manager,
      webhookRepo: deps.webhookRepo,
    })
  }

  if (deps.mediaStorage) {
    await app.register(mediaRoutes, {
      manager: deps.manager,
      mediaStorage: deps.mediaStorage,
      messages: deps.messages,
      env: deps.env,
    })
  }

  await app.register(eventsSseRoutes, { env: deps.env })

  await app.register(voipWsRoutes, {
    env: deps.env,
    instanceRepo: deps.instanceRepo,
    manager: deps.manager,
    callRecording: deps.callRecording,
    cache: deps.cache,
  })

  // Rich docs SPA (Tailwind guide) — served at /guide (Scalar API ref at /docs)
  const guideDir = join(process.cwd(), 'docs-site', 'dist')
  const hasGuide = existsSync(join(guideDir, 'index.html'))
  if (hasGuide) {
    await app.register(fastifyStatic, {
      root: guideDir,
      // wildcard:true so rebuilds without process restart still serve new hashed assets
      prefix: '/guide/',
      wildcard: true,
      decorateReply: false,
    })
    app.get('/guide', async (_request, reply) => reply.redirect('/guide/'))
  }

  // Dashboard SPA (if built)
  const dashDir = join(process.cwd(), 'dashboard', 'dist')
  const hasDash = existsSync(join(dashDir, 'index.html'))
  if (hasDash) {
    await app.register(fastifyStatic, {
      root: dashDir,
      // Must use wildcard:true — with false, @fastify/static globs files once at boot.
      // Dashboard rebuilds (new content-hash names) then 404 → SPA HTML for .js → MIME error.
      prefix: '/',
      wildcard: true,
      index: ['index.html'],
    })
  }

  // Always register so /v1 404s use the API envelope even without dashboard/docs dist
  // (CI runs tests without built SPAs; Fastify's default 404 body is not ErrorBodySchema).
  app.setNotFoundHandler((request, reply) => {
    const path = request.url.split('?')[0] ?? ''
    if (
      path.startsWith('/v1') ||
      path.startsWith('/docs') ||
      path.startsWith('/health') ||
      path.startsWith('/ready') ||
      path.startsWith('/media')
    ) {
      return reply.status(404).send({
        error: { code: 'NOT_FOUND', message: 'Not found' },
      })
    }
    // Never SPA-fallback for static asset paths (would poison MIME as text/html)
    if (
      path.startsWith('/assets/') ||
      path.startsWith('/guide/assets/') ||
      /\.(js|css|map|svg|png|jpe?g|webp|ico|woff2?|ttf|eot)$/i.test(path)
    ) {
      return reply.status(404).type('text/plain').send('Not found')
    }
    // SPA fallback for docs guide / dashboard client routes when built
    if (hasGuide && (path === '/guide' || path.startsWith('/guide/'))) {
      return reply.type('text/html').send(readFileSync(join(guideDir, 'index.html')))
    }
    if (hasDash) {
      return reply.type('text/html').send(readFileSync(join(dashDir, 'index.html')))
    }
    return reply.status(404).send({
      error: { code: 'NOT_FOUND', message: 'Not found' },
    })
  })

  return app
}
