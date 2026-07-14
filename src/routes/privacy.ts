import type { FastifyPluginAsync } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import { WA_PRIVACY_CATEGORY_TO_SETTING, WA_PRIVACY_SETTING_TO_CATEGORY, type WaPrivacySettingName } from 'zapo-js'
import { z } from 'zod'
import { resolveInstanceName, scopedInstancePaths } from '~/auth/plugin'
import { InstanceNameParams } from '~/http/openapi-schemas'
import type { InstanceManager } from '~/instances/manager'
import { badRequest } from '~/lib/errors'
import { resolveRecipientJid } from '~/lib/phone-resolve'
import type { CacheClient } from '~/redis/client'

export type PrivacyRoutesDeps = {
  manager: InstanceManager
  cache?: CacheClient
}

/**
 * Accepted `setting` inputs: the `WaPrivacySettingName` camelCase names returned
 * by `GET /privacy`, plus the raw WA category codes (`last`, `profile`, …) for
 * backwards-compatible clients. Both are normalized to a `WaPrivacySettingName`
 * before hitting `client.privacy.setPrivacySetting`.
 */
const PrivacySettingSchema = z.enum([
  // WaPrivacySettingName (camelCase)
  'readReceipts',
  'lastSeen',
  'online',
  'profilePicture',
  'about',
  'groupAdd',
  'callAdd',
  'messages',
  'defenseMode',
  // WA category codes (wire form; `online`/`messages` shared with the names above)
  'readreceipts',
  'last',
  'profile',
  'status',
  'groupadd',
  'calladd',
  'defense',
])

/** Union of every valid value across categories (WaPrivacySettingValueMap). */
const PrivacyValueSchema = z.enum([
  'all',
  'none',
  'contacts',
  'contact_blacklist',
  'match_last_seen',
  'known',
  'off',
  'on_standard',
])

const SetPrivacyBody = z.object({
  setting: PrivacySettingSchema,
  value: PrivacyValueSchema,
})

/** Map either a setting name or a WA category code to the canonical `WaPrivacySettingName`. */
function toPrivacySettingName(input: z.infer<typeof PrivacySettingSchema>): WaPrivacySettingName | null {
  if (input in WA_PRIVACY_SETTING_TO_CATEGORY) return input as WaPrivacySettingName
  return WA_PRIVACY_CATEGORY_TO_SETTING[input as keyof typeof WA_PRIVACY_CATEGORY_TO_SETTING] ?? null
}

const BusinessProfileBody = z.object({
  jids: z.array(z.string().min(1)).min(1).max(20),
})

const BusinessProfileParams = InstanceNameParams.extend({ phone: z.string().min(1) })

export const privacyRoutes: FastifyPluginAsync<PrivacyRoutesDeps> = async (app, deps) => {
  const { manager, cache } = deps
  const r = app.withTypeProvider<ZodTypeProvider>()

  r.get(
    scopedInstancePaths('/privacy'),
    {
      schema: {
        tags: ['Privacy'],
        summary: 'Get privacy settings',
        security: [{ apiKey: [] }, { bearerAuth: [] }],
        params: InstanceNameParams,
      },
    },
    async (request) => {
      const name = resolveInstanceName(request, request.params.name)
      const client = manager.requireRegisteredClient(name)
      const settings = await client.privacy.getPrivacySettings()
      return { settings }
    },
  )

  r.post(
    scopedInstancePaths('/privacy'),
    {
      schema: {
        tags: ['Privacy'],
        summary: 'Set one privacy setting',
        security: [{ apiKey: [] }, { bearerAuth: [] }],
        params: InstanceNameParams,
        body: SetPrivacyBody,
      },
    },
    async (request) => {
      const name = resolveInstanceName(request, request.params.name)
      const setting = toPrivacySettingName(request.body.setting)
      if (!setting) throw badRequest(`unknown privacy setting "${request.body.setting}"`)
      const client = manager.requireRegisteredClient(name)
      await client.privacy.setPrivacySetting(setting, request.body.value)
      return { ok: true as const }
    },
  )

  r.post(
    scopedInstancePaths('/business/profile'),
    {
      schema: {
        tags: ['Business'],
        summary: 'Fetch business profiles for JIDs/phones',
        security: [{ apiKey: [] }, { bearerAuth: [] }],
        params: InstanceNameParams,
        body: BusinessProfileBody,
      },
    },
    async (request) => {
      const name = resolveInstanceName(request, request.params.name)
      const client = manager.requireRegisteredClient(name)
      const resolved: string[] = []
      for (const j of request.body.jids) {
        resolved.push(await resolveRecipientJid(client, j, cache))
      }
      const profiles = await client.business.getBusinessProfile(resolved)
      return { profiles }
    },
  )

  r.get(
    scopedInstancePaths('/business/profile/:phone'),
    {
      schema: {
        tags: ['Business'],
        summary: 'Fetch one business profile',
        security: [{ apiKey: [] }, { bearerAuth: [] }],
        params: BusinessProfileParams,
      },
    },
    async (request) => {
      const { phone } = request.params
      const name = resolveInstanceName(request, request.params.name)
      const client = manager.requireRegisteredClient(name)
      const jid = await resolveRecipientJid(client, phone, cache)
      const profiles = await client.business.getBusinessProfile([jid])
      return { jid, profile: profiles[0] ?? null }
    },
  )
}
