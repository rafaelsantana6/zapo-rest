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
