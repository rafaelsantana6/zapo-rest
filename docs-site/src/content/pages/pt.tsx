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
            <strong>Mídia recuperável</strong> — se o objeto sumir, re-baixa do WhatsApp; blob expirado no CDN (404/410)
            pede um reupload ao remetente
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
          <li>
            <strong>@handle e histórico tardio de grupo</strong> — envie para <code>@handle</code>; histórico
            compartilhado depois que você entra no grupo é importado (<code>HISTORY_GROUP_BUNDLES</code>, ligado por
            padrão)
          </li>
          <li>
            <strong>Vídeo em canal binário próprio</strong> — frames H.264 nunca dividem o socket com o PCM; um
            visualizador lento cai para o próximo key frame em vez de crescer memória do servidor ou travar o áudio
          </li>
          <li>
            Configurações de conversa sincronizadas — ações bem-sucedidas e app-state do telefone atualizam o Postgres;
            consultas refletem a expiração do mute.
          </li>
          <li>
            Metadados duráveis preservam exclusões e configurações recentes durante importações da mailbox e replays.
          </li>
          <li>
            {
              'Área própria para canais: novas mensagens e threads de canais do mailbox ficam fora de app_messages/chats e do download de mídia de chats. Linhas já armazenadas são preservadas. Não há histórico/busca local de canais: consulte as rotas dedicadas do WhatsApp e renove as assinaturas temporárias ao vivo.'
            }
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
              <td>Blob expirado no CDN (404/410) → um reupload do remetente</td>
              <td>Mídia de histórico que o WhatsApp já apagou ainda pode ser buscada no celular do remetente</td>
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
              <td>
                Bundles de histórico de grupo (<code>HISTORY_GROUP_BUNDLES</code>, ligado por padrão)
              </td>
              <td>
                Histórico compartilhado depois que você entra fica na projeção. Um terceiro dispara o download —{' '}
                <code>false</code> ignora
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
            <tr>
              <td>
                Vídeo em WS dedicado (<code>.../calls/:id/video</code>) + drop-until-keyframe
              </td>
              <td>Nunca bloqueia nem atrasa o PCM; visualizador lento descarta frames até o próximo key frame</td>
            </tr>
            <tr>
              <td>Configurações de conversa projetadas do app-state</td>
              <td>
                Pin/mute/lock acompanham o telefone; mute temporário expira nas consultas. A exclusão somente local fica
                explícita.
              </td>
            </tr>
            <tr>
              <td>Metadados das ações de conversa</td>
              <td>
                Metadados duráveis preservam exclusões e configurações recentes durante importações da mailbox e
                replays.
              </td>
            </tr>
            <tr>
              <td>Canais — /v1/newsletters</td>
              <td>
                O tráfego de canais evita projeções ocultas e armazenamento de mídia de chats; o histórico é lido
                diretamente do WhatsApp.
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
          chat completo. Na aba <strong>Áudio/vídeo</strong> do softphone dá para escolher e testar a câmera (prévia + o
          mesmo encoder H.264 da call, com o motivo quando ela não abre); na call há <strong>Trocar câmera</strong>,{' '}
          <strong>Tela</strong> e uma linha com o que está sendo enviado. Câmera e tela exigem HTTPS ou{' '}
          <code>localhost</code>.
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

        <h2 id="l1-cache">Cache L1 do store (opcional)</h2>
        <p>
          <code>STORE_L1_CACHE=true</code> (padrão <code>false</code>) coloca um cache de leitura em processo na frente
          das rows de sessão Signal, identidade, sender-key e privacy-token no Postgres, reduzindo leituras no caminho
          crítico de decrypt/encrypt. <code>STORE_L1_IDLE_TTL_SECONDS</code> (padrão <code>1800</code>, <code>0</code> =
          só o limite de tamanho evicta) evita que um processo de vida longa guarde todo peer visto desde o boot. Seguro
          só com um único processo ou sticky sessions por instância — a mesma restrição que as sessões WA ao vivo já
          têm.
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
            WhatsApp e regrava. CDN 404/410 pede um reupload ao remetente antes de desistir
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
              <td>Blob expirado no CDN (404/410) → um reupload do remetente</td>
              <td>Mídia de histórico que o WhatsApp já apagou ainda pode ser buscada no celular do remetente</td>
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
              <td>
                Bundles de histórico de grupo (<code>HISTORY_GROUP_BUNDLES</code>, ligado por padrão)
              </td>
              <td>
                Histórico compartilhado depois que você entra fica na projeção. Um terceiro dispara o download —{' '}
                <code>false</code> ignora
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

        <h2 id="voip-arch">VoIP em três canais</h2>
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
              <td>Mídia (áudio)</td>
              <td>
                <code>.../calls/:id/stream</code>
              </td>
              <td>PCM Float32 LE mono @ 16 kHz (binary frames)</td>
            </tr>
            <tr>
              <td>Mídia (vídeo)</td>
              <td>
                <code>.../calls/:id/video</code>
              </td>
              <td>
                H.264 Annex-B, header binário de 12 bytes, um <code>streamId</code> por remetente
              </td>
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

# Avatar JPEG — URL pública
curl -s -X PUT "$BASE/v1/profile/image" \\
  -H "X-Api-Key: $INSTANCE_API_KEY" -H "content-type: application/json" \\
  -d '{"mediaUrl":"https://cdn.example.com/avatar.jpg"}'

# Avatar — upload multipart (campo file)
curl -s -X PUT "$BASE/v1/profile/image" -H "X-Api-Key: $INSTANCE_API_KEY" \\
  -F file=@./avatar.jpg

# Alias: /profile/picture · remover: DELETE /v1/profile/image

# Username (@handle). O PIN de recuperação não volta na resposta.
curl -s "$BASE/v1/profile/username" -H "X-Api-Key: $INSTANCE_API_KEY"
curl -s -X PUT "$BASE/v1/profile/username" -H "X-Api-Key: $INSTANCE_API_KEY" \\
  -H "content-type: application/json" -d '{"username":"loja"}'
curl -s "$BASE/v1/profile/username/check?username=loja" -H "X-Api-Key: $INSTANCE_API_KEY"
curl -s -X POST "$BASE/v1/profile/username/resolve" -H "X-Api-Key: $INSTANCE_API_KEY" \\
  -H "content-type: application/json" -d '{"username":"@loja"}'`}
        />
        <p>
          Troca de handle em outro aparelho emite <code>profile.username</code>. O campo <code>to</code> aceita{' '}
          <code>@handle</code>; <code>key-required</code> pede nova tentativa como <code>@handle:1234</code>.
        </p>
        <Callout title="Mídia: URL · base64 · multipart">
          Avatar, mensagens de mídia, status e blast aceitam <strong>uma</strong> fonte: <code>mediaUrl</code>,{' '}
          <code>mediaBase64</code> (JSON) ou upload <code>multipart/form-data</code> no campo <code>file</code>{' '}
          (aliases: <code>media</code>, <code>audio</code>, …). Limite de body/upload: env{' '}
          <code>MEDIA_UPLOAD_MAX_BYTES</code> (padrão 100&nbsp;MiB; o bodyLimit do Fastify segue o mesmo valor). No
          Scalar (<code>/docs</code>), o content-type padrão das rotas de mídia é <code>multipart/form-data</code> com
          seletor de <code>file</code> (JSON continua disponível). Foto de perfil/grupo: o servidor re-encoda PNG/WebP
          etc. para JPEG compacto (≤640px) antes do WhatsApp — evite 502 por formato/tamanho inválido.
        </Callout>
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
              <td>
                <code>mediaUrl</code> · <code>mediaBase64</code> · multipart <code>file</code>
              </td>
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

        <h2 id="extended-message-types">Eventos, ações e novos tipos de mídia</h2>
        <p>
          Todas as rotas abaixo usam POST com chave da instância e retornam <code>{`{ id, result }`}</code>.
        </p>
        <h3 id="send-event">Criar evento</h3>
        <p>
          <code>POST /v1/messages/event</code>
        </p>
        <p>
          Datas ISO 8601 com fuso são convertidas para segundos Unix. <code>endTime</code> deve ser igual ou posterior a{' '}
          <code>startTime</code>; datas inválidas retornam 400. Também aceita <code>isCanceled</code>.
        </p>
        <CodeBlock
          language="json"
          code={`{
  "to": "120363000000000@g.us",
  "name": "Team sync",
  "description": "Weekly",
  "startTime": "2026-12-01T15:00:00Z",
  "endTime": "2026-12-01T16:00:00Z",
  "location": {
    "latitude": -23.5,
    "longitude": -46.6,
    "name": "HQ"
  },
  "joinLink": "https://meet.example.com/team",
  "extraGuestsAllowed": true,
  "isScheduleCall": false,
  "hasReminder": true,
  "reminderOffsetSec": 600
}`}
        />
        <h3 id="send-event-respond">Responder a evento</h3>
        <p>
          <code>POST /v1/messages/event/respond</code>
        </p>
        <p>
          Respostas: <code>going</code>, <code>not_going</code> ou <code>maybe</code>. O original deve estar armazenado
          nesta instância e conversa; a API recupera autor, <code>fromMe</code>, participante e segredo de 32 bytes.
          Original ausente: 404; segredo/autor indisponível: 409. Receba/sincronize o original primeiro.
        </p>
        <CodeBlock
          language="json"
          code={`{
  "to": "120363000000000@g.us",
  "eventMessageId": "EVENT_ID",
  "response": "going",
  "extraGuestCount": 1
}`}
        />
        <h3 id="send-pin">Fixar ou desafixar</h3>
        <p>
          <code>POST /v1/messages/pin</code>
        </p>
        <p>
          Use <code>pinned: false</code> para desafixar. Duração: <code>24h</code> (padrão), <code>7d</code> ou{' '}
          <code>30d</code>, mapeadas para 86400, 604800 e 2592000 segundos. A API sempre inclui a duração ao fixar:
          clientes descartam silenciosamente pins sem duração. Requer mensagem armazenada nesta instância e conversa.
        </p>
        <CodeBlock
          language="json"
          code={`{
  "to": "120363000000000@g.us",
  "messageId": "MESSAGE_ID",
  "pinned": true,
  "duration": "7d"
}`}
        />
        <h3 id="send-keep">Manter ou deixar de manter</h3>
        <p>
          <code>POST /v1/messages/keep</code>
        </p>
        <p>
          Use <code>kept: false</code> para desfazer. Para mensagens temporárias; requer mensagem armazenada nesta
          instância e conversa.
        </p>
        <CodeBlock
          language="json"
          code={`{
  "to": "120363000000000@g.us",
  "messageId": "MESSAGE_ID",
  "kept": true
}`}
        />
        <h3 id="send-poll-vote">Votar em enquete</h3>
        <p>
          <code>POST /v1/messages/poll/vote</code>
        </p>
        <p>
          Use os nomes exatos das opções; lista vazia retorna 400. Requer enquete original armazenada, com autor,{' '}
          <code>fromMe</code>, participante e segredo recuperados pela API, tanto para enquetes enviadas como recebidas.
          Original ausente: 404; segredo/autor indisponível: 409.
        </p>
        <CodeBlock
          language="json"
          code={`{
  "to": "120363000000000@g.us",
  "pollMessageId": "POLL_ID",
  "options": [
    "Pizza"
  ]
}`}
        />
        <h3 id="send-ptv">Vídeo redondo (PTV)</h3>
        <p>
          <code>POST /v1/messages/ptv</code>
        </p>
        <p>
          Mesmo contrato de mídia de vídeo: <code>mediaUrl</code>, <code>mediaBase64</code> ou multipart com arquivo{' '}
          <code>file</code> e campo <code>to</code>. Não aceita legenda; arquivos temporários são removidos após o envio
          ou falha.
        </p>
        <CodeBlock
          language="json"
          code={`{
  "to": "5511999999999",
  "mediaUrl": "https://cdn.example.com/note.mp4",
  "mimetype": "video/mp4"
}`}
        />
        <h3 id="send-sticker-pack">Pacote de stickers</h3>
        <p>
          <code>POST /v1/messages/sticker-pack</code>
        </p>
        <p>
          JSON com 1–30 stickers (limite do gateway; o upstream não declara máximo). Cada <code>media</code>, ícone e
          capa opcional usa exatamente um de <code>url</code> ou <code>base64</code>. URLs passam pela proteção SSRF
          existente. Nomes de arquivos devem ser únicos, incluindo o ícone. <code>emojis</code> é opcional.{' '}
          <code>accessibilityLabel</code> não existe no upstream 1.11 e retorna 400.
        </p>
        <CodeBlock
          language="json"
          code={`{
  "to": "5511999999999",
  "id": "team-pack",
  "name": "Team",
  "publisher": "Example",
  "stickers": [
    {
      "media": {
        "url": "https://cdn.example.com/hi.webp"
      },
      "fileName": "hi.webp",
      "emojis": [
        "👋"
      ]
    }
  ],
  "trayIcon": {
    "media": {
      "base64": "BASE64_PNG"
    },
    "fileName": "tray.png"
  },
  "coverThumbnail": {
    "url": "https://cdn.example.com/cover.png"
  }
}`}
        />
        <h3 id="safe-message-context">Contexto seguro e recebimento</h3>
        <p>
          Envios tipados aceitam o objeto opcional <code>contextInfo</code> com apenas <code>expirationSeconds</code> e{' '}
          <code>ephemeralSettingTimestamp</code> (segundos Unix). Texto, resposta, mídia, enquete, reação, edição e
          revogação existentes também aceitam esses campos. <code>messageContextInfo</code> contém metadados de
          protocolo e não é exposto.
        </p>
        <CodeBlock
          language="json"
          code={`{ "to": "5511999999999", "text": "Hello", "contextInfo": { "expirationSeconds": 86400 } }`}
        />
        <p>
          Os eventos de mensagem existentes passam a identificar <code>event</code>, <code>event-response</code>,{' '}
          <code>pin</code>/<code>unpin</code>, <code>keep</code>/<code>unkeep</code>, <code>poll-vote</code>,{' '}
          <code>ptv</code> e <code>sticker-pack</code>, com resumos legíveis. Respostas/votos criptografados exibem o ID
          do original; nenhum novo nome de evento SSE/webhook foi adicionado.
        </p>

        <h2 id="to">
          Campo <code>to</code>
        </h2>
        <p>
          Aceita dígitos com DDI (<code>5511…</code>), JID PN, <code>@g.us</code>, <code>@lid</code> e username (
          <code>@handle</code> ou <code>@handle:key</code>). A API normaliza via resolve/JID helpers. O inbound traz{' '}
          <code>senderUsername</code> e <code>recipientUsername</code> quando o WhatsApp envia.
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
          Respostas ricas da Meta AI ficam como <code>type: text</code> (texto dos submessages, legenda de imagem e
          blocos de código). Imagem ou documento encaminhado por bot mantém o tipo interno. Quando o CDN devolve 404 ou
          410, o download pede ao celular do remetente um reupload antes de <code>message.media.failed</code>.
        </p>
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
          <li>Se o CDN responde 404/410 → pede um reupload ao remetente e baixa o path novo</li>
          <li>404 só se o WhatsApp e o remetente não puderem mais entregar a mídia</li>
          <li>
            Um primário que re-criptografa no reupload em vez de manter a chave falha rápido como{' '}
            <code>message.media.failed</code>, sem loop de retry
          </li>
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
          <code>history.sync</code>, não na resposta HTTP síncrona. Um bundle compartilhado depois que esta conta entra
          num grupo é importado com <code>HISTORY_GROUP_BUNDLES</code> ligado (padrão) e anunciado como{' '}
          <code>history.group</code>.
        </Callout>
        <h2 id="chat-actions">Ações de conversa</h2>
        <p>
          Os caminhos abaixo usam a chave da instância e aceitam telefones, JIDs de usuário/grupo e LIDs. As mudanças
          afetam sua conta e os dispositivos vinculados; os outros participantes mantêm suas cópias. Nenhuma ação sai de
          um grupo.
        </p>
        <p>
          GET /v1/chats e GET /v1/chats/:chatId retornam pinned numérico (0 desfixado, positivo fixado), muted,
          muteUntil (ISO ou null), locked e o muteEndMs existente. Mute expirado aparece como muted=false sem outro
          evento do telefone. Para sempre usa 9999-12-31T23:59:59Z.
        </p>
        <CodeBlock
          language="http"
          code={`POST /v1/chats/:chatId/pin       { "pinned": true }
POST /v1/chats/:chatId/mute      { "muted": true, "durationSeconds": 3600 }
POST /v1/chats/:chatId/mute      { "muted": true, "until": "2090-01-01T00:00:00Z" }
POST /v1/chats/:chatId/lock      { "locked": true }
POST /v1/chats/:chatId/clear     { "deleteStarred": false, "deleteMedia": false }
POST /v1/chats/:chatId/delete    { "deleteMedia": false }
DELETE /v1/chats/:chatId/messages/:messageId/for-me?deleteMedia=true`}
        />
        <p>
          Fixar também desarquiva. Bloquear limpa arquivo e fixação. Use false para desfixar, reativar notificações ou
          desbloquear.
        </p>
        <p>
          Mute aceita until (data ISO futura com fuso horário) ou durationSeconds (inteiro positivo), nunca ambos. Omita
          os dois para silenciar para sempre. Para reativar notificações, envie apenas muted=false.
        </p>
        <p>
          Clear usa deleteStarred=false e deleteMedia=false por padrão. Favoritas permanecem na projeção e a prévia é
          recalculada. Envie deleteStarred=true para limpar todas as mensagens. deleteMedia é repassado ao zapo; objetos
          de mídia/CAS do REST seguem sua própria retenção e não são apagados por essas rotas.
        </p>
        <p>
          POST /v1/chats/:chatId/delete chama deleteChat do zapo e remove conversa/mensagens locais, incluindo aliases
          LID. O DELETE /v1/chats/:chatId legado remove apenas a linha local da conversa e mantém mensagens. O zapo
          monta automaticamente o intervalo da última mensagem a partir da mailbox; suas opções de deleteChat aceitam
          apenas deleteMedia.
        </p>
        <p>
          Excluir para mim usa fromMe, participante e timestamp da mensagem armazenada e valida se ela pertence à
          conversa (404 caso contrário). Use ?deleteMedia=true para repassar a opção de mídia. Não revoga a cópia dos
          destinatários.
        </p>
        <p>
          As novas ações retornam 409 para conflitos de app-state e 503 para falhas de conexão, com a mensagem do
          upstream. A projeção local muda após sucesso do upstream. Mudanças do telefone chegam pelo evento webhook/SSE
          chat.update existente após persistência.
        </p>
        <p>
          Metadados duráveis preservam exclusões e configurações recentes durante importações da mailbox e replays.
          Clear/delete capturam um limite antes da chamada de rede e preservam mensagens posteriores; conversas limpas e
          vazias continuam na lista após reconcile. Favoritas recebidas antes da mensagem são aplicadas quando ela
          chega. O corpo de clear/delete pode ser omitido.
        </p>
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
            <code>status</code> em cada resultado: <code>in</code>, <code>out</code> (sem WhatsApp),{' '}
            <code>invalid</code>, <code>error</code> / <code>unanswered</code> (servidor sem resposta —{' '}
            <code>exists: false</code> aqui não quer dizer "sem WhatsApp" e não vai para o cache) ou <code>local</code>
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
            <code>instance.pairing_required</code> (<code>forceManual</code>), <code>instance.logged_out</code>
          </li>
          <li>
            Messages: <code>message</code>, <code>message.any</code>, <code>message.inbound</code>,{' '}
            <code>message.media.stored</code>, <code>message.media.failed</code>, <code>message.ack</code>,{' '}
            <code>message.reaction</code>, <code>message.revoked</code>, <code>message.edited</code>
          </li>
          <li>
            Chat/presence: <code>chat.update</code>, <code>presence.update</code>, <code>chatstate</code>,{' '}
            <code>group.update</code>, <code>history.sync</code>, <code>history.group</code>,{' '}
            <code>profile.username</code>
          </li>
          <li>
            Calls: <code>call.incoming</code>, <code>call.state</code>, <code>call.ended</code>,{' '}
            <code>call.peer_mute</code>, <code>call.hand_raise</code>, <code>call.reaction</code>,{' '}
            <code>call.participants_changed</code>, <code>call.mute_requested</code>,{' '}
            <code>call.participant_media</code>, <code>call.video_state</code>, <code>call.video_upgraded</code>,{' '}
            <code>call.screen_share</code>
          </li>
        </ul>

        <p>
          Pedidos de entrada em grupos: veja <a href="/guide/groups#join-requests">Pedidos de entrada</a> —{' '}
          <code>group.update</code>, <code>payload.type</code>, <code>payload.requesterJid</code> /{' '}
          <code>payload.requests[].jid</code>. O SSE usa <code>data.type</code>, <code>data.requesterJid</code> e{' '}
          <code>data.requests[].jid</code>.
        </p>

        <h2 id="hmac">HMAC e retries</h2>
        <p>
          Quando configurado, o worker assina o POST (<code>X-Webhook-Hmac</code> / <code>X-Webhook-Hmac-Sha512</code>
          ). Retries: policy linear/exponential/constant + attempts + delaySeconds. O secret é write-only na API (nunca
          re-ecoado no GET).
          <code>newsletter.update</code>, <code>newsletter.message_update</code>.
        </p>
        <p>
          Mudanças de app-state do telefone passam a emitir chat.update após projeção: chatId e os campos públicos da
          conversa (pinned numérico, muted, muteUntil ISO, locked, archived). ClearChat/DeleteChat/DeleteMessageForMe
          carregam action e deleted; deleted=true indica remoção da linha da conversa. Nenhum novo nome de evento ou
          transporte foi adicionado.
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

// outbound com vídeo (abre também .../calls/{callId}/video)
{ "op": "call:start", "id": "2b", "phone": "5511888888888", "video": true }

// inbound
{ "op": "call:accept", "id": "3", "callId": "call_…" }
{ "op": "call:reject", "id": "4", "callId": "call_…" }
{ "op": "call:end", "id": "5", "callId": "call_…" }
{ "op": "call:mute", "id": "6", "callId": "call_…", "muted": true }
{ "op": "call:hand", "id": "7", "callId": "call_…", "raised": true }
{ "op": "call:reaction", "id": "8", "callId": "call_…", "reaction": "👍" }
{ "op": "call:leave", "id": "9", "callId": "call_…" }
{ "op": "call:mute_participant", "id": "10", "callId": "call_…", "participant": "…@lid" }
{ "op": "call:video_upgrade", "id": "11", "callId": "call_…" }
{ "op": "call:screen_share", "id": "12", "callId": "call_…", "sharing": true }`}
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
            <code>call:ended</code> — terminal (<code>endReason</code> agora também cobre{' '}
            <code>accepted_elsewhere</code>, <code>rejected_elsewhere</code>, <code>relay_lost</code>)
          </li>
          <li>
            <code>calls:snapshot</code> — lista ao attach
          </li>
          <li>
            <code>call:peer_mute</code> — o peer anunciou o próprio estado do microfone
          </li>
          <li>
            <code>call:hand_raise</code> — um participante remoto levantou/baixou a mão
          </li>
          <li>
            <code>call:reaction</code> — um peer mandou uma reação emoji
          </li>
          <li>
            <code>call:participants_changed</code> / <code>call:mute_requested</code> /{' '}
            <code>call:participant_media</code> — chamadas em grupo
          </li>
          <li>
            <code>call:video_state</code> / <code>call:video_upgraded</code> / <code>call:screen_share_changed</code> —
            vídeo (estado da câmera, pedido de upgrade, compartilhamento de tela)
          </li>
          <li>
            <code>device:status</code> — status da sessão WA
          </li>
        </ul>

        <h2 id="group-calls">Chamadas em grupo</h2>
        <p>
          Para ligar para um grupo, troque <code>to</code> por <code>groupId</code> + <code>participants</code> em{' '}
          <code>POST .../calls</code>. Os participantes (telefone, JID ou LID, até 31, sem você) são resolvidos para
          LID; quem não tiver LID volta em <code>400</code> com <code>details.missing</code>. A resposta traz{' '}
          <code>groupJid</code> e os LIDs chamados.
        </p>
        <p>
          Controle: <code>POST .../calls/:callId/leave</code> sai da chamada sem encerrá-la para os outros (409 em call
          1:1 — use <code>end</code>); <code>POST .../calls/:callId/join</code> entra numa chamada em andamento que você
          perdeu ou saiu; <code>POST .../calls/:callId/participants/mute</code> (
          <code>{'{ "participant": "…@lid" }'}</code>) pede para um participante silenciar — quem decide é o cliente
          dele. No WS: <code>call:leave</code>, <code>call:join</code>, <code>call:mute_participant</code>.
        </p>
        <p>
          Eventos: <code>call.participants_changed</code> (<code>added</code>, <code>removed</code> com{' '}
          <code>cause</code>, <code>switched</code>, <code>devicesAdded</code>, <code>devicesRemoved</code>),{' '}
          <code>call.mute_requested</code> (<code>participantJid</code>, <code>muted</code>) e{' '}
          <code>call.participant_media</code> (<code>participantJid</code>, <code>receiving</code>). O snapshot ganha{' '}
          <code>isGroup</code>, <code>groupJid</code> e <code>participants</code> (<code>jid</code>,{' '}
          <code>devices</code>, <code>state</code>). Vídeo em grupo: veja <a href="#video">Vídeo H.264</a>.
        </p>

        <h2 id="interactions">Levantar a mão &amp; reações</h2>
        <p>
          Equivalentes REST de <code>call:hand</code> / <code>call:reaction</code>:{' '}
          <code>POST .../calls/:callId/hand</code> (<code>{'{ "raised": true }'}</code>, 404 em call desconhecida) e{' '}
          <code>POST .../calls/:callId/reaction</code> (<code>{'{ "reaction": "👍" }'}</code>, 1–32 chars, 409 quando a
          call não está ativa ou o canal de reação ainda não abriu). Levantar a mão é durável — o peer continua vendo
          até baixar; a reação é momentânea e não fica guardada na call.
        </p>
        <p>
          O snapshot da call (REST <code>GET /v1/calls</code> e eventos) agora traz <code>peerAudioMuted</code> (boolean
          ou <code>null</code> até o peer anunciar um), <code>handRaised</code> (local) e <code>raisedHands</code> (JIDs
          de device dos participantes remotos com a mão levantada). <code>POST .../calls/:callId/mute</code> agora
          também anuncia o estado de mudo local ao peer.
        </p>

        <h2 id="pcm">Mídia PCM</h2>
        <CodeBlock
          language="text"
          code={`ws://host/v1/calls/{callId}/stream?apiKey=$KEY

← JSON { "op":"ready", "sampleRate":16000, "format":"f32le", "channels":1 }
↔ binary Float32 LE mono @ 16 kHz
← JSON { "op":"backpressure", "pause": true | false }
← JSON { "op":"ended" }`}
        />

        <h2 id="video">Vídeo H.264</h2>
        <p>
          Chamadas iniciadas com <code>isVideo: true</code> (ou <code>call:start</code> com <code>"video": true</code>)
          carregam vídeo num <strong>segundo</strong> WebSocket, <code>.../calls/:callId/video</code> — o áudio continua
          em <code>.../stream</code>; abra os dois. A resposta de <code>POST.../calls</code> e todo snapshot de call
          (REST, <code>/v1/voip</code>, webhooks) trazem <code>mediaType: "audio" | "video"</code> e{' '}
          <code>videoOff</code> (câmera do peer desligada; sempre <code>true</code> em calls de áudio).
        </p>
        <CodeBlock
          language="text"
          code={`ws://host/v1/calls/{callId}/video?apiKey=$KEY

← JSON { "op":"ready", "callId":"...", "codec":"h264", "format":"annexb", "headerBytes":12, "mediaType":"video", "videoOff":false }
↔ binary: header de 12 bytes + 1 access unit H.264 Annex-B
   u8 version=1 · u8 flags (bit0 = key frame) · u16 BE stream id · u64 BE timestamp (µs)
← JSON { "op":"stream", "streamId":0, "ssrc":…, "participantJid":"…" }   (antes do 1º frame de cada remetente)
← JSON { "op":"state", "state":"active", "isActive":true, "mediaType":"video", "videoOff":false }
← JSON { "op":"ended" }`}
        />
        <ul>
          <li>
            <strong>Cliente → servidor:</strong> frames da câmera (Constrained Baseline recomendado, ex.{' '}
            <code>avc1.42E01F</code>). A API não repassa pedido de key frame do peer — envie um IDR a cada 1 s no
            máximo.
          </li>
          <li>
            <strong>Servidor → cliente:</strong> frames do peer; timestamps começam em 0 (clock RTP 90 kHz
            reconstruído). Se o socket atrasar (mais de 4 MiB em buffer), os frames são descartados até o próximo key
            frame — sem vídeo obsoleto, memória limitada.
          </li>
          <li>
            Fechar este socket <strong>não</strong> encerra a call — só o WS de áudio decide isso (
            <code>VOIP_END_CALL_ON_WS_CLOSE</code>).
          </li>
          <li>
            Close codes: <code>4401</code> sem key · <code>4403</code> forbidden · <code>4404</code> call não encontrada
            · <code>4503</code> instância offline.
          </li>
          <li>Vídeo não é gravado — a gravação WAV continua só de áudio.</li>
        </ul>

        <p>
          O socket de vídeo abre também em call de áudio, porque ela pode virar vídeo no meio. Cada remetente tem seu
          próprio stream: antes do primeiro frame chega{' '}
          <code>{'{ "op":"stream", "streamId":1, "ssrc":…, "participantJid":"…" }'}</code>e o header binário traz esse{' '}
          <code>streamId</code> — use um decoder por stream. Quando o remetente sai ou troca de aparelho chega{' '}
          <code>{'{ "op":"stream_end", "streamId":1 }'}</code>; os ids não se repetem. Em call 1:1 é sempre{' '}
          <code>0</code>; o cliente manda <code>0</code>.
        </p>
        <ul>
          <li>
            <strong>Áudio → vídeo (1:1):</strong> <code>POST .../calls/:callId/video/upgrade</code> (WS{' '}
            <code>call:video_upgrade</code>) espera o peer por cerca de 5 s e devolve <code>result</code>:{' '}
            <code>accepted</code>, <code>rejected</code>, <code>rejected_by_timeout</code>, <code>error</code>,{' '}
            <code>timeout</code> ou <code>cancelled</code>. Só mande frames depois de <code>accepted</code>.
          </li>
          <li>
            <strong>Pedido do peer:</strong> chega como <code>call.video_state</code> com{' '}
            <code>upgradeRequested: true</code>; responda em até 5 s com <code>.../video/upgrade/accept</code> ou{' '}
            <code>.../reject</code>. <code>.../cancel</code> retira um pedido nosso.
          </li>
          <li>
            <strong>Grupo:</strong> <code>isVideo: true</code> junto de <code>groupId</code> já começa com vídeo.{' '}
            <code>POST .../calls/:callId/video</code> (<code>{'{ "enabled": true }'}</code>, WS <code>call:video</code>)
            liga ou desliga a sua câmera. O upgrade numa call de grupo pede ao servidor; todos recebem{' '}
            <code>call.video_upgraded</code>.
          </li>
          <li>
            <strong>Compartilhar tela:</strong> <code>POST .../calls/:callId/screen-share</code> (
            <code>{'{ "sharing": true }'}</code>, WS <code>call:screen_share</code>). A tela substitui a câmera no mesmo
            stream: pare os frames da câmera, mande os da tela e volte depois. O peer compartilhando chega como{' '}
            <code>call.screen_share</code>.
          </li>
          <li>
            <strong>Primeiros frames retidos:</strong> o plugin segura os seus frames até o peer estar pronto (até 2 s)
            e abre o stream no próximo key frame. Por isso o envio de um IDR a cada 1 s também encurta o início.
          </li>
          <li>
            O snapshot traz <code>screenSharing</code>, <code>peerVideoState</code>, <code>peerScreenSharing</code> e{' '}
            <code>participantMedia</code> (por dispositivo: mic, câmera, tela, mídia chegando).
          </li>
          <li>
            <code>mediaType</code> vira <code>"video"</code> assim que a call carrega vídeo, inclusive numa call 1:1 que
            fez upgrade (o plugin mantém o tipo negociado, <code>audio</code>; a API lê os sinais de vídeo ativo).
          </li>
          <li>
            No WS de controle, o compartilhamento de tela do peer chega como <code>call:screen_share_changed</code> —{' '}
            <code>call:screen_share</code> é o comando.
          </li>
        </ul>

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
          CRUD completo sob <code>/v1/groups</code> com a chave da instância: create, metadata, leave,
          subject/description, invite-code, participants add/remove, promote/demote, picture, settings (announcement,
          restrict, ephemeral…).
        </p>
        <h2 id="member-settings">Permissões dos membros</h2>
        <p>
          Cada rota recebe <code>{'{ mode }'}</code>:
        </p>
        <ul>
          <li>
            Quem pode adicionar membros: <code>PUT /v1/groups/:groupId/settings/member-add-mode</code> —{' '}
            <code>admin_add</code> / <code>all_member_add</code>.
          </li>
          <li>
            Quem pode compartilhar o link do convite: <code>PUT /v1/groups/:groupId/settings/member-link-mode</code> —{' '}
            <code>admin_link</code> / <code>all_member_link</code>.
          </li>
          <li>
            Quem pode enviar histórico: <code>PUT /v1/groups/:groupId/settings/history-share-mode</code> —{' '}
            <code>admin_share</code> / <code>all_member_share</code>.
          </li>
        </ul>
        <CodeBlock
          language="bash"
          code={`curl -s -X PUT "$BASE/v1/groups/$GID/settings/member-add-mode" \\
 -H "X-Api-Key: $KEY" -H "Content-Type: application/json" \\
 -d '{"mode":"all_member_add"}'

curl -s -X PUT "$BASE/v1/groups/$GID/settings/member-link-mode" \\
 -H "X-Api-Key: $KEY" -H "Content-Type: application/json" \\
 -d '{"mode":"all_member_link"}'

curl -s -X PUT "$BASE/v1/groups/$GID/settings/history-share-mode" \\
 -H "X-Api-Key: $KEY" -H "Content-Type: application/json" \\
 -d '{"mode":"all_member_share"}'`}
        />
        <p>
          Apenas administradores do grupo podem alterar os modos. Valores inválidos retornam 400 com os valores aceitos;
          grupo inexistente retorna 404; falta de permissão no WhatsApp retorna 403. As configurações booleanas
          continuam usando <code>{'{ enabled }'}</code> (<code>PUT /v1/groups/:groupId/settings/:setting</code>).
        </p>
        <p>
          Em <code>GET /v1/groups/:groupId</code> / <code>GET /v1/groups</code>, os metadados retornam{' '}
          <code>memberAddMode</code>, <code>memberLinkMode</code>, <code>historyShareMode</code> quando informados pelo
          WhatsApp; valores ausentes ou desconhecidos são omitidos. O campo upstream{' '}
          <code>memberShareGroupHistoryMode</code> permanece por compatibilidade.
        </p>
        <p>
          Mudanças feitas pelo celular no modo de adição chegam em <code>group.update</code> com{' '}
          <code>action: "member_add_mode"</code>, <code>mode</code>, <code>memberAddMode</code>. O zapo-js 1.11.0 não
          decodifica notificações dos modos de link e histórico: consulte os metadados para observar essas mudanças.
        </p>
        <h2 id="group-history">Histórico do grupo</h2>
        <p>
          <code>POST .../groups/:groupId/share-history</code> manda o histórico recente para quem entrou depois (a conta
          precisa de <code>group_history_send</code>). Bundles recebidos ficam ligados por padrão (
          <code>HISTORY_GROUP_BUNDLES</code>) e aparecem como <code>history.group</code> mais as projeções de mensagem.
        </p>
        <p>
          O envio obedece ao <a href="#member-settings">modo de compartilhamento de histórico</a> (
          <code>historyShareMode</code>): <code>admin_share</code> / <code>all_member_share</code>.{' '}
          <code>HISTORY_GROUP_BUNDLES</code> controla somente o recebimento dos bundles.
        </p>
        <p>
          Referência detalhada: <a href="/guide/api/Groups">Groups API</a>.
        </p>
        <h2 id="join-requests">Pedidos de entrada</h2>
        <p>
          Ative a aprovação por admins com <code>PUT /v1/groups/:groupId/settings/membership_approval_mode</code> e{' '}
          <code>{'{ "enabled": true }'}</code>. Liste os pedidos pendentes com{' '}
          <code>GET /v1/groups/:groupId/membership-requests</code>. A resposta é{' '}
          <code>{'{ "requests": [{ "jid": "111@lid", "requestedAt": "2026-11-06T12:00:00.000Z" }] }'}</code>. Campos
          opcionais: <code>phoneNumber</code> (JID PN do upstream), <code>method</code>, <code>requestor</code>,{' '}
          <code>requestorUsername</code> e <code>parentGroupJid</code>. Datas usam ISO 8601; quando o upstream omite a
          data, ela é representada pela época Unix.
        </p>
        <p>
          Use <code>POST .../membership-requests/approve</code> ou <code>.../reject</code> como admin do grupo;
          <code>.../cancel</code> retira pedidos enviados por esta conta. Todos recebem{' '}
          <code>{'{ "participants": ["5511999999999", "111@lid"] }'}</code> (telefones/JIDs, resolvidos como
          add/remove). Listas vazias retornam 400, grupos desconhecidos 404, falta de permissão 403 e modo de aprovação
          desligado 409; as mensagens de erro do upstream são preservadas. Autentique com a chave da instância em{' '}
          <code>X-Api-Key</code>.
        </p>
        <p>
          As notificações usam <code>group.update</code> nos webhooks e SSE. Os campos atuais do upstream, incluindo{' '}
          <code>action</code>, são preservados. <code>payload.type</code> é <code>membership_approval_request</code> com{' '}
          <code>payload.requesterJid</code> vindo do autor no upstream, ou <code>created_membership_requests</code> /{' '}
          <code>revoked_membership_requests</code> com <code>payload.requests[].jid</code> (<code>phoneJid</code>/
          <code>username</code> opcionais). Identidades são omitidas quando o upstream não as fornece; consulte os
          pedidos pendentes para reconciliar a fila. O SSE usa <code>data.type</code>, <code>data.requesterJid</code> e{' '}
          <code>data.requests[].jid</code>.
        </p>
        <h2>Comunidades</h2>
        <p>
          Comunidades são grupos pais com subgrupos vinculados. Use a chave da instância em X-Api-Key; os caminhos
          começam em /v1/communities.
        </p>
        <p>
          Crie com subject e, opcionalmente, description, membershipApprovalMode (open ou request_required; padrão
          request_required), allowNonAdminSubGroupCreation e createGeneralChat. IDs aceitam dígitos ou JIDs completos
          @g.us.
        </p>
        <table>
          <tbody>
            <tr>
              <td>
                <code>POST /v1/communities</code>
              </td>
              <td>{'Criar → { community }'}</td>
            </tr>
            <tr>
              <td>
                <code>GET /v1/communities/:communityId</code>
              </td>
              <td>{'Consultar metadados → { community }'}</td>
            </tr>
            <tr>
              <td>
                <code>DELETE /v1/communities/:communityId</code>
              </td>
              <td>{'Desativar → { ok: true }'}</td>
            </tr>
            <tr>
              <td>
                <code>GET /v1/communities/:communityId/subgroups</code>
              </td>
              <td>{'Listar → { communityJid, announcementGroup, subGroups }'}</td>
            </tr>
            <tr>
              <td>
                <code>GET /v1/communities/:communityId/participants</code>
              </td>
              <td>{'Participantes agregados → { participants }'}</td>
            </tr>
            <tr>
              <td>
                <code>GET /v1/communities/:communityId/subgroups/suggestions?hint=:groupId</code>
              </td>
              <td>{'Subgrupos sugeridos → { suggestions }'}</td>
            </tr>
            <tr>
              <td>
                <code>POST /v1/communities/:communityId/subgroups/link</code>
              </td>
              <td>{'Vincular → { result: { linkedJids, failed } }'}</td>
            </tr>
            <tr>
              <td>
                <code>POST /v1/communities/:communityId/subgroups/unlink</code>
              </td>
              <td>{'Desvincular → { result: { unlinkedJids, failed } }'}</td>
            </tr>
            <tr>
              <td>
                <code>POST /v1/communities/:communityId/subgroups/:groupId/join</code>
              </td>
              <td>{'Entrar → { ok: true }'}</td>
            </tr>
            <tr>
              <td>
                <code>POST /v1/communities/:communityId/owner</code>
              </td>
              <td>{'Transferir propriedade → { ok: true }'}</td>
            </tr>
          </tbody>
        </table>
        <p>
          Vincular/desvincular exige groups com pelo menos um item; desvincular também aceita removeOrphanedMembers.
          Confira as entradas failed (jid, error) mesmo com HTTP 200. Entrar aceita corpo opcional com type e retorna
          apenas confirmação; consulte /groups/:groupId depois para obter os metadados. A transferência aceita user
          (telefone, JID, LID ou @username), resolvido pelo resolvedor compartilhado de destinatários.
        </p>
        <p>
          Operações sobre comunidades existentes verificam primeiro os metadados do grupo pai: comunidades desconhecidas
          e grupos comuns retornam 404. Listagem de subgrupos, sugestões e transferência de propriedade exigem o
          transporte MEX upstream e as permissões da conta. As rotas REST delegam as operações de protocolo ao zapo-js.
        </p>
        <p>
          As duas rotas de consulta de grupos e os metadados de comunidade preservam isParentGroup, isClosedCommunity,
          defaultSubgroup, generalSubgroup, hiddenSubgroup, allowNonAdminSubGroupCreation e linkedParentJid, além dos
          demais campos upstream.
        </p>
        <p>
          Notificações de comunidade usam o evento webhook/SSE existente group.update: action é link, unlink,
          linked_group_promote ou linked_group_demote; linkedGroups contém jid, subject, subjectTimestampSeconds e
          hiddenSubgroup quando fornecidos. contextGroupJid também é repassado. Não há novos nomes de evento.
        </p>
        <p>
          JIDs legados de grupo, como 5511999999999-1234567890@g.us, são aceitos sem alteração ao vincular, desvincular,
          sugerir e entrar. Ausência de transporte MEX retorna 503; falhas reconhecidas nas consultas MEX retornam 502
          com mensagem pública estática. Erros IQ mantêm o mapeamento de status existente. O corpo de join também é
          opcional no contrato OpenAPI.
        </p>
        <p>
          <a href="/guide/api/Communities">Communities API</a>
        </p>
        <h2 id="channels">Canais</h2>
        <p>
          {
            'Canais do WhatsApp usam a área REST Newsletters em /v1/newsletters. Envie a chave da instância em X-Api-Key ou Bearer; os JIDs terminam em @newsletter. A instância vem dessa chave.'
          }
        </p>
        <p>
          {
            'Descoberta: GET na coleção lista os canais seguidos; /:jid consulta metadados; /by-invite/:code busca por convite; /search?q=noticias&limit=20&cursor=... retorna o diretório e pageInfo; /recommended?limit=20 lista recomendações.'
          }
        </p>
        <p>
          {
            'POST /:jid/follow mantém a associação; /unfollow deixa de seguir. POST /:jid/mute aceita { "muted": true, "type": "follower" } (type também pode ser admin). Seguir não cria uma assinatura ao vivo: POST /:jid/live-updates retorna durationSeconds. Renove antes de expirar; o gateway não renova automaticamente.'
          }
        </p>
        <p>
          {
            'GET /:jid/messages?count=50&before=42 e /:jid/updates?count=50&after=42&since=1700000000 leem diretamente do WhatsApp (count de 1 a 100; before e after são mutuamente exclusivos). A leitura de atualizações exige exatamente um cursor, mesmo com since. Metadados ausentes por JID ou convite retornam 404. O zapo-js 1.11 retorna páginas BinaryNode sem decodificador público. A resposta é um envelope de transporte { name, attributes, children?, text?, bytesBase64? }, não uma projeção de mensagens decodificadas. Metadados, diretório e seguidores têm campos JSON públicos estáveis.'
          }
        </p>
        <p>
          {
            'POST /:jid/messages/:messageId/react recebe { "reaction": "🔥" }; uma string vazia remove a reação. /vote recebe { "options": ["<hash de 32 bytes em base64>"] }; são hashes das opções da enquete, não rótulos ou índices. /view envia confirmação de visualização. Essas três ações exigem o ID numérico positivo atribuído pelo servidor, obtido no histórico do canal.'
          }
        </p>
        <p>
          {
            'Administração: POST na coleção com { name, description?, picture? } cria um canal (picture é um JPEG decodificável em base64, limitado a 256 KiB decodificados e 16 megapixels). PATCH /:jid aceita name, description, picture (null remove) e reactionCodesSetting. DELETE /:jid exclui permanentemente. GET /:jid/admin retorna informações e capacidades administrativas; /followers?count=50 retorna seguidores (sem cursor upstream); /pending-invites retorna JIDs de usuários.'
          }
        </p>
        <p>
          {
            'POST /:jid/admins/invite, /:jid/admins/invite/revoke, /:jid/admins/demote e /:jid/owner recebem { "user": "111@lid" }; telefones e @handles passam pelo resolvedor existente de destinatários. Todos os alvos precisam resolver para JIDs de usuário PN/LID; grupos, broadcasts e canais retornam 400. POST /:jid/admins/invite/accept aceita para a conta atual. A transferência exige um administrador previamente convidado. O upstream aceita automaticamente os termos de criação/convite administrativo ao criar/aceitar.'
          }
        </p>
        <p>
          {
            'Publicação: POST /:jid/messages chama client.newsletter.send. Use { "type": "text", "text": "Notícias" } ou type image/video/audio/document com mediaUrl, mediaBase64 ou arquivo multipart file, além de caption/mimetype/fileName/ptt conforme o tipo. PATCH /:jid/messages/:messageId edita com o mesmo corpo de texto/mídia; DELETE revoga. Esses IDs são os IDs de stanza retornados em id ao publicar, diferentes dos IDs numéricos de servidor de react/vote/view. O MIME é detectado no arquivo quando ausente; formatos não reconhecidos exigem mimetype explícito (400 caso contrário). A mídia temporária é removida após sucesso ou falha, inclusive quando a detecção de MIME falha.'
          }
        </p>
        <p>
          {
            'newsletter.update e newsletter.message_update chegam a webhooks e SSE. Notificações contêm jid, action e detalhes escalares; objetos aninhados desconhecidos são omitidos e bigints viram strings decimais. Atualizações de mensagens contêm jid, serverId e o tipo edit/revoke/reaction/poll_vote/counters. Edições trazem conteúdo projetado; hashes de votos usam base64. Nenhum dos eventos expõe nós brutos, plaintext ou protobuf.'
          }
        </p>
        <p>
          {
            'Área própria para canais: novas mensagens e threads de canais do mailbox ficam fora de app_messages/chats e do download de mídia de chats. Linhas já armazenadas são preservadas. Não há histórico/busca local de canais: consulte as rotas dedicadas do WhatsApp e renove as assinaturas temporárias ao vivo.'
          }
        </p>
        <p>
          Contrato completo: <a href="/guide/api/Newsletters">Newsletters API</a> ·{' '}
          <a href="https://zapo.to/en/guides/newsletters">zapo-js</a>
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
