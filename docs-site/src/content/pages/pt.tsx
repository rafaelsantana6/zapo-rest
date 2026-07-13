import { Callout } from '../../components/Callout'
import { CodeBlock } from '../../components/CodeBlock'
import { ExternalLink } from '../../components/ExternalLink'
import type { GuidePage } from './types'

export type { GuidePage }

export const GUIDE_PAGES: Record<string, GuidePage> = {
  intro: {
    title: 'zapo-rest',
    description: 'REST API multi-session para WhatsApp (zapo-js) — mensagens, mídia, webhooks, VoIP e dashboard.',
    body: (
      <>
        <p>
          <strong>zapo-rest</strong> é uma API HTTP multi-sessão sobre{' '}
          <a href="https://zapo.to" target="_blank" rel="noreferrer">
            zapo-js
          </a>
          , multi-session: cada <em>instance</em> é um dispositivo vinculado do WhatsApp com ciclo de vida próprio
          (QR/pairing → open → messages → calls).
        </p>

        <Callout title="Documentação em duas camadas">
          <ul>
            <li>
              <strong>Este guia</strong> (<code>/guide</code>) — contexto, fluxos, exemplos e referência narrativa de{' '}
              <em>todos</em> os endpoints.
            </li>
            <li>
              <ExternalLink href="/docs">Scalar</ExternalLink> — OpenAPI interativo (Try it out) gerado das rotas
              Fastify + Zod. JSON em <ExternalLink href="/docs/json">/docs/json</ExternalLink>.
            </li>
            <li>
              <strong>Código-fonte</strong> —{' '}
              <a href="https://github.com/rafaelsantana6/zapo-rest" target="_blank" rel="noreferrer">
                github.com/rafaelsantana6/zapo-rest
              </a>{' '}
              (stars, issues, releases, Docker).
            </li>
          </ul>
        </Callout>

        <h2 id="capabilities">O que a API cobre</h2>
        <ul>
          <li>
            <strong>Instâncias</strong> — create/connect/QR/pairing-code/restart/logout, API keys admin vs instance
          </li>
          <li>
            <strong>Mensagens</strong> — text, reply, image, video, audio/PTT, document, sticker, location, poll, react,
            edit, revoke, contact, forward, star
          </li>
          <li>
            <strong>Chats & store</strong> — listagem Postgres, history-sync, read/archive/unread, reconcile LID→PN
          </li>
          <li>
            <strong>Contatos / JID / LID</strong> — resolve, check (batch), blocklist, profile picture, about
          </li>
          <li>
            <strong>Mídia</strong> — download por messageId, storage S3/local, getBase64 endpoint
          </li>
          <li>
            <strong>Presence</strong> — available/unavailable, composing/recording, subscribe
          </li>
          <li>
            <strong>Webhooks multi-config</strong> — HMAC, retries, outbox; eventos message / any / inbound, calls,
            presence…
          </li>
          <li>
            <strong>Realtime SSE</strong> — <code>GET /v1/events</code> (server → client)
          </li>
          <li>
            <strong>VoIP</strong> — control plane <code>/v1/voip</code> + PCM stream + gravação WAV
          </li>
          <li>
            <strong>Grupos, labels, privacy, profile, status/stories, business profiles</strong>
          </li>
        </ul>

        <h2 id="stack">Stack</h2>
        <table>
          <thead>
            <tr>
              <th>Camada</th>
              <th>Tecnologia</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>HTTP</td>
              <td>Fastify 5 + Zod (type provider) + OpenAPI 3.1</td>
            </tr>
            <tr>
              <td>WhatsApp</td>
              <td>zapo-js multi-session + @zapo-js/voip + media-utils</td>
            </tr>
            <tr>
              <td>Persistência</td>
              <td>Postgres (projections + mailbox_*) · Redis opcional</td>
            </tr>
            <tr>
              <td>Mídia</td>
              <td>Local disk ou S3/MinIO</td>
            </tr>
            <tr>
              <td>UI</td>
              <td>Dashboard React + este guia Tailwind</td>
            </tr>
          </tbody>
        </table>

        <h2 id="links">Links rápidos</h2>
        <ul>
          <li>
            <a href="/guide/quickstart">Quickstart em 4 passos</a>
          </li>
          <li>
            <a href="/guide/architecture">Arquitetura e fluxos internos</a>
          </li>
          <li>
            <a href="/guide/api">Catálogo completo de endpoints</a>
          </li>
          <li>
            <a href="https://github.com/rafaelsantana6/zapo-rest" target="_blank" rel="noreferrer">
              Repositório no GitHub
            </a>
          </li>
          <li>
            <ExternalLink href="/docs">Abrir Scalar</ExternalLink>
          </li>
        </ul>
      </>
    ),
  },

  quickstart: {
    title: 'Quickstart',
    description: 'Do zero até a primeira mensagem e o primeiro webhook.',
    body: (
      <>
        <h2 id="env">1. Ambiente</h2>
        <p>
          Configure pelo menos <code>ADMIN_API_KEY</code>, <code>DATABASE_URL</code> e suba a API (Docker Compose ou{' '}
          <code>pnpm dev</code>).
        </p>
        <CodeBlock
          language="bash"
          code={`export BASE=http://localhost:3000
export ADMIN_API_KEY=your-admin-key
export KEY=$ADMIN_API_KEY # ou a instance key depois de criar`}
        />

        <h2 id="create">2. Criar e conectar instância</h2>
        <CodeBlock
          language="bash"
          code={`# Criar (admin)
curl -s -X POST "$BASE/v1/instances" \\
 -H "X-Api-Key: $ADMIN_API_KEY" -H "content-type: application/json" \\
 -d '{"name":"sales-1","webhookUrl":"https://hooks.example.com/wa"}'

# Conectar socket
curl -s -X POST "$BASE/v1/instances/sales-1/connect" \\
 -H "X-Api-Key: $ADMIN_API_KEY"

# QR (renderize a string como QR no cliente / dashboard)
curl -s "$BASE/v1/instances/sales-1/qr" -H "X-Api-Key: $ADMIN_API_KEY"`}
        />
        <p>
          Escaneie em WhatsApp → Aparelhos conectados. Alternativa: pairing code com <code>POST.../pairing-code</code> e
          o número do chip.
        </p>

        <h2 id="send">3. Enviar texto</h2>
        <CodeBlock
          language="bash"
          code={`curl -s -X POST "$BASE/v1/instances/sales-1/messages/text" \\
 -H "X-Api-Key: $KEY" -H "content-type: application/json" \\
 -d '{"to":"5511999999999","text":"Olá via zapo-rest 👋"}'`}
        />

        <h2 id="listen">4. Ouvir eventos</h2>
        <ul>
          <li>
            <strong>Webhook HTTP</strong> — configure na criação ou via <code>POST.../webhooks</code> (multi-config
            multi-config).
          </li>
          <li>
            <strong>SSE</strong> — <code>GET /v1/events?instance=sales-1</code> com header <code>X-Api-Key</code> (evite{' '}
            <code>?apiKey=</code> na URL)
          </li>
        </ul>
        <Callout tone="tip" title="Dashboard">
          Com a dashboard buildada, abra a raiz do host, faça login com a mesma API key e use o softphone flutuante +
          chat completo.
        </Callout>
      </>
    ),
  },

  architecture: {
    title: 'Arquitetura',
    description: 'Componentes, fluxo de mensagens e garantias de consistência.',
    body: (
      <>
        <h2 id="overview">Visão geral</h2>
        <CodeBlock
          language="text"
          code={`┌─────────────┐     ┌──────────────────────────────────────────┐
│ Clients     │     │ zapo-rest                                │
│ Dashboard   │────▶│ Fastify routes — Auth (admin|instance)   │
│ Softphone   │     │                   │                      │
│ Integrators │     │                   ▼                      │
└─────────────┘     │ InstanceManager (per-session queues)     │
                    │                   │                      │
  SSE /events       │                   ▼                      │
  WS /voip          │  zapo-js client ◄── WhatsApp             │
  WS stream         │                   │                      │
                    │                   ▼                      │
                    │  Event processor → Postgres projections  │
                    │                   │ media storage        │
                    │                   ▼                      │
                    │  Webhook outbox (HMAC, retries)          │
                    │  RealtimeBus → SSE /v1/events            │
                    └──────────────────────────────────────────┘`}
        />

        <h2 id="session-queue">Fila por sessão</h2>
        <p>
          Cada instância processa eventos WhatsApp em série (<em>session queue</em>) para evitar corridas em upsert de
          mensagem, ack e presença. Side-effects (webhook, broadcast WS) ocorrem <strong>depois</strong> do upsert
          idempotente <code>(instance, message_id)</code>.
        </p>

        <h2 id="projections">Projeções Postgres</h2>
        <ul>
          <li>
            <code>messages</code> / mailbox — histórico consultável via chats API
          </li>
          <li>
            <code>chats</code> — threads com unread, last message, merge LID/PN
          </li>
          <li>
            <code>contacts</code>, <code>lid_map</code>, <code>labels</code>, <code>calls</code>
          </li>
          <li>
            <code>processed_events</code> — dedupe de eventos de protocolo
          </li>
          <li>
            <code>webhook_outbox</code> — entrega at-least-once com retry policy
          </li>
        </ul>

        <h2 id="lid-pn">LID vs Phone Number (PN)</h2>
        <p>
          WhatsApp moderno usa identificadores <code>@lid</code> além de <code>@s.whatsapp.net</code>. A API prefere
          armazenar PN quando mapeado, mantém <code>lid_map</code>, expande aliases em presence/subscribe e oferece{' '}
          <code>POST.../chats/reconcile-lids</code> para fundir duplicatas.
        </p>

        <h2 id="media-flow">Fluxo de mídia</h2>
        <ol>
          <li>
            Inbound com mídia → opcional auto-download (<code>MEDIA_AUTO_DOWNLOAD</code>)
          </li>
          <li>Storage preferido (S3/local) → senão stream via client → fallback CDN WA</li>
          <li>
            GET <code>.../messages/:id/media</code> ou <code>getBase64FromMediaMessage</code>
          </li>
        </ol>

        <h2 id="voip-arch">VoIP em dois canais</h2>
        <table>
          <thead>
            <tr>
              <th>Canal</th>
              <th>URL</th>
              <th>Conteúdo</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Sinalização</td>
              <td>
                <code>/v1/voip</code>
              </td>
              <td>JSON: start/accept/end/mute + push call:offer/state/ended</td>
            </tr>
            <tr>
              <td>Mídia</td>
              <td>
                <code>.../calls/:id/stream</code>
              </td>
              <td>PCM Float32 LE mono @ 16 kHz (binary frames)</td>
            </tr>
          </tbody>
        </table>
        <p>HTTP REST de calls ainda existe (compat), mas o softphone não faz polling — só WS de controle.</p>
      </>
    ),
  },

  concepts: {
    title: 'Conceitos & entidades',
    description: 'Modelo mental das entidades expostas pela API.',
    body: (
      <>
        <h2 id="instance">Instance</h2>
        <p>
          Uma sessão WhatsApp nomeada. Campos principais: <code>name</code> (sessionId estável), <code>apiKey</code>,{' '}
          <code>status</code>, <code>meJid</code>, webhooks legados, <code>lastQr</code>.
        </p>
        <p>
          Status: <code>created</code> → <code>connecting</code> → <code>qr</code> / <code>pairing</code> →{' '}
          <code>open</code> · <code>close</code> · <code>logged_out</code>.
        </p>

        <h2 id="message">Message</h2>
        <p>
          Identificada por <code>messageId</code> (stanza id) no escopo da instância. Tipos: text, image, video, audio,
          document, sticker, location, poll, reaction, contact, etc. Acks: 0 pending · 1 server · 2 delivered · 3 read.
        </p>

        <h2 id="chat">Chat</h2>
        <p>
          Thread com um peer (1:1) ou grupo. <code>chatId</code> é o JID (URL-encode <code>@</code>). Pode existir
          projeção LID e PN — reconcile unifica.
        </p>

        <h2 id="call">Call</h2>
        <p>
          Snapshot em memória (ringing/active) + histórico em DB. Flags importantes: <code>canAccept</code> (só inbound
          ringing), <code>isActive</code> (mídia conectada), <code>direction</code>, gravação opcional.
        </p>

        <h2 id="webhook-cfg">Webhook config</h2>
        <p>
          Multi-config por instância: URL, allow-list de events, HMAC key, retries (linear/exponential/constant), custom
          headers, enabled.
        </p>

        <h2 id="actor">Actor (auth)</h2>
        <ul>
          <li>
            <code>{`{ role: 'admin' }`}</code> — <code>ADMIN_API_KEY</code>
          </li>
          <li>
            <code>{`{ role: 'instance', instanceName }`}</code> — key da instância
          </li>
        </ul>
      </>
    ),
  },

  auth: {
    title: 'Autenticação',
    description: 'Admin key vs instance key, headers, SSE e WebSocket VoIP.',
    body: (
      <>
        <h2 id="keys">Dois tipos de chave</h2>
        <table>
          <thead>
            <tr>
              <th>Tipo</th>
              <th>Origem</th>
              <th>Escopo</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>
                <strong>Admin</strong>
              </td>
              <td>
                env <code>ADMIN_API_KEY</code>
              </td>
              <td>Todas as instâncias + create/list/delete/rotate</td>
            </tr>
            <tr>
              <td>
                <strong>Instance</strong>
              </td>
              <td>
                campo <code>apiKey</code> da instância
              </td>
              <td>Somente a própria instância</td>
            </tr>
          </tbody>
        </table>

        <h2 id="headers">Como enviar</h2>
        <CodeBlock language="http" code={`X-Api-Key: <sua-chave>\n\n# ou\nAuthorization: Bearer <sua-chave>`} />
        <p>
          Rotas <code>/v1/*</code> exigem chave. Públicos: <code>GET /health</code>, <code>GET /ready</code>, UI OpenAPI
          em <code>/docs</code>, este guia em <code>/guide</code>.
        </p>

        <h2 id="stream-auth">SSE e WebSocket</h2>
        <ul>
          <li>
            <strong>SSE</strong> — prefira <code>fetch</code> com header <code>X-Api-Key</code> (dashboard faz isso).
            Evite <code>?apiKey=</code> na URL.
          </li>
          <li>
            <strong>WebSocket</strong> (VoIP <code>/v1/voip</code>, PCM stream) — browser em geral não manda headers; aí
            query <code>?apiKey=</code> ainda é o fallback prático.
          </li>
        </ul>

        <h2 id="me">Descobrir o actor</h2>
        <CodeBlock
          language="bash"
          code={`curl -s "$BASE/v1/me" -H "X-Api-Key: $KEY"
# admin → { "role": "admin" }
# instance → { "role": "instance", "instance": {... } }`}
        />

        <Callout tone="warn" title="Produção">
          Proteja <code>/docs</code> e <code>/guide</code> com ACL de rede se a API for pública. Keys de instância são
          retornadas em plaintext de propósito (operabilidade / dashboard) — trate como secretos.
        </Callout>
      </>
    ),
  },

  instances: {
    title: 'Instâncias & pairing',
    description: 'Ciclo de vida completo de uma sessão WhatsApp.',
    body: (
      <>
        <h2 id="lifecycle">Ciclo de vida</h2>
        <ol>
          <li>
            <code>POST /v1/instances</code> (admin) → status <code>created</code> + apiKey
          </li>
          <li>
            <code>POST.../connect</code> → <code>connecting</code>
          </li>
          <li>
            QR: <code>GET.../qr</code> ou evento <code>instance.qr</code> · ou pairing-code
          </li>
          <li>
            <code>open</code> → pronto para enviar/receber · <code>meJid</code> preenchido
          </li>
          <li>
            <code>disconnect</code> / <code>restart</code> / <code>DELETE</code> (logout)
          </li>
        </ol>

        <h2 id="pairing">Pairing code</h2>
        <CodeBlock
          language="bash"
          code={`curl -s -X POST "$BASE/v1/instances/sales-1/pairing-code" \\
 -H "X-Api-Key: $KEY" -H "content-type: application/json" \\
 -d '{"phone":"5511999999999"}'
# → { "code": "ABCD-EFGH", "phone": "5511999999999" }`}
        />

        <h2 id="rotate">Rotação de key</h2>
        <p>
          <code>POST.../keys/rotate</code> invalida a key antiga. Clientes e webhooks que usam a instance key precisam
          atualizar.
        </p>

        <h2 id="endpoints">Endpoints</h2>
        <p>
          Ver referência: <a href="/guide/api/Instances">Instances</a>.
        </p>
      </>
    ),
  },

  messages: {
    title: 'Mensagens',
    description: 'Envio, tipos, acks e eventos inbound.',
    body: (
      <>
        <h2 id="send-types">Tipos de envio</h2>
        <table>
          <thead>
            <tr>
              <th>Path</th>
              <th>Uso</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>
                <code>.../messages/text</code>
              </td>
              <td>Texto + linkPreview + mentions</td>
            </tr>
            <tr>
              <td>
                <code>.../messages/reply</code>
              </td>
              <td>Quote por messageId</td>
            </tr>
            <tr>
              <td>
                <code>.../messages/image|video|audio|document|sticker</code>
              </td>
              <td>mediaUrl ou mediaBase64</td>
            </tr>
            <tr>
              <td>
                <code>.../messages/location|poll|contact</code>
              </td>
              <td>Estruturados</td>
            </tr>
            <tr>
              <td>
                <code>.../messages/react|edit|revoke|forward|star</code>
              </td>
              <td>Ações sobre mensagens existentes</td>
            </tr>
          </tbody>
        </table>

        <h2 id="to">
          Campo <code>to</code>
        </h2>
        <p>
          Aceita dígitos com DDI (<code>5511…</code>), JID PN, <code>@g.us</code>, <code>@lid</code>. A API normaliza
          via resolve/JID helpers.
        </p>

        <h2 id="inbound-events">Três eventos de mensagem</h2>
        <table>
          <thead>
            <tr>
              <th>Evento</th>
              <th>Quando</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>
                <code>message</code>
              </td>
              <td>Mensagem “útil” processada (filtro de tipos)</td>
            </tr>
            <tr>
              <td>
                <code>message.any</code>
              </td>
              <td>Qualquer upsert (incl. eco/fromMe conforme config)</td>
            </tr>
            <tr>
              <td>
                <code>message.inbound</code>
              </td>
              <td>Alias legado focado em recebidas (!fromMe)</td>
            </tr>
            <tr>
              <td>
                <code>message.media.stored</code>
              </td>
              <td>
                Etapa 2 após CAS; payload com <code>mediaStage: "stored"</code>, storage key + URL. Etapa 1 é o{' '}
                <code>message</code> inicial com <code>mediaStage: "meta"</code>.
              </td>
            </tr>
            <tr>
              <td>
                <code>message.media.failed</code>
              </td>
              <td>
                Falha no download/store após retries (<code>mediaStage: "failed"</code> + erro)
              </td>
            </tr>
          </tbody>
        </table>
        <p>
          Um inbound pode disparar mais de um evento se o allow-list do webhook incluir vários nomes — assine só o que
          precisa. Bots que só querem arquivo permanente: assine <code>message.media.stored</code>.
        </p>

        <h2 id="acks">Acks (ticks)</h2>
        <p>
          Evento <code>message.ack</code> atualiza delivered/read. No store: mapa por messageIds.
        </p>
      </>
    ),
  },

  media: {
    title: 'Mídia & storage',
    description: 'Download, storage S3/local e download API.',
    body: (
      <>
        <h2 id="config">Config</h2>
        <ul>
          <li>
            <code>MEDIA_STORAGE=local|s3</code> — gravação de calls e cache de mídia
          </li>
          <li>
            <code>MEDIA_AUTO_DOWNLOAD</code> — baixar mídia inbound automaticamente
          </li>
          <li>
            S3/MinIO: bucket, endpoint, <code>S3_PUBLIC_URL</code>
          </li>
        </ul>

        <h2 id="download">Download</h2>
        <CodeBlock
          language="bash"
          code={`# Stream / redirect da mídia de uma mensagem
curl -sL "$BASE/v1/instances/sales-1/messages/3EB0ABC/media" \\
 -H "X-Api-Key: $KEY" -o file.bin

# API parity
curl -s -X POST "$BASE/v1/instances/sales-1/media/getBase64FromMediaMessage" \\
 -H "X-Api-Key: $KEY" -H "content-type: application/json" \\
 -d '{"messageId":"3EB0ABC"}'`}
        />

        <h2 id="fallback">Ordem de resolução</h2>
        <ol>
          <li>Objeto já no storage</li>
          <li>Se sumiu → re-download do WhatsApp, grava de novo no storage</li>
          <li>404 só se o WhatsApp não puder mais entregar a mídia</li>
        </ol>
      </>
    ),
  },

  chats: {
    title: 'Chats & histórico',
    description: 'Projeções, sync e ações de thread.',
    body: (
      <>
        <p>
          Chats e mensagens vêm do store Postgres (histórico + live). Endpoints sob{' '}
          <code>/v1/instances/:name/chats</code>.
        </p>
        <ul>
          <li>List / get chat · messages paginadas · get message</li>
          <li>read · archive · unarchive · unread · delete local · history-sync</li>
          <li>
            <code>reconcile-lids</code> — merge PN/LID
          </li>
        </ul>
        <Callout title="history-sync">
          <code>POST.../history-sync</code> pede backfill ao WhatsApp; chunks chegam como evento{' '}
          <code>history.sync</code>, não na resposta HTTP síncrona.
        </Callout>
      </>
    ),
  },

  contacts: {
    title: 'Contatos & JID/LID',
    description: 'Resolve números, check existence e blocklist.',
    body: (
      <>
        <h2 id="resolve">Resolve vs check</h2>
        <ul>
          <li>
            <code>POST.../contacts/jid</code> — monta JID local (sem rede)
          </li>
          <li>
            <code>POST.../contacts/resolve</code> — JID canônico no WhatsApp (LID-aware)
          </li>
          <li>
            <code>POST.../contacts/check</code> — batch exists (max 50), tenta variantes BR 9º dígito
          </li>
          <li>
            <code>POST.../contacts/whatsapp-numbers</code> — legacy alias
          </li>
        </ul>
        <CodeBlock
          language="bash"
          code={`curl -s -X POST "$BASE/v1/instances/sales-1/contacts/check" \\
 -H "X-Api-Key: $KEY" -H "content-type: application/json" \\
 -d '{"phones":["5511999999999"]}'`}
        />
        <p>
          Mapa LID↔PN também em <a href="/guide/api/Lids">/lids</a>.
        </p>
      </>
    ),
  },

  presence: {
    title: 'Presence & typing',
    description: 'Online, composing/recording e subscribe.',
    body: (
      <>
        <h2 id="set">Presence da conta</h2>
        <CodeBlock
          language="bash"
          code={`curl -s -X POST "$BASE/v1/instances/sales-1/presence" \\
 -H "X-Api-Key: $KEY" -H "content-type: application/json" \\
 -d '{"type":"available"}'`}
        />

        <h2 id="chatstate">Typing / recording</h2>
        <CodeBlock
          language="bash"
          code={`curl -s -X POST "$BASE/v1/instances/sales-1/chats/5511999999999/chatstate" \\
 -H "X-Api-Key: $KEY" -H "content-type: application/json" \\
 -d '{"state":"composing"}'
# states: composing  | recording | paused`}
        />

        <h2 id="subscribe">Subscribe (obrigatório para receber)</h2>
        <p>
          Sem <code>POST.../presence/subscribe</code>, a sessão pode não emitir <code>presence.update</code> /{' '}
          <code>chatstate</code> do peer. O manager expande aliases LID+PN.
        </p>
        <CodeBlock
          language="json"
          code={`// evento chatstate no SSE /v1/events ou webhook
{
 "event": "chatstate",
 "instance": "sales-1",
 "data": { "jid": "5511…@s.whatsapp.net", "state": "composing" }
}`}
        />
      </>
    ),
  },

  webhooks: {
    title: 'Webhooks',
    description: 'Multi-config, envelope, HMAC e retries.',
    body: (
      <>
        <h2 id="multi">Multi-config (multi-config)</h2>
        <p>
          CRUD em <code>/v1/instances/:name/webhooks</code>. Cada config: URL, events[], hmac, retries, customHeaders,
          enabled. Há também webhook legado nos campos da instance (<code>webhookUrl</code> / <code>webhookEvents</code>
          ).
        </p>

        <h2 id="envelope">Envelope</h2>
        <CodeBlock
          language="json"
          code={`{
 "id": "01H…",
 "event": "message.inbound",
 "instance": "sales-1",
 "timestamp": 1720700000000,
 "engine": "zapo",
 "payload": { /* dados do evento */ }
}`}
        />

        <h2 id="events">Catálogo de eventos</h2>
        <ul>
          <li>
            Instance: <code>instance.qr</code>, <code>instance.connection</code>, <code>instance.paired</code>,{' '}
            <code>instance.logged_out</code>
          </li>
          <li>
            Messages: <code>message</code>, <code>message.any</code>, <code>message.inbound</code>,{' '}
            <code>message.media.stored</code>, <code>message.media.failed</code>, <code>message.ack</code>,{' '}
            <code>message.reaction</code>, <code>message.revoked</code>, <code>message.edited</code>
          </li>
          <li>
            Chat/presence: <code>chat.update</code>, <code>presence.update</code>, <code>chatstate</code>,{' '}
            <code>group.update</code>, <code>history.sync</code>
          </li>
          <li>
            Calls: <code>call.incoming</code>, <code>call.state</code>, <code>call.ended</code>
          </li>
        </ul>

        <h2 id="hmac">HMAC</h2>
        <p>
          Quando configurado, header de assinatura no POST outbound (outbox worker). Retries: policy
          linear/exponential/constant + attempts + delaySeconds.
        </p>
      </>
    ),
  },

  realtime: {
    title: 'SSE /v1/events',
    description: 'Stream unidirecional (server → client) via Server-Sent Events.',
    body: (
      <>
        <p>
          O canal de eventos é <strong>SSE</strong>, não WebSocket: o cliente só escuta. VoIP bidirecional permanece em{' '}
          <code>/v1/voip</code> + stream PCM.
        </p>
        <Callout tone="warn" title="Auth: header, não query">
          Prefira <code>X-Api-Key</code> ou <code>Authorization: Bearer</code>. Colocar a key na URL (
          <code>?apiKey=</code>) vaza em logs de access/proxy, histórico e Referer. O dashboard usa <code>fetch</code> +
          stream com header. Query só como fallback do <code>EventSource</code> nativo (que não aceita headers).
        </Callout>
        <CodeBlock
          language="bash"
          code={`# curl (recomendado) — key no header
curl -N -s "$BASE/v1/events?instance=sales-1" \\
 -H "X-Api-Key: $KEY" -H "Accept: text/event-stream"`}
        />
        <CodeBlock
          language="javascript"
          code={`// Browser: fetch + stream (headers OK)
const res = await fetch(\`/v1/events?instance=sales-1\`, {
 headers: { 'X-Api-Key': key, Accept: 'text/event-stream' },
})
const reader = res.body.getReader
const dec = new TextDecoder
// … parse frames "data: …\\n\\n"

// Evite: new EventSource(\`/v1/events?apiKey=\${key}\`) // key na URL`}
        />
        <p>
          Primeiro frame <code>connected</code>, depois o mesmo shape do bus de webhooks. Admin sem{' '}
          <code>instance</code> recebe de todas as instâncias. Keepalive a cada 15s (comentário SSE <code>: ping</code>
          ).
        </p>
      </>
    ),
  },

  voip: {
    title: 'VoIP & softphone',
    description: 'Sinalização JSON, PCM 16 kHz e gravação.',
    body: (
      <>
        <h2 id="control">Control plane — /v1/voip</h2>
        <CodeBlock
          language="json"
          code={`// attach
{ "op": "instance:attach", "id": "1", "instance": "sales-1" }

// outbound
{ "op": "call:start", "id": "2", "phone": "5511888888888" }

// inbound
{ "op": "call:accept", "id": "3", "callId": "call_…" }
{ "op": "call:reject", "id": "4", "callId": "call_…" }
{ "op": "call:end", "id": "5", "callId": "call_…" }
{ "op": "call:mute", "id": "6", "callId": "call_…", "muted": true }`}
        />

        <h2 id="server-push">Push do servidor</h2>
        <ul>
          <li>
            <code>call:offer</code> / <code>call:ringing</code> — entrada
          </li>
          <li>
            <code>call:state</code> — transição (connecting, active, …)
          </li>
          <li>
            <code>call:ended</code> — terminal
          </li>
          <li>
            <code>calls:snapshot</code> — lista ao attach
          </li>
          <li>
            <code>device:status</code> — status da sessão WA
          </li>
        </ul>

        <h2 id="pcm">Mídia PCM</h2>
        <CodeBlock
          language="text"
          code={`ws://host/v1/instances/sales-1/calls/{callId}/stream?apiKey=$KEY

← JSON { "op":"ready", "sampleRate":16000, "format":"f32le", "channels":1 }
↔ binary Float32 LE mono @ 16 kHz
← JSON { "op":"backpressure", "pause": true | false }
← JSON { "op":"ended" }`}
        />

        <h2 id="states">Estados importantes</h2>
        <ul>
          <li>
            <strong>Accept</strong> só com <code>canAccept</code> (incoming_ringing)
          </li>
          <li>
            Mídia “ativa” após <code>media_connected</code> / state active — UI não deve forçar active em outbound só
            por ringing
          </li>
          <li>
            Gravação: <code>PUT.../settings/call-recording</code> + storage ready → PCM só após atender (
            <code>connecting</code>/<code>active</code>) → WAV em <code>GET.../recording</code>
          </li>
        </ul>
      </>
    ),
  },

  groups: {
    title: 'Grupos',
    description: 'Criar, participantes, convites e settings.',
    body: (
      <>
        <p>
          CRUD completo sob <code>/v1/instances/:name/groups</code>: create, metadata, leave, subject/description,
          invite-code, participants add/remove, promote/demote, picture, settings (announcement, restrict, ephemeral…).
        </p>
        <p>
          Referência detalhada: <a href="/guide/api/Groups">Groups API</a>.
        </p>
      </>
    ),
  },

  errors: {
    title: 'Erros & códigos',
    description: 'Envelope padrão e códigos HTTP.',
    body: (
      <>
        <CodeBlock
          language="json"
          code={`{
 "error": {
 "code": "UNAUTHORIZED",
 "message": "Missing API key (X-Api-Key or Authorization: Bearer)",
 "details": {}
 }
}`}
        />
        <table>
          <thead>
            <tr>
              <th>code</th>
              <th>HTTP</th>
              <th>Significado</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>UNAUTHORIZED</td>
              <td>401</td>
              <td>Key ausente/inválida</td>
            </tr>
            <tr>
              <td>FORBIDDEN</td>
              <td>403</td>
              <td>Sem acesso à instância / não admin</td>
            </tr>
            <tr>
              <td>NOT_FOUND</td>
              <td>404</td>
              <td>Recurso inexistente</td>
            </tr>
            <tr>
              <td>CONFLICT</td>
              <td>409</td>
              <td>Ex.: nome de instância duplicado</td>
            </tr>
            <tr>
              <td>VALIDATION_ERROR</td>
              <td>400</td>
              <td>Body/query Zod inválido</td>
            </tr>
            <tr>
              <td>BAD_REQUEST</td>
              <td>400</td>
              <td>Regra de negócio</td>
            </tr>
            <tr>
              <td>SERVICE_UNAVAILABLE</td>
              <td>503</td>
              <td>Sessão não open / dependência</td>
            </tr>
          </tbody>
        </table>
      </>
    ),
  },

  faq: {
    title: 'FAQ',
    description: 'Perguntas frequentes de integração.',
    body: (
      <>
        <h3 id="q-polling">Preciso fazer poll de calls?</h3>
        <p>
          Não. Use <code>/v1/voip</code> para sinalização. REST de list/get call é fallback/debug.
        </p>

        <h3 id="q-typing">Por que não vejo typing no SSE /events?</h3>
        <p>
          Chame <code>presence/subscribe</code> para o JID (e mantenha a sessão available). LID vs PN é expandido no
          server.
        </p>

        <h3 id="q-three-events">Por que 3 eventos de mensagem?</h3>
        <p>
          Compatibilidade com : <code>message</code>, <code>message.any</code> e alias <code>message.inbound</code>.
          Filtre no webhook allow-list.
        </p>

        <h3 id="q-swagger">Onde está o OpenAPI interativo?</h3>
        <p>
          <ExternalLink href="/docs">/docs</ExternalLink> (Scalar). Este guia é a camada narrativa rica.
        </p>

        <h3 id="q-storage">Gravação de call 404?</h3>
        <p>
          Storage precisa estar configurado e <code>storageReady: true</code>. Ative <code>call-recording</code> na
          instância.
        </p>
      </>
    ),
  },
}
