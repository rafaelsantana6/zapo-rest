import { Callout } from '../../components/Callout'
import { CodeBlock } from '../../components/CodeBlock'
import { ExternalLink } from '../../components/ExternalLink'
import type { GuidePage } from './types'

export const GUIDE_PAGES: Record<string, GuidePage> = {
  intro: {
    title: 'zapo-rest',
    description: 'API REST multi-sesión para WhatsApp (zapo-js) — mensajes, media, webhooks, VoIP y dashboard.',
    body: (
      <>
        <p>
          <strong>zapo-rest</strong> es una API HTTP multi-sesión sobre{' '}
          <a href="https://zapo.to" target="_blank" rel="noreferrer">
            zapo-js
          </a>
          : cada <em>instance</em> es un dispositivo vinculado de WhatsApp con su propio ciclo de vida (QR/pairing →
          open → messages → calls).
        </p>

        <Callout title="Documentación en dos capas">
          <ul>
            <li>
              <strong>Esta guía</strong> (<code>/guide</code>) — contexto, flujos, ejemplos y referencia narrativa de{' '}
              <em>todos</em> los endpoints.
            </li>
            <li>
              <ExternalLink href="/docs">Scalar</ExternalLink> — OpenAPI interactivo (Try it out) generado de las rutas
              Fastify + Zod. JSON en <ExternalLink href="/docs/json">/docs/json</ExternalLink>.
            </li>
            <li>
              <strong>Código fuente</strong> —{' '}
              <a href="https://github.com/rafaelsantana6/zapo-rest" target="_blank" rel="noreferrer">
                github.com/rafaelsantana6/zapo-rest
              </a>{' '}
              (stars, issues, releases, Docker).
            </li>
          </ul>
        </Callout>

        <h2 id="capabilities">Qué cubre la API</h2>
        <ul>
          <li>
            <strong>Instancias</strong> — create/connect/QR/pairing-code/restart/logout, API keys admin vs instance;
            path dual (con nombre o forma corta con instance key)
          </li>
          <li>
            <strong>Mensajes</strong> — text, reply, image, video, audio/PTT, document, sticker, location, poll, react,
            edit, revoke, contact, forward, star
          </li>
          <li>
            <strong>Chats y store</strong> — listado Postgres, history-sync, read/archive/unread, reconcile LID→PN
          </li>
          <li>
            <strong>Contactos / JID / LID</strong> — resolve, check (batch), blocklist, foto de perfil, about
          </li>
          <li>
            <strong>Media</strong> — descarga por messageId, storage S3/local, endpoint getBase64
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
            <strong>VoIP</strong> — control plane <code>/v1/voip</code> + stream PCM + grabación WAV
          </li>
          <li>
            <strong>Grupos, labels, privacy, profile, status/stories, business profiles</strong>
          </li>
        </ul>

        <h2 id="stack">Stack</h2>
        <table>
          <thead>
            <tr>
              <th>Capa</th>
              <th>Tecnología</th>
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
              <td>Persistencia</td>
              <td>Postgres (proyecciones + mailbox_*) · Redis opcional</td>
            </tr>
            <tr>
              <td>Media</td>
              <td>
                Local o S3/MinIO/R2 con <strong>CAS</strong> (dedup SHA-256 por instancia)
              </td>
            </tr>
            <tr>
              <td>UI</td>
              <td>Dashboard React + esta guía Tailwind</td>
            </tr>
          </tbody>
        </table>

        <Callout title="Ventajas de diseño (resumen)">
          <p>No necesitas abrir otro archivo para ver qué hace diferente a este gateway:</p>
          <ul>
            <li>
              <strong>CAS de media</strong> — el mismo archivo (forward/sticker) se guarda una vez por instancia
            </li>
            <li>
              <strong>Rehydrate + 302</strong> — media recuperable de WA; descarga directa del storage
            </li>
            <li>
              <strong>Outbox + HMAC</strong> — webhooks at-least-once, sin double-fire
            </li>
            <li>
              <strong>SSE / WS solo VoIP</strong> · <strong>LID↔PN</strong> · boot amigable al healthcheck ·{' '}
              <strong>WAM</strong> paridad de wire (<code>WAM_ENABLED=false</code> para apagar)
            </li>
          </ul>
          <p>
            Tabla completa: <a href="/guide/why">Ventajas de diseño</a> · flujos en{' '}
            <a href="/guide/architecture">Arquitectura</a>.
          </p>
        </Callout>

        <h2 id="links">Enlaces rápidos</h2>
        <ul>
          <li>
            <a href="/guide/why">Ventajas de diseño (resumen)</a>
          </li>
          <li>
            <a href="/guide/quickstart">Quickstart en 4 pasos</a>
          </li>
          <li>
            <a href="/guide/architecture">Arquitectura y flujos internos</a>
          </li>
          <li>
            <a href="/guide/api">Catálogo completo de endpoints</a>
          </li>
          <li>
            <a href="https://github.com/rafaelsantana6/zapo-rest" target="_blank" rel="noreferrer">
              Repositorio en GitHub
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
    title: 'Ventajas de diseño',
    description: 'Resumen de decisiones que bajan costo y riesgo en producción — legible sin abrir el repositorio.',
    body: (
      <>
        <p>
          Estas elecciones son <strong>intencionales</strong>. El resumen de abajo basta para evaluar el proyecto; el
          archivo <code>docs/DESIGN-DECISIONS.md</code> en el repo es el detalle para contribuidores.
        </p>

        <h2 id="glance">De un vistazo</h2>
        <ul>
          <li>
            <strong>Media más barata</strong> — CAS (SHA-256 por instancia); forwards/stickers no multiplican objetos
          </li>
          <li>
            <strong>Media recuperable</strong> — si el objeto desaparece, redescarga de WhatsApp y vuelve a guardar
          </li>
          <li>
            <strong>Webhooks fiables</strong> — persiste el chat primero, outbox + retry, HMAC, sin double-fire
          </li>
          <li>
            <strong>Realtime correcto</strong> — SSE para eventos de la app; WebSocket solo para VoIP
          </li>
          <li>
            <strong>Identidad WA moderna</strong> — mapa LID ↔ PN + reconcile (sin historial partido)
          </li>
          <li>
            <strong>Boot ops-friendly</strong> — HTTP sube antes del reconnect/reconcile largo (healthcheck verde)
          </li>
          <li>
            <strong>Paridad de wire de WA Web</strong> — telemetría WAM activa por defecto; apaga con{' '}
            <code>WAM_ENABLED=false</code>
          </li>
          <li>
            <strong>Instancia desde la API key</strong> — con instance key el nombre puede omitirse en la URL; admin
            siempre indica <code>:name</code>
          </li>
        </ul>

        <h2 id="table">Decisión → beneficio</h2>
        <table>
          <thead>
            <tr>
              <th>Decisión</th>
              <th>Beneficio</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>
                <strong>CAS</strong> <code>…/cas/sha256/…</code> por instancia
              </td>
              <td>Menos costo de storage; identidad estable del objeto</td>
            </tr>
            <tr>
              <td>Rehydrate si el objeto desaparece</td>
              <td>Media recuperable sin re-parear; 404 solo si WA no entrega</td>
            </tr>
            <tr>
              <td>302 + presign</td>
              <td>La API no es middleman permanente de bandwidth</td>
            </tr>
            <tr>
              <td>
                Webhooks en 2 etapas (<code>meta</code> → <code>stored</code>)
              </td>
              <td>
                El bot reacciona pronto; archivo estable en <code>message.media.stored</code>
              </td>
            </tr>
            <tr>
              <td>
                Projection → <code>processed_events</code> → outbox
              </td>
              <td>Store consistente + side-effects sin doble entrega</td>
            </tr>
            <tr>
              <td>SSE app / WS solo VoIP</td>
              <td>Contrato simple; softphone sin poll REST</td>
            </tr>
            <tr>
              <td>Auth por header preferida</td>
              <td>Key fuera de access log / Referer</td>
            </tr>
            <tr>
              <td>Instancia inferida de la API key (rutas dual)</td>
              <td>
                Path con nombre siempre válido; forma corta <code>/v1/…</code> y <code>/v1/instance/…</code> con
                instance key. Admin debe pasar <code>:name</code>
              </td>
            </tr>
            <tr>
              <td>Cola serial por sesión</td>
              <td>Sin carreras en upsert/ack/presencia</td>
            </tr>
            <tr>
              <td>
                <code>lid_map</code> + reconcile
              </td>
              <td>Identidad moderna de WA sin hilos duplicados</td>
            </tr>
            <tr>
              <td>
                <code>listen</code> antes del boot WA largo
              </td>
              <td>Healthcheck Docker/Swarm verde durante reconnect/reconcile</td>
            </tr>
            <tr>
              <td>
                Telemetría <strong>WAM</strong> (<code>@zapo-js/wam</code>, default on)
              </td>
              <td>
                Emite batches <code>w:stats</code> de WA Web para paridad de wire. Apaga con{' '}
                <code>WAM_ENABLED=false</code>
              </td>
            </tr>
          </tbody>
        </table>

        <h2 id="next">Profundizar</h2>
        <ul>
          <li>
            <a href="/guide/architecture">Arquitectura</a> — colas, proyecciones, diagrama
          </li>
          <li>
            <a href="/guide/media">Media</a> — CAS, rehydrate, 302
          </li>
          <li>
            <a href="/guide/webhooks">Webhooks</a> — outbox, HMAC, eventos
          </li>
          <li>
            <a href="/guide/realtime">SSE</a> — por qué no un WebSocket general
          </li>
        </ul>
      </>
    ),
  },

  quickstart: {
    title: 'Quickstart',
    description: 'De cero al primer mensaje y al primer webhook.',
    body: (
      <>
        <h2 id="env">1. Entorno</h2>
        <p>
          Configura al menos <code>ADMIN_API_KEY</code>, <code>DATABASE_URL</code> y levanta la API (Docker Compose o{' '}
          <code>pnpm dev</code>).
        </p>
        <CodeBlock
          language="bash"
          code={`export BASE=http://localhost:3000
export ADMIN_API_KEY=your-admin-key
export KEY=$ADMIN_API_KEY # o la instance key después de crear`}
        />

        <h2 id="create">2. Crear y conectar instancia</h2>
        <CodeBlock
          language="bash"
          code={`# Crear (admin)
curl -s -X POST "$BASE/v1/instances" \\
 -H "X-Api-Key: $ADMIN_API_KEY" -H "content-type: application/json" \\
 -d '{"name":"sales-1","webhookUrl":"https://hooks.example.com/wa"}'

# Conectar socket
curl -s -X POST "$BASE/v1/instances/sales-1/connect" \\
 -H "X-Api-Key: $ADMIN_API_KEY"

# QR (renderiza la string como QR en el cliente / dashboard)
curl -s "$BASE/v1/instances/sales-1/qr" -H "X-Api-Key: $ADMIN_API_KEY"`}
        />
        <p>
          Escanea en WhatsApp → Dispositivos vinculados. Alternativa: pairing code con <code>POST.../pairing-code</code>{' '}
          y el número del chip.
        </p>

        <h2 id="send">3. Enviar texto</h2>
        <CodeBlock
          language="bash"
          code={`# Admin o multi-tenant: path con nombre
curl -s -X POST "$BASE/v1/instances/sales-1/messages/text" \\
 -H "X-Api-Key: $ADMIN_API_KEY" -H "content-type: application/json" \\
 -d '{"to":"5511999999999","text":"Hola vía zapo-rest 👋"}'

# Instance key: forma corta (nombre inferido de la key)
curl -s -X POST "$BASE/v1/messages/text" \\
 -H "X-Api-Key: $INSTANCE_API_KEY" -H "content-type: application/json" \\
 -d '{"to":"5511999999999","text":"Hola vía zapo-rest 👋"}'`}
        />
        <p>
          Con <strong>instance key</strong> puedes omitir el nombre en la URL. Con la <strong>admin key</strong> el
          nombre es obligatorio. Detalles en <a href="/guide/auth#scope">Autenticación → Alcance de instancia</a>.
        </p>

        <h2 id="listen">4. Escuchar eventos</h2>
        <ul>
          <li>
            <strong>Webhook HTTP</strong> — configura al crear o vía <code>POST.../webhooks</code> (multi-config).
          </li>
          <li>
            <strong>SSE</strong> — <code>GET /v1/events?instance=sales-1</code> con header <code>X-Api-Key</code> (evita{' '}
            <code>?apiKey=</code> en la URL)
          </li>
        </ul>
        <Callout tone="tip" title="Dashboard">
          Con el dashboard compilado, abre la raíz del host, inicia sesión con la misma API key y usa el softphone
          flotante + chat completo.
        </Callout>
      </>
    ),
  },

  architecture: {
    title: 'Arquitectura',
    description: 'Componentes, flujo de mensajes y garantías de consistencia.',
    body: (
      <>
        <h2 id="overview">Visión general</h2>
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

        <h2 id="session-queue">Cola por sesión</h2>
        <p>
          Cada instancia procesa eventos de WhatsApp en serie (<em>session queue</em>) para evitar carreras en upsert de
          mensaje, ack y presencia. Los side-effects (webhook, broadcast WS) ocurren <strong>después</strong> del upsert
          idempotente <code>(instance, message_id)</code>.
        </p>

        <h2 id="projections">Proyecciones Postgres</h2>
        <ul>
          <li>
            <code>messages</code> / mailbox — historial consultable vía chats API
          </li>
          <li>
            <code>chats</code> — hilos con unread, last message, merge LID/PN
          </li>
          <li>
            <code>contacts</code>, <code>lid_map</code>, <code>labels</code>, <code>calls</code>
          </li>
          <li>
            <code>processed_events</code> — dedupe de eventos de protocolo
          </li>
          <li>
            <code>webhook_outbox</code> — entrega at-least-once con retry policy
          </li>
        </ul>

        <h2 id="lid-pn">LID vs Phone Number (PN)</h2>
        <p>
          WhatsApp moderno usa identificadores <code>@lid</code> además de <code>@s.whatsapp.net</code>. La API prefiere
          almacenar PN cuando está mapeado, mantiene <code>lid_map</code>, expande alias en presence/subscribe y ofrece{' '}
          <code>POST.../chats/reconcile-lids</code> para fusionar duplicados.
        </p>

        <h2 id="media-flow">Flujo de media</h2>
        <ol>
          <li>
            Inbound con media → auto-download opcional (<code>MEDIA_AUTO_DOWNLOAD</code>)
          </li>
          <li>
            Escritura <strong>content-addressed</strong> (CAS) → si el objeto ya existe, <code>deduped</code> (sin
            reescribir)
          </li>
          <li>
            GET <code>.../messages/:id/media</code> prefiere <strong>302</strong> al storage; si falta, redescarga de
            WhatsApp y re-guarda
          </li>
        </ol>

        <h2 id="design-choices">Decisiones de diseño (beneficios)</h2>
        <p>
          Resumen completo en <a href="/guide/why">Ventajas de diseño</a> (no hace falta abrir el repo). Elecciones
          conscientes — no “framework por moda”. Canónico para contribuidores: <code>docs/DESIGN-DECISIONS.md</code>.
        </p>
        <table>
          <thead>
            <tr>
              <th>Decisión</th>
              <th>Beneficio</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>
                <strong>CAS</strong> <code>…/cas/sha256/…</code> por instancia
              </td>
              <td>Menos costo de storage; forwards/stickers no multiplican objetos</td>
            </tr>
            <tr>
              <td>Rehydrate si el objeto desaparece</td>
              <td>Media recuperable sin re-parear; 404 solo si WA no entrega</td>
            </tr>
            <tr>
              <td>302 + presign</td>
              <td>La API no es middleman permanente de bandwidth</td>
            </tr>
            <tr>
              <td>
                Webhooks en 2 etapas (<code>meta</code> → <code>stored</code>)
              </td>
              <td>
                El bot puede reaccionar pronto y bajar archivo estable en <code>message.media.stored</code>
              </td>
            </tr>
            <tr>
              <td>
                Persist projection → claim <code>processed_events</code> → outbox
              </td>
              <td>Store consistente + side-effects sin doble entrega</td>
            </tr>
            <tr>
              <td>SSE app / WS solo VoIP</td>
              <td>Contrato simple; softphone sin poll REST</td>
            </tr>
            <tr>
              <td>Auth por header preferida</td>
              <td>Key fuera de access log / Referer</td>
            </tr>
            <tr>
              <td>Instancia inferida de la API key (rutas dual)</td>
              <td>
                Path con nombre siempre válido; forma corta <code>/v1/…</code> y <code>/v1/instance/…</code> con
                instance key. Admin debe pasar <code>:name</code>
              </td>
            </tr>
            <tr>
              <td>Cola serial por sesión</td>
              <td>Sin carreras en upsert/ack/presencia</td>
            </tr>
            <tr>
              <td>
                <code>lid_map</code> + reconcile
              </td>
              <td>Identidad moderna de WA sin hilos duplicados</td>
            </tr>
            <tr>
              <td>
                <code>listen</code> antes del boot WA largo
              </td>
              <td>Healthcheck Docker/Swarm verde durante reconnect/reconcile</td>
            </tr>
            <tr>
              <td>
                <strong>WAM</strong> (<code>@zapo-js/wam</code>, default on)
              </td>
              <td>
                <code>w:stats</code> client-side como una pestaña real de WA Web. <code>WAM_ENABLED=false</code> lo
                apaga
              </td>
            </tr>
          </tbody>
        </table>

        <h2 id="wam">Telemetría WAM (paridad de wire de la sesión)</h2>
        <p>
          Las pestañas reales de WhatsApp Web envían batches de analytics en el canal <code>w:stats</code>. zapo-rest
          adjunta el plugin upstream <code>@zapo-js/wam</code> en cada sesión <strong>por defecto</strong> para que el
          footprint headless multi-session se acerque a un browser (eventos de protocolo + telemetría de UI sintética).
        </p>
        <ul>
          <li>
            <strong>No</strong> son métricas/logs de tu aplicación ni superficie OpenAPI
          </li>
          <li>
            <strong>No</strong> cambia REST, SSE, media ni VoIP
          </li>
          <li>
            <strong>Activo por defecto</strong> (<code>WAM_ENABLED=true</code> si se omite)
          </li>
          <li>
            Desactivar: <code>WAM_ENABLED=false</code> y reinicia el proceso de la API
          </li>
        </ul>
        <p>
          Guía upstream:{' '}
          <a href="https://zapo.to/guides/wam" rel="noreferrer" target="_blank">
            zapo.to/guides/wam
          </a>
          .
        </p>

        <h2 id="voip-arch">VoIP en dos canales</h2>
        <table>
          <thead>
            <tr>
              <th>Canal</th>
              <th>URL</th>
              <th>Contenido</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Señalización</td>
              <td>
                <code>/v1/voip</code>
              </td>
              <td>JSON: start/accept/end/mute + push call:offer/state/ended</td>
            </tr>
            <tr>
              <td>Media</td>
              <td>
                <code>.../calls/:id/stream</code>
              </td>
              <td>PCM Float32 LE mono @ 16 kHz (binary frames)</td>
            </tr>
          </tbody>
        </table>
        <p>
          Los endpoints REST de calls siguen existiendo (compat), pero el softphone no hace polling — solo WS de
          control.
        </p>
      </>
    ),
  },

  concepts: {
    title: 'Conceptos y entidades',
    description: 'Modelo mental de las entidades expuestas por la API.',
    body: (
      <>
        <h2 id="instance">Instance</h2>
        <p>
          Una sesión de WhatsApp con nombre. Campos principales: <code>name</code> (sessionId estable),{' '}
          <code>apiKey</code>, <code>status</code>, <code>meJid</code>, webhooks legados, <code>lastQr</code>.
        </p>
        <p>
          Status: <code>created</code> → <code>connecting</code> → <code>qr</code> / <code>pairing</code> →{' '}
          <code>open</code> · <code>close</code> · <code>logged_out</code>.
        </p>

        <h2 id="message">Message</h2>
        <p>
          Identificada por <code>messageId</code> (stanza id) en el alcance de la instancia. Tipos: text, image, video,
          audio, document, sticker, location, poll, reaction, contact, etc. Acks: 0 pending · 1 server · 2 delivered · 3
          read.
        </p>

        <h2 id="chat">Chat</h2>
        <p>
          Hilo con un peer (1:1) o grupo. <code>chatId</code> es el JID (URL-encode <code>@</code>). Puede existir
          proyección LID y PN — reconcile unifica.
        </p>

        <h2 id="call">Call</h2>
        <p>
          Snapshot en memoria (ringing/active) + historial en DB. Flags importantes: <code>canAccept</code> (solo
          inbound ringing), <code>isActive</code> (media conectada), <code>direction</code>, grabación opcional.
        </p>

        <h2 id="webhook-cfg">Webhook config</h2>
        <p>
          Multi-config por instancia: URL, allow-list de events, HMAC key, retries (linear/exponential/constant), custom
          headers, enabled.
        </p>

        <h2 id="actor">Actor (auth)</h2>
        <ul>
          <li>
            <code>{`{ role: 'admin' }`}</code> — <code>ADMIN_API_KEY</code>
          </li>
          <li>
            <code>{`{ role: 'instance', instanceName }`}</code> — key de la instancia
          </li>
        </ul>
      </>
    ),
  },

  auth: {
    title: 'Autenticación',
    description: 'Admin key vs instance key, paths dual, headers, SSE y WebSocket VoIP.',
    body: (
      <>
        <h2 id="keys">Dos tipos de clave</h2>
        <table>
          <thead>
            <tr>
              <th>Tipo</th>
              <th>Origen</th>
              <th>Alcance</th>
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
              <td>Todas las instancias + create/list/delete/rotate</td>
            </tr>
            <tr>
              <td>
                <strong>Instance</strong>
              </td>
              <td>
                campo <code>apiKey</code> de la instancia (siempre en GET)
              </td>
              <td>Solo la propia instancia</td>
            </tr>
          </tbody>
        </table>

        <h2 id="headers">Cómo enviar</h2>
        <CodeBlock language="http" code={`X-Api-Key: <tu-clave>\n\n# o\nAuthorization: Bearer <tu-clave>`} />
        <p>
          Las rutas <code>/v1/*</code> exigen clave. Públicos: <code>GET /health</code>, <code>GET /ready</code>, UI
          OpenAPI en <code>/docs</code>, esta guía en <code>/guide</code>.
        </p>

        <h2 id="scope">Alcance de la instancia (dual path)</h2>
        <p>
          Las rutas de una sesión WhatsApp aceptan <strong>dos formas</strong>. La resolución está en{' '}
          <code>resolveInstanceName</code>: si el nombre viene en el path, se valida el acceso; si se omite, la instance
          key amarra su propia instancia; admin sin nombre → <code>400</code>.
        </p>
        <table>
          <thead>
            <tr>
              <th>Quién</th>
              <th>Path</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>
                <strong>Admin</strong>
              </td>
              <td>
                <strong>Siempre</strong> con nombre: <code>/v1/instances/:name/...</code> (omitir el nombre → 400)
              </td>
            </tr>
            <tr>
              <td>
                <strong>Instance key</strong>
              </td>
              <td>
                Con nombre <strong>o</strong> forma corta — la instancia se infiere de la API key
              </td>
            </tr>
          </tbody>
        </table>
        <p>
          <strong>Forma corta</strong> (solo instance key):
        </p>
        <ul>
          <li>
            Recursos: <code>/v1/messages/text</code>, <code>/v1/chats</code>, <code>/v1/contacts</code>, … (equivalente
            a <code>/v1/instances/:name/...</code>)
          </li>
          <li>
            Ciclo de vida: <code>/v1/instance</code>, <code>/v1/instance/connect</code>, <code>/v1/instance/qr</code>, …
            — singular <code>instance</code> para no colisionar con la colección admin <code>/v1/instances</code>
          </li>
        </ul>
        <CodeBlock
          language="bash"
          code={`# Admin — nombre obligatorio
curl -s -X POST "$BASE/v1/instances/sales-1/messages/text" \\
  -H "X-Api-Key: $ADMIN_API_KEY" -H "content-type: application/json" \\
  -d '{"to":"5511999999999","text":"hola"}'

# Instance key — con nombre (sigue válido)
curl -s -X POST "$BASE/v1/instances/sales-1/messages/text" \\
  -H "X-Api-Key: $INSTANCE_API_KEY" -H "content-type: application/json" \\
  -d '{"to":"5511999999999","text":"hola"}'

# Instance key — forma corta
curl -s -X POST "$BASE/v1/messages/text" \\
  -H "X-Api-Key: $INSTANCE_API_KEY" -H "content-type: application/json" \\
  -d '{"to":"5511999999999","text":"hola"}'

# Lifecycle corto
curl -s "$BASE/v1/instance" -H "X-Api-Key: $INSTANCE_API_KEY"
curl -s -X POST "$BASE/v1/instance/connect" -H "X-Api-Key: $INSTANCE_API_KEY"`}
        />

        <h2 id="stream-auth">SSE y WebSocket</h2>
        <ul>
          <li>
            <strong>SSE</strong> — prefiere <code>fetch</code> con header <code>X-Api-Key</code> (el dashboard lo hace
            así). Evita <code>?apiKey=</code> en la URL.
          </li>
          <li>
            <strong>WebSocket</strong> (VoIP <code>/v1/voip</code>, stream PCM) — el navegador en general no manda
            headers; ahí query <code>?apiKey=</code> sigue siendo el fallback práctico.
          </li>
        </ul>

        <h2 id="me">Descubrir el actor</h2>
        <CodeBlock
          language="bash"
          code={`curl -s "$BASE/v1/me" -H "X-Api-Key: $KEY"
# admin → { "role": "admin" }
# instance → { "role": "instance", "instance": {... } }`}
        />

        <Callout tone="warn" title="Producción">
          Protege <code>/docs</code> y <code>/guide</code> con ACL de red si la API es pública. Las keys de instancia se
          devuelven en plaintext a propósito (operabilidad / dashboard) — trátalas como secretos.
        </Callout>
      </>
    ),
  },

  instances: {
    title: 'Instancias y pairing',
    description: 'Ciclo de vida completo de una sesión WhatsApp.',
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
            QR: <code>GET.../qr</code> o evento <code>instance.qr</code> · o pairing-code
          </li>
          <li>
            <code>open</code> → listo para enviar/recibir · <code>meJid</code> rellenado
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

        <h2 id="rotate">Rotación de key</h2>
        <p>
          <code>POST.../keys/rotate</code> invalida la key antigua. Clientes y webhooks que usan la instance key deben
          actualizarse.
        </p>

        <h2 id="short-path">Forma corta (instance key)</h2>
        <p>
          Con la API key de la propia instancia puedes usar singular <code>/v1/instance/...</code> en lugar de{' '}
          <code>/v1/instances/:name/...</code> — el nombre se infiere de la key. Admin sigue obligado a pasar el nombre.
          Ver <a href="/guide/auth#scope">Autenticación</a>.
        </p>
        <CodeBlock
          language="bash"
          code={`curl -s "$BASE/v1/instance" -H "X-Api-Key: $INSTANCE_API_KEY"
curl -s -X POST "$BASE/v1/instance/connect" -H "X-Api-Key: $INSTANCE_API_KEY"
curl -s "$BASE/v1/instance/qr" -H "X-Api-Key: $INSTANCE_API_KEY"`}
        />

        <h2 id="endpoints">Endpoints</h2>
        <p>
          Ver referencia: <a href="/guide/api/Instances">Instances</a>.
        </p>
      </>
    ),
  },

  messages: {
    title: 'Mensajes',
    description: 'Envío, tipos, acks y eventos inbound.',
    body: (
      <>
        <Callout title="Path dual">
          Los paths de abajo usan <code>.../messages/…</code> de forma relativa. Prefijo completo:{' '}
          <code>/v1/instances/:name/messages/…</code> (admin o instance) o, con instance key,{' '}
          <code>/v1/messages/…</code>. Detalles en <a href="/guide/auth#scope">Autenticación</a>.
        </Callout>
        <h2 id="own-profile">Nombre y avatar (perfil propio)</h2>
        <p>
          Para actualizar el <strong>push name</strong> y la <strong>foto de perfil</strong> de la sesión en WhatsApp:
        </p>
        <CodeBlock
          language="bash"
          code={`# Nombre visible (máx. 25 chars)
curl -s -X PUT "$BASE/v1/profile/name" \\
  -H "X-Api-Key: $INSTANCE_API_KEY" -H "content-type: application/json" \\
  -d '{"name":"Tienda Sales"}'

# Avatar JPEG (URL pública o base64)
curl -s -X PUT "$BASE/v1/profile/image" \\
  -H "X-Api-Key: $INSTANCE_API_KEY" -H "content-type: application/json" \\
  -d '{"mediaUrl":"https://cdn.example.com/avatar.jpg"}'

# Avatar — subida multipart (campo file)
curl -s -X PUT "$BASE/v1/profile/image" -H "X-Api-Key: $INSTANCE_API_KEY" \\
  -F file=@./avatar.jpg

# Alias: /profile/picture · quitar: DELETE /v1/profile/image`}
        />
        <Callout title="Medios: URL · base64 · multipart">
          Avatar, mensajes de media, status y blast aceptan <strong>una</strong> fuente: <code>mediaUrl</code>,{' '}
          <code>mediaBase64</code> (JSON) o subida <code>multipart/form-data</code> en el campo <code>file</code>{' '}
          (alias: <code>media</code>, <code>audio</code>, …). Límite de body/upload: env{' '}
          <code>MEDIA_UPLOAD_MAX_BYTES</code> (por defecto 100&nbsp;MiB; el <code>bodyLimit</code> de Fastify coincide).
          En Scalar (<code>/docs</code>), las rutas de media usan por defecto <code>multipart/form-data</code> con
          selector de <code>file</code> (JSON sigue disponible). Foto de perfil/grupo: el servidor re-codifica
          PNG/WebP/etc. a JPEG compacto (≤640px) antes de WhatsApp — evita 502 opacos por formato/tamaño.
        </Callout>
        <h2 id="send-types">Tipos de envío</h2>
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
              <td>Estructurados</td>
            </tr>
            <tr>
              <td>
                <code>.../messages/react|edit|revoke|forward|star</code>
              </td>
              <td>Acciones sobre mensajes existentes</td>
            </tr>
          </tbody>
        </table>

        <h2 id="to">
          Campo <code>to</code>
        </h2>
        <p>
          Acepta dígitos con DDI (<code>5511…</code>), JID PN, <code>@g.us</code>, <code>@lid</code>. La API normaliza
          vía helpers de resolve/JID.
        </p>

        <h2 id="inbound-events">Tres eventos de mensaje</h2>
        <table>
          <thead>
            <tr>
              <th>Evento</th>
              <th>Cuándo</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>
                <code>message</code>
              </td>
              <td>Mensaje “útil” procesado (filtro de tipos)</td>
            </tr>
            <tr>
              <td>
                <code>message.any</code>
              </td>
              <td>Cualquier upsert (incl. eco/fromMe según config)</td>
            </tr>
            <tr>
              <td>
                <code>message.inbound</code>
              </td>
              <td>Alias legado centrado en recibidos (!fromMe)</td>
            </tr>
            <tr>
              <td>
                <code>message.media.stored</code>
              </td>
              <td>
                Etapa 2 tras CAS; payload con <code>mediaStage: "stored"</code>, storage key + URL. Etapa 1 es el{' '}
                <code>message</code> inicial con <code>mediaStage: "meta"</code>.
              </td>
            </tr>
            <tr>
              <td>
                <code>message.media.failed</code>
              </td>
              <td>
                Fallo de download/store tras reintentos (<code>mediaStage: "failed"</code> + error)
              </td>
            </tr>
          </tbody>
        </table>
        <p>
          Un inbound puede disparar más de un evento si el allow-list del webhook incluye varios nombres — suscríbete
          solo a lo que necesitas. Bots que solo quieren el archivo permanente: suscríbete a{' '}
          <code>message.media.stored</code>.
        </p>

        <h2 id="acks">Acks (ticks)</h2>
        <p>
          Evento <code>message.ack</code> actualiza delivered/read. En el store: mapa por messageIds.
        </p>
      </>
    ),
  },

  media: {
    title: 'Media y storage',
    description: 'CAS con dedup, descarga S3/local y rehydrate de WhatsApp.',
    body: (
      <>
        <h2 id="config">Config</h2>
        <ul>
          <li>
            <code>MEDIA_STORAGE=local|s3</code> — grabación de calls y caché de media
          </li>
          <li>
            <code>MEDIA_AUTO_DOWNLOAD</code> — descargar media inbound automáticamente
          </li>
          <li>
            S3/MinIO/R2: bucket, endpoint, <code>S3_PUBLIC_URL</code> (URL browser-facing para presign)
          </li>
        </ul>

        <h2 id="cas">Content-addressed storage (CAS) — menos bytes</h2>
        <p>
          Los objetos usan clave por <strong>SHA-256 del contenido</strong> en el ámbito de la instancia:
        </p>
        <CodeBlock language="text" code={`{instanceName}/cas/sha256/{hash}{ext}`} />
        <ul>
          <li>
            <strong>Dedup</strong> — el mismo payload (forward, sticker, reenvío) se guarda <em>una vez</em>; put
            devuelve <code>deduped: true</code> sin reescribir
          </li>
          <li>
            <strong>Aislamiento</strong> — las instancias no comparten objetos; borrar la instancia solo elimina{' '}
            <code>{'{name}'}/…</code>
          </li>
          <li>
            <strong>Extensión de tipo</strong> en la key (mime/filename), no el nombre original — la URL directa abre
            con el tipo correcto; el nombre de visualización vive en la fila del mensaje
          </li>
          <li>
            Avatars usan <code>putAt</code> (clave fija), sin CAS
          </li>
        </ul>
        <Callout title="Por qué importa">
          En multi-session con alto volumen, la media repetida es una gran parte del bucket. CAS reduce costo sin
          cambiar el contrato de la API de mensajes.
        </Callout>

        <h2 id="download">Descarga</h2>
        <CodeBlock
          language="bash"
          code={`# Stream / redirect de la media de un mensaje
curl -sL "$BASE/v1/instances/sales-1/messages/3EB0ABC/media" \\
 -H "X-Api-Key: $KEY" -o file.bin

# API parity
curl -s -X POST "$BASE/v1/instances/sales-1/media/getBase64FromMediaMessage" \\
 -H "X-Api-Key: $KEY" -H "content-type: application/json" \\
 -d '{"messageId":"3EB0ABC"}'`}
        />
        <p>
          Preferencia: <strong>302</strong> al storage (presign S3 o base pública local). La API no necesita
          retransmitir cada byte.
        </p>

        <h2 id="fallback">Orden de resolución (rehydrate)</h2>
        <ol>
          <li>Objeto ya en storage (CAS)</li>
          <li>Si falta → redescarga de WhatsApp y vuelve a guardar</li>
          <li>404 solo si WhatsApp ya no puede entregar la media</li>
        </ol>

        <h2 id="two-stage">Webhooks en dos etapas</h2>
        <ol>
          <li>
            <code>message</code> con <code>mediaStage: "meta"</code> — llegada temprana (URL WA o placeholder)
          </li>
          <li>
            <code>message.media.stored</code> — tras CAS; URL/storage estables · o <code>message.media.failed</code>
          </li>
        </ol>
        <p>
          Bots que solo quieren archivo permanente: suscríbete a <code>message.media.stored</code> (o{' '}
          <code>message</code>, que también coincide con stage-2).
        </p>
      </>
    ),
  },

  chats: {
    title: 'Chats e historial',
    description: 'Proyecciones, sync y acciones de hilo.',
    body: (
      <>
        <p>
          Chats y mensajes vienen del store Postgres (historial + live). Endpoints bajo{' '}
          <code>/v1/instances/:name/chats</code>.
        </p>
        <ul>
          <li>List / get chat · mensajes paginados · get message</li>
          <li>read · archive · unarchive · unread · delete local · history-sync</li>
          <li>
            <code>reconcile-lids</code> — merge PN/LID
          </li>
        </ul>
        <Callout title="history-sync">
          <code>POST.../history-sync</code> pide backfill a WhatsApp; los chunks llegan como evento{' '}
          <code>history.sync</code>, no en la respuesta HTTP síncrona.
        </Callout>
      </>
    ),
  },

  contacts: {
    title: 'Contactos y JID/LID',
    description: 'Resolver números, check de existencia y blocklist.',
    body: (
      <>
        <h2 id="resolve">Resolve vs check</h2>
        <ul>
          <li>
            <code>POST.../contacts/jid</code> — arma JID local (sin red)
          </li>
          <li>
            <code>POST.../contacts/resolve</code> — JID canónico en WhatsApp (LID-aware)
          </li>
          <li>
            <code>POST.../contacts/check</code> — batch exists (max 50), prueba variantes BR 9º dígito
          </li>
          <li>
            <code>POST.../contacts/whatsapp-numbers</code> — alias legado
          </li>
        </ul>
        <CodeBlock
          language="bash"
          code={`curl -s -X POST "$BASE/v1/instances/sales-1/contacts/check" \\
 -H "X-Api-Key: $KEY" -H "content-type: application/json" \\
 -d '{"phones":["5511999999999"]}'`}
        />
        <p>
          Mapa LID↔PN también en <a href="/guide/api/Lids">/lids</a>.
        </p>
      </>
    ),
  },

  presence: {
    title: 'Presence y typing',
    description: 'Online, composing/recording y subscribe.',
    body: (
      <>
        <h2 id="set">Presence de la cuenta</h2>
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
# states: composing | recording | paused`}
        />

        <h2 id="subscribe">Subscribe (obligatorio para recibir)</h2>
        <p>
          Sin <code>POST.../presence/subscribe</code>, la sesión puede no emitir <code>presence.update</code> /{' '}
          <code>chatstate</code> del peer. El manager expande alias LID+PN.
        </p>
        <CodeBlock
          language="json"
          code={`// evento chatstate en SSE /v1/events o webhook
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
    description: 'Multi-config, outbox durable, HMAC y retries.',
    body: (
      <>
        <h2 id="multi">Multi-config</h2>
        <p>
          CRUD en <code>/v1/instances/:name/webhooks</code>. Cada config: URL, events[], hmac, retries, customHeaders,
          enabled. También hay webhook legado en campos de la instance (<code>webhookUrl</code> /{' '}
          <code>webhookEvents</code>).
        </p>
        <Callout title="Garantías (por diseño)">
          <ul>
            <li>
              <strong>Proyección primero</strong> — mensaje/chat upsertados antes de encolar el webhook
            </li>
            <li>
              <strong>Outbox Postgres</strong> — claim atómico, retry/backoff; receptor offline no pierde el evento
            </li>
            <li>
              <strong>
                <code>processed_events</code>
              </strong>{' '}
              — el side-effect no dispara dos veces si el protocolo reentrega
            </li>
            <li>
              <strong>HMAC-SHA512</strong> — verifica autenticidad en tu endpoint
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
 "payload": { /* datos del evento */ }
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

        <h2 id="hmac">HMAC y retries</h2>
        <p>
          Cuando está configurado, el worker firma el POST (<code>X-Webhook-Hmac</code> /{' '}
          <code>X-Webhook-Hmac-Sha512</code>). Retries: policy linear/exponential/constant + attempts + delaySeconds. El
          secret es write-only en la API (nunca se re-eco en GET).
        </p>
      </>
    ),
  },

  realtime: {
    title: 'SSE /v1/events',
    description: 'Stream unidireccional (server → client) vía Server-Sent Events.',
    body: (
      <>
        <p>
          El canal de eventos es <strong>SSE</strong>, no WebSocket: el cliente solo escucha. VoIP bidireccional sigue
          en <code>/v1/voip</code> + stream PCM.
        </p>
        <Callout tone="warn" title="Auth: header, no query">
          Prefiere <code>X-Api-Key</code> o <code>Authorization: Bearer</code>. Poner la key en la URL (
          <code>?apiKey=</code>) filtra en logs de access/proxy, historial y Referer. El dashboard usa{' '}
          <code>fetch</code> + stream con header. Query solo como fallback de <code>EventSource</code> nativo (que no
          acepta headers).
        </Callout>
        <CodeBlock
          language="bash"
          code={`# curl (recomendado) — key en el header
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

// Evita: new EventSource(\`/v1/events?apiKey=\${key}\`) // key en la URL`}
        />
        <p>
          Primer frame <code>connected</code>, después la misma forma del bus de webhooks. Admin sin{' '}
          <code>instance</code> recibe de todas las instancias. Keepalive cada 15s (comentario SSE <code>: ping</code>
          ).
        </p>
      </>
    ),
  },

  voip: {
    title: 'VoIP y softphone',
    description: 'Señalización JSON, PCM 16 kHz, grabación, audio blast y STT.',
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

        <h2 id="server-push">Push del servidor</h2>
        <ul>
          <li>
            <code>call:offer</code> / <code>call:ringing</code> — entrada
          </li>
          <li>
            <code>call:state</code> — transición (connecting, active, …)
          </li>
          <li>
            <code>call:ended</code> — terminal
          </li>
          <li>
            <code>calls:snapshot</code> — lista al attach
          </li>
          <li>
            <code>device:status</code> — status de la sesión WA
          </li>
        </ul>

        <h2 id="pcm">Media PCM</h2>
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
            <strong>Accept</strong> solo con <code>canAccept</code> (incoming_ringing)
          </li>
          <li>
            Media “activa” tras <code>media_connected</code> / state active — la UI no debe forzar active en outbound
            solo por ringing
          </li>
          <li>
            Grabación: <code>PUT.../settings/call-recording</code> + storage ready → WAV en{' '}
            <code>GET.../recording</code>
          </li>
        </ul>

        <h2 id="blast">Audio blast + STT</h2>
        <p>Para prompts outbound automáticos (estilo IVR), usa REST en lugar del WS del softphone:</p>
        <table>
          <thead>
            <tr>
              <th>Endpoint</th>
              <th>Qué hace</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>
                <code>POST /v1/instances/:name/calls/blast</code>
              </td>
              <td>
                Marca → reproduce WAV de <code>audioUrl</code> al contestar → graba la pierna remota (opcional) +
                transcripción Whisper
              </td>
            </tr>
            <tr>
              <td>
                <code>POST /v1/instances/:name/calls/:callId/transcribe</code>
              </td>
              <td>STT sobre grabación ya almacenada (blast o call-recording)</td>
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
    "sttLanguage": "es"
  }'`}
        />
        <ul>
          <li>
            <strong>Solo WAV</strong> (PCM/float); resample a 16 kHz mono. <code>audioUrl</code> con protección SSRF
            (HTTPS público, sin redirects, caps de tamaño/tiempo).
          </li>
          <li>
            La grabación queda ligada a la row de la call — <code>GET .../recording</code> y <code>.../transcribe</code>{' '}
            funcionan tras el blast.
          </li>
          <li>
            STT requiere <code>STT_ENABLED=true</code>, <code>STT_API_URL</code> (ej.{' '}
            <code>https://api.groq.com/openai</code>), <code>STT_API_KEY</code>. Opcional <code>STT_MODEL</code> /{' '}
            <code>STT_LANGUAGE</code>.
          </li>
          <li>
            El HTTP permanece abierto hasta que termine el blast — sube el timeout del client en WAVs largos. Ver Scalar{' '}
            <ExternalLink href="/docs">/docs</ExternalLink> (tag Calls).
          </li>
        </ul>
      </>
    ),
  },

  groups: {
    title: 'Grupos',
    description: 'Crear, participantes, invitaciones y settings.',
    body: (
      <>
        <p>
          CRUD completo bajo <code>/v1/instances/:name/groups</code>: create, metadata, leave, subject/description,
          invite-code, participants add/remove, promote/demote, picture, settings (announcement, restrict, ephemeral…).
        </p>
        <p>
          Referencia detallada: <a href="/guide/api/Groups">Groups API</a>.
        </p>
      </>
    ),
  },

  errors: {
    title: 'Errores y códigos',
    description: 'Envelope estándar y códigos HTTP.',
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
              <td>Sin acceso a la instancia / no admin</td>
            </tr>
            <tr>
              <td>NOT_FOUND</td>
              <td>404</td>
              <td>Recurso inexistente</td>
            </tr>
            <tr>
              <td>CONFLICT</td>
              <td>409</td>
              <td>p. ej. nombre de instancia duplicado</td>
            </tr>
            <tr>
              <td>VALIDATION_ERROR</td>
              <td>400</td>
              <td>Body/query Zod inválido</td>
            </tr>
            <tr>
              <td>BAD_REQUEST</td>
              <td>400</td>
              <td>Regla de negocio</td>
            </tr>
            <tr>
              <td>SERVICE_UNAVAILABLE</td>
              <td>503</td>
              <td>Sesión no open / dependencia</td>
            </tr>
          </tbody>
        </table>
      </>
    ),
  },

  faq: {
    title: 'FAQ',
    description: 'Preguntas frecuentes de integración.',
    body: (
      <>
        <h3 id="q-polling">¿Necesito hacer poll de calls?</h3>
        <p>
          No. Usa <code>/v1/voip</code> para señalización. REST de list/get call es fallback/debug.
        </p>

        <h3 id="q-typing">¿Por qué no veo typing en SSE /events?</h3>
        <p>
          Llama a <code>presence/subscribe</code> para el JID (y mantén la sesión available). LID vs PN se expande en el
          server.
        </p>

        <h3 id="q-three-events">¿Por qué 3 eventos de mensaje?</h3>
        <p>
          Compatibilidad: <code>message</code>, <code>message.any</code> y alias <code>message.inbound</code>. Filtra en
          el webhook allow-list.
        </p>

        <h3 id="q-swagger">¿Dónde está el OpenAPI interactivo?</h3>
        <p>
          <ExternalLink href="/docs">/docs</ExternalLink> (Scalar). Esta guía es la capa narrativa rica.
        </p>

        <h3 id="q-storage">¿Grabación de call 404?</h3>
        <p>
          El storage debe estar configurado y <code>storageReady: true</code>. Activa <code>call-recording</code> en la
          instancia (softphone) o usa <code>POST .../calls/blast</code> con <code>recordResponse: true</code>.
        </p>

        <h3 id="q-blast">¿Cómo reproduzco un WAV y transcribo la respuesta?</h3>
        <p>
          <code>POST /v1/instances/:name/calls/blast</code> con <code>audioUrl</code> (WAV HTTPS público). Configura{' '}
          <code>STT_*</code> para Whisper inline, o llama <code>POST .../calls/:callId/transcribe</code> después.
          Detalles en <a href="/guide/voip#blast">VoIP</a>.
        </p>

        <h3 id="q-wam">¿Qué es WAM / cómo lo apago?</h3>
        <p>
          WAM es la analytics client-side de WhatsApp Web (<code>w:stats</code>) para paridad de wire con una pestaña
          real — no son métricas de zapo-rest. Está <strong>activo por defecto</strong> vía <code>@zapo-js/wam</code>.
          Para desactivar: <code>WAM_ENABLED=false</code> y reinicia el proceso. Ver{' '}
          <a href="/guide/architecture#wam">Arquitectura</a>.
        </p>

        <h3 id="q-instance-path">¿Necesito el nombre de la instancia en cada URL?</h3>
        <p>
          Con la <strong>admin key</strong>, sí — usa <code>/v1/instances/:name/...</code>. Con la{' '}
          <strong>instance key</strong>, el nombre puede omitirse: recursos en <code>/v1/messages/...</code>,{' '}
          <code>/v1/chats</code>, etc., y ciclo de vida en <code>/v1/instance/...</code> (singular). El path con nombre
          sigue válido. Ver <a href="/guide/auth#scope">Autenticación</a>.
        </p>
      </>
    ),
  },
}
