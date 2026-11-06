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
            <strong>Media recuperable</strong> — si el objeto desaparece, redescarga de WhatsApp; un blob expirado en el
            CDN (404/410) pide un reupload al remitente
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
          <li>
            <strong>@handle e historial tardío de grupo</strong> — envía a <code>@handle</code>; el historial compartido
            después de entrar al grupo se importa (<code>HISTORY_GROUP_BUNDLES</code>, activo por defecto)
          </li>
          <li>
            <strong>Video en su propio canal binario</strong> — los frames H.264 nunca comparten el socket con el PCM;
            un visualizador lento cae al próximo key frame en vez de crecer la memoria del servidor o bloquear el audio
          </li>
          <li>
            Configuración de chats sincronizada — las acciones exitosas y el app-state del teléfono actualizan Postgres;
            las consultas reflejan el vencimiento del silencio.
          </li>
          <li>
            Los metadatos duraderos conservan eliminaciones y ajustes recientes durante importaciones de mailbox y
            replays.
          </li>
          <li>
            {
              'Área propia para canales: los nuevos mensajes y threads de canales del mailbox quedan fuera de app_messages/chats y de las descargas de media de chats. Se conservan las filas existentes. No hay historial/búsqueda local de canales: consulta las rutas dedicadas de WhatsApp y renueva las suscripciones temporales en vivo.'
            }
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
              <td>Blob expirado en el CDN (404/410) → un reupload del remitente</td>
              <td>La media de historial que WhatsApp ya borró todavía se puede pedir al teléfono del remitente</td>
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
              <td>
                Bundles de historial de grupo (<code>HISTORY_GROUP_BUNDLES</code>, activo por defecto)
              </td>
              <td>
                El historial compartido después de entrar queda en la proyección. Un tercero dispara la descarga —{' '}
                <code>false</code> lo ignora
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
            <tr>
              <td>
                Video en WS dedicado (<code>.../calls/:id/video</code>) + drop-until-keyframe
              </td>
              <td>Nunca bloquea ni atrasa el PCM; un visualizador lento descarta frames hasta el próximo key frame</td>
            </tr>
            <tr>
              <td>Configuración de chats proyectada desde app-state</td>
              <td>
                Pin/mute/lock siguen los cambios del teléfono; el silencio vence en las consultas. La eliminación solo
                local queda explícita.
              </td>
            </tr>
            <tr>
              <td>Metadatos de acciones de conversación</td>
              <td>
                Los metadatos duraderos conservan eliminaciones y ajustes recientes durante importaciones de mailbox y
                replays.
              </td>
            </tr>
            <tr>
              <td>Canales — /v1/newsletters</td>
              <td>
                El tráfico de canales evita proyecciones ocultas y almacenamiento de media de chats; el historial se lee
                directamente de WhatsApp.
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
          flotante + chat completo. En la pestaña <strong>Áudio/vídeo</strong> del softphone se elige y prueba la cámara
          (vista previa + el mismo encoder H.264 de la call, con el motivo cuando no abre); en la call hay{' '}
          <strong>Trocar câmera</strong> (cambiar cámara), <strong>Tela</strong> (compartir pantalla) y una línea con lo
          que se está enviando. Cámara y pantalla exigen HTTPS o <code>localhost</code>.
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

        <h2 id="l1-cache">Cache L1 del store (opcional)</h2>
        <p>
          <code>STORE_L1_CACHE=true</code> (por defecto <code>false</code>) pone un cache de lectura en proceso delante
          de las rows de sesión Signal, identidad, sender-key y privacy-token en Postgres, reduciendo lecturas en el
          camino crítico de decrypt/encrypt. <code>STORE_L1_IDLE_TTL_SECONDS</code> (por defecto <code>1800</code>,{' '}
          <code>0</code> = solo el límite de tamaño evicta) evita que un proceso de larga duración retenga cada peer
          visto desde el boot. Seguro solo con un único proceso o sticky sessions por instancia — la misma restricción
          que ya tienen las sesiones WA en vivo.
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
            WhatsApp y re-guarda. Un CDN 404/410 pide un reupload al remitente antes de rendirse
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
              <td>Blob expirado en el CDN (404/410) → un reupload del remitente</td>
              <td>La media de historial que WhatsApp ya borró todavía se puede pedir al teléfono del remitente</td>
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
              <td>
                Bundles de historial de grupo (<code>HISTORY_GROUP_BUNDLES</code>, activo por defecto)
              </td>
              <td>
                El historial compartido después de entrar queda en la proyección. Un tercero dispara la descarga —{' '}
                <code>false</code> lo ignora
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

        <h2 id="voip-arch">VoIP en tres canales</h2>
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
              <td>Media (audio)</td>
              <td>
                <code>.../calls/:id/stream</code>
              </td>
              <td>PCM Float32 LE mono @ 16 kHz (binary frames)</td>
            </tr>
            <tr>
              <td>Media (video)</td>
              <td>
                <code>.../calls/:id/video</code>
              </td>
              <td>
                H.264 Annex-B, header binario de 12 bytes, un <code>streamId</code> por emisor
              </td>
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

# Alias: /profile/picture · quitar: DELETE /v1/profile/image

# Username (@handle). El PIN de recuperación no vuelve en la respuesta.
curl -s "$BASE/v1/profile/username" -H "X-Api-Key: $INSTANCE_API_KEY"
curl -s -X PUT "$BASE/v1/profile/username" -H "X-Api-Key: $INSTANCE_API_KEY" \\
  -H "content-type: application/json" -d '{"username":"loja"}'
curl -s "$BASE/v1/profile/username/check?username=loja" -H "X-Api-Key: $INSTANCE_API_KEY"
curl -s -X POST "$BASE/v1/profile/username/resolve" -H "X-Api-Key: $INSTANCE_API_KEY" \\
  -H "content-type: application/json" -d '{"username":"@loja"}'`}
        />
        <p>
          Un cambio de handle en otro aparato emite <code>profile.username</code>. El campo <code>to</code> acepta{' '}
          <code>@handle</code>; <code>key-required</code> pide reintentar como <code>@handle:1234</code>.
        </p>
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

        <h2 id="extended-message-types">Eventos, acciones y nuevos tipos de media</h2>
        <p>
          Todas las rutas siguientes usan POST con clave de instancia y devuelven <code>{`{ id, result }`}</code>.
        </p>
        <h3 id="send-event">Crear un evento</h3>
        <p>
          <code>POST /v1/messages/event</code>
        </p>
        <p>
          Las fechas ISO 8601 con zona horaria se convierten a segundos Unix. <code>endTime</code> debe ser igual o
          posterior a <code>startTime</code>; las fechas inválidas devuelven 400. También acepta <code>isCanceled</code>
          .
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
        <h3 id="send-event-respond">Responder a un evento</h3>
        <p>
          <code>POST /v1/messages/event/respond</code>
        </p>
        <p>
          Respuestas: <code>going</code>, <code>not_going</code> o <code>maybe</code>. El original debe estar almacenado
          en esta instancia y conversación; la API recupera autor, <code>fromMe</code>, participante y secreto de 32
          bytes. Original ausente: 404; secreto/autor no disponible: 409. Reciba/sincronice primero el original.
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
        <h3 id="send-pin">Fijar o desfijar</h3>
        <p>
          <code>POST /v1/messages/pin</code>
        </p>
        <p>
          Use <code>pinned: false</code> para desfijar. Duración: <code>24h</code> (predeterminado), <code>7d</code> o{' '}
          <code>30d</code>, convertidas a 86400, 604800 y 2592000 segundos. La API siempre incluye la duración al fijar:
          los clientes descartan silenciosamente los pins sin duración. Requiere un mensaje almacenado en esta instancia
          y conversación.
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
        <h3 id="send-keep">Conservar o dejar de conservar</h3>
        <p>
          <code>POST /v1/messages/keep</code>
        </p>
        <p>
          Use <code>kept: false</code> para deshacer. Para mensajes temporales; requiere un mensaje almacenado en esta
          instancia y conversación.
        </p>
        <CodeBlock
          language="json"
          code={`{
  "to": "120363000000000@g.us",
  "messageId": "MESSAGE_ID",
  "kept": true
}`}
        />
        <h3 id="send-poll-vote">Votar en una encuesta</h3>
        <p>
          <code>POST /v1/messages/poll/vote</code>
        </p>
        <p>
          Use los nombres exactos de las opciones; una lista vacía devuelve 400. Requiere la encuesta original
          almacenada, con autor, <code>fromMe</code>, participante y secreto recuperados por la API, tanto para
          encuestas enviadas como recibidas. Original ausente: 404; secreto/autor no disponible: 409.
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
        <h3 id="send-ptv">Nota de vídeo circular (PTV)</h3>
        <p>
          <code>POST /v1/messages/ptv</code>
        </p>
        <p>
          Mismo contrato de media de vídeo: <code>mediaUrl</code>, <code>mediaBase64</code> o multipart con archivo{' '}
          <code>file</code> y campo <code>to</code>. No acepta leyenda; los archivos temporales se eliminan tras el
          envío o fallo.
        </p>
        <CodeBlock
          language="json"
          code={`{
  "to": "5511999999999",
  "mediaUrl": "https://cdn.example.com/note.mp4",
  "mimetype": "video/mp4"
}`}
        />
        <h3 id="send-sticker-pack">Paquete de stickers</h3>
        <p>
          <code>POST /v1/messages/sticker-pack</code>
        </p>
        <p>
          JSON con 1–30 stickers (límite del gateway; upstream no declara máximo). Cada <code>media</code>, icono y
          portada opcional usa exactamente uno de <code>url</code> o <code>base64</code>. Las URL usan la protección
          SSRF existente. Los nombres de archivo deben ser únicos, incluido el icono. <code>emojis</code> es opcional.{' '}
          <code>accessibilityLabel</code> no existe en upstream 1.11 y devuelve 400.
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
        <h3 id="safe-message-context">Contexto seguro y mensajes recibidos</h3>
        <p>
          Los envíos tipados aceptan <code>contextInfo</code> opcional con solo <code>expirationSeconds</code> y{' '}
          <code>ephemeralSettingTimestamp</code> (segundos Unix). Las rutas existentes de texto, respuesta, media,
          encuesta, reacción, edición y revocación también aceptan estos campos. <code>messageContextInfo</code>{' '}
          contiene metadatos de protocolo y no se expone.
        </p>
        <CodeBlock
          language="json"
          code={`{ "to": "5511999999999", "text": "Hello", "contextInfo": { "expirationSeconds": 86400 } }`}
        />
        <p>
          Los eventos de mensaje existentes identifican <code>event</code>, <code>event-response</code>,{' '}
          <code>pin</code>/<code>unpin</code>, <code>keep</code>/<code>unkeep</code>, <code>poll-vote</code>,{' '}
          <code>ptv</code> y <code>sticker-pack</code> con resúmenes legibles. Las respuestas/votos cifrados muestran el
          ID original; no se añadieron nuevos nombres de evento SSE/webhook.
        </p>

        <h2 id="to">
          Campo <code>to</code>
        </h2>
        <p>
          Acepta dígitos con DDI (<code>5511…</code>), JID PN, <code>@g.us</code>, <code>@lid</code> y username (
          <code>@handle</code> o <code>@handle:key</code>). La API normaliza vía helpers de resolve/JID. El inbound trae{' '}
          <code>senderUsername</code> y <code>recipientUsername</code> cuando WhatsApp los envía.
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
          Las respuestas ricas de Meta AI se guardan como <code>type: text</code> (texto de los submessages, pie de
          imagen y bloques de código). Una imagen o documento reenviado por un bot conserva el tipo interno. Cuando el
          CDN devuelve 404 o 410, la descarga pide al teléfono del remitente un reupload antes de{' '}
          <code>message.media.failed</code>.
        </p>
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
          <li>Si el CDN responde 404/410 → pide un reupload al remitente y descarga el path nuevo</li>
          <li>404 solo si WhatsApp y el remitente ya no pueden entregar la media</li>
          <li>
            Un primario que re-encripta en el reupload en vez de mantener la clave falla rápido como{' '}
            <code>message.media.failed</code>, sin loop de retry
          </li>
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
          <code>history.sync</code>, no en la respuesta HTTP síncrona. Un bundle compartido después de que esta cuenta
          entra a un grupo se importa con <code>HISTORY_GROUP_BUNDLES</code> activo (por defecto) y se anuncia como{' '}
          <code>history.group</code>.
        </Callout>
        <h2 id="chat-actions">Acciones de conversación</h2>
        <p>
          Las rutas siguientes usan la clave de instancia y aceptan teléfonos, JIDs de usuario/grupo y LIDs. Los cambios
          afectan a tu cuenta y dispositivos vinculados; los demás participantes conservan sus copias. Ninguna acción
          abandona un grupo.
        </p>
        <p>
          GET /v1/chats y GET /v1/chats/:chatId devuelven pinned numérico (0 sin fijar, positivo fijado), muted,
          muteUntil (ISO o null), locked y el muteEndMs existente. El silencio vencido aparece como muted=false sin otro
          evento del teléfono. Para siempre usa 9999-12-31T23:59:59Z.
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
          Fijar también desarchiva. Bloquear elimina archivo y fijación. Usa false para desfijar, reactivar
          notificaciones o desbloquear.
        </p>
        <p>
          Mute acepta until (fecha ISO futura con zona horaria) o durationSeconds (entero positivo), nunca ambos. Omite
          ambos para silenciar para siempre. Para reactivar notificaciones, envía solo muted=false.
        </p>
        <p>
          Clear usa deleteStarred=false y deleteMedia=false por defecto. Los destacados permanecen en la proyección y se
          recalcula la vista previa. Envía deleteStarred=true para borrar todos los mensajes. deleteMedia se reenvía a
          zapo; los objetos multimedia/CAS de REST siguen su propia retención y no se purgan con estas rutas.
        </p>
        <p>
          POST /v1/chats/:chatId/delete llama a deleteChat de zapo y elimina conversación/mensajes locales, incluidos
          los alias LID. El DELETE /v1/chats/:chatId anterior elimina solo la fila local de la conversación y conserva
          los mensajes. zapo construye automáticamente el rango del último mensaje desde su mailbox; sus opciones de
          deleteChat solo aceptan deleteMedia.
        </p>
        <p>
          Eliminar para mí usa fromMe, participante y timestamp del mensaje almacenado y valida que pertenezca a esta
          conversación (404 en caso contrario). Usa ?deleteMedia=true para reenviar la opción multimedia. No revoca la
          copia de los destinatarios.
        </p>
        <p>
          Las nuevas acciones devuelven 409 para conflictos de app-state y 503 para fallos de conexión, con el mensaje
          del upstream. La proyección local cambia tras el éxito del upstream. Los cambios del teléfono llegan mediante
          el evento webhook/SSE chat.update existente tras persistir.
        </p>
        <p>
          Los metadatos duraderos conservan eliminaciones y ajustes recientes durante importaciones de mailbox y
          replays. Clear/delete capturan un límite antes de la llamada de red y preservan mensajes posteriores; las
          conversaciones vacías conservadas siguen en la lista tras reconcile. Los destacados recibidos antes del
          mensaje se aplican cuando llega. El cuerpo de clear/delete puede omitirse.
        </p>
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
            <code>status</code> en cada resultado: <code>in</code>, <code>out</code> (sin WhatsApp),{' '}
            <code>invalid</code>, <code>error</code> / <code>unanswered</code> (el servidor no respondió —{' '}
            <code>exists: false</code> aquí no significa "sin WhatsApp" y no se cachea) o <code>local</code>
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
          Solicitudes de ingreso a grupos: consulta <a href="/guide/groups#join-requests">Solicitudes de ingreso</a> —{' '}
          <code>group.update</code>, <code>payload.type</code>, <code>payload.requesterJid</code> /{' '}
          <code>payload.requests[].jid</code>. SSE usa <code>data.type</code>, <code>data.requesterJid</code> y{' '}
          <code>data.requests[].jid</code>.
        </p>

        <h2 id="hmac">HMAC y retries</h2>
        <p>
          Cuando está configurado, el worker firma el POST (<code>X-Webhook-Hmac</code> /{' '}
          <code>X-Webhook-Hmac-Sha512</code>). Retries: policy linear/exponential/constant + attempts + delaySeconds. El
          secret es write-only en la API (nunca se re-eco en GET).
          <code>newsletter.update</code>, <code>newsletter.message_update</code>.
        </p>
        <p>
          Los cambios de app-state del teléfono ahora emiten chat.update tras la proyección: chatId y los campos
          públicos (pinned numérico, muted, muteUntil ISO, locked, archived). ClearChat/DeleteChat/DeleteMessageForMe
          incluyen action y deleted; deleted=true indica que se eliminó la fila de la conversación. No se añade otro
          nombre de evento ni transporte.
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

// outbound con video (también abre .../calls/{callId}/video)
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

        <h2 id="server-push">Push del servidor</h2>
        <ul>
          <li>
            <code>call:offer</code> / <code>call:ringing</code> — entrada
          </li>
          <li>
            <code>call:state</code> — transición (connecting, active, …)
          </li>
          <li>
            <code>call:ended</code> — terminal (<code>endReason</code> ahora también cubre{' '}
            <code>accepted_elsewhere</code>, <code>rejected_elsewhere</code>, <code>relay_lost</code>)
          </li>
          <li>
            <code>calls:snapshot</code> — lista al attach
          </li>
          <li>
            <code>call:peer_mute</code> — el peer anunció su propio estado de micrófono
          </li>
          <li>
            <code>call:hand_raise</code> — un participante remoto levantó/bajó la mano
          </li>
          <li>
            <code>call:reaction</code> — un peer envió una reacción emoji
          </li>
          <li>
            <code>call:participants_changed</code> / <code>call:mute_requested</code> /{' '}
            <code>call:participant_media</code> — llamadas en grupo
          </li>
          <li>
            <code>call:video_state</code> / <code>call:video_upgraded</code> / <code>call:screen_share_changed</code> —
            video (estado de la cámara, pedido de upgrade, compartir pantalla)
          </li>
          <li>
            <code>device:status</code> — status de la sesión WA
          </li>
        </ul>

        <h2 id="group-calls">Llamadas en grupo</h2>
        <p>
          Para llamar a un grupo, cambia <code>to</code> por <code>groupId</code> + <code>participants</code> en{' '}
          <code>POST .../calls</code>. Los participantes (teléfono, JID o LID, hasta 31, sin ti) se resuelven a LID;
          quien no tenga LID vuelve en <code>400</code> con <code>details.missing</code>. La respuesta trae{' '}
          <code>groupJid</code> y los LIDs llamados.
        </p>
        <p>
          Control: <code>POST .../calls/:callId/leave</code> sale de la llamada sin terminarla para los demás (409 en
          una call 1:1 — usa <code>end</code>); <code>POST .../calls/:callId/join</code> entra en una llamada en curso
          que perdiste o dejaste; <code>POST .../calls/:callId/participants/mute</code> (
          <code>{'{ "participant": "…@lid" }'}</code>) pide a un participante que se silencie — decide su cliente. En el
          WS: <code>call:leave</code>, <code>call:join</code>, <code>call:mute_participant</code>.
        </p>
        <p>
          Eventos: <code>call.participants_changed</code> (<code>added</code>, <code>removed</code> con{' '}
          <code>cause</code>, <code>switched</code>, <code>devicesAdded</code>, <code>devicesRemoved</code>),{' '}
          <code>call.mute_requested</code> (<code>participantJid</code>, <code>muted</code>) y{' '}
          <code>call.participant_media</code> (<code>participantJid</code>, <code>receiving</code>). El snapshot gana{' '}
          <code>isGroup</code>, <code>groupJid</code> y <code>participants</code> (<code>jid</code>,{' '}
          <code>devices</code>, <code>state</code>). Video en grupo: ver <a href="#video">Video H.264</a>.
        </p>

        <h2 id="interactions">Levantar la mano &amp; reacciones</h2>
        <p>
          Equivalentes REST de <code>call:hand</code> / <code>call:reaction</code>:{' '}
          <code>POST .../calls/:callId/hand</code> (<code>{'{ "raised": true }'}</code>, 404 en una call desconocida) y{' '}
          <code>POST .../calls/:callId/reaction</code> (<code>{'{ "reaction": "👍" }'}</code>, 1–32 caracteres, 409
          cuando la call no está activa o su canal de reacción aún no abrió). Levantar la mano es durable — el peer la
          sigue viendo hasta que se baje; la reacción es momentánea y no queda guardada en la call.
        </p>
        <p>
          El snapshot de la call (REST <code>GET /v1/calls</code> y eventos) ahora trae <code>peerAudioMuted</code>{' '}
          (boolean o <code>null</code> hasta que el peer anuncie uno), <code>handRaised</code> (local) y{' '}
          <code>raisedHands</code> (JIDs de device de los participantes remotos con la mano levantada).{' '}
          <code>POST .../calls/:callId/mute</code> ahora también anuncia el estado de mute local al peer.
        </p>

        <h2 id="pcm">Media PCM</h2>
        <CodeBlock
          language="text"
          code={`ws://host/v1/calls/{callId}/stream?apiKey=$KEY

← JSON { "op":"ready", "sampleRate":16000, "format":"f32le", "channels":1 }
↔ binary Float32 LE mono @ 16 kHz
← JSON { "op":"backpressure", "pause": true | false }
← JSON { "op":"ended" }`}
        />

        <h2 id="video">Video H.264</h2>
        <p>
          Las llamadas iniciadas con <code>isVideo: true</code> (o <code>call:start</code> con{' '}
          <code>"video": true</code>) llevan video en un <strong>segundo</strong> WebSocket,{' '}
          <code>.../calls/:callId/video</code> — el audio se queda en <code>.../stream</code>; abre los dos. La
          respuesta de <code>POST.../calls</code> y todo snapshot de call (REST, <code>/v1/voip</code>, webhooks)
          incluyen <code>mediaType: "audio" | "video"</code> y <code>videoOff</code> (cámara del peer apagada; siempre{' '}
          <code>true</code> en calls de audio).
        </p>
        <CodeBlock
          language="text"
          code={`ws://host/v1/calls/{callId}/video?apiKey=$KEY

← JSON { "op":"ready", "callId":"...", "codec":"h264", "format":"annexb", "headerBytes":12, "mediaType":"video", "videoOff":false }
↔ binary: header de 12 bytes + 1 access unit H.264 Annex-B
   u8 version=1 · u8 flags (bit0 = key frame) · u16 BE stream id · u64 BE timestamp (µs)
← JSON { "op":"stream", "streamId":0, "ssrc":…, "participantJid":"…" }   (antes del 1er frame de cada emisor)
← JSON { "op":"state", "state":"active", "isActive":true, "mediaType":"video", "videoOff":false }
← JSON { "op":"ended" }`}
        />
        <ul>
          <li>
            <strong>Cliente → servidor:</strong> frames de la cámara (Constrained Baseline recomendado, ej.{' '}
            <code>avc1.42E01F</code>). La API no reenvía el pedido de key frame del peer — envía un IDR cada 1 s como
            máximo.
          </li>
          <li>
            <strong>Servidor → cliente:</strong> frames del peer; los timestamps empiezan en 0 (clock RTP 90 kHz
            reconstruido). Si el socket se atrasa (más de 4 MiB en buffer), los frames se descartan hasta el próximo key
            frame — sin video obsoleto, memoria acotada.
          </li>
          <li>
            Cerrar este socket <strong>no</strong> termina la llamada — solo el WS de audio hace eso (
            <code>VOIP_END_CALL_ON_WS_CLOSE</code>).
          </li>
          <li>
            Close codes: <code>4401</code> falta la key · <code>4403</code> forbidden · <code>4404</code> call no
            encontrada · <code>4503</code> instancia offline.
          </li>
          <li>El video no se graba — la grabación WAV sigue siendo solo de audio.</li>
        </ul>

        <p>
          El socket de video abre también en una call de audio, porque puede volverse video a mitad de la llamada. Cada
          emisor tiene su propio stream: antes del primer frame llega{' '}
          <code>{'{ "op":"stream", "streamId":1, "ssrc":…, "participantJid":"…" }'}</code> y el header binario trae ese{' '}
          <code>streamId</code> — usa un decoder por stream. Cuando el emisor sale o cambia de dispositivo llega{' '}
          <code>{'{ "op":"stream_end", "streamId":1 }'}</code>; los ids no se repiten. En una call 1:1 siempre es{' '}
          <code>0</code>; el cliente envía <code>0</code>.
        </p>
        <ul>
          <li>
            <strong>Audio → video (1:1):</strong> <code>POST .../calls/:callId/video/upgrade</code> (WS{' '}
            <code>call:video_upgrade</code>) espera al peer unos 5 s y devuelve <code>result</code>:{' '}
            <code>accepted</code>, <code>rejected</code>, <code>rejected_by_timeout</code>, <code>error</code>,{' '}
            <code>timeout</code> o <code>cancelled</code>. Envía frames solo después de <code>accepted</code>.
          </li>
          <li>
            <strong>Pedido del peer:</strong> llega como <code>call.video_state</code> con{' '}
            <code>upgradeRequested: true</code>; responde en 5 s con <code>.../video/upgrade/accept</code> o{' '}
            <code>.../reject</code>. <code>.../cancel</code> retira un pedido nuestro.
          </li>
          <li>
            <strong>Grupo:</strong> <code>isVideo: true</code> junto con <code>groupId</code> empieza con video.{' '}
            <code>POST .../calls/:callId/video</code> (<code>{'{ "enabled": true }'}</code>, WS <code>call:video</code>)
            enciende o apaga tu cámara. El upgrade en una call de grupo se pide al servidor; todos reciben{' '}
            <code>call.video_upgraded</code>.
          </li>
          <li>
            <strong>Compartir pantalla:</strong> <code>POST .../calls/:callId/screen-share</code> (
            <code>{'{ "sharing": true }'}</code>, WS <code>call:screen_share</code>). La pantalla reemplaza la cámara en
            el mismo stream: deja los frames de la cámara, envía los de la pantalla y vuelve después. Un peer
            compartiendo llega como <code>call.screen_share</code>.
          </li>
          <li>
            <strong>Primeros frames retenidos:</strong> el plugin retiene tus frames hasta que el peer esté listo (hasta
            2 s) y abre el stream en el próximo key frame. Un IDR cada 1 s también acorta el inicio.
          </li>
          <li>
            El snapshot trae <code>screenSharing</code>, <code>peerVideoState</code>, <code>peerScreenSharing</code> y{' '}
            <code>participantMedia</code> (por dispositivo: mic, cámara, pantalla, medios llegando).
          </li>
          <li>
            <code>mediaType</code> pasa a <code>"video"</code> en cuanto la call lleva video, incluida una call 1:1 que
            hizo upgrade (el plugin mantiene el tipo negociado, <code>audio</code>; la API lee las señales de video
            activo).
          </li>
          <li>
            En el WS de control, la pantalla compartida del peer llega como <code>call:screen_share_changed</code> —{' '}
            <code>call:screen_share</code> es el comando.
          </li>
        </ul>

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
          CRUD completo bajo <code>/v1/groups</code> con la clave de la instancia: create, metadata, leave,
          subject/description, invite-code, participants add/remove, promote/demote, picture, settings (announcement,
          restrict, ephemeral…).
        </p>
        <h2 id="member-settings">Permisos de los miembros</h2>
        <p>
          Cada ruta acepta <code>{'{ mode }'}</code>:
        </p>
        <ul>
          <li>
            Quién puede añadir miembros: <code>PUT /v1/groups/:groupId/settings/member-add-mode</code> —{' '}
            <code>admin_add</code> / <code>all_member_add</code>.
          </li>
          <li>
            Quién puede compartir el enlace de invitación:{' '}
            <code>PUT /v1/groups/:groupId/settings/member-link-mode</code> — <code>admin_link</code> /{' '}
            <code>all_member_link</code>.
          </li>
          <li>
            Quién puede enviar historial: <code>PUT /v1/groups/:groupId/settings/history-share-mode</code> —{' '}
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
          Solo los administradores del grupo pueden cambiar los modos. Valores inválidos devuelven 400 con los valores
          aceptados; grupo desconocido devuelve 404; permisos denegados por WhatsApp devuelven 403. Los ajustes
          booleanos siguen usando <code>{'{ enabled }'}</code> (<code>PUT /v1/groups/:groupId/settings/:setting</code>).
        </p>
        <p>
          En <code>GET /v1/groups/:groupId</code> / <code>GET /v1/groups</code>, los metadatos exponen{' '}
          <code>memberAddMode</code>, <code>memberLinkMode</code>, <code>historyShareMode</code> cuando WhatsApp los
          informa; los valores ausentes o desconocidos se omiten. El campo upstream{' '}
          <code>memberShareGroupHistoryMode</code> se mantiene por compatibilidad.
        </p>
        <p>
          Los cambios desde el teléfono al modo de adición llegan en <code>group.update</code> con{' '}
          <code>action: "member_add_mode"</code>, <code>mode</code>, <code>memberAddMode</code>. zapo-js 1.11.0 no
          decodifica notificaciones de los modos de enlace e historial: consulte los metadatos para observar esos
          cambios.
        </p>
        <h2 id="group-history">Historial del grupo</h2>
        <p>
          <code>POST .../groups/:groupId/share-history</code> manda el historial reciente a quien entró después (la
          cuenta necesita <code>group_history_send</code>). Los bundles recibidos están activos por defecto (
          <code>HISTORY_GROUP_BUNDLES</code>) y aparecen como <code>history.group</code> más las proyecciones.
        </p>
        <p>
          El envío respeta el <a href="#member-settings">modo de compartir historial</a> (<code>historyShareMode</code>
          ): <code>admin_share</code> / <code>all_member_share</code>. <code>HISTORY_GROUP_BUNDLES</code> solo controla
          la recepción de bundles.
        </p>
        <p>
          Referencia detallada: <a href="/guide/api/Groups">Groups API</a>.
        </p>
        <h2 id="join-requests">Solicitudes de ingreso</h2>
        <p>
          Activa la aprobación por admins con <code>PUT /v1/groups/:groupId/settings/membership_approval_mode</code> y{' '}
          <code>{'{ "enabled": true }'}</code>. Lista las solicitudes pendientes con{' '}
          <code>GET /v1/groups/:groupId/membership-requests</code>. La respuesta es{' '}
          <code>{'{ "requests": [{ "jid": "111@lid", "requestedAt": "2026-11-06T12:00:00.000Z" }] }'}</code>. Campos
          opcionales: <code>phoneNumber</code> (JID PN del upstream), <code>method</code>, <code>requestor</code>,{' '}
          <code>requestorUsername</code> y <code>parentGroupJid</code>. Las fechas usan ISO 8601; si el upstream omite
          la fecha, se representa con la época Unix.
        </p>
        <p>
          Usa <code>POST .../membership-requests/approve</code> o <code>.../reject</code> como admin del grupo;
          <code>.../cancel</code> retira solicitudes enviadas por esta cuenta. Todos reciben{' '}
          <code>{'{ "participants": ["5511999999999", "111@lid"] }'}</code> (teléfonos/JIDs, resueltos como add/remove).
          Listas vacías devuelven 400, grupos desconocidos 404, falta de permisos 403 y aprobación desactivada 409; se
          conservan los mensajes de error del upstream. Autentica con la clave de instancia en <code>X-Api-Key</code>.
        </p>
        <p>
          Las notificaciones usan <code>group.update</code> en webhooks y SSE. Los campos actuales del upstream,
          incluido <code>action</code>, se conservan. <code>payload.type</code> es{' '}
          <code>membership_approval_request</code> con <code>payload.requesterJid</code> del autor del upstream, o{' '}
          <code>created_membership_requests</code> / <code>revoked_membership_requests</code> con{' '}
          <code>payload.requests[].jid</code> (<code>phoneJid</code>/<code>username</code> opcionales). Se omiten las
          identidades que el upstream no proporciona; consulta las solicitudes pendientes para reconciliar la cola. SSE
          usa <code>data.type</code>, <code>data.requesterJid</code> y <code>data.requests[].jid</code>.
        </p>
        <h2>Comunidades</h2>
        <p>
          Las comunidades son grupos padre con subgrupos vinculados. Usa la clave de instancia en X-Api-Key; las rutas
          empiezan en /v1/communities.
        </p>
        <p>
          Crea con subject y, opcionalmente, description, membershipApprovalMode (open o request_required;
          predeterminado request_required), allowNonAdminSubGroupCreation y createGeneralChat. Los IDs aceptan dígitos o
          JIDs completos @g.us.
        </p>
        <table>
          <tbody>
            <tr>
              <td>
                <code>POST /v1/communities</code>
              </td>
              <td>{'Crear → { community }'}</td>
            </tr>
            <tr>
              <td>
                <code>GET /v1/communities/:communityId</code>
              </td>
              <td>{'Consultar metadatos → { community }'}</td>
            </tr>
            <tr>
              <td>
                <code>DELETE /v1/communities/:communityId</code>
              </td>
              <td>{'Desactivar → { ok: true }'}</td>
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
              <td>{'Transferir propiedad → { ok: true }'}</td>
            </tr>
          </tbody>
        </table>
        <p>
          Vincular/desvincular exige un array groups no vacío; desvincular también acepta removeOrphanedMembers. Revisa
          las entradas failed (jid, error) incluso con HTTP 200. Entrar acepta un cuerpo opcional con type y solo
          devuelve confirmación; consulta /groups/:groupId después para obtener metadatos. La transferencia acepta user
          (teléfono, JID, LID o @username), resuelto por el resolvedor compartido de destinatarios.
        </p>
        <p>
          Las operaciones sobre comunidades existentes verifican primero los metadatos del grupo padre: comunidades
          desconocidas y grupos comunes devuelven 404. Listado de subgrupos, sugerencias y transferencia de propiedad
          requieren el transporte MEX upstream y los permisos de la cuenta. Las rutas REST delegan las operaciones de
          protocolo a zapo-js.
        </p>
        <p>
          Ambas rutas de consulta de grupos y los metadatos de comunidad preservan isParentGroup, isClosedCommunity,
          defaultSubgroup, generalSubgroup, hiddenSubgroup, allowNonAdminSubGroupCreation y linkedParentJid, además de
          los demás campos upstream.
        </p>
        <p>
          Las notificaciones de comunidad usan el evento webhook/SSE existente group.update: action es link, unlink,
          linked_group_promote o linked_group_demote; linkedGroups contiene jid, subject, subjectTimestampSeconds y
          hiddenSubgroup cuando se proporcionan. contextGroupJid también se conserva. No hay nuevos nombres de evento.
        </p>
        <p>
          Los JIDs de grupo antiguos, como 5511999999999-1234567890@g.us, se aceptan sin cambios para vincular,
          desvincular, sugerir y entrar. La ausencia de transporte MEX devuelve 503; los fallos reconocidos de consultas
          MEX devuelven 502 con un mensaje público estático. Los errores IQ conservan su mapeo de estado existente. El
          cuerpo de join también es opcional en el contrato OpenAPI.
        </p>
        <p>
          <a href="/guide/api/Communities">Communities API</a>
        </p>
        <h2 id="channels">Canales</h2>
        <p>
          {
            'Los canales de WhatsApp usan el área REST Newsletters en /v1/newsletters. Envía la clave de instancia en X-Api-Key o Bearer; los JID terminan en @newsletter. La instancia se obtiene de esa clave.'
          }
        </p>
        <p>
          {
            'Descubrimiento: GET en la colección lista los canales seguidos; /:jid consulta metadatos; /by-invite/:code busca por invitación; /search?q=noticias&limit=20&cursor=... devuelve directorio y pageInfo; /recommended?limit=20 lista recomendaciones.'
          }
        </p>
        <p>
          {
            'POST /:jid/follow mantiene la asociación; /unfollow deja de seguir. POST /:jid/mute acepta { "muted": true, "type": "follower" } (type también puede ser admin). Seguir no crea una suscripción en vivo: POST /:jid/live-updates devuelve durationSeconds. Renueva antes de que expire; el gateway no renueva automáticamente.'
          }
        </p>
        <p>
          {
            'GET /:jid/messages?count=50&before=42 y /:jid/updates?count=50&after=42&since=1700000000 leen directamente de WhatsApp (count de 1 a 100; before y after son mutuamente excluyentes). Las actualizaciones requieren exactamente un cursor, incluso con since. Los metadatos ausentes por JID o invitación devuelven 404. zapo-js 1.11 devuelve páginas BinaryNode sin decodificador público. Las respuestas son sobres de transporte { name, attributes, children?, text?, bytesBase64? }, no proyecciones de mensajes decodificados. Metadatos, directorio y seguidores tienen campos JSON públicos estables.'
          }
        </p>
        <p>
          {
            'POST /:jid/messages/:messageId/react recibe { "reaction": "🔥" }; una cadena vacía elimina la reacción. /vote recibe { "options": ["<hash de 32 bytes en base64>"] }; son hashes de opciones de encuesta, no etiquetas ni índices. /view envía confirmación de visualización. Estas tres acciones requieren el ID numérico positivo del servidor obtenido del historial del canal.'
          }
        </p>
        <p>
          {
            'Administración: POST en la colección con { name, description?, picture? } crea un canal (picture es un JPEG decodificable en base64, limitado a 256 KiB decodificados y 16 megapíxeles). PATCH /:jid acepta name, description, picture (null la elimina) y reactionCodesSetting. DELETE /:jid elimina permanentemente. GET /:jid/admin devuelve información y capacidades administrativas; /followers?count=50 devuelve seguidores (sin cursor upstream); /pending-invites devuelve JID de usuarios.'
          }
        </p>
        <p>
          {
            'POST /:jid/admins/invite, /:jid/admins/invite/revoke, /:jid/admins/demote y /:jid/owner reciben { "user": "111@lid" }; teléfonos y @handles pasan por el resolvedor existente de destinatarios. Todos los destinos deben resolver a JID de usuario PN/LID; grupos, broadcasts y canales devuelven 400. POST /:jid/admins/invite/accept acepta para la cuenta actual. Transferir requiere un administrador previamente invitado. El upstream acepta automáticamente los términos de creación/invitación administrativa al crear/aceptar.'
          }
        </p>
        <p>
          {
            'Publicación: POST /:jid/messages llama a client.newsletter.send. Usa { "type": "text", "text": "Noticias" } o type image/video/audio/document con mediaUrl, mediaBase64 o archivo multipart file, más caption/mimetype/fileName/ptt según el tipo. PATCH /:jid/messages/:messageId edita con el mismo cuerpo de texto/media; DELETE revoca. Estos ID son los ID de stanza devueltos en id al publicar, distintos de los ID numéricos de servidor usados por react/vote/view. El MIME se detecta en el archivo si falta; los formatos no reconocidos requieren mimetype explícito (400 en caso contrario). Los archivos temporales se eliminan tras éxito o fallo, incluso si falla la detección de MIME.'
          }
        </p>
        <p>
          {
            'newsletter.update y newsletter.message_update llegan a webhooks y SSE. Las notificaciones contienen jid, action y detalles escalares; se omiten objetos anidados desconocidos y los bigints pasan a cadenas decimales. Las actualizaciones de mensajes contienen jid, serverId y el tipo edit/revoke/reaction/poll_vote/counters. Las ediciones contienen contenido proyectado y los hashes de votos usan base64. Ningún evento expone nodos brutos, plaintext ni protobuf.'
          }
        </p>
        <p>
          {
            'Área propia para canales: los nuevos mensajes y threads de canales del mailbox quedan fuera de app_messages/chats y de las descargas de media de chats. Se conservan las filas existentes. No hay historial/búsqueda local de canales: consulta las rutas dedicadas de WhatsApp y renueva las suscripciones temporales en vivo.'
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
