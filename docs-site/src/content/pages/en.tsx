import { Callout } from '../../components/Callout'
import { CodeBlock } from '../../components/CodeBlock'
import { ExternalLink } from '../../components/ExternalLink'
import type { GuidePage } from './types'

export const GUIDE_PAGES: Record<string, GuidePage> = {
  intro: {
    title: 'zapo-rest',
    description: 'Multi-session REST API for WhatsApp (zapo-js) — messages, media, webhooks, VoIP and dashboard.',
    body: (
      <>
        <p>
          <strong>zapo-rest</strong> is a multi-session HTTP API built on{' '}
          <a href="https://zapo.to" target="_blank" rel="noreferrer">
            zapo-js
          </a>
          : each <em>instance</em> is a linked WhatsApp device with its own lifecycle (QR/pairing → open → messages →
          calls).
        </p>

        <Callout title="Two documentation layers">
          <ul>
            <li>
              <strong>This guide</strong> (<code>/guide</code>) — context, flows, examples and a narrative reference for{' '}
              <em>all</em> endpoints.
            </li>
            <li>
              <ExternalLink href="/docs">Scalar</ExternalLink> — interactive OpenAPI (Try it out) generated from Fastify
              + Zod routes. JSON at <ExternalLink href="/docs/json">/docs/json</ExternalLink>.
            </li>
            <li>
              <strong>Source</strong> —{' '}
              <a href="https://github.com/rafaelsantana6/zapo-rest" target="_blank" rel="noreferrer">
                github.com/rafaelsantana6/zapo-rest
              </a>{' '}
              (stars, issues, releases, Docker).
            </li>
          </ul>
        </Callout>

        <h2 id="capabilities">What the API covers</h2>
        <ul>
          <li>
            <strong>Instances</strong> — create/connect/QR/pairing-code/restart/logout, admin vs instance API keys; dual
            paths (named or short form with instance key)
          </li>
          <li>
            <strong>Messages</strong> — text, reply, image, video, audio/PTT, document, sticker, location, poll, react,
            edit, revoke, contact, forward, star
          </li>
          <li>
            <strong>Chats & store</strong> — Postgres listing, history-sync, read/archive/unread, reconcile LID→PN
          </li>
          <li>
            <strong>Contacts / JID / LID</strong> — resolve, check (batch), blocklist, profile picture, about
          </li>
          <li>
            <strong>Media</strong> — download by messageId, S3/local storage, getBase64 endpoint
          </li>
          <li>
            <strong>Presence</strong> — available/unavailable, composing/recording, subscribe
          </li>
          <li>
            <strong>Multi-config webhooks</strong> — HMAC, retries, outbox; message / any / inbound, calls, presence…
          </li>
          <li>
            <strong>Realtime SSE</strong> — <code>GET /v1/events</code> (server → client)
          </li>
          <li>
            <strong>VoIP</strong> — control plane <code>/v1/voip</code> + PCM stream + WAV recording
          </li>
          <li>
            <strong>Groups, labels, privacy, profile, status/stories, business profiles</strong>
          </li>
        </ul>

        <h2 id="stack">Stack</h2>
        <table>
          <thead>
            <tr>
              <th>Layer</th>
              <th>Technology</th>
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
              <td>Persistence</td>
              <td>Postgres (projections + mailbox_*) · optional Redis</td>
            </tr>
            <tr>
              <td>Media</td>
              <td>
                Local or S3/MinIO/R2 with <strong>CAS</strong> (SHA-256 dedup per instance)
              </td>
            </tr>
            <tr>
              <td>UI</td>
              <td>React dashboard + this Tailwind guide</td>
            </tr>
          </tbody>
        </table>

        <Callout title="Design advantages (summary)">
          <p>You do not need to open another file to see what makes this gateway different:</p>
          <ul>
            <li>
              <strong>Media CAS</strong> — same file (forward/sticker) stored once per instance
            </li>
            <li>
              <strong>Rehydrate + 302</strong> — recoverable from WA; direct download from storage
            </li>
            <li>
              <strong>Outbox + HMAC</strong> — at-least-once webhooks, no double-fire
            </li>
            <li>
              <strong>SSE / WS for VoIP only</strong> · <strong>LID↔PN</strong> · healthcheck-friendly boot ·{' '}
              <strong>WAM</strong> wire parity (<code>WAM_ENABLED=false</code> to disable)
            </li>
          </ul>
          <p>
            Full table: <a href="/guide/why">Design advantages</a> · flows in{' '}
            <a href="/guide/architecture">Architecture</a>.
          </p>
        </Callout>

        <h2 id="links">Quick links</h2>
        <ul>
          <li>
            <a href="/guide/why">Design advantages (summary)</a>
          </li>
          <li>
            <a href="/guide/quickstart">Quickstart in 4 steps</a>
          </li>
          <li>
            <a href="/guide/architecture">Architecture and internal flows</a>
          </li>
          <li>
            <a href="/guide/api">Full endpoint catalog</a>
          </li>
          <li>
            <a href="https://github.com/rafaelsantana6/zapo-rest" target="_blank" rel="noreferrer">
              GitHub repository
            </a>
          </li>
          <li>
            <ExternalLink href="/docs">Open Scalar</ExternalLink>
          </li>
        </ul>
      </>
    ),
  },

  why: {
    title: 'Design advantages',
    description: 'Summary of decisions that cut cost and risk in production — readable without opening the repo.',
    body: (
      <>
        <p>
          These choices are <strong>intentional</strong>. The summary below is enough to evaluate the project; the repo
          file <code>docs/DESIGN-DECISIONS.md</code> is the long form for contributors.
        </p>

        <h2 id="glance">At a glance</h2>
        <ul>
          <li>
            <strong>Cheaper media</strong> — CAS (SHA-256 per instance); forwards/stickers do not multiply objects
          </li>
          <li>
            <strong>Recoverable media</strong> — if the object is missing, re-download from WhatsApp and re-store
          </li>
          <li>
            <strong>Reliable webhooks</strong> — persist chat first, outbox + retry, HMAC, no double-fire
          </li>
          <li>
            <strong>Right realtime</strong> — SSE for app events; WebSocket only for VoIP
          </li>
          <li>
            <strong>Modern WA identity</strong> — LID ↔ PN map + reconcile (no split history)
          </li>
          <li>
            <strong>Ops-friendly boot</strong> — HTTP listens before long reconnect/reconcile (healthchecks stay green)
          </li>
          <li>
            <strong>WA Web wire parity</strong> — WAM telemetry on by default; set <code>WAM_ENABLED=false</code> to
            disable
          </li>
          <li>
            <strong>Instance from API key</strong> — with an instance key the name may be omitted from the URL; admin
            always supplies <code>:name</code>
          </li>
        </ul>

        <h2 id="table">Decision → benefit</h2>
        <table>
          <thead>
            <tr>
              <th>Decision</th>
              <th>Benefit</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>
                <strong>CAS</strong> <code>…/cas/sha256/…</code> per instance
              </td>
              <td>Lower object storage cost; stable object identity</td>
            </tr>
            <tr>
              <td>Rehydrate if object is missing</td>
              <td>Recoverable media without re-pairing; 404 only if WA cannot deliver</td>
            </tr>
            <tr>
              <td>302 + presign</td>
              <td>API is not a permanent bandwidth middleman</td>
            </tr>
            <tr>
              <td>
                Two-stage webhooks (<code>meta</code> → <code>stored</code>)
              </td>
              <td>
                Bots react early; stable file on <code>message.media.stored</code>
              </td>
            </tr>
            <tr>
              <td>
                Projection → <code>processed_events</code> → outbox
              </td>
              <td>Consistent store + side-effects without double delivery</td>
            </tr>
            <tr>
              <td>SSE for app / WS for VoIP only</td>
              <td>Simple contract; softphone without REST polling</td>
            </tr>
            <tr>
              <td>Header auth preferred</td>
              <td>Keys out of access logs / Referer</td>
            </tr>
            <tr>
              <td>Instance inferred from API key (dual routes)</td>
              <td>
                Named path always valid; short <code>/v1/…</code> and <code>/v1/instance/…</code> with instance key.
                Admin must pass <code>:name</code>
              </td>
            </tr>
            <tr>
              <td>Per-session serial queue</td>
              <td>No races on upsert/ack/presence</td>
            </tr>
            <tr>
              <td>
                <code>lid_map</code> + reconcile
              </td>
              <td>Modern WA identity without duplicate threads</td>
            </tr>
            <tr>
              <td>
                <code>listen</code> before long WA boot
              </td>
              <td>Docker/Swarm healthchecks stay green during reconnect/reconcile</td>
            </tr>
            <tr>
              <td>
                <strong>WAM</strong> telemetry (<code>@zapo-js/wam</code>, default on)
              </td>
              <td>
                Emits WA Web <code>w:stats</code> batches for wire parity. Disable with <code>WAM_ENABLED=false</code>
              </td>
            </tr>
          </tbody>
        </table>

        <h2 id="next">Go deeper</h2>
        <ul>
          <li>
            <a href="/guide/architecture">Architecture</a> — queues, projections, diagram
          </li>
          <li>
            <a href="/guide/media">Media</a> — CAS, rehydrate, 302
          </li>
          <li>
            <a href="/guide/webhooks">Webhooks</a> — outbox, HMAC, events
          </li>
          <li>
            <a href="/guide/realtime">SSE</a> — why not a general WebSocket
          </li>
        </ul>
      </>
    ),
  },

  quickstart: {
    title: 'Quickstart',
    description: 'From zero to first message and first webhook.',
    body: (
      <>
        <h2 id="env">1. Environment</h2>
        <p>
          Configure at least <code>ADMIN_API_KEY</code>, <code>DATABASE_URL</code> and start the API (Docker Compose or{' '}
          <code>pnpm dev</code>).
        </p>
        <CodeBlock
          language="bash"
          code={`export BASE=http://localhost:3000
export ADMIN_API_KEY=your-admin-key
export KEY=$ADMIN_API_KEY # or the instance key after create`}
        />

        <h2 id="create">2. Create and connect an instance</h2>
        <CodeBlock
          language="bash"
          code={`# Create (admin)
curl -s -X POST "$BASE/v1/instances" \\
 -H "X-Api-Key: $ADMIN_API_KEY" -H "content-type: application/json" \\
 -d '{"name":"sales-1","webhookUrl":"https://hooks.example.com/wa"}'

# Connect socket
curl -s -X POST "$BASE/v1/instances/sales-1/connect" \\
 -H "X-Api-Key: $ADMIN_API_KEY"

# QR (render the string as a QR in the client / dashboard)
curl -s "$BASE/v1/instances/sales-1/qr" -H "X-Api-Key: $ADMIN_API_KEY"`}
        />
        <p>
          Scan in WhatsApp → Linked devices. Alternative: pairing code with <code>POST.../pairing-code</code> and the
          SIM number.
        </p>

        <h2 id="send">3. Send text</h2>
        <CodeBlock
          language="bash"
          code={`# Admin or multi-tenant: named path
curl -s -X POST "$BASE/v1/instances/sales-1/messages/text" \\
 -H "X-Api-Key: $ADMIN_API_KEY" -H "content-type: application/json" \\
 -d '{"to":"5511999999999","text":"Hello from zapo-rest 👋"}'

# Instance key: short form (name inferred from the key)
curl -s -X POST "$BASE/v1/messages/text" \\
 -H "X-Api-Key: $INSTANCE_API_KEY" -H "content-type: application/json" \\
 -d '{"to":"5511999999999","text":"Hello from zapo-rest 👋"}'`}
        />
        <p>
          With an <strong>instance key</strong> you may omit the name from the URL. With the <strong>admin key</strong>{' '}
          the name is required. Details in <a href="/guide/auth#scope">Authentication → Instance scope</a>.
        </p>

        <h2 id="listen">4. Listen to events</h2>
        <ul>
          <li>
            <strong>HTTP webhook</strong> — set on create or via <code>POST.../webhooks</code> (multi-config).
          </li>
          <li>
            <strong>SSE</strong> — <code>GET /v1/events?instance=sales-1</code> with <code>X-Api-Key</code> header
            (avoid <code>?apiKey=</code> in the URL)
          </li>
        </ul>
        <Callout tone="tip" title="Dashboard">
          With the dashboard built, open the host root, sign in with the same API key and use the floating softphone +
          full chat.
        </Callout>
      </>
    ),
  },

  architecture: {
    title: 'Architecture',
    description: 'Components, message flow and consistency guarantees.',
    body: (
      <>
        <h2 id="overview">Overview</h2>
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

        <h2 id="session-queue">Per-session queue</h2>
        <p>
          Each instance processes WhatsApp events in series (<em>session queue</em>) to avoid races on message upsert,
          ack and presence. Side-effects (webhook, WS broadcast) run <strong>after</strong> the idempotent upsert{' '}
          <code>(instance, message_id)</code>.
        </p>

        <h2 id="projections">Postgres projections</h2>
        <ul>
          <li>
            <code>messages</code> / mailbox — history queryable via chats API
          </li>
          <li>
            <code>chats</code> — threads with unread, last message, LID/PN merge
          </li>
          <li>
            <code>contacts</code>, <code>lid_map</code>, <code>labels</code>, <code>calls</code>
          </li>
          <li>
            <code>processed_events</code> — protocol event dedupe
          </li>
          <li>
            <code>webhook_outbox</code> — at-least-once delivery with retry policy
          </li>
        </ul>

        <h2 id="lid-pn">LID vs Phone Number (PN)</h2>
        <p>
          Modern WhatsApp uses <code>@lid</code> identifiers in addition to <code>@s.whatsapp.net</code>. The API
          prefers storing PN when mapped, keeps <code>lid_map</code>, expands aliases on presence/subscribe and offers{' '}
          <code>POST.../chats/reconcile-lids</code> to merge duplicates.
        </p>

        <h2 id="media-flow">Media flow</h2>
        <ol>
          <li>
            Inbound with media → optional auto-download (<code>MEDIA_AUTO_DOWNLOAD</code>)
          </li>
          <li>
            <strong>Content-addressed</strong> (CAS) write → if the object already exists, <code>deduped</code> (no
            rewrite)
          </li>
          <li>
            GET <code>.../messages/:id/media</code> prefers a <strong>302</strong> to storage; if missing, re-download
            from WhatsApp and re-store
          </li>
        </ol>

        <h2 id="design-choices">Design decisions (benefits)</h2>
        <p>
          Full summary on <a href="/guide/why">Design advantages</a> (no need to open the repo). Intentional choices —
          not framework fashion. Contributor canonical: <code>docs/DESIGN-DECISIONS.md</code>.
        </p>
        <table>
          <thead>
            <tr>
              <th>Decision</th>
              <th>Benefit</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>
                <strong>CAS</strong> <code>…/cas/sha256/…</code> per instance
              </td>
              <td>Lower object storage cost; forwards/stickers do not multiply objects</td>
            </tr>
            <tr>
              <td>Rehydrate if object is missing</td>
              <td>Recoverable media without re-pairing; 404 only if WA cannot deliver</td>
            </tr>
            <tr>
              <td>302 + presign</td>
              <td>API is not a permanent bandwidth middleman</td>
            </tr>
            <tr>
              <td>
                Two-stage webhooks (<code>meta</code> → <code>stored</code>)
              </td>
              <td>
                Bots can react early and fetch a stable file on <code>message.media.stored</code>
              </td>
            </tr>
            <tr>
              <td>
                Persist projection → claim <code>processed_events</code> → outbox
              </td>
              <td>Consistent store + side-effects without double delivery</td>
            </tr>
            <tr>
              <td>SSE for app / WS for VoIP only</td>
              <td>Simple contract; softphone without REST polling</td>
            </tr>
            <tr>
              <td>Header auth preferred</td>
              <td>Keys out of access logs / Referer</td>
            </tr>
            <tr>
              <td>Instance inferred from API key (dual routes)</td>
              <td>
                Named path always valid; short <code>/v1/…</code> and <code>/v1/instance/…</code> with instance key.
                Admin must pass <code>:name</code>
              </td>
            </tr>
            <tr>
              <td>Per-session serial queue</td>
              <td>No races on upsert/ack/presence</td>
            </tr>
            <tr>
              <td>
                <code>lid_map</code> + reconcile
              </td>
              <td>Modern WA identity without duplicate threads</td>
            </tr>
            <tr>
              <td>
                <code>listen</code> before long WA boot
              </td>
              <td>Docker/Swarm healthchecks stay green during reconnect/reconcile</td>
            </tr>
            <tr>
              <td>
                <strong>WAM</strong> (<code>@zapo-js/wam</code>, default on)
              </td>
              <td>
                Client-side <code>w:stats</code> like a real WA Web tab. <code>WAM_ENABLED=false</code> turns it off
              </td>
            </tr>
          </tbody>
        </table>

        <h2 id="wam">WAM telemetry (session wire parity)</h2>
        <p>
          Real WhatsApp Web tabs send analytics batches on the <code>w:stats</code> channel. zapo-rest attaches the
          upstream plugin <code>@zapo-js/wam</code> on every session <strong>by default</strong> so headless
          multi-session clients look closer to a browser tab on the wire (protocol events + synthetic UI telemetry).
        </p>
        <ul>
          <li>
            <strong>Not</strong> your application metrics, logs, or OpenAPI surface
          </li>
          <li>
            Does <strong>not</strong> change REST, SSE, media, or VoIP behaviour
          </li>
          <li>
            <strong>Enabled by default</strong> (<code>WAM_ENABLED=true</code> when unset)
          </li>
          <li>
            Disable: set <code>WAM_ENABLED=false</code> and restart the API process
          </li>
        </ul>
        <p>
          Upstream guide:{' '}
          <a href="https://zapo.to/guides/wam" rel="noreferrer" target="_blank">
            zapo.to/guides/wam
          </a>
          .
        </p>

        <h2 id="voip-arch">VoIP on two channels</h2>
        <table>
          <thead>
            <tr>
              <th>Channel</th>
              <th>URL</th>
              <th>Content</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Signaling</td>
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
        <p>REST call endpoints still exist (compat), but the softphone does not poll — only control WS.</p>
      </>
    ),
  },

  concepts: {
    title: 'Concepts & entities',
    description: 'Mental model of entities exposed by the API.',
    body: (
      <>
        <h2 id="instance">Instance</h2>
        <p>
          A named WhatsApp session. Main fields: <code>name</code> (stable sessionId), <code>apiKey</code>,{' '}
          <code>status</code>, <code>meJid</code>, legacy webhooks, <code>lastQr</code>.
        </p>
        <p>
          Status: <code>created</code> → <code>connecting</code> → <code>qr</code> / <code>pairing</code> →{' '}
          <code>open</code> · <code>close</code> · <code>logged_out</code>.
        </p>

        <h2 id="message">Message</h2>
        <p>
          Identified by <code>messageId</code> (stanza id) in the instance scope. Types: text, image, video, audio,
          document, sticker, location, poll, reaction, contact, etc. Acks: 0 pending · 1 server · 2 delivered · 3 read.
        </p>

        <h2 id="chat">Chat</h2>
        <p>
          Thread with a peer (1:1) or group. <code>chatId</code> is the JID (URL-encode <code>@</code>). LID and PN
          projections may both exist — reconcile unifies them.
        </p>

        <h2 id="call">Call</h2>
        <p>
          In-memory snapshot (ringing/active) + DB history. Important flags: <code>canAccept</code> (inbound ringing
          only), <code>isActive</code> (media connected), <code>direction</code>, optional recording.
        </p>

        <h2 id="webhook-cfg">Webhook config</h2>
        <p>
          Multi-config per instance: URL, event allow-list, HMAC key, retries (linear/exponential/constant), custom
          headers, enabled.
        </p>

        <h2 id="actor">Actor (auth)</h2>
        <ul>
          <li>
            <code>{`{ role: 'admin' }`}</code> — <code>ADMIN_API_KEY</code>
          </li>
          <li>
            <code>{`{ role: 'instance', instanceName }`}</code> — instance key
          </li>
        </ul>
      </>
    ),
  },

  auth: {
    title: 'Authentication',
    description: 'Admin key vs instance key, dual paths, headers, SSE and VoIP WebSocket.',
    body: (
      <>
        <h2 id="keys">Two key types</h2>
        <table>
          <thead>
            <tr>
              <th>Type</th>
              <th>Source</th>
              <th>Scope</th>
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
              <td>All instances + create/list/delete/rotate</td>
            </tr>
            <tr>
              <td>
                <strong>Instance</strong>
              </td>
              <td>
                instance <code>apiKey</code> field (always on GET)
              </td>
              <td>Only that instance</td>
            </tr>
          </tbody>
        </table>

        <h2 id="headers">How to send</h2>
        <CodeBlock language="http" code={`X-Api-Key: <your-key>\n\n# or\nAuthorization: Bearer <your-key>`} />
        <p>
          Routes <code>/v1/*</code> require a key. Public: <code>GET /health</code>, <code>GET /ready</code>, OpenAPI UI
          at <code>/docs</code>, this guide at <code>/guide</code>.
        </p>

        <h2 id="scope">Instance scope (dual path)</h2>
        <p>
          Session-scoped routes accept <strong>two forms</strong>. Resolution is in <code>resolveInstanceName</code>: if
          the name is in the path, access is checked; if omitted, an instance key binds its own instance; admin without
          a name → <code>400</code>.
        </p>
        <table>
          <thead>
            <tr>
              <th>Who</th>
              <th>Path</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>
                <strong>Admin</strong>
              </td>
              <td>
                <strong>Always</strong> with a name: <code>/v1/instances/:name/...</code> (omit name → 400)
              </td>
            </tr>
            <tr>
              <td>
                <strong>Instance key</strong>
              </td>
              <td>
                Named <strong>or</strong> short form — instance is inferred from the API key
              </td>
            </tr>
          </tbody>
        </table>
        <p>
          <strong>Short form</strong> (instance key only):
        </p>
        <ul>
          <li>
            Resources: <code>/v1/messages/text</code>, <code>/v1/chats</code>, <code>/v1/contacts</code>, … (same as{' '}
            <code>/v1/instances/:name/...</code>)
          </li>
          <li>
            Lifecycle: <code>/v1/instance</code>, <code>/v1/instance/connect</code>, <code>/v1/instance/qr</code>, … —
            singular <code>instance</code> so it never collides with the admin collection <code>/v1/instances</code>
          </li>
        </ul>
        <CodeBlock
          language="bash"
          code={`# Admin — name required
curl -s -X POST "$BASE/v1/instances/sales-1/messages/text" \\
  -H "X-Api-Key: $ADMIN_API_KEY" -H "content-type: application/json" \\
  -d '{"to":"5511999999999","text":"hi"}'

# Instance key — named (still valid)
curl -s -X POST "$BASE/v1/instances/sales-1/messages/text" \\
  -H "X-Api-Key: $INSTANCE_API_KEY" -H "content-type: application/json" \\
  -d '{"to":"5511999999999","text":"hi"}'

# Instance key — short form
curl -s -X POST "$BASE/v1/messages/text" \\
  -H "X-Api-Key: $INSTANCE_API_KEY" -H "content-type: application/json" \\
  -d '{"to":"5511999999999","text":"hi"}'

# Short lifecycle
curl -s "$BASE/v1/instance" -H "X-Api-Key: $INSTANCE_API_KEY"
curl -s -X POST "$BASE/v1/instance/connect" -H "X-Api-Key: $INSTANCE_API_KEY"`}
        />

        <h2 id="stream-auth">SSE and WebSocket</h2>
        <ul>
          <li>
            <strong>SSE</strong> — prefer <code>fetch</code> with <code>X-Api-Key</code> header (dashboard does this).
            Avoid <code>?apiKey=</code> in the URL.
          </li>
          <li>
            <strong>WebSocket</strong> (VoIP <code>/v1/voip</code>, PCM stream) — browsers usually cannot send headers;
            query <code>?apiKey=</code> remains the practical fallback.
          </li>
        </ul>

        <h2 id="me">Discover the actor</h2>
        <CodeBlock
          language="bash"
          code={`curl -s "$BASE/v1/me" -H "X-Api-Key: $KEY"
# admin → { "role": "admin" }
# instance → { "role": "instance", "instance": {... } }`}
        />

        <Callout tone="warn" title="Production">
          Protect <code>/docs</code> and <code>/guide</code> with network ACL if the API is public. Instance keys are
          returned in plaintext on purpose (ops / dashboard) — treat them as secrets.
        </Callout>
      </>
    ),
  },

  instances: {
    title: 'Instances & pairing',
    description: 'Full lifecycle of a WhatsApp session.',
    body: (
      <>
        <h2 id="lifecycle">Lifecycle</h2>
        <ol>
          <li>
            <code>POST /v1/instances</code> (admin) → status <code>created</code> + apiKey
          </li>
          <li>
            <code>POST.../connect</code> → <code>connecting</code>
          </li>
          <li>
            QR: <code>GET.../qr</code> or <code>instance.qr</code> event · or pairing-code
          </li>
          <li>
            <code>open</code> → ready to send/receive · <code>meJid</code> set
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

        <h2 id="rotate">Key rotation</h2>
        <p>
          <code>POST.../keys/rotate</code> invalidates the old key. Clients and webhooks using the instance key must
          update.
        </p>

        <h2 id="short-path">Short form (instance key)</h2>
        <p>
          With the instance’s own API key you may use singular <code>/v1/instance/...</code> instead of{' '}
          <code>/v1/instances/:name/...</code> — the name is inferred from the key. Admin must still pass the name. See{' '}
          <a href="/guide/auth#scope">Authentication</a>.
        </p>
        <CodeBlock
          language="bash"
          code={`curl -s "$BASE/v1/instance" -H "X-Api-Key: $INSTANCE_API_KEY"
curl -s -X POST "$BASE/v1/instance/connect" -H "X-Api-Key: $INSTANCE_API_KEY"
curl -s "$BASE/v1/instance/qr" -H "X-Api-Key: $INSTANCE_API_KEY"`}
        />

        <h2 id="endpoints">Endpoints</h2>
        <p>
          See reference: <a href="/guide/api/Instances">Instances</a>.
        </p>
      </>
    ),
  },

  messages: {
    title: 'Messages',
    description: 'Sending, types, acks and inbound events.',
    body: (
      <>
        <Callout title="Dual path">
          Paths below use relative <code>.../messages/…</code>. Full prefix: <code>/v1/instances/:name/messages/…</code>{' '}
          (admin or instance) or, with an instance key, <code>/v1/messages/…</code>. Details in{' '}
          <a href="/guide/auth#scope">Authentication</a>.
        </Callout>
        <h2 id="own-profile">Name and avatar (own profile)</h2>
        <p>
          Update the session’s WhatsApp <strong>push name</strong> and <strong>profile picture</strong>:
        </p>
        <CodeBlock
          language="bash"
          code={`# Display name (max 25 chars)
curl -s -X PUT "$BASE/v1/profile/name" \\
  -H "X-Api-Key: $INSTANCE_API_KEY" -H "content-type: application/json" \\
  -d '{"name":"Store Sales"}'

# JPEG avatar (public URL or base64)
curl -s -X PUT "$BASE/v1/profile/image" \\
  -H "X-Api-Key: $INSTANCE_API_KEY" -H "content-type: application/json" \\
  -d '{"mediaUrl":"https://cdn.example.com/avatar.jpg"}'

# Alias: /profile/picture · remove: DELETE /v1/profile/image`}
        />
        <h2 id="send-types">Send types</h2>
        <table>
          <thead>
            <tr>
              <th>Path</th>
              <th>Use</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>
                <code>.../messages/text</code>
              </td>
              <td>Text + linkPreview + mentions</td>
            </tr>
            <tr>
              <td>
                <code>.../messages/reply</code>
              </td>
              <td>Quote by messageId</td>
            </tr>
            <tr>
              <td>
                <code>.../messages/image|video|audio|document|sticker</code>
              </td>
              <td>mediaUrl or mediaBase64</td>
            </tr>
            <tr>
              <td>
                <code>.../messages/location|poll|contact</code>
              </td>
              <td>Structured</td>
            </tr>
            <tr>
              <td>
                <code>.../messages/react|edit|revoke|forward|star</code>
              </td>
              <td>Actions on existing messages</td>
            </tr>
          </tbody>
        </table>

        <h2 id="to">
          Field <code>to</code>
        </h2>
        <p>
          Accepts digits with country code (<code>5511…</code>), PN JID, <code>@g.us</code>, <code>@lid</code>. The API
          normalizes via resolve/JID helpers.
        </p>

        <h2 id="inbound-events">Three message events</h2>
        <table>
          <thead>
            <tr>
              <th>Event</th>
              <th>When</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>
                <code>message</code>
              </td>
              <td>“Useful” processed message (type filter)</td>
            </tr>
            <tr>
              <td>
                <code>message.any</code>
              </td>
              <td>Any upsert (incl. echo/fromMe depending on config)</td>
            </tr>
            <tr>
              <td>
                <code>message.inbound</code>
              </td>
              <td>Legacy alias focused on received (!fromMe)</td>
            </tr>
            <tr>
              <td>
                <code>message.media.stored</code>
              </td>
              <td>
                Stage 2 after media is in CAS; payload has <code>mediaStage: "stored"</code>, storage key + URL. Stage 1
                is the initial <code>message</code> with <code>mediaStage: "meta"</code>.
              </td>
            </tr>
            <tr>
              <td>
                <code>message.media.failed</code>
              </td>
              <td>
                Download/store failed after retries (<code>mediaStage: "failed"</code> + error string)
              </td>
            </tr>
          </tbody>
        </table>
        <p>
          One inbound can fire more than one event if the webhook allow-list includes several names — subscribe only to
          what you need. For media bots that only care about permanent files, subscribe to{' '}
          <code>message.media.stored</code> alone.
        </p>

        <h2 id="acks">Acks (ticks)</h2>
        <p>
          Event <code>message.ack</code> updates delivered/read. In the store: map by messageIds.
        </p>
      </>
    ),
  },

  media: {
    title: 'Media & storage',
    description: 'CAS with dedup, S3/local download and WhatsApp rehydrate.',
    body: (
      <>
        <h2 id="config">Config</h2>
        <ul>
          <li>
            <code>MEDIA_STORAGE=local|s3</code> — call recordings and media cache
          </li>
          <li>
            <code>MEDIA_AUTO_DOWNLOAD</code> — auto-download inbound media
          </li>
          <li>
            S3/MinIO/R2: bucket, endpoint, <code>S3_PUBLIC_URL</code> (browser-facing URL for presign)
          </li>
        </ul>

        <h2 id="cas">Content-addressed storage (CAS) — fewer bytes</h2>
        <p>
          Objects use a key from the <strong>SHA-256 of the content</strong> within the instance:
        </p>
        <CodeBlock language="text" code={`{instanceName}/cas/sha256/{hash}{ext}`} />
        <ul>
          <li>
            <strong>Dedup</strong> — the same payload (forward, sticker, resend) is stored <em>once</em>; put returns{' '}
            <code>deduped: true</code> without rewriting
          </li>
          <li>
            <strong>Isolation</strong> — instances never share objects; deleting an instance removes only{' '}
            <code>{'{name}'}/…</code>
          </li>
          <li>
            <strong>Type extension</strong> on the key (mime/filename), not the original display name — direct URLs open
            with the right type; the display name lives on the message row
          </li>
          <li>
            Avatars use <code>putAt</code> (fixed key), not CAS
          </li>
        </ul>
        <Callout title="Why this matters">
          On multi-session with high volume, repeated media is a large share of the bucket. CAS cuts cost without
          changing the message API contract.
        </Callout>

        <h2 id="download">Download</h2>
        <CodeBlock
          language="bash"
          code={`# Stream / redirect media for a message
curl -sL "$BASE/v1/instances/sales-1/messages/3EB0ABC/media" \\
 -H "X-Api-Key: $KEY" -o file.bin

# API parity
curl -s -X POST "$BASE/v1/instances/sales-1/media/getBase64FromMediaMessage" \\
 -H "X-Api-Key: $KEY" -H "content-type: application/json" \\
 -d '{"messageId":"3EB0ABC"}'`}
        />
        <p>
          Preference: <strong>302</strong> to storage (S3 presign or local public base). The API does not need to
          retransmit every byte.
        </p>

        <h2 id="fallback">Resolution order (rehydrate)</h2>
        <ol>
          <li>Object already in storage (CAS)</li>
          <li>If missing → re-download from WhatsApp, store again</li>
          <li>404 only if WhatsApp can no longer provide the media</li>
        </ol>

        <h2 id="two-stage">Two-stage webhooks</h2>
        <ol>
          <li>
            <code>message</code> with <code>mediaStage: "meta"</code> — early arrival (WA URL or placeholder)
          </li>
          <li>
            <code>message.media.stored</code> — after CAS; stable URL/storage · or <code>message.media.failed</code>
          </li>
        </ol>
        <p>
          Bots that only want a permanent file: subscribe to <code>message.media.stored</code> (or <code>message</code>,
          which also matches stage-2).
        </p>
      </>
    ),
  },

  chats: {
    title: 'Chats & history',
    description: 'Projections, sync and thread actions.',
    body: (
      <>
        <p>
          Chats and messages come from the Postgres store (history + live). Endpoints under{' '}
          <code>/v1/instances/:name/chats</code>.
        </p>
        <ul>
          <li>List / get chat · paginated messages · get message</li>
          <li>read · archive · unarchive · unread · local delete · history-sync</li>
          <li>
            <code>reconcile-lids</code> — merge PN/LID
          </li>
        </ul>
        <Callout title="history-sync">
          <code>POST.../history-sync</code> requests backfill from WhatsApp; chunks arrive as <code>history.sync</code>{' '}
          events, not in the synchronous HTTP response.
        </Callout>
      </>
    ),
  },

  contacts: {
    title: 'Contacts & JID/LID',
    description: 'Resolve numbers, existence check and blocklist.',
    body: (
      <>
        <h2 id="resolve">Resolve vs check</h2>
        <ul>
          <li>
            <code>POST.../contacts/jid</code> — build local JID (no network)
          </li>
          <li>
            <code>POST.../contacts/resolve</code> — canonical WhatsApp JID (LID-aware)
          </li>
          <li>
            <code>POST.../contacts/check</code> — batch exists (max 50), tries BR 9th-digit variants
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
          LID↔PN map also under <a href="/guide/api/Lids">/lids</a>.
        </p>
      </>
    ),
  },

  presence: {
    title: 'Presence & typing',
    description: 'Online, composing/recording and subscribe.',
    body: (
      <>
        <h2 id="set">Account presence</h2>
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

        <h2 id="subscribe">Subscribe (required to receive)</h2>
        <p>
          Without <code>POST.../presence/subscribe</code>, the session may not emit peer <code>presence.update</code> /{' '}
          <code>chatstate</code>. The manager expands LID+PN aliases.
        </p>
        <CodeBlock
          language="json"
          code={`// chatstate event on SSE /v1/events or webhook
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
    description: 'Multi-config, durable outbox, HMAC and retries.',
    body: (
      <>
        <h2 id="multi">Multi-config</h2>
        <p>
          CRUD at <code>/v1/instances/:name/webhooks</code>. Each config: URL, events[], hmac, retries, customHeaders,
          enabled. There is also a legacy webhook on instance fields (<code>webhookUrl</code> /{' '}
          <code>webhookEvents</code>).
        </p>
        <Callout title="Guarantees (by design)">
          <ul>
            <li>
              <strong>Projection first</strong> — message/chat upserted before the webhook is enqueued
            </li>
            <li>
              <strong>Postgres outbox</strong> — atomic claim, retry/backoff; offline receivers do not drop events
            </li>
            <li>
              <strong>
                <code>processed_events</code>
              </strong>{' '}
              — side-effects do not fire twice if the protocol redelivers
            </li>
            <li>
              <strong>HMAC-SHA512</strong> — verify authenticity on your endpoint
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
 "payload": { /* event data */ }
}`}
        />

        <h2 id="events">Event catalog</h2>
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

        <h2 id="hmac">HMAC and retries</h2>
        <p>
          When configured, the worker signs the POST (<code>X-Webhook-Hmac</code> / <code>X-Webhook-Hmac-Sha512</code>).
          Retries: linear/exponential/constant policy + attempts + delaySeconds. The secret is write-only on the API
          (never re-echoed on GET).
        </p>
      </>
    ),
  },

  realtime: {
    title: 'SSE /v1/events',
    description: 'Unidirectional stream (server → client) via Server-Sent Events.',
    body: (
      <>
        <p>
          The event channel is <strong>SSE</strong>, not WebSocket: the client only listens. Bidirectional VoIP stays on{' '}
          <code>/v1/voip</code> + PCM stream.
        </p>
        <Callout tone="warn" title="Auth: header, not query">
          Prefer <code>X-Api-Key</code> or <code>Authorization: Bearer</code>. Putting the key in the URL (
          <code>?apiKey=</code>) leaks in access/proxy logs, history and Referer. The dashboard uses <code>fetch</code>{' '}
          + stream with a header. Query only as fallback for native <code>EventSource</code> (which cannot send
          headers).
        </Callout>
        <CodeBlock
          language="bash"
          code={`# curl (recommended) — key in header
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

// Avoid: new EventSource(\`/v1/events?apiKey=\${key}\`) // key in URL`}
        />
        <p>
          First frame <code>connected</code>, then the same shape as the webhook bus. Admin without{' '}
          <code>instance</code> receives all instances. Keepalive every 15s (SSE comment <code>: ping</code>).
        </p>
      </>
    ),
  },

  voip: {
    title: 'VoIP & softphone',
    description: 'JSON signaling, 16 kHz PCM, recording, audio blast and STT.',
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

        <h2 id="server-push">Server push</h2>
        <ul>
          <li>
            <code>call:offer</code> / <code>call:ringing</code> — inbound
          </li>
          <li>
            <code>call:state</code> — transition (connecting, active, …)
          </li>
          <li>
            <code>call:ended</code> — terminal
          </li>
          <li>
            <code>calls:snapshot</code> — list on attach
          </li>
          <li>
            <code>device:status</code> — WA session status
          </li>
        </ul>

        <h2 id="pcm">PCM media</h2>
        <CodeBlock
          language="text"
          code={`ws://host/v1/instances/sales-1/calls/{callId}/stream?apiKey=$KEY

← JSON { "op":"ready", "sampleRate":16000, "format":"f32le", "channels":1 }
↔ binary Float32 LE mono @ 16 kHz
← JSON { "op":"backpressure", "pause": true | false }
← JSON { "op":"ended" }`}
        />

        <h2 id="states">Important states</h2>
        <ul>
          <li>
            <strong>Accept</strong> only with <code>canAccept</code> (incoming_ringing)
          </li>
          <li>
            Media “active” after <code>media_connected</code> / active state — UI must not force active on outbound just
            from ringing
          </li>
          <li>
            Recording: <code>PUT.../settings/call-recording</code> + storage ready → PCM only after answer (
            <code>connecting</code>/<code>active</code>) → WAV at <code>GET.../recording</code>
          </li>
        </ul>

        <h2 id="blast">Audio blast + STT</h2>
        <p>For automated outbound prompts (IVR-style), use REST instead of the softphone WS:</p>
        <table>
          <thead>
            <tr>
              <th>Endpoint</th>
              <th>What it does</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>
                <code>POST /v1/instances/:name/calls/blast</code>
              </td>
              <td>
                Dial → play a WAV from <code>audioUrl</code> when answered → optional remote-leg record + Whisper
                transcription
              </td>
            </tr>
            <tr>
              <td>
                <code>POST /v1/instances/:name/calls/:callId/transcribe</code>
              </td>
              <td>STT on an existing stored recording (blast or call-recording)</td>
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
            <strong>WAV only</strong> (PCM/float); resampled to 16 kHz mono. <code>audioUrl</code> is SSRF-guarded
            (public HTTPS, no redirects, size/time caps).
          </li>
          <li>
            Recording is linked on the call row — <code>GET .../recording</code> and <code>.../transcribe</code> work
            after a successful blast.
          </li>
          <li>
            STT needs <code>STT_ENABLED=true</code>, <code>STT_API_URL</code> (e.g.{' '}
            <code>https://api.groq.com/openai</code>), <code>STT_API_KEY</code>. Optional <code>STT_MODEL</code> /
            <code>STT_LANGUAGE</code>.
          </li>
          <li>
            HTTP stays open until the blast finishes — raise client timeouts for long WAVs. See Scalar{' '}
            <ExternalLink href="/docs">/docs</ExternalLink> (Calls tag).
          </li>
        </ul>
      </>
    ),
  },

  groups: {
    title: 'Groups',
    description: 'Create, participants, invites and settings.',
    body: (
      <>
        <p>
          Full CRUD under <code>/v1/instances/:name/groups</code>: create, metadata, leave, subject/description,
          invite-code, participants add/remove, promote/demote, picture, settings (announcement, restrict, ephemeral…).
        </p>
        <p>
          Detailed reference: <a href="/guide/api/Groups">Groups API</a>.
        </p>
      </>
    ),
  },

  errors: {
    title: 'Errors & codes',
    description: 'Standard envelope and HTTP codes.',
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
              <th>Meaning</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>UNAUTHORIZED</td>
              <td>401</td>
              <td>Missing/invalid key</td>
            </tr>
            <tr>
              <td>FORBIDDEN</td>
              <td>403</td>
              <td>No access to instance / not admin</td>
            </tr>
            <tr>
              <td>NOT_FOUND</td>
              <td>404</td>
              <td>Resource does not exist</td>
            </tr>
            <tr>
              <td>CONFLICT</td>
              <td>409</td>
              <td>e.g. duplicate instance name</td>
            </tr>
            <tr>
              <td>VALIDATION_ERROR</td>
              <td>400</td>
              <td>Invalid Zod body/query</td>
            </tr>
            <tr>
              <td>BAD_REQUEST</td>
              <td>400</td>
              <td>Business rule</td>
            </tr>
            <tr>
              <td>SERVICE_UNAVAILABLE</td>
              <td>503</td>
              <td>Session not open / dependency</td>
            </tr>
          </tbody>
        </table>
      </>
    ),
  },

  faq: {
    title: 'FAQ',
    description: 'Common integration questions.',
    body: (
      <>
        <h3 id="q-polling">Do I need to poll calls?</h3>
        <p>
          No. Use <code>/v1/voip</code> for signaling. REST list/get call is fallback/debug.
        </p>

        <h3 id="q-typing">Why don’t I see typing on SSE /events?</h3>
        <p>
          Call <code>presence/subscribe</code> for the JID (and keep the session available). LID vs PN is expanded on
          the server.
        </p>

        <h3 id="q-three-events">Why 3 message events?</h3>
        <p>
          Compatibility: <code>message</code>, <code>message.any</code> and alias <code>message.inbound</code>. Filter
          with the webhook allow-list.
        </p>

        <h3 id="q-swagger">Where is interactive OpenAPI?</h3>
        <p>
          <ExternalLink href="/docs">/docs</ExternalLink> (Scalar). This guide is the rich narrative layer.
        </p>

        <h3 id="q-storage">Call recording 404?</h3>
        <p>
          Storage must be configured and <code>storageReady: true</code>. Enable <code>call-recording</code> on the
          instance (softphone) or use <code>POST .../calls/blast</code> with <code>recordResponse: true</code>.
        </p>

        <h3 id="q-blast">How do I play a WAV and get the answer transcribed?</h3>
        <p>
          <code>POST /v1/instances/:name/calls/blast</code> with <code>audioUrl</code> (public HTTPS WAV). Set{' '}
          <code>STT_*</code> env for inline Whisper STT, or call <code>POST .../calls/:callId/transcribe</code> later.
          Details on the <a href="/guide/voip#blast">VoIP</a> page.
        </p>

        <h3 id="q-wam">What is WAM / how do I turn it off?</h3>
        <p>
          WAM is WhatsApp Web client-side analytics (<code>w:stats</code>) for wire parity with a real browser tab — not
          zapo-rest app metrics. It is <strong>on by default</strong> via <code>@zapo-js/wam</code>. To disable: set{' '}
          <code>WAM_ENABLED=false</code> and restart the process. See <a href="/guide/architecture#wam">Architecture</a>
          .
        </p>

        <h3 id="q-instance-path">Do I need the instance name on every URL?</h3>
        <p>
          With the <strong>admin key</strong>, yes — use <code>/v1/instances/:name/...</code>. With an{' '}
          <strong>instance key</strong>, you may omit the name: resources under <code>/v1/messages/...</code>,{' '}
          <code>/v1/chats</code>, etc., and lifecycle under <code>/v1/instance/...</code> (singular). Named paths remain
          valid. See <a href="/guide/auth#scope">Authentication</a>.
        </p>
      </>
    ),
  },
}
