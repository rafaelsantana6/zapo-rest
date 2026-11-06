# Design decisions (why zapo-rest is built this way)

Short list of **intentional engineering choices** that show up in production cost, reliability, and integrator experience.

**Public summaries (keep in sync — do not force readers to open this file):**

| Surface | Location |
| ------- | -------- |
| README | **Design advantages (summary)** |
| Guide SPA / GitHub Pages | `/why` (and feature pages: media, webhooks, architecture, …) |

When adding a new decision here, update those summaries too (see `AGENTS.md` → *Design surface triad*).

Narrative guide: `/guide/architecture`. Ops guarantees: [`PRODUCTION-CONSISTENCY.md`](./PRODUCTION-CONSISTENCY.md).

Not affiliated with WhatsApp/Meta.

---

## At a glance

| Choice | What you gain |
| ------ | ------------- |
| **CAS media** (SHA-256 per instance) | Storage savings when the same bytes are resent/forwarded; stable object identity |
| **Rehydrate from WA** if object missing | Recoverable media without re-pair; 404 only when WhatsApp itself cannot provide the file |
| **302 + presigned GET** | API does not proxy every media byte; clients hit S3/MinIO/R2 directly when possible |
| **Two-stage media webhooks** (`meta` → `stored`) | Fast “message arrived” + later permanent URL after CAS; bots can wait for `message.media.stored` |
| **Upsert projections** (not pure event-sourcing) | Natural edits/acks/revokes; simple list/query APIs |
| **`processed_events` claim** | Side-effects (webhooks) fire once even if the protocol redelivers |
| **Webhook outbox** + HMAC-SHA512 | At-least-once delivery, durable retries, multi-URL configs, verifiable payloads |
| **SSE for app events / WS for VoIP only** | Right transport: one-way live feed vs bidirectional audio |
| **Header auth preferred** | Keys stay out of access logs, proxies, and `Referer` |
| **Instance inferred from API key** (dual routes) | Instance-key clients omit `:name` in the URL; admin always names the target |
| **Per-session serial queue** | No races on message upsert, ack, and presence for a given instance |
| **LID ↔ PN map + reconcile** | Modern WhatsApp identities without duplicate chat threads |
| **Listen before WA boot** | Healthchecks stay green while reconnect/reconcile run in the background |
| **WAM telemetry** (`@zapo-js/wam`, default on) | Wire parity with real WhatsApp Web analytics (`w:stats`) — better session fingerprint |
| **Contract-first OpenAPI** | Scalar `/docs`, exportable `openapi.json`, guide SPA, GitHub Pages |
| **Video on its own WS, drop-until-keyframe backpressure** | H.264 never blocks or shares the PCM socket; a lagging viewer drops to the next key frame — bounded memory, no stale video |

---

## Instance scope: dual paths + key inference

**Decision:** every instance-scoped REST route is mounted **twice**:

| Form | Example | Who |
| ---- | ------- | --- |
| **Named** | `/v1/instances/:name/messages/text` | Admin (required) and instance key (optional explicit) |
| **Short resource** | `/v1/messages/text` | Instance key only (name inferred from the key) |
| **Short lifecycle** | `/v1/instance`, `/v1/instance/connect` | Instance key only (singular `instance` so it never collides with collection `/v1/instances`) |

Resolution is centralized in `resolveInstanceName(request, nameFromParams?)`:

1. Path has `name` → `requireInstanceAccess` (instance key may only hit its own name).
2. Path has no `name` + **instance** actor → use `actor.instanceName`.
3. Path has no `name` + **admin** → **400** (`Instance name is required when using the admin API key…`).

**Why**

- Integrators with a single session should not repeat the instance name on every URL once they already hold that instance’s API key.
- Admins manage many sessions: forcing `:name` avoids accidental cross-tenant operations and keeps multi-tenant scripts explicit.
- Keeping the named path forever preserves backward compatibility (dashboard, OpenAPI samples, existing clients).

**Trade-off:** OpenAPI lists both URLs for the same handler (slightly larger surface). Lifecycle short form uses singular `/v1/instance` on purpose — not `/v1/instances` without a name.

**Code:** `src/auth/plugin.ts` (`resolveInstanceName`, `scopedInstancePaths`, `scopedSelfPaths`); multi-URL expansion at bootstrap in `src/app.ts` (`enableMultiUrlRoutes` — Fastify 5 only accepts one string URL per registration).

---

## Session wire parity: WAM telemetry

**Decision:** every `WaClient` loads the optional plugin [`@zapo-js/wam`](https://zapo.to/pt-br/guides/wam) **by default**. It emits the client-side analytics batches (`w:stats`) that a real WhatsApp Web tab sends after login — protocol lifecycle events plus plausible synthetic UI telemetry.

**Why**

- Headless multi-session gateways look different on the wire without Web analytics traffic.
- WAM is **not** app observability and does **not** change REST, SSE, media, or VoIP contracts.
- Upstream covers auto-emit of real protocol events and optional synthetic UI; we keep plugin defaults (install-and-forget).

**Disable**

```bash
WAM_ENABLED=false
```

Default is `true` when unset. Restart the API process after changing the env (plugins are attached when the session client is created).

**Trade-off:** slightly more outbound traffic to WhatsApp analytics endpoints; disable only if you want a quieter footprint or are debugging plugin interaction.

Env: `WAM_ENABLED`. Wired in `src/instances/client-factory.ts` next to `voipPlugin`.

---

## Media: content-addressed storage (CAS)

**Decision:** store media under  
`{instanceName}/cas/sha256/{hash}{ext}`  
where `hash` is SHA-256 of the bytes. Same payload inside one instance → **same key, no rewrite** (`deduped: true`).

**Why**

- Forwards, stickers, and repeated documents do not multiply object storage cost.
- Extension is type-derived (mime/filename suffix), not the original display name — direct storage URLs open with the correct type; original name lives on the message row for downloads / `Content-Disposition`.
- Instances do **not** share objects: wipe/delete instance removes `{name}/…` only (isolation + multi-tenant hygiene).

**Also**

- Prefer **302** to storage (presigned or public base URL) over streaming through Node.
- If the object is gone, **re-download from WhatsApp**, re-store, then serve — not a silent permanent failure.
- If that download gets CDN **404/410** (blob expired, typical of history), ask the sender's phone to re-upload **once** (`requestMediaReupload`) and download the new `directPath`. The media key and hashes normally stay valid, but some primaries re-encrypt on reupload instead — that `media MAC mismatch` / `file hash mismatch` is final (`media reupload re-encrypted: ...` → `message.media.failed`, no retry, since nothing in the reupload answer carries the new key). `not_found` stops; transient errors still use the 5× backoff.
- Private R2/S3 API hosts are not exposed as browser `mediaUrl` (not fetchable); fall back to the authenticated API media path.

Env: `MEDIA_STORAGE`, `MEDIA_AUTO_DOWNLOAD`, S3/MinIO/R2 vars. See guide **Media** and README.

---

## Reliability pipeline

```
WA stanza → session queue → decode + LID map
  → upsert app_messages / app_chats (persist first)
  → claim processed_events
  → optional media download → CAS put
  → webhook outbox enqueue (non-blocking)
  → RealtimeBus → SSE subscribers
```

| Mechanism | Role |
| --------- | ---- |
| **Session queue** | One serial chain per instance — ordering and race safety |
| **Upsert by natural keys** | Edits/acks use `GREATEST(ack)` and flags on the same row |
| **`processed_events`** | Short-lived ledger so webhooks/side-effects are not double-fired |
| **Outbox worker** | Atomic claim (`pending` → `sending`), retry/backoff, stale requeue |
| **HMAC-SHA512** | Integrators verify authenticity (`X-Webhook-Hmac` / `…-Sha512`) |

Webhooks support **multiple URLs** per instance, event allow-lists (`message`, `message.any`, media stages, calls, …), custom headers, and exponential retries.

---

## Realtime split (do not drift)

| Need | Transport | Auth note |
| ---- | --------- | --------- |
| App events (messages, connection, presence, …) | **SSE** `GET /v1/events` | Prefer `X-Api-Key` / Bearer |
| VoIP signaling + live PCM | **WebSocket** only | Query `apiKey` OK for browsers |

Dashboard uses `fetch` + stream for SSE so the key stays in **headers**, not the query string.

---

## Identity: LID and phone number

WhatsApp uses `@lid` and `@s.whatsapp.net`. zapo-rest:

- Maintains **`lid_map`** (including **batched** upserts on large history/reconcile paths)
- Prefers PN in projections when known
- Expands aliases on presence/subscribe
- Exposes **`POST .../chats/reconcile-lids`** to merge duplicate threads

Without this, integrators see split history and broken typing/presence.

---

## Group history bundles

**Decision:** `HISTORY_GROUP_BUNDLES` defaults **on**. A bundle another member shares after this account joins a group is downloaded, copied into `app_*`, and emitted as `history.group`.

**Why**

- Without it, someone who enters a group later has an empty thread here even when WhatsApp delivered the backfill.
- zapo leaves the download off because a **third party** triggers it. The env flag is the off switch for operators who do not want that fetch.

Sending (`POST .../groups/:id/share-history`) stays explicit and fails when the account lacks `group_history_send`.

---

## Video calls: dedicated binary WebSocket

**Decision:** video (`isVideo: true` on `POST .../calls` / `call:start`) rides a **second** WebSocket,
`GET .../calls/:callId/video`, separate from the PCM audio stream. Every binary frame — both
directions — is a fixed **12-byte header** (version, key-frame flag, reserved, big-endian
microsecond timestamp) followed by one raw H.264 Annex-B access unit; no JSON envelope, no
base64. When a client falls behind (`bufferedAmount` over 4 MiB), the server **drops frames
until the next key frame** instead of queuing. The peer has no way to request a key frame
through this API, so the client is expected to emit an IDR at least every second (the dashboard
encoder: 350 kbps, 480×360, 1 s GOP — numbers from `pnpm test:call-quality`, see below).

**Why**

- A single multiplexed socket would let a slow video consumer apply backpressure to audio —
  unacceptable for a voice call that happens to also carry video. Two sockets keep the failure
  domains apart: video can degrade or stall while audio keeps flowing.
- Annex-B + a fixed binary header is copy-free on both ends and hands the browser's WebCodecs
  `EncodedVideoChunk` API bytes it can use directly — no JSON/base64 inflation or parsing on a
  media-rate channel.
- Real-time video without RTCP means the receiver cannot signal "send me a key frame now" (PLI/FIR).
  Periodic IDRs (client-side) plus server-side drop-until-keyframe are the two mitigations available
  without implementing that feedback path.

**Trade-off:** two WebSocket connections per video call instead of one; the server cannot ask the
peer (or the local encoder) for an out-of-band key frame, so recovery after loss waits for the next
scheduled IDR (up to ~1 s); video is not written to the WAV call recording (audio-only).

**Measured (call harness, `tests/call-harness/`):** because nothing retransmits and nobody can ask
for a key frame, one lost packet spoils video until the next IDR. On Wi-Fi-like loss (0.2%), 600 kbps
with a 2 s GOP froze for 1.8 s. 350 kbps with a 1 s GOP froze for 0.8 s. On a 450 kbps uplink the old
settings delivered no decodable frames, and the new ones deliver 15 fps. The harness also found that
`@zapo-js/voip` 1.1.0 never flagged WhatsApp-packed IDRs as key frames; `@zapo-js/voip-media` 0.3
(voip 1.4) fixed it upstream, so the bridge now trusts `frame.keyFrame`.

**Group video (voip 1.4):** a group call delivers one H.264 stream per sender. The header's 2-byte
stream id (reserved before, so 1:1 clients keep working with id `0`) keeps each sender on its own
decoder; a JSON `stream` message names the participant first. Rejected alternative: one socket per
participant — more connections, and the set of senders changes mid-call.

**Code:** `src/voip/video-frame.ts` (framing + RTP timestamp unwrap), `src/voip/call-video-stream.ts`
(bridge to `client.voip.feedLiveVideo` / `voip_call_inbound_video`), `src/routes/calls.ts`
(`GET .../calls/:callId/video`).

---

## Startup and ops

- **`app.listen()` before** full WA auto-connect + large `lid_map` reconcile — so Docker/Swarm healthchecks do not kill the task during long boot.
- **Rate limit** on `/v1` in production (configurable).
- **CORS** locked down by default in production (`CORS_ORIGINS`).
- **No secrets in logs** (API keys, HMAC, Signal material).
- OpenAPI UI + guide are **unauthenticated by design** — put network ACL in front in production.

---

## What we deliberately do *not* do

| Avoid | Reason |
| ----- | ------ |
| Pure event-sourcing for app chat API | Harder edits/acks; worse “latest message” UX |
| General events WebSocket | SSE is enough for server→client; WS reserved for VoIP |
| Reimplement Noise/Signal/stanza here | Fix upstream [zapo-js](https://github.com/vinikjkkj/zapo), then bump |
| Multi-replica shared live sessions without sticky routing | Sessions are process-local today |

---

## Where this is documented

| Audience | Doc |
| -------- | --- |
| Visitors / stars | [README](../README.md) · [Guide (Pages)](https://rafaelsantana6.github.io/zapo-rest/) |
| Integrators | Guide `/architecture`, `/media`, `/webhooks`, `/realtime` |
| Operators | [`PRODUCTION-CONSISTENCY.md`](./PRODUCTION-CONSISTENCY.md) |
| Contributors / agents | [`AGENTS.md`](../AGENTS.md) · this file |

---

## Permissions-Policy: camera, mic and screen for the same origin

**Decision:** `Permissions-Policy: camera=(self), microphone=(self), display-capture=(self), geolocation=()`.
The dashboard softphone needs the camera and screen capture for video calls; `camera=()` blocked
them even when the user allowed them in the browser.

**Trade-off:** the dashboard, the API docs (Scalar) and the guide share one origin, so any page
there may *ask* for the camera or the screen. The browser still prompts the user, and other-origin
iframes stay blocked; it only matters with an XSS on this origin. Serve the dashboard on its own
origin, or tighten the header at the reverse proxy, if that is a concern.

**Code:** `src/plugins/security-headers.ts`.

## Chat app-state actions and projections

**Decision:** new pin/mute/lock/clear/delete routes call the typed `client.chat` coordinator first, then persist the matching projection. Connection failures return 503; other upstream app-state failures return 409. The manager also forwards inbound `mutation` events to the processor, which persists settings before `chat.update`. Omitted upsert fields preserve existing settings. Timed mute is computed on reads because zapo does not emit another mutation on expiration; forever uses its documented year-9999 convention.

**Compatibility:** existing numeric `pinned` and `muteEndMs` stay available; `muted`, ISO `muteUntil` and `locked` are additive. Existing `DELETE /chats/:chatId` deletes only a local chat row; `POST /chats/:chatId/delete` synchronizes account deletion and removes local messages/aliases. Clear preserves starred rows by default, and previews are recalculated. zapo constructs the message range from its mailbox; callers do not supply last-message metadata.

**Trade-off:** WhatsApp and Postgres cannot share a transaction. A DB failure after upstream success requires resync. Media deletion flags are forwarded to zapo; CAS objects are retained for storage retention policies. Phone clear/delete ranges preserve newer messages. No event names or transports are added.

### Durable chat action projection state

The zapo mailbox retains messages and historical thread flags after sending chat mutations. Physical removal from `app_messages` alone would therefore be undone by the next mailbox import. `app_chat_actions` stores clear/delete cutoffs, intentional empty-chat retention, and authoritative settings with per-field timestamps; `app_message_actions` stores individual deletion markers and stars even before a message is materialized. Every message upsert checks these records; history derives its preview only from messages actually materialized. LID/PN aliases share decisions through `lid_map`, and merged listing reads authoritative settings independently of the alias supplying the newest message.

REST clear/delete capture their boundary before network I/O and preserve newer messages, retaining the chat when those remain. Mutation timestamps (milliseconds, not the schema `version`) order each collection/index in `app_state_projection_cursors`. Stale events are ignored before projection, while the current timestamp can retry after partial failure. These records survive restart and webhook-ledger pruning and are removed with the instance. They add Postgres metadata and lookup work; the mailbox stays untouched and older messages with unknown timestamps are conservatively suppressed after a clear/delete cutoff.

Materialization and destructive actions take a transaction-scoped advisory lock per instance **before** reading decisions, on the same connection and transaction as the projection writes. This matches the existing session queue granularity and avoids alias lock-order races. A lock inside the INSERT CTE would be too late: PostgreSQL READ COMMITTED would retain the statement's older snapshot and allow a concurrent deletion to be bypassed. Clear/delete refresh or remove chat projections in that same transaction. This adds transaction round-trips and serializes REST/background materialization for one instance, while different instances remain independent. Late LID→PN rekey uses the same transaction lock, enforces destination cutoffs/stars before moving rows and rebuilds previews from surviving messages. Individual GET applies authoritative alias settings too, and a setting older than an active delete cannot recreate the chat; a later intentional action can.
