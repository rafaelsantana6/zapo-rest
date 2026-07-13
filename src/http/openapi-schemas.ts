import { z } from 'zod'

/** Free-form JSON for OpenAPI (z.unknown has no type and breaks swagger refs). */
const JsonAny = z.any().meta({ type: 'object', additionalProperties: true })

/**
 * Shared Zod schemas for routes + OpenAPI.
 * Descriptions and `.meta({ example })` feed Scalar via fastify-type-provider-zod → @fastify/swagger.
 */

/** Example payloads used in `.meta({ example })` and prose in the API description. */
export const EXAMPLES = {
  createInstance: {
    name: 'sales-1',
    webhookUrl: 'https://example.com/webhooks/zapo',
    webhookEvents: ['instance.qr', 'instance.connection', 'message.inbound', 'call.incoming'],
  },
  instance: {
    name: 'sales-1',
    apiKey: 'zr_AbCdEfGhIjKlMnOpQrStUvWx',
    webhookUrl: 'https://example.com/webhooks/zapo',
    webhookEvents: ['message.inbound', 'instance.qr'],
    status: 'open' as const,
    meJid: '5511999999999:12@s.whatsapp.net',
    pairPhone: null,
    lastQr: null,
    lastQrAt: null,
    createdAt: '2026-07-11T12:00:00.000Z',
    updatedAt: '2026-07-11T12:05:00.000Z',
  },
  textMessage: {
    to: '5511999999999',
    text: 'Olá! Mensagem enviada via zapo-rest 👋',
    linkPreview: true,
  },
  imageMessage: {
    to: '5511999999999',
    mediaUrl: 'https://picsum.photos/800',
    mimetype: 'image/jpeg',
    caption: 'Foto do produto',
  },
  audioMessage: {
    to: '5511999999999',
    mediaUrl: 'https://example.com/voice.ogg',
    mimetype: 'audio/ogg; codecs=opus',
    ptt: true,
  },
  documentMessage: {
    to: '5511999999999',
    mediaUrl: 'https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf',
    mimetype: 'application/pdf',
    fileName: 'relatorio.pdf',
    caption: 'Segue o PDF',
  },
  checkPhones: { phones: ['5511999999999', '5511888888888'] },
  checkPhonesResult: {
    results: [
      {
        input: '5511999999999',
        phoneJid: '5511999999999@s.whatsapp.net',
        lidJid: '1234567890@lid',
        exists: true,
        matchedNumber: '5511999999999',
        numberExists: true,
        chatId: '5511999999999@s.whatsapp.net',
      },
    ],
  },
  sendMessage: {
    id: '3EB0ABC123DEF456',
    result: { status: 1 },
  },
  startCall: { to: '5511888888888' },
  startCallResponse: {
    callId: 'ABCDEF0123456789',
    peerJid: '5511888888888@s.whatsapp.net',
  },
  callInfo: {
    callId: 'ABCDEF0123456789',
    peerJid: '5511888888888@s.whatsapp.net',
    direction: 'outgoing',
    mediaType: 'audio',
    state: 'active',
    isActive: true,
    isRinging: false,
    isEnded: false,
    canAccept: false,
    audioMuted: false,
    durationSecs: 12,
  },
  qr: {
    qr: '2@abc...,1,key...',
    expiresAt: '2026-07-11T12:01:00.000Z',
    status: 'qr' as const,
  },
  pairingCode: { code: 'ABCD-EFGH', phone: '5511999999999' },
  profilePicture: {
    picture: { url: 'https://cdn.example.com/avatars/sales-1/5511.jpg' },
    jid: '5511999999999@s.whatsapp.net',
    status: 'ok' as const,
    revalidated: false,
    fromStorage: true,
    storageKey: 'avatars/sales-1/5511.jpg',
    sha256: 'e3b0c44298fc1c149afbf4c8996fb924',
    url: 'https://cdn.example.com/avatars/sales-1/5511.jpg',
    cacheTtlSeconds: 86400,
    lastCheckedAt: '2026-07-11T12:00:00.000Z',
    lastFetchedAt: '2026-07-11T11:00:00.000Z',
    cached: true,
    cachedAt: '2026-07-11T11:00:00.000Z',
  },
  webhookMessage: {
    event: 'message.inbound',
    instance: 'sales-1',
    timestamp: '2026-07-11T12:10:00.000Z',
    data: {
      key: { remoteJid: '5511888888888@s.whatsapp.net', fromMe: false, id: 'ABC123' },
      message: { conversation: 'Oi' },
      pushName: 'Cliente',
    },
  },
  error: {
    error: {
      code: 'VALIDATION_ERROR',
      message: 'Invalid request',
      details: { fieldErrors: { to: ['Required'] } },
    },
  },
  health: { status: 'ok' as const },
  ready: { status: 'ready' as const },
  ok: { ok: true as const },
  meAdmin: { role: 'admin' as const },
} as const

/** Read-view example: reads never expose `apiKey` (stored hashed). */
const INSTANCE_READ_EXAMPLE = Object.fromEntries(Object.entries(EXAMPLES.instance).filter(([key]) => key !== 'apiKey'))

export const ErrorBodySchema = z
  .object({
    error: z.object({
      code: z.string().meta({
        description: 'Machine-readable error code (UNAUTHORIZED, FORBIDDEN, NOT_FOUND, VALIDATION_ERROR, …)',
        example: 'VALIDATION_ERROR',
      }),
      message: z.string().meta({ description: 'Human-readable error message', example: 'Invalid request' }),
      details: JsonAny.optional().meta({ description: 'Optional structured details (e.g. Zod flatten)' }),
    }),
  })
  .meta({
    description: 'Standard API error envelope',
    example: EXAMPLES.error,
  })

/** Shared instance name rules — path params and create body stay in lockstep. */
export const InstanceName = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-zA-Z0-9_-]+$/, 'name must be alphanumeric, _ or -')
  .meta({
    description: 'Unique instance name / zapo sessionId (e.g. `sales-1`). Alphanumeric, `_` and `-` only.',
    example: 'sales-1',
  })

export const InstanceNameParams = z.object({
  name: InstanceName,
})

export const InstanceStatusSchema = z
  .enum(['created', 'connecting', 'qr', 'pairing', 'open', 'close', 'logged_out'])
  .meta({
    description: [
      'WhatsApp session lifecycle:',
      '`created` registered but not connected;',
      '`connecting` socket/handshake in progress;',
      '`qr` waiting for QR scan;',
      '`pairing` pairing-code flow;',
      '`open` ready to send/receive;',
      '`close` disconnected (credentials kept);',
      '`logged_out` device unlinked — re-pair required.',
    ].join(' '),
    example: 'open',
  })

/** Fields shared by read and create/rotate views; the API key is layered on separately. */
const instanceBaseShape = z.object({
  name: z.string().meta({ description: 'Instance name / session id', example: EXAMPLES.instance.name }),
  webhookUrl: z
    .string()
    .url()
    .nullable()
    .meta({ description: 'Webhook URL receiving JSON events, or null', example: EXAMPLES.instance.webhookUrl }),
  webhookEvents: z.array(z.string()).meta({
    description:
      'Event allow-list. Empty = all. Examples: `instance.qr`, `instance.connection`, `instance.paired`, `instance.logged_out`, `message.inbound`, `call.incoming`, `call.state`, `call.ended`. `*` = all.',
    example: EXAMPLES.instance.webhookEvents,
  }),
  status: InstanceStatusSchema,
  meJid: z.string().nullable().meta({
    description: 'Linked account JID after pairing (e.g. `5511999999999:12@s.whatsapp.net`)',
    example: EXAMPLES.instance.meJid,
  }),
  pairPhone: z.string().nullable().meta({ description: 'Optional phone hint for pairing-code flows', example: null }),
  lastQr: z
    .string()
    .nullable()
    .meta({ description: 'Raw QR payload from last `auth_qr` event — render as QR image on clients', example: null }),
  lastQrAt: z.string().nullable().meta({ description: 'ISO-8601 time when lastQr was updated', example: null }),
  createdAt: z.string().meta({ description: 'ISO-8601 creation timestamp', example: EXAMPLES.instance.createdAt }),
  updatedAt: z.string().meta({ description: 'ISO-8601 last update timestamp', example: EXAMPLES.instance.updatedAt }),
})

/**
 * Instance API key (plaintext). Returned **once** on create/rotate and never again —
 * only the SHA-256 hash is stored, so reads cannot and do not expose it.
 */
const InstanceApiKeySchema = z.string().meta({
  description:
    'Instance API key in plaintext. Returned only on create/rotate and shown once — store it immediately. ' +
    'Scope: this instance only. Header `X-Api-Key` or `Authorization: Bearer`.',
  example: EXAMPLES.instance.apiKey,
})

/** Read view of an instance — never carries the API key. */
export const InstanceSchema = instanceBaseShape.meta({
  description: 'WhatsApp multi-session instance (read view — API key omitted)',
  example: INSTANCE_READ_EXAMPLE,
})

/** Create / rotate view — includes the freshly minted plaintext API key (shown once). */
export const InstanceWithKeySchema = instanceBaseShape.extend({ apiKey: InstanceApiKeySchema }).meta({
  description: 'WhatsApp instance plus its new API key (create / rotate response only)',
  example: EXAMPLES.instance,
})

export const InstanceResponseSchema = z.object({ instance: InstanceSchema }).meta({
  example: { instance: INSTANCE_READ_EXAMPLE },
})

/** Response envelope for create / rotate — the only responses carrying the plaintext key. */
export const InstanceWithKeyResponseSchema = z.object({ instance: InstanceWithKeySchema }).meta({
  example: { instance: EXAMPLES.instance },
})

export const InstanceListResponseSchema = z.object({ instances: z.array(InstanceSchema) }).meta({
  example: { instances: [INSTANCE_READ_EXAMPLE] },
})

export const OkSchema = z
  .object({
    ok: z.literal(true).meta({ description: 'Operation succeeded', example: true }),
  })
  .meta({ example: EXAMPLES.ok })

export const CreateInstanceBodySchema = z
  .object({
    name: InstanceName.meta({ description: 'Unique instance name (also zapo `sessionId`)', example: 'sales-1' }),
    webhookUrl: z
      .string()
      .url()
      .optional()
      .nullable()
      .meta({ description: 'Optional HTTPS webhook URL for events', example: EXAMPLES.createInstance.webhookUrl }),
    webhookEvents: z.array(z.string()).optional().meta({
      description: 'Optional event filter; omit or empty for all events',
      example: EXAMPLES.createInstance.webhookEvents,
    }),
    pairPhone: z
      .string()
      .optional()
      .nullable()
      .meta({ description: 'Optional phone digits for later pairing-code use', example: '5511999999999' }),
  })
  .meta({
    description: 'Create a new WhatsApp instance',
    example: EXAMPLES.createInstance,
  })

export const PairingCodeBodySchema = z
  .object({
    phone: z.string().min(8).meta({
      description: 'Phone with country code (e.g. `5511999999999`). Non-digits are stripped.',
      example: '5511999999999',
    }),
  })
  .meta({
    description: 'Request 8-char pairing code (Linked devices → Link with phone number)',
    example: { phone: '5511999999999' },
  })

export const PairingCodeResponseSchema = z
  .object({
    code: z.string().meta({ description: '8-character pairing code from WhatsApp', example: 'ABCD-EFGH' }),
    phone: z.string().meta({ description: 'Normalized digits used', example: '5511999999999' }),
  })
  .meta({ example: EXAMPLES.pairingCode })

export const QrResponseSchema = z
  .object({
    qr: z
      .string()
      .nullable()
      .meta({ description: 'Raw QR string to encode as image; null if none cached', example: EXAMPLES.qr.qr }),
    expiresAt: z
      .string()
      .nullable()
      .meta({ description: 'When the QR was last received (server rotates QR)', example: EXAMPLES.qr.expiresAt }),
    status: InstanceStatusSchema,
  })
  .meta({ example: EXAMPLES.qr })

export const RecipientToSchema = z.string().min(1).meta({
  description: 'Recipient: digits (`5511999999999`), PN JID (`…@s.whatsapp.net`), group (`…@g.us`), or LID (`…@lid`)',
  example: '5511999999999',
})

export const SendTextBodySchema = z
  .object({
    to: RecipientToSchema,
    text: z.string().min(1).meta({ description: 'Plain-text body', example: EXAMPLES.textMessage.text }),
    linkPreview: z
      .boolean()
      .optional()
      .meta({ description: 'Force/disable link preview for URLs in text', example: true }),
    mentions: z
      .array(z.string())
      .optional()
      .meta({ description: 'JIDs to mention in groups; include `@number` tokens in text' }),
  })
  .meta({
    description: 'Send a text message',
    example: EXAMPLES.textMessage,
  })

export const SendMediaBodySchema = z
  .object({
    to: RecipientToSchema,
    mediaUrl: z
      .string()
      .url()
      .optional()
      .meta({ description: 'Public HTTPS URL of the file (preferred)', example: EXAMPLES.imageMessage.mediaUrl }),
    mediaBase64: z
      .string()
      .optional()
      .meta({ description: 'Base64 or data-URL media (prefer mediaUrl for large files)' }),
    mimetype: z
      .string()
      .optional()
      .meta({ description: 'MIME type, e.g. image/jpeg, audio/ogg; codecs=opus', example: 'image/jpeg' }),
    caption: z.string().optional().meta({ description: 'Caption (image/document)', example: 'Foto do produto' }),
    fileName: z.string().optional().meta({ description: 'Document display name', example: 'relatorio.pdf' }),
    ptt: z.boolean().optional().meta({ description: 'Audio: send as voice note (PTT)', example: true }),
    viewOnce: z.boolean().optional().meta({ description: 'Image: view-once wrapper', example: false }),
  })
  .meta({
    description: 'Send media — require mediaUrl or mediaBase64',
    example: EXAMPLES.imageMessage,
  })

export const SendMessageResponseSchema = z
  .object({
    id: z.string().meta({ description: 'WhatsApp message / stanza id', example: EXAMPLES.sendMessage.id }),
    result: JsonAny.meta({ description: 'Full zapo WaMessagePublishResult', example: EXAMPLES.sendMessage.result }),
  })
  .meta({ example: EXAMPLES.sendMessage })

export const CheckContactsBodySchema = z
  .object({
    phones: z.array(z.string().min(1)).min(1).max(50).meta({
      description:
        'Phones with country code (max 50). BR 9th digit optional — both forms are tried. Non-digits stripped.',
      example: EXAMPLES.checkPhones.phones,
    }),
  })
  .meta({
    description: 'Batch WhatsApp existence / LID check (variant-aware)',
    example: EXAMPLES.checkPhones,
  })

export const CheckContactsResponseSchema = z
  .object({
    results: z.array(
      z.object({
        input: z.string().optional().meta({ description: 'Original input' }),
        phoneJid: z.string().meta({ description: 'Canonical phone JID (use this for send when exists)' }),
        lidJid: z.string().nullable().meta({ description: 'LID when mapped' }),
        exists: z.boolean().meta({ description: 'Whether the number exists / maps on WhatsApp' }),
        matchedNumber: z.string().nullable().optional().meta({ description: 'Digits form that matched on WA' }),
        numberExists: z.boolean().optional().meta({ description: 'alias of exists' }),
        chatId: z.string().nullable().optional().meta({ description: 'multi-config chat id when exists' }),
      }),
    ),
  })
  .meta({ example: EXAMPLES.checkPhonesResult })

const boolQuery = z
  .union([z.boolean(), z.enum(['true', 'false', '1', '0'])])
  .optional()
  .transform((v) => v === true || v === 'true' || v === '1')

export const ProfilePictureQuerySchema = z.object({
  type: z
    .enum(['preview', 'image'])
    .default('preview')
    .meta({ description: 'preview = compact; image = high resolution', example: 'preview' }),
  /**
   * multi-config: force live fetch from WhatsApp and refresh cache.
   * Default false — serve Redis/memory cache (24h TTL). Do not spam refresh (rate-overlimit).
   */
  refresh: boolQuery.meta({ description: 'Force refresh from WhatsApp (default false; cache 24h)', example: false }),
})

export const ProfilePictureParamsSchema = z.object({
  name: z.string().min(1).meta({ description: 'Instance name', example: 'sales-1' }),
  phone: z.string().min(1).meta({ description: 'Phone digits or JID of the contact', example: '5511999999999' }),
})

export const ProfilePictureResponseSchema = z
  .object({
    picture: JsonAny.nullable().meta({
      description: 'Avatar payload; `url` points to our durable storage (or API file path), not ephemeral WA CDN',
      example: EXAMPLES.profilePicture.picture,
    }),
    jid: z.string().optional().meta({ description: 'Resolved contact JID used for the query' }),
    reason: z
      .string()
      .optional()
      .nullable()
      .meta({ description: 'When picture is null: not-authorized | item-not-found | privacy | …' }),
    status: z.enum(['ok', 'none', 'privacy']).optional(),
    /** true when WhatsApp was queried this request (TTL expired or refresh) */
    revalidated: z.boolean().optional(),
    /** true when image bytes are served from our storage */
    fromStorage: z.boolean().optional(),
    storageKey: z.string().nullable().optional(),
    sha256: z.string().nullable().optional(),
    url: z.string().nullable().optional(),
    cacheTtlSeconds: z
      .number()
      .optional()
      .meta({ description: 'Revalidation TTL (seconds); default 86400 — controls WA IQ, not file lifetime' }),
    lastCheckedAt: z.string().optional(),
    lastFetchedAt: z.string().nullable().optional(),
    /** @deprecated use fromStorage / revalidated */
    cached: z.boolean().optional(),
    cachedAt: z.string().optional(),
  })
  .meta({ example: EXAMPLES.profilePicture })

export const PresenceBodySchema = z
  .object({
    type: z
      .enum(['available', 'unavailable'])
      .meta({ description: 'Account-level online presence', example: 'available' }),
  })
  .meta({ description: 'Broadcast presence', example: { type: 'available' } })

export const ChatstateBodySchema = z
  .object({
    state: z.enum(['composing', 'recording', 'paused']).meta({
      description: 'composing=typing, recording=PTT indicator, paused=stop',
      example: 'composing',
    }),
  })
  .meta({
    description: 'Chat-state indicator for a conversation',
    example: { state: 'composing' },
  })

export const ChatstateParamsSchema = z.object({
  name: z.string().min(1).meta({ description: 'Instance name', example: 'sales-1' }),
  jid: z.string().min(1).meta({
    description: 'Chat JID or phone (URL-encode `@` as %40). Example: 5511999999999',
    example: '5511999999999',
  }),
})

export const StartCallBodySchema = z
  .object({
    to: RecipientToSchema.meta({ description: 'Peer to call — audio-only live VoIP' }),
  })
  .meta({
    description: 'Start outbound voice call (stream PCM over WebSocket; no file autoplay)',
    example: EXAMPLES.startCall,
  })

export const CallInfoSchema = z
  .object({
    callId: z.string().meta({ description: 'Id for control routes and PCM stream', example: EXAMPLES.callInfo.callId }),
    peerJid: z.string().nullable().optional().meta({ example: EXAMPLES.callInfo.peerJid }),
    peerJidRaw: z.string().nullable().optional(),
    peerLid: z.string().nullable().optional(),
    callerPn: z.string().nullable().optional(),
    direction: z.string().nullable().optional().meta({ description: 'outgoing | incoming', example: 'outgoing' }),
    mediaType: z.string().nullable().optional().meta({ description: 'audio', example: 'audio' }),
    createdAt: JsonAny.optional().nullable(),
    state: z
      .string()
      .nullable()
      .optional()
      .meta({ description: 'ringing | connecting | active | ended | …', example: 'active' }),
    isActive: z.boolean().optional(),
    isRinging: z.boolean().optional(),
    isEnded: z.boolean().optional(),
    canAccept: z.boolean().optional(),
    acceptBlocked: z.boolean().optional(),
    audioMuted: z.boolean().optional().nullable(),
    // Live calls often have null duration/endReason until hangup — must allow null (not just optional)
    durationSecs: z.number().nullable().optional(),
    endReason: z.string().nullable().optional(),
  })
  .meta({
    description: 'In-memory VoIP call snapshot',
    example: EXAMPLES.callInfo,
  })

export const StartCallResponseSchema = z
  .object({
    callId: z.string().meta({ example: EXAMPLES.startCallResponse.callId }),
    peerJid: z.string().meta({ example: EXAMPLES.startCallResponse.peerJid }),
  })
  .meta({ example: EXAMPLES.startCallResponse })

export const CallListResponseSchema = z
  .object({ calls: z.array(CallInfoSchema) })
  .meta({ example: { calls: [EXAMPLES.callInfo] } })

export const CallGetResponseSchema = z
  .object({ call: CallInfoSchema.nullable() })
  .meta({ example: { call: EXAMPLES.callInfo } })

export const CallParamsSchema = z.object({
  name: z.string().min(1).meta({ description: 'Instance name', example: 'sales-1' }),
  callId: z.string().min(1).meta({ description: 'Call id from start or webhook', example: 'ABCDEF0123456789' }),
})

export const MuteBodySchema = z
  .object({
    muted: z.boolean().meta({ description: 'true = mute local mic', example: true }),
  })
  .meta({ example: { muted: true } })

export const CallReasonBodySchema = z
  .object({
    reason: z.string().optional().meta({ description: 'Optional reject/end reason', example: 'busy' }),
  })
  .meta({ example: { reason: 'busy' } })

/** Empty POST bodies arrive as `null` — coerce so reject/end without body still work. */
export const CallReasonBodyOptionalSchema = z.preprocess((v) => (v == null || v === '' ? {} : v), CallReasonBodySchema)

export const MeResponseSchema = z
  .union([
    z.object({ role: z.literal('admin') }).meta({ example: EXAMPLES.meAdmin }),
    z.object({ role: z.literal('instance'), instance: InstanceSchema }).meta({
      example: { role: 'instance' as const, instance: EXAMPLES.instance },
    }),
  ])
  .meta({ example: EXAMPLES.meAdmin })

export const HealthResponseSchema = z.object({ status: z.literal('ok') }).meta({ example: EXAMPLES.health })

export const ReadyResponseSchema = z
  .object({ status: z.enum(['ready', 'not_ready']) })
  .meta({ example: EXAMPLES.ready })

export const StreamQuerySchema = z.object({
  apiKey: z.string().optional().meta({
    description: 'API key for browsers (WebSocket cannot always set custom headers). Prefer X-Api-Key when possible.',
    example: 'zr_AbCdEfGhIjKlMnOpQrStUvWx',
  }),
})

export const OPENAPI_TAGS = [
  {
    name: 'Health',
    description: 'Liveness and readiness probes (public — no API key).',
  },
  {
    name: 'Auth',
    description:
      'Authentication uses **two key types**:\n\n' +
      '1. **Admin** — `ADMIN_API_KEY` from environment. Full access: create/list/delete instances, rotate keys, act on any instance.\n' +
      '2. **Instance** — per-instance `apiKey`, returned **once** on create/rotate (stored hashed, never shown again). Scoped to that instance only.\n\n' +
      'Send the key as:\n- Header `X-Api-Key: <key>` **(preferred)**\n- or `Authorization: Bearer <key>`\n\n' +
      'Dashboard login uses the same keys via `GET /v1/me`.',
  },
  {
    name: 'Instances',
    description:
      'Multi-session lifecycle. Each instance is one WhatsApp linked device (zapo `sessionId`).\n\n' +
      '**Typical flow:**\n1. `POST /v1/instances` (admin) → receive `apiKey`\n' +
      '2. `POST /v1/instances/{name}/connect`\n' +
      '3. `GET /v1/instances/{name}/qr` → scan with WhatsApp → Linked devices\n' +
      '4. Status becomes `open` — send messages / receive webhooks\n\n' +
      'Alternatively use pairing code: `POST.../pairing-code` after connect when status is `pairing`/`qr`.',
  },
  {
    name: 'Messages',
    description:
      'Send WhatsApp messages through a connected instance (`status: open`).\n\n' +
      'Supports **text**, **image**, **audio** (incl. PTT), and **document**. Video is not exposed in this API.\n\n' +
      '`to` accepts digits with country code or full JID. Media: provide `mediaUrl` (HTTPS) or `mediaBase64`.',
  },
  {
    name: 'Contacts',
    description:
      'Contact utilities: check if numbers exist on WhatsApp (LID sync) and fetch profile pictures.\n\n' +
      'Instance must be connected. Rate limits may apply on WhatsApp side for bulk checks.',
  },
  {
    name: 'Presence',
    description:
      'Presence and chat-state (typing / recording). Chat-state is per conversation; presence is account-level.',
  },
  {
    name: 'Calls',
    description:
      '**Live VoIP audio only** (WhatsApp voice calls via `@zapo-js/voip`).\n\n' +
      '1. `POST.../calls` with `{ "to": "5511…" }` → `{ callId }`\n' +
      '2. Open WebSocket: `GET /v1/instances/{name}/calls/{callId}/stream?apiKey=...`\n' +
      '3. Exchange binary frames: **Float32 LE mono PCM @ 16 kHz**\n' +
      '4. Control: accept / reject / end / mute\n\n' +
      'No file autoplay when the peer answers — real phone-style streaming.\n' +
      'Multiple concurrent calls per instance up to `VOIP_MAX_CONCURRENT_CALLS`.',
  },
  {
    name: 'Metrics',
    description:
      'Per-instance analytics: message/call time series for charts, media storage breakdown, ' +
      'and process resource snapshots (memory/CPU are process-wide; storage is per-instance).',
  },
  {
    name: 'Webhooks',
    description:
      'When `webhookUrl` is set on an instance, events are **HTTP POST** JSON:\n\n' +
      '```json\n' +
      '{\n' +
      ' "event": "message.inbound",\n' +
      ' "instance": "sales-1",\n' +
      ' "timestamp": "2026-07-11T12:10:00.000Z",\n' +
      ' "data": { }\n' +
      '}\n' +
      '```\n\n' +
      '**Events:** `instance.qr`, `instance.connection`, `instance.paired`, `instance.logged_out`, ' +
      '`message.inbound`, `call.incoming`, `call.state`, `call.ended`.\n\n' +
      'Filter with `webhookEvents` on create (empty = all). Delivery is best-effort with timeout `WEBHOOK_TIMEOUT_MS`.',
  },
] as const
