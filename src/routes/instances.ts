import type { FastifyPluginAsync } from 'fastify'
import { requireAdmin, resolveInstanceName, scopedSelfPaths } from '~/auth/plugin'
import {
  CreateInstanceBodySchema,
  ErrorBodySchema,
  EXAMPLES,
  InstanceListResponseSchema,
  InstanceNameParams,
  InstanceResponseSchema,
  InstanceWithKeyResponseSchema,
  OkSchema,
  PairingCodeBodySchema,
  PairingCodeResponseSchema,
  QrResponseSchema,
} from '~/http/openapi-schemas'
import type { InstanceManager } from '~/instances/manager'

export type InstanceRoutesDeps = {
  manager: InstanceManager
}

/**
 * Admin collection: create / list / delete / rotate (paths under `/v1/instances`).
 * Own session: get / connect / qr / … under `/v1/instance` with **instance API key only**.
 */
export const instanceRoutes: FastifyPluginAsync<InstanceRoutesDeps> = async (app, deps) => {
  const { manager } = deps

  app.post(
    '/v1/instances',
    {
      schema: {
        tags: ['Instances'],
        summary: 'Create instance',
        description:
          '**Admin only.** Provisions a new WhatsApp session.\n\n' +
          '- Generates a unique **instance API key** (`apiKey`) — use it for all session operations\n' +
          '- Does **not** open the socket yet — call `POST /v1/instance/connect` with the instance key\n' +
          '- `name` becomes the zapo `sessionId` (stable across restarts)\n\n' +
          '**Example**\n' +
          '```bash\n' +
          'curl -s -X POST "$BASE/v1/instances" \\\n' +
          '  -H "X-Api-Key: $ADMIN_API_KEY" -H "content-type: application/json" \\\n' +
          `  -d '${JSON.stringify(EXAMPLES.createInstance)}'\n` +
          '```',
        security: [{ apiKey: [] }, { bearerAuth: [] }],
        body: CreateInstanceBodySchema,
        response: {
          200: InstanceWithKeyResponseSchema,
          400: ErrorBodySchema,
          401: ErrorBodySchema,
          403: ErrorBodySchema,
          409: ErrorBodySchema,
        },
      },
    },
    async (request) => {
      requireAdmin(request)
      const body = CreateInstanceBodySchema.parse(request.body)
      const instance = await manager.create(body)
      return { instance }
    },
  )

  app.get(
    '/v1/instances',
    {
      schema: {
        tags: ['Instances'],
        summary: 'List instances',
        description:
          '**Admin only.** Returns every instance including **`apiKey`**, **`pushName`**, and **`avatarUrl`** when known.\n\n' +
          '```bash\n' +
          'curl -s "$BASE/v1/instances" -H "X-Api-Key: $ADMIN_API_KEY"\n' +
          '```',
        security: [{ apiKey: [] }, { bearerAuth: [] }],
        response: {
          200: InstanceListResponseSchema,
          401: ErrorBodySchema,
          403: ErrorBodySchema,
        },
      },
    },
    async (request) => {
      requireAdmin(request)
      const instances = await manager.list()
      return { instances }
    },
  )

  app.delete(
    '/v1/instances/:name',
    {
      schema: {
        tags: ['Instances'],
        summary: 'Delete instance (logout)',
        description:
          '**Admin only.** Unlinks the companion device when possible (`logout`), stops the client, and deletes metadata.\n\n' +
          'Irreversible without re-pairing. Prefer `POST /v1/instance/disconnect` (instance key) to stop temporarily.',
        security: [{ apiKey: [] }, { bearerAuth: [] }],
        response: {
          200: OkSchema,
          401: ErrorBodySchema,
          403: ErrorBodySchema,
          404: ErrorBodySchema,
        },
      },
    },
    async (request) => {
      requireAdmin(request)
      const { name } = InstanceNameParams.parse(request.params)
      await manager.delete(name)
      return { ok: true as const }
    },
  )

  app.post(
    '/v1/instances/:name/keys/rotate',
    {
      schema: {
        tags: ['Instances'],
        summary: 'Rotate instance API key',
        description:
          '**Admin only.** Generates a new instance `apiKey`, invalidates the previous one, and returns the instance including the new key.\n\n' +
          'Update all integrations immediately after rotation.',
        security: [{ apiKey: [] }, { bearerAuth: [] }],
        response: {
          200: InstanceWithKeyResponseSchema,
          401: ErrorBodySchema,
          403: ErrorBodySchema,
          404: ErrorBodySchema,
        },
      },
    },
    async (request) => {
      requireAdmin(request)
      const { name } = InstanceNameParams.parse(request.params)
      const instance = await manager.rotateKey(name)
      return { instance }
    },
  )

  // ── Own session (instance API key only) ─────────────────────────────────

  app.get(
    scopedSelfPaths(),
    {
      schema: {
        tags: ['Instances'],
        summary: 'Get own instance',
        description:
          '**Instance key only.** Returns this key’s instance (`apiKey`, `pushName`, `avatarUrl`, status, …).\n\n' +
          '```bash\n' +
          'curl -s "$BASE/v1/instance" -H "X-Api-Key: $INSTANCE_API_KEY"\n' +
          '```',
        security: [{ apiKey: [] }, { bearerAuth: [] }],
        response: {
          200: InstanceResponseSchema,
          401: ErrorBodySchema,
          403: ErrorBodySchema,
          404: ErrorBodySchema,
        },
      },
    },
    async (request) => {
      const name = resolveInstanceName(request)
      const instance = await manager.get(name)
      return { instance }
    },
  )

  app.post(
    scopedSelfPaths('/connect'),
    {
      schema: {
        tags: ['Instances'],
        summary: 'Connect / start own session',
        description:
          '**Instance key only.** Opens the WhatsApp Web socket.\n\n' +
          '```bash\n' +
          'curl -s -X POST "$BASE/v1/instance/connect" -H "X-Api-Key: $INSTANCE_API_KEY"\n' +
          '```',
        security: [{ apiKey: [] }, { bearerAuth: [] }],
        response: {
          200: InstanceResponseSchema,
          401: ErrorBodySchema,
          403: ErrorBodySchema,
          404: ErrorBodySchema,
          503: ErrorBodySchema,
        },
      },
    },
    async (request) => {
      const name = resolveInstanceName(request)
      const instance = await manager.connect(name)
      return { instance }
    },
  )

  app.post(
    scopedSelfPaths('/disconnect'),
    {
      schema: {
        tags: ['Instances'],
        summary: 'Disconnect own session',
        description:
          '**Instance key only.** Closes the socket without unlinking the device. Next `connect` resumes without QR.',
        security: [{ apiKey: [] }, { bearerAuth: [] }],
        response: {
          200: InstanceResponseSchema,
          401: ErrorBodySchema,
          403: ErrorBodySchema,
          404: ErrorBodySchema,
        },
      },
    },
    async (request) => {
      const name = resolveInstanceName(request)
      const instance = await manager.disconnect(name)
      return { instance }
    },
  )

  app.post(
    scopedSelfPaths('/restart'),
    {
      schema: {
        tags: ['Instances'],
        summary: 'Restart own session',
        description: '**Instance key only.** Shortcut for disconnect then connect.',
        security: [{ apiKey: [] }, { bearerAuth: [] }],
        response: {
          200: InstanceResponseSchema,
          401: ErrorBodySchema,
          403: ErrorBodySchema,
          404: ErrorBodySchema,
          503: ErrorBodySchema,
        },
      },
    },
    async (request) => {
      const name = resolveInstanceName(request)
      const instance = await manager.restart(name)
      return { instance }
    },
  )

  app.get(
    scopedSelfPaths('/qr'),
    {
      schema: {
        tags: ['Instances'],
        summary: 'Get own QR payload',
        description:
          '**Instance key only.** Last cached QR string from `auth_qr`.\n\n' +
          '```bash\n' +
          'curl -s "$BASE/v1/instance/qr" -H "X-Api-Key: $INSTANCE_API_KEY"\n' +
          '```',
        security: [{ apiKey: [] }, { bearerAuth: [] }],
        response: {
          200: QrResponseSchema,
          401: ErrorBodySchema,
          403: ErrorBodySchema,
          404: ErrorBodySchema,
        },
      },
    },
    async (request) => {
      const name = resolveInstanceName(request)
      const instance = await manager.get(name)
      return {
        qr: instance.lastQr,
        expiresAt: instance.lastQrAt,
        status: instance.status,
      }
    },
  )

  app.post(
    scopedSelfPaths('/pairing-code'),
    {
      schema: {
        tags: ['Instances'],
        summary: 'Request pairing code (own session)',
        description:
          '**Instance key only.** Requests an 8-character pairing code.\n\n' +
          '```json\n{ "phone": "5511999999999" }\n```',
        security: [{ apiKey: [] }, { bearerAuth: [] }],
        body: PairingCodeBodySchema,
        response: {
          200: PairingCodeResponseSchema,
          400: ErrorBodySchema,
          401: ErrorBodySchema,
          403: ErrorBodySchema,
          404: ErrorBodySchema,
          503: ErrorBodySchema,
        },
      },
    },
    async (request) => {
      const name = resolveInstanceName(request)
      const body = PairingCodeBodySchema.parse(request.body)
      const client = manager.getClient(name)
      const phone = body.phone.replace(/\D/g, '')
      const code = await client.auth.requestPairingCode(phone)
      return { code, phone }
    },
  )
}
