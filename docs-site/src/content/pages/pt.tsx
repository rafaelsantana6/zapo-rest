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
            <strong>Instâncias</strong> — create/connect/QR/pairing-code/restart/logout, API keys admin vs instance;
            path dual (nomeado ou forma curta com instance key)
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
              <td>
                Local ou S3/MinIO/R2 com <strong>CAS</strong> (dedup SHA-256 por instância)
              </td>
            </tr>
            <tr>
              <td>UI</td>
              <td>Dashboard React + este guia Tailwind</td>
            </tr>
          </tbody>
        </table>

        <Callout title="Vantagens de design (resumo)">
          <p>Você não precisa abrir outro arquivo para ver o que este gateway faz de diferente:</p>
          <ul>
            <li>
              <strong>CAS de mídia</strong> — mesmo arquivo (forward/sticker) grava uma vez por instância
            </li>
            <li>
              <strong>Rehydrate + 302</strong> — mídia recuperável do WA; download direto no storage
            </li>
            <li>
              <strong>Outbox + HMAC</strong> — webhook at-least-once, sem double-fire
            </li>
            <li>
              <strong>SSE / WS só VoIP</strong> · <strong>LID↔PN</strong> · boot friendly a healthcheck ·{' '}
              <strong>WAM</strong> paridade de wire (<code>WAM_ENABLED=false</code> desliga)
            </li>
          </ul>
          <p>
            Tabela completa: <a href="/guide/why">Vantagens de design</a> · fluxos em{' '}
            <a href="/guide/architecture">Arquitetura</a>.
          </p>
        </Callout>

        <h2 id="links">Links rápidos</h2>
        <ul>
          <li>
            <a href="/guide/why">Vantagens de design (resumo)</a>
          </li>
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

  why: {
    title: 'Vantagens de design',
    description: 'Resumo das decisões que baixam custo e risco em produção — legível sem abrir o repositório.',
    body: (
      <>
        <p>
          Estas escolhas são <strong>intencionais</strong>. O resumo abaixo basta para avaliar o projeto; o arquivo{' '}
          <code>docs/DESIGN-DECISIONS.md</code> no repo é só o detalhe para contribuidores.
        </p>

        <h2 id="glance">Em uma olhada</h2>
        <ul>
          <li>
            <strong>Mídia mais barata</strong> — CAS (SHA-256 por instância); forwards/stickers não multiplicam objetos
          </li>
          <li>
            <strong>Mídia recuperável</strong> — se o objeto sumir, re-baixa do WhatsApp e regrava
          </li>
          <li>
            <strong>Webhooks confiáveis</strong> — grava o chat primeiro, outbox + retry, HMAC, sem double-fire
          </li>
          <li>
            <strong>Realtime certo</strong> — SSE para eventos da app; WebSocket só para VoIP
          </li>
          <li>
            <strong>Identidade WA moderna</strong> — mapa LID ↔ PN + reconcile (sem histórico partido)
          </li>
          <li>
            <strong>Boot ops-friendly</strong> — HTTP sobe antes do reconnect/reconcile longo (healthcheck verde)
          </li>
          <li>
            <strong>Paridade de wire do WA Web</strong> — telemetria WAM ligada por padrão; desligue com{' '}
            <code>WAM_ENABLED=false</code>
          </li>
          <li>
            <strong>Instância pela API key</strong> — com instance key o nome pode ser omitido na URL; admin sempre
            indica <code>:name</code>
          </li>
        </ul>

        <h2 id="table">Decisão → benefício</h2>
        <table>
          <thead>
            <tr>
              <th>Decisão</th>
              <th>Benefício</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>
                <strong>CAS</strong> <code>…/cas/sha256/…</code> por instância
              </td>
              <td>Economia de storage; identidade estável do objeto</td>
            </tr>
            <tr>
              <td>Rehydrate se objeto sumir</td>
              <td>Mídia recuperável sem re-parear; 404 só se o WA não entregar</td>
            </tr>
            <tr>
              <td>302 + presign</td>
              <td>API não é middleman permanente de bandwidth</td>
            </tr>
            <tr>
              <td>
                Webhooks em 2 etapas (<code>meta</code> → <code>stored</code>)
              </td>
              <td>
                Bot reage cedo; arquivo estável em <code>message.media.stored</code>
              </td>
            </tr>
            <tr>
              <td>
                Projection → <code>processed_events</code> → outbox
              </td>
              <td>Store consistente + side-effects sem duplicar entrega</td>
            </tr>
            <tr>
              <td>SSE app / WS só VoIP</td>
              <td>Contrato simples; softphone sem poll REST</td>
            </tr>
            <tr>
              <td>Auth por header preferida</td>
              <td>Key fora de access log / Referer</td>
            </tr>
            <tr>
              <td>Instância inferida da API key (rotas dual)</td>
              <td>
                Path nomeado sempre válido; forma curta <code>/v1/…</code> e <code>/v1/instance/…</code> com instance
                key. Admin deve passar <code>:name</code>
              </td>
            </tr>
            <tr>
              <td>Fila serial por sessão</td>
              <td>Sem corrida em upsert/ack/presença</td>
            </tr>
            <tr>
              <td>
                <code>lid_map</code> + reconcile
              </td>
              <td>Identidade moderna do WA sem threads duplicadas</td>
            </tr>
            <tr>
              <td>
                <code>listen</code> antes do boot WA longo
              </td>
              <td>Healthcheck Docker/Swarm verde durante reconnect/reconcile</td>
            </tr>
            <tr>
              <td>
                Telemetria <strong>WAM</strong> (<code>@zapo-js/wam</code>, default on)
              </td>
              <td>
                Emite batches <code>w:stats</code> do WA Web para paridade de wire. Desligue com{' '}
                <code>WAM_ENABLED=false</code>
              </td>
            </tr>
          </tbody>
        </table>

        <h2 id="next">Onde aprofundar</h2>
        <ul>
          <li>
            <a href="/guide/architecture">Arquitetura</a> — filas, projeções, diagrama
          </li>
          <li>
            <a href="/guide/media">Mídia</a> — CAS, rehydrate, 302
          </li>
          <li>
            <a href="/guide/webhooks">Webhooks</a> — outbox, HMAC, eventos
          </li>
          <li>
            <a href="/guide/realtime">SSE</a> — por que não WebSocket geral
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
          code={`# Admin ou multi-tenant: path com nome
curl -s -X POST "$BASE/v1/instances/sales-1/messages/text" \\
 -H "X-Api-Key: $ADMIN_API_KEY" -H "content-type: application/json" \\
 -d '{"to":"5511999999999","text":"Olá via zapo-rest 👋"}'

# Instance key: forma curta (nome inferido da key)
curl -s -X POST "$BASE/v1/messages/text" \\
 -H "X-Api-Key: $INSTANCE_API_KEY" -H "content-type: application/json" \\
 -d '{"to":"5511999999999","text":"Olá via zapo-rest 👋"}'`}
        />
        <p>
          Com <strong>instance key</strong> você pode omitir o nome na URL. Com a <strong>admin key</strong> o nome é
          obrigatório. Detalhes em <a href="/guide/auth#scope">Autenticação → Escopo da instância</a>.
        </p>

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
          <li>
            Gravação <strong>content-addressed</strong> (CAS) → se o objeto já existir, <code>deduped</code> (sem
            reescrever bytes)
          </li>
          <li>
            GET <code>.../messages/:id/media</code> prefere <strong>302</strong> para storage; se sumiu, re-baixa do
            WhatsApp e regrava
          </li>
        </ol>

        <h2 id="design-choices">Decisões de design (benefícios)</h2>
        <p>
          Resumo completo na página <a href="/guide/why">Vantagens de design</a> (não precisa abrir o repo). Escolhas
          conscientes — não “framework pela moda”. Canônico para contribuidores: <code>docs/DESIGN-DECISIONS.md</code>.
        </p>
        <table>
          <thead>
            <tr>
              <th>Decisão</th>
              <th>Benefício</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>
                <strong>CAS</strong> <code>…/cas/sha256/…</code> por instância
              </td>
              <td>Economia de storage; forwards/stickers não multiplicam objetos</td>
            </tr>
            <tr>
              <td>Rehydrate se objeto sumir</td>
              <td>Mídia recuperável sem re-parear; 404 só se o WA não entregar</td>
            </tr>
            <tr>
              <td>302 + presign</td>
              <td>API não é middleman permanente de bandwidth</td>
            </tr>
            <tr>
              <td>
                Webhooks em 2 etapas (<code>meta</code> → <code>stored</code>)
              </td>
              <td>
                Bot pode reagir cedo e baixar arquivo estável em <code>message.media.stored</code>
              </td>
            </tr>
            <tr>
              <td>
                Persist projection → claim <code>processed_events</code> → outbox
              </td>
              <td>Consistência do store + side-effects sem duplicar entrega</td>
            </tr>
            <tr>
              <td>SSE app / WS só VoIP</td>
              <td>Contrato simples; softphone sem poll REST</td>
            </tr>
            <tr>
              <td>Auth por header preferida</td>
              <td>Key fora de access log / Referer</td>
            </tr>
            <tr>
              <td>Instância inferida da API key (rotas dual)</td>
              <td>
                Path nomeado sempre válido; forma curta <code>/v1/…</code> e <code>/v1/instance/…</code> com instance
                key. Admin deve passar <code>:name</code>
              </td>
            </tr>
            <tr>
              <td>Fila serial por sessão</td>
              <td>Sem corrida em upsert/ack/presença</td>
            </tr>
            <tr>
              <td>
                <code>lid_map</code> + reconcile
              </td>
              <td>Identidade moderna do WA sem threads duplicadas</td>
            </tr>
            <tr>
              <td>
                <code>listen</code> antes do boot WA longo
              </td>
              <td>Healthcheck Docker/Swarm verde durante reconnect/reconcile</td>
            </tr>
            <tr>
              <td>
                <strong>WAM</strong> (<code>@zapo-js/wam</code>, default on)
              </td>
              <td>
                <code>w:stats</code> client-side como uma aba real do WA Web. <code>WAM_ENABLED=false</code> desliga
              </td>
            </tr>
          </tbody>
        </table>

        <h2 id="wam">Telemetria WAM (paridade de wire da sessão)</h2>
        <p>
          Abas reais do WhatsApp Web enviam batches de analytics no canal <code>w:stats</code>. O zapo-rest anexa o
          plugin upstream <code>@zapo-js/wam</code> em toda sessão <strong>por padrão</strong> para o footprint headless
          multi-session se aproximar de um browser (eventos de protocolo + telemetria de UI sintética).
        </p>
        <ul>
          <li>
            <strong>Não</strong> é métrica/log da sua aplicação nem superfície OpenAPI
          </li>
          <li>
            <strong>Não</strong> altera REST, SSE, mídia ou VoIP
          </li>
          <li>
            <strong>Ligado por padrão</strong> (<code>WAM_ENABLED=true</code> quando omitido)
          </li>
          <li>
            Desligar: <code>WAM_ENABLED=false</code> e reinicie o processo da API
          </li>
        </ul>
        <p>
          Guia upstream:{' '}
          <a href="https://zapo.to/pt-br/guides/wam" rel="noreferrer" target="_blank">
            zapo.to/pt-br/guides/wam
          </a>
          .
        </p>

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
    description: 'Admin key vs instance key, paths dual, headers, SSE e WebSocket VoIP.',
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
                campo <code>apiKey</code> da instância (sempre no GET)
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

        <h2 id="scope">Escopo da instância (dual path)</h2>
        <p>
          Rotas de uma sessão WhatsApp aceitam <strong>duas formas</strong>. A resolução está em{' '}
          <code>resolveInstanceName</code>: se o nome vier no path, valida o acesso; se omitido, a instance key amarra a
          própria instância; admin sem nome → <code>400</code>.
        </p>
        <table>
          <thead>
            <tr>
              <th>Quem</th>
              <th>Path</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>
                <strong>Admin</strong>
              </td>
              <td>
                <strong>Sempre</strong> com nome: <code>/v1/instances/:name/...</code> (omitir o nome → 400)
              </td>
            </tr>
            <tr>
              <td>
                <strong>Instance key</strong>
              </td>
              <td>
                Nomeado <strong>ou</strong> forma curta — a instância é inferida da API key
              </td>
            </tr>
          </tbody>
        </table>
        <p>
          <strong>Forma curta</strong> (só instance key):
        </p>
        <ul>
          <li>
            Recursos: <code>/v1/messages/text</code>, <code>/v1/chats</code>, <code>/v1/contacts</code>, … (equivalente
            a <code>/v1/instances/:name/...</code>)
          </li>
          <li>
            Ciclo de vida: <code>/v1/instance</code>, <code>/v1/instance/connect</code>, <code>/v1/instance/qr</code>, …
            — singular <code>instance</code> para não colidir com a coleção admin <code>/v1/instances</code>
          </li>
        </ul>
        <CodeBlock
          language="bash"
          code={`# Admin — nome obrigatório
curl -s -X POST "$BASE/v1/instances/sales-1/messages/text" \\
  -H "X-Api-Key: $ADMIN_API_KEY" -H "content-type: application/json" \\
  -d '{"to":"5511999999999","text":"oi"}'

# Instance key — nomeado (ainda válido)
curl -s -X POST "$BASE/v1/instances/sales-1/messages/text" \\
  -H "X-Api-Key: $INSTANCE_API_KEY" -H "content-type: application/json" \\
  -d '{"to":"5511999999999","text":"oi"}'

# Instance key — forma curta
curl -s -X POST "$BASE/v1/messages/text" \\
  -H "X-Api-Key: $INSTANCE_API_KEY" -H "content-type: application/json" \\
  -d '{"to":"5511999999999","text":"oi"}'

# Lifecycle curto
curl -s "$BASE/v1/instance" -H "X-Api-Key: $INSTANCE_API_KEY"
curl -s -X POST "$BASE/v1/instance/connect" -H "X-Api-Key: $INSTANCE_API_KEY"`}
        />

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

        <h2 id="short-path">Forma curta (instance key)</h2>
        <p>
          Com a API key da própria instância você pode usar singular <code>/v1/instance/...</code> em vez de{' '}
          <code>/v1/instances/:name/...</code> — o nome é inferido da key. Admin continua obrigado a passar o nome. Ver{' '}
          <a href="/guide/auth#scope">Autenticação</a>.
        </p>
        <CodeBlock
          language="bash"
          code={`curl -s "$BASE/v1/instance" -H "X-Api-Key: $INSTANCE_API_KEY"
curl -s -X POST "$BASE/v1/instance/connect" -H "X-Api-Key: $INSTANCE_API_KEY"
curl -s "$BASE/v1/instance/qr" -H "X-Api-Key: $INSTANCE_API_KEY"`}
        />

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
        <Callout title="Path dual">
          Paths abaixo usam <code>.../messages/…</code> de forma relativa. Prefixo completo:{' '}
          <code>/v1/instances/:name/messages/…</code> (admin ou instance) ou, com instance key,{' '}
          <code>/v1/messages/…</code>. Detalhes em <a href="/guide/auth#scope">Autenticação</a>.
        </Callout>
        <h2 id="own-profile">Nome e avatar (próprio perfil)</h2>
        <p>
          Para atualizar o <strong>push name</strong> e a <strong>foto de perfil</strong> da sessão no WhatsApp:
        </p>
        <CodeBlock
          language="bash"
          code={`# Display name (máx. 25 chars)
curl -s -X PUT "$BASE/v1/profile/name" \\
  -H "X-Api-Key: $INSTANCE_API_KEY" -H "content-type: application/json" \\
  -d '{"name":"Loja Sales"}'

# Avatar JPEG (URL pública ou base64)
curl -s -X PUT "$BASE/v1/profile/image" \\
  -H "X-Api-Key: $INSTANCE_API_KEY" -H "content-type: application/json" \\
  -d '{"mediaUrl":"https://cdn.example.com/avatar.jpg"}'

# Alias: /profile/picture · remover: DELETE /v1/profile/image`}
        />
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
    description: 'CAS com dedup, download S3/local e rehydrate do WhatsApp.',
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
            S3/MinIO/R2: bucket, endpoint, <code>S3_PUBLIC_URL</code> (URL browser-facing para presign)
          </li>
        </ul>

        <h2 id="cas">Content-addressed storage (CAS) — economia de bytes</h2>
        <p>
          Objetos usam chave por <strong>SHA-256 do conteúdo</strong> no escopo da instância:
        </p>
        <CodeBlock language="text" code={`{instanceName}/cas/sha256/{hash}{ext}`} />
        <ul>
          <li>
            <strong>Dedup</strong> — o mesmo payload (forward, sticker, reenvio) grava <em>uma vez</em>; put retorna{' '}
            <code>deduped: true</code> sem reescrever
          </li>
          <li>
            <strong>Isolamento</strong> — instâncias não compartilham objetos; delete da instância remove só{' '}
            <code>{'{name}'}/…</code>
          </li>
          <li>
            <strong>Extensão de tipo</strong> no key (mime/filename), não o nome original — URL direta abre com o tipo
            certo; o nome de exibição fica na linha da mensagem
          </li>
          <li>
            Avatars usam <code>putAt</code> (chave fixa), sem CAS
          </li>
        </ul>
        <Callout title="Por que isso importa">
          Em multi-session com volume alto, mídia repetida é uma fatia grande do bucket. CAS corta custo sem mudar o
          contrato da API de mensagens.
        </Callout>

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
        <p>
          Preferência: <strong>302</strong> para storage (presign S3 ou base pública local). A API não precisa
          retransmitir cada byte.
        </p>

        <h2 id="fallback">Ordem de resolução (rehydrate)</h2>
        <ol>
          <li>Objeto já no storage (CAS)</li>
          <li>Se sumiu → re-download do WhatsApp, grava de novo no storage</li>
          <li>404 só se o WhatsApp não puder mais entregar a mídia</li>
        </ol>

        <h2 id="two-stage">Webhooks em duas etapas</h2>
        <ol>
          <li>
            <code>message</code> com <code>mediaStage: "meta"</code> — chegou cedo (URL WA ou placeholder)
          </li>
          <li>
            <code>message.media.stored</code> — após CAS; URL/storage estáveis · ou <code>message.media.failed</code>
          </li>
        </ol>
        <p>
          Bots que só querem arquivo permanente: assinem <code>message.media.stored</code> (ou <code>message</code>, que
          também casa stage-2).
        </p>
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
    description: 'Multi-config, outbox durável, HMAC e retries.',
    body: (
      <>
        <h2 id="multi">Multi-config</h2>
        <p>
          CRUD em <code>/v1/instances/:name/webhooks</code>. Cada config: URL, events[], hmac, retries, customHeaders,
          enabled. Há também webhook legado nos campos da instance (<code>webhookUrl</code> / <code>webhookEvents</code>
          ).
        </p>
        <Callout title="Garantias (por design)">
          <ul>
            <li>
              <strong>Projeção primeiro</strong> — mensagem/chat upsertados antes de enfileirar o webhook
            </li>
            <li>
              <strong>Outbox Postgres</strong> — claim atômico, retry/backoff; receptor offline não perde o evento
            </li>
            <li>
              <strong>
                <code>processed_events</code>
              </strong>{' '}
              — side-effect não dispara duas vezes se o protocolo reentregar
            </li>
            <li>
              <strong>HMAC-SHA512</strong> — verificar autenticidade no seu endpoint
            </li>
          </ul>
        </Callout>

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

        <h2 id="hmac">HMAC e retries</h2>
        <p>
          Quando configurado, o worker assina o POST (<code>X-Webhook-Hmac</code> / <code>X-Webhook-Hmac-Sha512</code>
          ). Retries: policy linear/exponential/constant + attempts + delaySeconds. O secret é write-only na API (nunca
          re-ecoado no GET).
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
    description: 'Sinalização JSON, PCM 16 kHz, gravação, audio blast e STT.',
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

        <h2 id="blast">Audio blast + STT</h2>
        <p>Para prompts outbound automáticos (estilo IVR), use REST em vez do WS do softphone:</p>
        <table>
          <thead>
            <tr>
              <th>Endpoint</th>
              <th>O que faz</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>
                <code>POST /v1/instances/:name/calls/blast</code>
              </td>
              <td>
                Discagem → toca WAV de <code>audioUrl</code> ao atender → grava a perna remota (opcional) + transcrição
                Whisper
              </td>
            </tr>
            <tr>
              <td>
                <code>POST /v1/instances/:name/calls/:callId/transcribe</code>
              </td>
              <td>STT sobre gravação já armazenada (blast ou call-recording)</td>
            </tr>
          </tbody>
        </table>
        <CodeBlock
          language="bash"
          code={`curl -s -X POST "$BASE/v1/instances/sales-1/calls/blast" \\
  -H "X-Api-Key: $KEY" -H "content-type: application/json" \\
  -d '{
    "to": "5511999999999",
    "audioUrl": "https://cdn.example.com/prompt.wav",
    "responseTimeoutMs": 5000,
    "recordResponse": true,
    "transcribe": true,
    "sttLanguage": "pt"
  }'`}
        />
        <ul>
          <li>
            <strong>Só WAV</strong> (PCM/float); resample para 16 kHz mono. <code>audioUrl</code> com proteção SSRF
            (HTTPS público, sem redirects, caps de tamanho/tempo).
          </li>
          <li>
            Gravação fica ligada na row da call — <code>GET .../recording</code> e <code>.../transcribe</code> funcionam
            depois do blast.
          </li>
          <li>
            STT exige <code>STT_ENABLED=true</code>, <code>STT_API_URL</code> (ex.{' '}
            <code>https://api.groq.com/openai</code>), <code>STT_API_KEY</code>. Opcional <code>STT_MODEL</code> /{' '}
            <code>STT_LANGUAGE</code>.
          </li>
          <li>
            O HTTP fica aberto até o blast terminar — aumente o timeout do client em WAVs longos. Ver Scalar{' '}
            <ExternalLink href="/docs">/docs</ExternalLink> (tag Calls).
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
          instância (softphone) ou use <code>POST .../calls/blast</code> com <code>recordResponse: true</code>.
        </p>

        <h3 id="q-blast">Como tocar um WAV e transcrever a resposta?</h3>
        <p>
          <code>POST /v1/instances/:name/calls/blast</code> com <code>audioUrl</code> (WAV em HTTPS público). Configure{' '}
          <code>STT_*</code> para Whisper inline, ou chame <code>POST .../calls/:callId/transcribe</code> depois.
          Detalhes em <a href="/guide/voip#blast">VoIP</a>.
        </p>

        <h3 id="q-wam">O que é WAM / como desligar?</h3>
        <p>
          WAM é a analytics client-side do WhatsApp Web (<code>w:stats</code>) para paridade de wire com uma aba real —
          não são métricas do zapo-rest. Fica <strong>ligado por padrão</strong> via <code>@zapo-js/wam</code>. Para
          desligar: <code>WAM_ENABLED=false</code> e reinicie o processo. Ver{' '}
          <a href="/guide/architecture#wam">Arquitetura</a>.
        </p>

        <h3 id="q-instance-path">Preciso colocar o nome da instância em toda URL?</h3>
        <p>
          Com a <strong>admin key</strong>, sim — use <code>/v1/instances/:name/...</code>. Com a{' '}
          <strong>instance key</strong>, o nome pode ser omitido: recursos em <code>/v1/messages/...</code>,{' '}
          <code>/v1/chats</code>, etc., e ciclo de vida em <code>/v1/instance/...</code> (singular). O path nomeado
          continua válido. Ver <a href="/guide/auth#scope">Autenticação</a>.
        </p>
      </>
    ),
  },
}
