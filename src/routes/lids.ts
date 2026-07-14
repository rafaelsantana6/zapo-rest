import type { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'
import { resolveInstanceName, scopedInstancePaths } from '~/auth/plugin'
import { ErrorBodySchema, InstanceNameParams } from '~/http/openapi-schemas'
import type { InstanceManager } from '~/instances/manager'
import { notFound } from '~/lib/errors'
import { digitsOnly } from '~/lib/phone'
import type { LidStore } from '~/store/lids'

export type LidRoutesDeps = {
  manager: InstanceManager
  lids: LidStore
}

type InstanceParams = { Params: z.infer<typeof InstanceNameParams> }

export const lidRoutes: FastifyPluginAsync<LidRoutesDeps> = async (app, deps) => {
  const { manager, lids } = deps

  app.get<InstanceParams & { Querystring: { limit?: number; offset?: number } }>(
    scopedInstancePaths('/lids'),
    {
      schema: {
        tags: ['Lids'],
        summary: 'List LID ↔ phone mappings',
        description:
          'multi-config LID directory from app_contacts + zapo mailbox_contacts.\n' +
          'Populated as contacts/history/usync resolve PN↔LID pairs.',
        security: [{ apiKey: [] }, { bearerAuth: [] }],
        params: InstanceNameParams,
        querystring: z.object({
          limit: z.coerce.number().int().positive().max(500).optional(),
          offset: z.coerce.number().int().nonnegative().optional(),
        }),
      },
    },
    async (request) => {
      const name = resolveInstanceName(request, request.params.name)
      await manager.get(name)
      const q = request.query
      const rows = await lids.list(name, { limit: q.limit, offset: q.offset })
      return {
        lids: rows.map((row) => ({
          lid: row.lid,
          pn: row.pn,
          phoneNumber: row.pn,
          displayName: row.displayName,
          pushName: row.pushName,
          source: row.source,
        })),
      }
    },
  )

  app.get<InstanceParams>(
    scopedInstancePaths('/lids/count'),
    {
      schema: {
        tags: ['Lids'],
        summary: 'Count known LIDs',
        security: [{ apiKey: [] }, { bearerAuth: [] }],
        params: InstanceNameParams,
      },
    },
    async (request) => {
      const name = resolveInstanceName(request, request.params.name)
      await manager.get(name)
      const count = await lids.count(name)
      return { count }
    },
  )

  // Register static path segments before :lid param
  app.get<{ Params: z.infer<typeof InstanceNameParams> & { phone: string } }>(
    scopedInstancePaths('/lids/pn/:phone'),
    {
      schema: {
        tags: ['Lids'],
        summary: 'Get LID by phone number',
        security: [{ apiKey: [] }, { bearerAuth: [] }],
        params: InstanceNameParams.extend({ phone: z.string() }),
      },
    },
    async (request) => {
      const params = request.params
      const name = resolveInstanceName(request, params.name)
      const lid = await lids.findLidByPn(name, params.phone)
      if (!lid) throw notFound(`no lid for phone ${digitsOnly(params.phone)}`)
      return { phone: digitsOnly(params.phone), lid }
    },
  )

  app.get<{ Params: z.infer<typeof InstanceNameParams> & { lid: string } }>(
    scopedInstancePaths('/lids/:lid'),
    {
      schema: {
        tags: ['Lids'],
        summary: 'Get phone number by LID',
        security: [{ apiKey: [] }, { bearerAuth: [] }],
        params: InstanceNameParams.extend({ lid: z.string() }),
        response: { 404: ErrorBodySchema },
      },
    },
    async (request) => {
      const params = request.params
      const name = resolveInstanceName(request, params.name)
      if (params.lid === 'count' || params.lid === 'pn') {
        throw notFound('not found')
      }
      const row = await lids.findByLid(name, params.lid)
      if (!row) throw notFound(`lid "${params.lid}" not found`)
      return {
        lid: row.lid,
        pn: row.pn,
        phoneNumber: row.pn,
        displayName: row.displayName,
        pushName: row.pushName,
      }
    },
  )
}
