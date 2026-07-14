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
          '- Generates a unique **instance API key**, returned **once** in this response (stored hashed — save it now)\n' +
          '- Does **not** open the socket yet — call `POST .../connect` next\n' +
          '- `name` becomes the zapo `sessionId` (stable across restarts)\n\n' +
          '**Example body**\n' +
          '```json\n' +
          `${JSON.stringify(EXAMPLES.createInstance, null, 2)}\n` +
          '```\n\n' +
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
          '**Admin only.** Returns every instance with full metadata. The **`apiKey` is not included** — ' +
          'it is only shown once at create/rotate. Use `POST .../keys/rotate` to mint a new one.\n\n' +
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

  app.get(
    scopedSelfPaths(),
    {
      schema: {
        tags: ['Instances'],
        summary: 'Get instance',
        description:
          'Returns one instance. Includes **`apiKey`**, **`pushName`**, and **`avatarUrl`** when known.\n\n' +
          '- **Admin** may read any instance\n' +
          '- **Instance key** may only read its own `name` (otherwise `403`) — use this to refresh status/JID/avatar after pairing\n\n' +
          '```bash\n' +
          'curl -s "$BASE/v1/instances/sales-1" -H "X-Api-Key: $KEY"\n' +
          '```',
        security: [{ apiKey: [] }, { bearerAuth: [] }],
        params: InstanceNameParams,
        response: {
          200: InstanceResponseSchema,
          401: ErrorBodySchema,
          403: ErrorBodySchema,
          404: ErrorBodySchema,
        },
      },
    },
    async (request) => {
      const name = resolveInstanceName(request, InstanceNameParams.parse(request.params).name)
      const instance = await manager.get(name)
      return { instance }
    },
  )

  app.post(
    scopedSelfPaths('/connect'),
    {
      schema: {
        tags: ['Instances'],
        summary: 'Connect / start session',
        description:
          'Opens the WhatsApp Web socket for the instance (zapo `client.connect()`).\n\n' +
          '- First time: emits QR (`status: qr`) or pairing flow\n' +
          '- After pairing: resumes from stored credentials (`status: open`)\n' +
          '- Spawns reconnect-with-backoff on transient disconnects\n\n' +
          'Poll `GET .../qr` or listen to webhook `instance.qr` while pairing.\n\n' +
          '```bash\n' +
          'curl -s -X POST "$BASE/v1/instances/sales-1/connect" -H "X-Api-Key: $KEY"\n' +
          '```',
        security: [{ apiKey: [] }, { bearerAuth: [] }],
        params: InstanceNameParams,
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
      const name = resolveInstanceName(request, InstanceNameParams.parse(request.params).name)
      const instance = await manager.connect(name)
      return { instance }
    },
  )

  app.post(
    scopedSelfPaths('/disconnect'),
    {
      schema: {
        tags: ['Instances'],
        summary: 'Disconnect session',
        description:
          'Gracefully closes the socket **without** unlinking the device (`client.disconnect()`).\n\n' +
          'Credentials remain in the zapo store — next `connect` resumes without a new QR.\n\n' +
          'Do **not** confuse with `DELETE` (logout + remove).',
        security: [{ apiKey: [] }, { bearerAuth: [] }],
        params: InstanceNameParams,
        response: {
          200: InstanceResponseSchema,
          401: ErrorBodySchema,
          403: ErrorBodySchema,
          404: ErrorBodySchema,
        },
      },
    },
    async (request) => {
      const name = resolveInstanceName(request, InstanceNameParams.parse(request.params).name)
      const instance = await manager.disconnect(name)
      return { instance }
    },
  )

  app.post(
    scopedSelfPaths('/restart'),
    {
      schema: {
        tags: ['Instances'],
        summary: 'Restart session',
        description: 'Shortcut for `disconnect` then `connect`. Useful after stuck state or config changes.',
        security: [{ apiKey: [] }, { bearerAuth: [] }],
        params: InstanceNameParams,
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
      const name = resolveInstanceName(request, InstanceNameParams.parse(request.params).name)
      const instance = await manager.restart(name)
      return { instance }
    },
  )

  app.delete(
    scopedSelfPaths(),
    {
      schema: {
        tags: ['Instances'],
        summary: 'Delete instance (logout)',
        description:
          '**Admin only.** Unlinks the companion device when possible (`logout`), stops the client, and deletes metadata.\n\n' +
          'Irreversible without re-pairing. Prefer `disconnect` if you only want to stop the process temporarily.',
        security: [{ apiKey: [] }, { bearerAuth: [] }],
        params: InstanceNameParams,
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
      const name = resolveInstanceName(request, InstanceNameParams.parse(request.params).name)
      await manager.delete(name)
      return { ok: true as const }
    },
  )

  app.get(
    scopedSelfPaths('/qr'),
    {
      schema: {
        tags: ['Instances'],
        summary: 'Get current QR payload',
        description:
          'Returns the last cached QR string from event `auth_qr`.\n\n' +
          '- Render `qr` as a QR **image** (dashboard does this automatically)\n' +
          '- `null` when already paired or not in QR state\n' +
          '- WhatsApp rotates QR; keep polling (~2–3s) or use webhook `instance.qr`\n\n' +
          '```bash\n' +
          'curl -s "$BASE/v1/instances/sales-1/qr" -H "X-Api-Key: $KEY"\n' +
          '```',
        security: [{ apiKey: [] }, { bearerAuth: [] }],
        params: InstanceNameParams,
        response: {
          200: QrResponseSchema,
          401: ErrorBodySchema,
          403: ErrorBodySchema,
          404: ErrorBodySchema,
        },
      },
    },
    async (request) => {
      const name = resolveInstanceName(request, InstanceNameParams.parse(request.params).name)
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
        summary: 'Request pairing code',
        description:
          'Requests an 8-character pairing code (`client.auth.requestPairingCode`).\n\n' +
          '**Prerequisites:** instance must be **connected** and in a pairing-capable state.\n' +
          'On the phone: WhatsApp → Linked devices → **Link with phone number instead**.\n\n' +
          '**Example body**\n' +
          '```json\n{ "phone": "5511999999999" }\n```',
        security: [{ apiKey: [] }, { bearerAuth: [] }],
        params: InstanceNameParams,
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
      const name = resolveInstanceName(request, InstanceNameParams.parse(request.params).name)
      const body = PairingCodeBodySchema.parse(request.body)
      const client = manager.getClient(name)
      const phone = body.phone.replace(/\D/g, '')
      const code = await client.auth.requestPairingCode(phone)
      return { code, phone }
    },
  )

  app.post(
    scopedSelfPaths('/keys/rotate'),
    {
      schema: {
        tags: ['Instances'],
        summary: 'Rotate instance API key',
        description:
          '**Admin only.** Generates a new instance `apiKey`, invalidates the previous one, and returns the instance with the new key **shown once**.\n\n' +
          'Update all integrations immediately after rotation.',
        security: [{ apiKey: [] }, { bearerAuth: [] }],
        params: InstanceNameParams,
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
      const name = resolveInstanceName(request, InstanceNameParams.parse(request.params).name)
      const instance = await manager.rotateKey(name)
      return { instance }
    },
  )
}
