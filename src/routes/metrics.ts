import type { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'
import { resolveInstanceName, scopedInstancePaths } from '~/auth/plugin'
import { isAdmin } from '~/auth/types'
import { ErrorBodySchema, InstanceNameParams } from '~/http/openapi-schemas'
import type { InstanceManager } from '~/instances/manager'
import { badRequest } from '~/lib/errors'
import { sampleProcessResources } from '~/lib/process-resources'
import type { CacheClient } from '~/redis/client'
import { MetricsStore } from '~/store/metrics'

export type MetricsRoutesDeps = {
  manager: InstanceManager
  pool: import('pg').Pool
  cache?: CacheClient
}

const RangeQuery = z.object({
  /** ISO date/time — default: 7 days ago */
  from: z.string().optional(),
  /** ISO date/time — default: now */
  to: z.string().optional(),
  bucket: z.enum(['hour', 'day']).optional().default('day'),
})

function parseRange(q: z.infer<typeof RangeQuery>): { from: Date; to: Date; bucket: 'hour' | 'day' } {
  const to = q.to ? new Date(q.to) : new Date()
  const from = q.from ? new Date(q.from) : new Date(to.getTime() - 7 * 24 * 60 * 60 * 1000)
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
    throw badRequest('Invalid from/to datetime')
  }
  if (from >= to) {
    throw badRequest('from must be before to')
  }
  // Cap range to 90 days to protect DB
  const maxMs = 90 * 24 * 60 * 60 * 1000
  if (to.getTime() - from.getTime() > maxMs) {
    throw badRequest('range too large (max 90 days)')
  }
  return { from, to, bucket: q.bucket ?? 'day' }
}

type InstanceParams = { Params: z.infer<typeof InstanceNameParams> }
type MetricsRoute = InstanceParams & { Querystring: z.infer<typeof RangeQuery> }

export const metricsRoutes: FastifyPluginAsync<MetricsRoutesDeps> = async (app, deps) => {
  const { manager, pool, cache } = deps
  const metrics = new MetricsStore(pool)

  app.get<MetricsRoute>(
    scopedInstancePaths('/metrics'),
    {
      schema: {
        tags: ['Metrics'],
        summary: 'Instance metrics summary',
        description:
          'Aggregated messages, calls, media and storage for an instance over a time range (default last 7 days).',
        security: [{ apiKey: [] }, { bearerAuth: [] }],
        params: InstanceNameParams,
        querystring: RangeQuery,
        response: { 400: ErrorBodySchema, 403: ErrorBodySchema },
      },
    },
    async (request) => {
      const name = resolveInstanceName(request, request.params.name)
      await manager.get(name) // 404 if missing
      const q = request.query
      const { from, to } = parseRange(q)
      return metrics.summary(name, from, to)
    },
  )

  app.get<MetricsRoute>(
    scopedInstancePaths('/metrics/timeseries'),
    {
      schema: {
        tags: ['Metrics'],
        summary: 'Instance metrics time series (for charts)',
        description: 'Bucketed message and call counts for plotting. `bucket=hour||day` (default day).',
        security: [{ apiKey: [] }, { bearerAuth: [] }],
        params: InstanceNameParams,
        querystring: RangeQuery,
        response: { 400: ErrorBodySchema, 403: ErrorBodySchema },
      },
    },
    async (request) => {
      const name = resolveInstanceName(request, request.params.name)
      await manager.get(name)
      const q = request.query
      const { from, to, bucket } = parseRange(q)
      // Auto-pick hour for ranges ≤ 3 days if client didn't force
      const effectiveBucket = q.bucket ?? (to.getTime() - from.getTime() <= 3 * 24 * 60 * 60 * 1000 ? 'hour' : bucket)
      const [messages, calls] = await Promise.all([
        metrics.messageSeries(name, from, to, effectiveBucket),
        metrics.callSeries(name, from, to, effectiveBucket),
      ])
      return {
        instance: name,
        range: { from: from.toISOString(), to: to.toISOString() },
        bucket: effectiveBucket,
        messages,
        calls,
        generatedAt: new Date().toISOString(),
      }
    },
  )

  app.get<InstanceParams>(
    scopedInstancePaths('/metrics/resources'),
    {
      schema: {
        tags: ['Metrics'],
        summary: 'Live resource snapshot for instance / process',
        description:
          'Process memory & CPU (Node process), live session share estimate, and storage usage for this instance. ' +
          'CPU/memory are process-wide (multi-session); heap is split equally among live sessions when possible.',
        security: [{ apiKey: [] }, { bearerAuth: [] }],
        params: InstanceNameParams,
        response: { 403: ErrorBodySchema },
      },
    },
    async (request) => {
      const name = resolveInstanceName(request, request.params.name)
      await manager.get(name)

      const proc = sampleProcessResources()
      const liveNames = manager.listLiveSessionNames()
      const live = liveNames.includes(name)
      const n = Math.max(1, liveNames.length)
      const storage = await metrics.storageBreakdown(name)
      // Multi-tenant: only admins see the full live session name list.
      const liveSessionNames = isAdmin(request.actor) ? liveNames : live ? [name] : []

      return {
        instance: name,
        live,
        process: proc,
        liveSessions: liveNames.length,
        liveSessionNames,
        estimatedHeapShareBytes: live ? Math.round(proc.memory.heapUsedBytes / n) : null,
        estimatedRssShareBytes: live ? Math.round(proc.memory.rssBytes / n) : null,
        storage: {
          mediaObjectsBytes: storage.mediaObjectsBytes,
          callRecordingBytes: storage.callRecordingBytes,
          estimatedTotalBytes: storage.estimatedTotalBytes,
          messagesCount: storage.messagesCount,
          chatsCount: storage.chatsCount,
          contactsCount: storage.contactsCount,
        },
        cache: {
          kind: cache?.kind ?? 'unknown',
          note:
            cache?.kind === 'redis'
              ? 'Redis is process-shared; not partitioned per instance'
              : cache?.kind === 'memory'
                ? 'In-memory cache is process-shared'
                : 'No cache configured',
        },
        notes: [
          'CPU/memory metrics are for the whole Node process (all instances).',
          'estimated*ShareBytes divides process memory by live session count.',
          'Storage sizes come from media_objects + call recordings; Postgres row bloat is not fully included.',
        ],
        generatedAt: new Date().toISOString(),
      }
    },
  )
}
