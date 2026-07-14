import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import swagger from '@fastify/swagger'
import scalarApiReference from '@scalar/fastify-api-reference'
import type { FastifyPluginAsync } from 'fastify'
import fp from 'fastify-plugin'
import { createJsonSchemaTransform, jsonSchemaTransformObject } from 'fastify-type-provider-zod'
import { injectMultipartMediaBodies } from '~/http/openapi-multipart'
import { EXAMPLES, OPENAPI_TAGS } from '~/http/openapi-schemas'

function packageVersion(): string {
  try {
    const root = join(dirname(fileURLToPath(import.meta.url)), '../..')
    const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { version?: string }
    return pkg.version ?? '0.0.0'
  } catch {
    return '0.0.0'
  }
}

const API_DESCRIPTION = `
# zapo-rest

REST API multi-session para WhatsApp baseada em [zapo-js](https://zapo.to).

## Autenticação

| Tipo | Origem | Escopo |
|------|--------|--------|
| **Admin** | env \`ADMIN_API_KEY\` | Todas as instâncias + create/delete/rotate |
| **Instance** | campo \`apiKey\` da instância (plaintext) | Somente a instância dona da key |

Envie em **todas** as rotas \`/v1/*\`:

\`\`\`http
X-Api-Key: <sua-chave>
\`\`\`

ou

\`\`\`http
Authorization: Bearer <sua-chave>
\`\`\`

\`GET /health\` e \`GET /ready\` são públicos.

## Escopo da instância (dual path)

| Quem | Path |
|------|------|
| **Admin** | **Sempre** com nome: \`/v1/instances/:name/...\` (omitir o nome → 400) |
| **Instance key** | Nomeado **ou** forma curta sem nome |

Forma curta (só com instance key — a instância é inferida da API key):

- Recursos: \`/v1/messages/text\`, \`/v1/chats\`, \`/v1/contacts\`, … (equivale a \`/v1/instances/:name/...\`)
- Ciclo de vida: \`/v1/instance\`, \`/v1/instance/connect\`, \`/v1/instance/qr\`, … (singular \`instance\`, não colide com \`/v1/instances\`)

## Fluxo rápido (instância)

\`\`\`bash
# 1) Criar (admin)
curl -s -X POST "$BASE/v1/instances" \\
  -H "X-Api-Key: $ADMIN_API_KEY" -H "content-type: application/json" \\
  -d '${JSON.stringify(EXAMPLES.createInstance)}'

# 2) Conectar
curl -s -X POST "$BASE/v1/instances/sales-1/connect" -H "X-Api-Key: $ADMIN_API_KEY"

# 3) QR
curl -s "$BASE/v1/instances/sales-1/qr" -H "X-Api-Key: $ADMIN_API_KEY"

# 4) Enviar texto (admin: path com nome)
curl -s -X POST "$BASE/v1/instances/sales-1/messages/text" \\
  -H "X-Api-Key: $ADMIN_API_KEY" -H "content-type: application/json" \\
  -d '${JSON.stringify(EXAMPLES.textMessage)}'

# 4b) Enviar texto (instance key: forma curta sem nome)
curl -s -X POST "$BASE/v1/messages/text" \\
  -H "X-Api-Key: $INSTANCE_API_KEY" -H "content-type: application/json" \\
  -d '${JSON.stringify(EXAMPLES.textMessage)}'
\`\`\`

## Webhooks

Payload envelope:

\`\`\`json
${JSON.stringify(EXAMPLES.webhookMessage, null, 2)}
\`\`\`

## VoIP (áudio live)

Após \`POST.../calls\`, abra o WebSocket:

\`\`\`
ws(s)://<host>/v1/instances/{name}/calls/{callId}/stream?apiKey=<key>
\`\`\`

- Server → JSON \`{ "op": "ready", "sampleRate": 16000, "format": "f32le" }\`
- Client ↔ server: frames **binários** Float32 LE mono @ 16 kHz
- Backpressure: JSON \`{ "op": "backpressure", "pause": true | false }\`

## Erros

Todas as falhas usam:

\`\`\`json
{ "error": { "code": "UNAUTHORIZED", "message": "…", "details": {} } }
\`\`\`

Códigos comuns: \`UNAUTHORIZED\`, \`FORBIDDEN\`, \`NOT_FOUND\`, \`CONFLICT\`, \`VALIDATION_ERROR\`, \`SERVICE_UNAVAILABLE\`, \`BAD_REQUEST\`.

## Mídia (URL · base64 · upload)

Rotas de envio de mídia e avatar aceitam **uma** das fontes:

| Content-Type | Campos |
|--------------|--------|
| \`application/json\` | \`mediaUrl\` e/ou \`mediaBase64\` (+ metadados) |
| \`multipart/form-data\` | arquivo \`file\` (aliases: \`media\`, \`audio\`, \`image\`, \`document\`, \`video\`, \`sticker\`) + campos de texto |

Limite: env \`MEDIA_UPLOAD_MAX_BYTES\` (padrão **100 MiB**).

\`\`\`bash
# Avatar por upload
curl -s -X PUT "$BASE/v1/profile/image" -H "X-Api-Key: $INSTANCE_API_KEY" \\
  -F file=@./avatar.jpg

# Imagem de mensagem por multipart
curl -s -X POST "$BASE/v1/messages/image" -H "X-Api-Key: $INSTANCE_API_KEY" \\
  -F to=5511999999999 -F file=@./foto.jpg -F caption="oi"
\`\`\`

Endpoints: \`PUT /v1/profile/image|picture\`, \`PUT /v1/groups/:id/picture\`,
\`POST /v1/messages/{image,video,audio,document,sticker}\`, \`POST /v1/status/send\`,
\`POST /v1/calls/blast\` (WAV).

## OpenAPI

- **UI (Scalar):** [\`/docs\`](/docs) — escolha *multipart/form-data* no request body para o seletor de arquivo
- **JSON:** [\`/docs/json\`](/docs/json) — gerado a partir dos schemas Zod + multipart injetado

## Guia rico

Documentação narrativa (arquitetura, fluxos, exemplos): **[/guide](/guide/)**.
`.trim()

const plugin: FastifyPluginAsync = async (app) => {
  await app.register(swagger, {
    openapi: {
      openapi: '3.1.0',
      info: {
        title: 'zapo-rest API',
        description: API_DESCRIPTION,
        version: packageVersion(),
        contact: {
          name: 'zapo-rest',
        },
        license: {
          name: 'MIT',
        },
      },
      servers: [
        {
          url: 'http://localhost:3000',
          description: 'Local development',
        },
        {
          url: '/',
          description: 'Current host',
        },
      ],
      tags: [...OPENAPI_TAGS],
      components: {
        securitySchemes: {
          apiKey: {
            type: 'apiKey',
            name: 'X-Api-Key',
            in: 'header',
            description: 'Admin (`ADMIN_API_KEY`) or instance `apiKey`. Preferred authentication method.',
          },
          bearerAuth: {
            type: 'http',
            scheme: 'bearer',
            description: 'Same key as X-Api-Key, sent as `Authorization: Bearer <key>`.',
          },
        },
      },
      security: [{ apiKey: [] }, { bearerAuth: [] }],
      externalDocs: {
        description: 'zapo protocol documentation',
        url: 'https://zapo.to/en/introduction',
      },
    },
    transform: createJsonSchemaTransform({
      // Hide Scalar/static assets from the OpenAPI document itself
      skipList: [
        '/docs',
        '/docs/',
        '/docs/json',
        '/docs/yaml',
        '/documentation/',
        '/documentation/json',
        '/documentation/yaml',
        '/documentation/static/*',
        '/documentation/*',
      ],
    }),
    transformObject: (input) => {
      const openapiObject = jsonSchemaTransformObject(input) as Record<string, unknown>
      return injectMultipartMediaBodies(injectWebsocketStreamPath(openapiObject))
    },
  })

  // Machine-readable OpenAPI (export script + Scalar/tools)
  app.get('/docs/json', { schema: { hide: true } }, async () => app.swagger())

  await app.register(scalarApiReference, {
    routePrefix: '/docs',
    configuration: {
      theme: 'kepler',
      layout: 'modern',
      darkMode: true,
      hideModels: false,
      defaultHttpClient: {
        targetKey: 'shell',
        clientKey: 'curl',
      },
      metaData: {
        title: 'zapo-rest API Reference',
      },
    },
  })
}

export const swaggerPlugin = fp(plugin, { name: 'swagger' })

/** @fastify/websocket routes are often omitted from OAS — inject VoIP stream docs. */
function injectWebsocketStreamPath(document: Record<string, unknown>) {
  const paths = { ...((document.paths ?? {}) as Record<string, unknown>) }
  const pathKey = '/v1/instances/{name}/calls/{callId}/stream'
  paths[pathKey] = {
    get: {
      tags: ['Calls'],
      summary: 'WebSocket live PCM audio stream',
      description: [
        '**WebSocket upgrade** for bidirectional live VoIP audio (not a plain HTTP JSON response).',
        '',
        '### URL',
        '```',
        'ws(s)://<host>/v1/instances/{name}/calls/{callId}/stream?apiKey=<key>',
        '```',
        '',
        'Auth: query `apiKey` (browsers) and/or header `X-Api-Key`.',
        '',
        '### Protocol',
        '1. Server → JSON text: `{ "op": "ready", "sampleRate": 16000, "channels": 1, "format": "f32le", "callId": "..." }`',
        '2. Client → server **binary**: Float32 LE mono PCM @ 16 kHz (microphone)',
        '3. Server → client **binary**: same format (peer audio)',
        '4. Backpressure JSON: `{ "op": "backpressure", "pause": true | false, "bufferedMs": N }`',
        '5. End: `{ "op": "ended", "callId": "..." }` then socket close',
        '',
        'Uses `setExternalAudioMode` — **no file autoplay**. Multi-call supported up to `VOIP_MAX_CONCURRENT_CALLS`.',
      ].join('\n'),
      operationId: 'streamCallAudio',
      security: [{ apiKey: [] }, { bearerAuth: [] }],
      parameters: [
        {
          name: 'name',
          in: 'path',
          required: true,
          schema: { type: 'string' },
          description: 'Instance name',
          example: 'sales-1',
        },
        {
          name: 'callId',
          in: 'path',
          required: true,
          schema: { type: 'string' },
          description: 'Call id from POST.../calls or webhook call.incoming',
        },
        {
          name: 'apiKey',
          in: 'query',
          required: false,
          schema: { type: 'string' },
          description: 'API key for browser WebSocket clients',
        },
      ],
      responses: {
        '101': {
          description: 'Switching Protocols — WebSocket connection established',
        },
        '401': { description: 'Missing/invalid API key (socket close 4401)' },
        '403': { description: 'Forbidden for this instance (socket close 4403)' },
        '404': { description: 'Instance or call not found (socket close 4404)' },
      },
    },
  }
  document.paths = paths
  return document
}
