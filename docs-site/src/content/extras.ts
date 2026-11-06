import type { EndpointDoc } from './endpoints.generated'

/** Routes present in the API but missing/stale in openapi.json export. */
export const EXTRA_ENDPOINTS: EndpointDoc[] = [
  {
    id: 'sse-v1-events',
    method: 'GET',
    path: '/v1/events',
    summary: 'SSE event stream (server → client)',
    description:
      'Canal **unidirecional** (Server-Sent Events) para eventos ao vivo (mensagens, conexão, calls, presence, chatstate…).\n\n' +
      '**URL:** `GET /v1/events?instance=<opcional>`\n' +
      '**Auth (preferido):** header `X-Api-Key` ou `Authorization: Bearer`\n' +
      '**Auth (evitar):** `?apiKey=` — só se o cliente for `EventSource` nativo\n' +
      '**Content-Type:** `text/event-stream`\n\n' +
      '- Instance keys ficam sempre escopadas à própria instância.\n' +
      '- Admin pode filtrar com `instance=` ou receber de todas.\n' +
      '- Primeiro frame: `{ "event": "connected", "role", "instance", "timestamp" }`.\n' +
      '- Keepalive: comentário SSE `: ping <ts>` a cada 15s.\n' +
      '- VoIP bidirecional continua em **WebSocket** (`/v1/voip` + PCM stream).',
    tags: ['Realtime'],
    security: true,
    responseExample: {
      event: 'connected',
      role: 'instance',
      instance: 'sales-1',
      timestamp: '2026-07-11T12:00:00.000Z',
    },
    notes: [
      'Prefira header — key na URL vaza em access logs / proxies / histórico.',
      'Dashboard usa fetch+stream com X-Api-Key (não EventSource).',
      'Envelope igual ao bus de webhooks (instance, event, eventId, timestamp, data).',
    ],
  },
  {
    id: 'ws-v1-voip',
    method: 'GET',
    path: '/v1/voip',
    summary: 'VoIP control WebSocket (signaling)',
    description:
      'Control plane do softphone. JSON text frames.\n\n' +
      '**URL:** `ws(s)://<host>/v1/voip?apiKey=<key>&instance=<opcional>`\n\n' +
      '**Client → server:** `instance:attach`, `call:start`, `call:accept`, `call:reject`, `call:end`, `call:mute`, `ping`.\n\n' +
      '**Server → client:** `ready`, `ack`, `calls:snapshot`, `call:offer`, `call:ringing`, `call:accepted`, `call:state`, `call:ended`, `device:status`, `pong`.\n\n' +
      'Áudio PCM permanece em `GET.../calls/{callId}/stream` (canal separado).',
    tags: ['Calls'],
    security: true,
    bodyExample: {
      op: 'call:start',
      id: 'req-1',
      phone: '5511999999999',
      contactName: 'Cliente',
    },
    notes: [
      'Não faz polling HTTP de calls — o softphone assina este WS.',
      'Accept só funciona em incoming_ringing (não em outbound ringing).',
    ],
  },
  {
    id: 'post-presence-subscribe',
    method: 'POST',
    path: '/v1/instances/{name}/presence/subscribe',
    summary: 'Subscribe to peer presence & chatstate',
    description:
      'Inscreve online/offline e indicadores typing/recording para um chat.\n\n' +
      'Expande aliases PN↔LID e marca a sessão como `available`. Re-subscribe após reconnect.\n\n' +
      'Eventos: `presence.update`, `chatstate`.',
    tags: ['Presence'],
    security: true,
    bodyExample: { jid: '5511999999999' },
    responseExample: {
      ok: true,
      jid: '5511999999999@s.whatsapp.net',
      jids: ['5511999999999@s.whatsapp.net', '1234567890@lid'],
    },
  },
  {
    id: 'get-calls-history',
    method: 'GET',
    path: '/v1/instances/{name}/calls/history',
    summary: 'List call history (DB)',
    description:
      'Histórico persistido de chamadas. Query: `limit`, `offset`, `withRecording=true` para só gravações baixáveis.',
    tags: ['Calls'],
    security: true,
  },
  {
    id: 'get-call-recording-setting',
    method: 'GET',
    path: '/v1/instances/{name}/settings/call-recording',
    summary: 'Get call recording setting',
    description: 'Retorna `{ callRecordingEnabled, storageReady }`. Gravação exige storage local ou S3.',
    tags: ['Calls'],
    security: true,
    responseExample: { callRecordingEnabled: true, storageReady: true },
  },
  {
    id: 'put-call-recording-setting',
    method: 'PUT',
    path: '/v1/instances/{name}/settings/call-recording',
    summary: 'Enable/disable call recording',
    description: 'Ativa gravação WAV estéreo (local||remote) no object storage. Requer `MEDIA_STORAGE=local||s3`.',
    tags: ['Calls'],
    security: true,
    bodyExample: { enabled: true },
  },
  {
    id: 'get-call-recording',
    method: 'GET',
    path: '/v1/instances/{name}/calls/{callId}/recording',
    summary: 'Download call recording (WAV)',
    description: 'Baixa o WAV da gravação se existir em storage. 404 se não gravado / storage off.',
    tags: ['Calls'],
    security: true,
  },
  {
    id: 'post-reconcile-lids',
    method: 'POST',
    path: '/v1/instances/{name}/chats/reconcile-lids',
    summary: 'Reconcile LID→PN chats',
    description:
      'Mescla chats duplicados quando o mesmo peer aparece como `@lid` e `@s.whatsapp.net`. Preferência de storage é PN.',
    tags: ['Chats'],
    security: true,
  },
  {
    id: 'post-getBase64',
    method: 'POST',
    path: '/v1/instances/{name}/media/getBase64FromMediaMessage',
    summary: 'Get media as base64 (API parity)',
    description:
      'Baixa mídia (storage → decrypt live) e devolve base64 + mimetype. Aceita `{ messageId }` ou legacy envelope `{ message: { key: { id } } }`.',
    tags: ['Media'],
    security: true,
    bodyExample: { messageId: 'ABC123XYZ' },
    responseExample: {
      base64: '/9j/4AAQ…',
      mimetype: 'image/jpeg',
      fileName: null,
    },
  },
  {
    id: 'post-getBase64-alias',
    method: 'POST',
    path: '/v1/instances/{name}/chat/getBase64FromMediaMessage',
    summary: 'legacy alias: getBase64FromMediaMessage',
    description: 'Mesmo comportamento de `POST.../media/getBase64FromMediaMessage` (legacy path).',
    tags: ['Media'],
    security: true,
    bodyExample: {
      message: { key: { id: 'ABC123XYZ', remoteJid: '5511999999999@s.whatsapp.net', fromMe: false } },
    },
  },
]
