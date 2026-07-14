import { type EndpointDoc, ENDPOINTS as GENERATED, type HttpMethod } from './endpoints.generated'
import { EXTRA_ENDPOINTS } from './extras'

const RESPONSE_EXAMPLES: Record<string, unknown> = {
  'GET /health': { status: 'ok' },
  'GET /ready': { status: 'ready' },
  'GET /v1/me': { role: 'admin' },
  'POST /v1/instances': {
    instance: {
      name: 'sales-1',
      apiKey: 'zr_AbCdEfGhIjKlMnOpQrStUvWx',
      webhookUrl: 'https://example.com/webhooks/zapo',
      webhookEvents: ['message.inbound', 'call.incoming'],
      status: 'created',
      meJid: null,
      pairPhone: null,
      lastQr: null,
      lastQrAt: null,
      createdAt: '2026-07-11T12:00:00.000Z',
      updatedAt: '2026-07-11T12:00:00.000Z',
    },
  },
  'GET /v1/instances/{name}/qr': {
    qr: '2@abc...,1,KEY,...',
    expiresAt: '2026-07-11T12:01:00.000Z',
    status: 'qr',
  },
  'POST /v1/instances/{name}/messages/text': {
    id: '3EB0ABC123',
    result: { id: '3EB0ABC123', status: 1 },
  },
  'POST /v1/instances/{name}/contacts/check': {
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
  'POST /v1/instances/{name}/calls': {
    callId: 'call_01HXYZ',
    peerJid: '5511888888888@s.whatsapp.net',
  },
  'GET /v1/instances/{name}/calls': {
    calls: [
      {
        callId: 'call_01HXYZ',
        peerJid: '5511888888888@s.whatsapp.net',
        direction: 'incoming',
        state: 'incoming_ringing',
        isRinging: true,
        canAccept: true,
        isActive: false,
        audioMuted: false,
      },
    ],
  },
}

const NOTES: Record<string, string[]> = {
  'POST /v1/instances': [
    'Admin only.',
    'Não abre o socket — chame POST .../connect em seguida.',
    'apiKey da instância é retornada em plaintext e sempre legível via GET.',
  ],
  'POST /v1/instances/{name}/messages/text': [
    'Requer status: open.',
    'to aceita dígitos, PN JID, group @g.us ou LID @lid.',
    'Mensagem é upserted no store local (source: live).',
    'Com instance key o path curto /v1/messages/text também funciona (nome inferido da key). Admin precisa de :name.',
  ],
  'POST /v1/instances/{name}/calls': [
    'Áudio live via WebSocket PCM — não há autoplay de arquivo.',
    'Após start, abra .../calls/{callId}/stream e/ou controle via /v1/voip.',
  ],
  'POST /v1/instances/{name}/calls/{callId}/accept': [
    'Só aceita incoming ringing (canAccept: true).',
    'Outbound ringing NÃO deve chamar accept.',
  ],
}

function dedupeKey(ep: EndpointDoc) {
  return `${ep.method} ${ep.path}`
}

function enrich(ep: EndpointDoc): EndpointDoc {
  const key = dedupeKey(ep)
  return {
    ...ep,
    responseExample: ep.responseExample ?? RESPONSE_EXAMPLES[key],
    notes: ep.notes ?? NOTES[key],
    bodyExample: ep.bodyExample ?? undefined,
  }
}

const merged = new Map<string, EndpointDoc>()
for (const ep of GENERATED) {
  merged.set(dedupeKey(ep), enrich(ep as EndpointDoc))
}
for (const ep of EXTRA_ENDPOINTS) {
  if (!merged.has(dedupeKey(ep))) merged.set(dedupeKey(ep), enrich(ep))
}

export type { EndpointDoc, HttpMethod }

export const ALL_ENDPOINTS: EndpointDoc[] = [...merged.values()].sort((a, b) => {
  const ta = (a.tags[0] ?? 'Z').localeCompare(b.tags[0] ?? 'Z')
  if (ta) return ta
  return a.path.localeCompare(b.path) || a.method.localeCompare(b.method)
})

export function endpointsByTag(tag: string): EndpointDoc[] {
  return ALL_ENDPOINTS.filter((e) => e.tags.includes(tag))
}

export function allTags(): string[] {
  const s = new Set<string>()
  for (const e of ALL_ENDPOINTS) for (const t of e.tags) s.add(t)
  return [...s].sort()
}

export function findEndpoint(id: string): EndpointDoc | undefined {
  return ALL_ENDPOINTS.find((e) => e.id === id)
}

export function buildCurl(ep: EndpointDoc, base = '$BASE'): string {
  const path = ep.path.replace(/\{(\w+)\}/g, (_, p) => {
    if (p === 'name') return 'sales-1'
    if (p === 'callId') return 'call_01HXYZ'
    if (p === 'chatId' || p === 'jid') return '5511999999999%40s.whatsapp.net'
    if (p === 'messageId') return '3EB0ABC123'
    if (p === 'groupId') return '120363...%40g.us'
    if (p === 'webhookId') return 'wh_01'
    if (p === 'labelId') return '1'
    if (p === 'phone') return '5511999999999'
    if (p === 'lid') return '1234567890'
    if (p === 'instance') return 'sales-1'
    if (p === 'key') return 'media%2Fsales-1%2Fabc.jpg'
    return `:${p}`
  })

  const isSse = ep.path === '/v1/events'
  if (isSse) {
    return `curl -N -s "$BASE${path}?instance=sales-1" \\\n  -H "X-Api-Key: $KEY" \\\n  -H "Accept: text/event-stream"`
  }
  const isWs = ep.path === '/v1/voip' || ep.path.endsWith('/stream')
  if (isWs) {
    return `# WebSocket\nwscat -c "ws://localhost:3000${path}?apiKey=$KEY"`
  }

  const lines = [`curl -s -X ${ep.method} "${base}${path}"`]
  if (ep.security !== false && !['/health', '/ready'].includes(ep.path)) {
    lines.push('  -H "X-Api-Key: $KEY"')
  }
  if (ep.bodyExample && ['POST', 'PUT', 'PATCH'].includes(ep.method)) {
    lines.push('  -H "content-type: application/json"')
    lines.push(`  -d '${JSON.stringify(ep.bodyExample)}'`)
  }
  return lines.join(' \\\n')
}
