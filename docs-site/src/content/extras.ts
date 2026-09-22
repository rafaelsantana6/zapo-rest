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
  {
    id: 'get-profile-username',
    method: 'GET',
    path: '/v1/profile/username',
    summary: 'Get own username',
    description:
      'Handle atual da conta. `username: null` quando não há. O PIN de recuperação não é devolvido.\n\n' +
      'Mudança em outro aparelho: webhook `profile.username`.',
    tags: ['Profile'],
    security: true,
    responseExample: { username: 'loja', state: 'ACTIVE' },
  },
  {
    id: 'put-profile-username',
    method: 'PUT',
    path: '/v1/profile/username',
    summary: 'Set own username',
    description: 'Publica ou reserva o handle. `409` se o servidor recusar (ocupado, rate-limit).',
    tags: ['Profile'],
    security: true,
    bodyExample: { username: 'loja' },
    responseExample: { ok: true, username: 'loja' },
  },
  {
    id: 'delete-profile-username',
    method: 'DELETE',
    path: '/v1/profile/username',
    summary: 'Delete own username',
    description: 'Remove o handle da conta.',
    tags: ['Profile'],
    security: true,
    responseExample: { ok: true },
  },
  {
    id: 'get-profile-username-check',
    method: 'GET',
    path: '/v1/profile/username/check',
    summary: 'Check username availability',
    description: 'Query `username`. Devolve `available` e `suggestions`.',
    tags: ['Profile'],
    security: true,
    responseExample: { available: false, suggestions: ['loja2'] },
  },
  {
    id: 'post-profile-username-resolve',
    method: 'POST',
    path: '/v1/profile/username/resolve',
    summary: 'Resolve a username to a JID',
    description:
      '`found` traz o LID (`jid`) e `pnJid` quando o WhatsApp revela. `key-required` pede `usernameKey` ou `@handle:1234`. O envio para `@handle` usa a mesma resolução.',
    tags: ['Profile'],
    security: true,
    bodyExample: { username: '@loja' },
    responseExample: {
      status: 'found',
      username: 'loja',
      jid: '123@lid',
      pnJid: '5511999999999@s.whatsapp.net',
      isBusiness: false,
    },
  },
  {
    id: 'post-group-share-history',
    method: 'POST',
    path: '/v1/groups/{groupId}/share-history',
    summary: 'Share group history with members who joined later',
    description:
      'Envia o bundle só para `to` e um aviso oculto para o grupo. A conta precisa de `group_history_send`. ' +
      '`to` aceita telefone, JID ou `@handle`, no modo de endereçamento do grupo. Sem `noticeMessageId` o bundle já foi entregue — não repetir.\n\n' +
      'Receber: `HISTORY_GROUP_BUNDLES` (padrão ligado) importa o bundle e emite `history.group`.',
    tags: ['Groups'],
    security: true,
    params: ['groupId'],
    bodyExample: { to: ['5511999999999@s.whatsapp.net'], count: 50 },
    responseExample: {
      bundleMessageId: '3EB0ABC',
      noticeMessageId: '3EB0DEF',
      messagesCount: 50,
      historyReceivers: ['5511999999999@s.whatsapp.net'],
      nonHistoryReceivers: [],
    },
  },
]
