<h1 align="center">zapo-rest</h1>

<p align="center">
 <strong>Multi-session REST API for WhatsApp</strong>, powered by
 <a href="https://github.com/vinikjkkj/zapo">zapo-js</a>.<br />
 Instances, messages, media, webhooks, live VoIP, history sync, and a built-in dashboard —
 with a clean <code>/v1</code> contract for multi-session WhatsApp.
</p>

<p align="center">
 <a href="#quick-start-docker"><img src="https://img.shields.io/badge/quick%20start-docker-0ea5e9?style=flat-square" alt="Quick start" /></a>
 <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-22c55e?style=flat-square" alt="MIT" /></a>
 <a href="https://semver.org/"><img src="https://img.shields.io/badge/semver-0.x-f59e0b?style=flat-square" alt="SemVer" /></a>
 <a href="package.json"><img src="https://img.shields.io/badge/node-%3E%3D24.18-339933?style=flat-square&logo=node.js&logoColor=white" alt="Node" /></a>
 <a href="https://github.com/vinikjkkj/zapo"><img src="https://img.shields.io/badge/engine-zapo--js-CB3837?style=flat-square" alt="zapo-js" /></a>
 <a href="#realtime-sse--voip-websocket"><img src="https://img.shields.io/badge/events-SSE-8b5cf6?style=flat-square" alt="SSE" /></a>
</p>

<p align="center">
 📚 <a href="https://rafaelsantana6.github.io/zapo-rest/"><strong>Guide (GitHub Pages)</strong></a>
 · 📐 <a href="https://rafaelsantana6.github.io/zapo-rest/docs/"><strong>Scalar API</strong></a>
 · 📖 <a href="#documentation"><strong>Docs</strong></a>
 · 🛠 <a href="CONTRIBUTING.md"><strong>Contributing</strong></a>
 · 🔐 <a href="SECURITY.md"><strong>Security</strong></a>
 · 💛 <a href="https://github.com/sponsors/vinikjkkj"><strong>Sponsor zapo</strong></a>
</p>

---

## Why zapo-rest?

[zapo-js](https://github.com/vinikjkkj/zapo) is a high-performance TypeScript implementation of the WhatsApp Web protocol. **zapo-rest** wraps it as an HTTP product you can deploy — with choices aimed at **cost, reliability, and a clean multi-session contract**, not just “expose every method”.

| You get | Details |
| ------- | ------- |
| Multi-session | Many WhatsApp numbers in one process, each with its own API key |
| REST + OpenAPI | Fastify 5, Zod validation, Scalar at `/docs` (+ [public Pages](https://rafaelsantana6.github.io/zapo-rest/docs/)) |
| Durable chat store | Upsert projections in Postgres (edits/acks/revokes on the same row) |
| Reliable webhooks | Multi-URL configs, HMAC-SHA512, durable **outbox** + retries |
| Live events | **SSE** `GET /v1/events` (server → client; prefer header auth) |
| Voice calls | **WebSocket** control + live PCM stream (`@zapo-js/voip`) — not a second events bus |
| Media | Local or S3/MinIO/R2 with **CAS dedup**, rehydrate-from-WA, optional auto-download |
| Ops UI | Dashboard for QR, chat, send tester, webhooks, softphone |

Not affiliated with WhatsApp/Meta. Independent gateway for engineering and interoperability.

### Design advantages (summary)

You do **not** need to open another file to see why this stack is shaped this way. Same summary lives in the
[guide → Why zapo-rest](https://rafaelsantana6.github.io/zapo-rest/why) page. Longer narrative for operators:
[`docs/DESIGN-DECISIONS.md`](docs/DESIGN-DECISIONS.md).

**At a glance**

- **Cheaper media** — CAS dedup (SHA-256 per instance); forwards/stickers do not multiply objects
- **Recoverable media** — missing object re-downloads from WhatsApp, then re-stores
- **Reliable webhooks** — persist chat first, outbox + retries, HMAC, no double-fire on redelivery
- **Right realtime** — SSE for app events; WebSocket only for VoIP
- **Modern WA identity** — LID ↔ PN map + reconcile (no split history)
- **Ops-friendly boot** — HTTP listens before long reconnect/reconcile (healthchecks stay green)
- **WA Web wire parity** — WAM telemetry (`@zapo-js/wam`) on by default; set `WAM_ENABLED=false` to disable

| Decision | Benefit |
| -------- | ------- |
| **Content-addressed media (CAS)** — `{instance}/cas/sha256/{hash}{ext}` | Same bytes inside one instance are stored **once**. Less object storage; stable identity. |
| **Rehydrate from WhatsApp** if the object is missing | Media stays recoverable after storage loss; 404 only when WA itself cannot provide the file. |
| **302 + presigned GET** | Clients download from S3/R2 directly; the API is not a permanent bandwidth middleman. |
| **Two-stage media events** (`mediaStage: meta` → `stored`) | Fast “message arrived”, then permanent URL after CAS (`message.media.stored`). |
| **Persist projections before webhooks** | Chat store stays consistent even if a receiver is down; outbox retries separately. |
| **`processed_events` claim** | Protocol redelivery does not double-fire side-effects. |
| **SSE for app events / WS for VoIP only** | Right tool per job; no fragile general events WebSocket. |
| **Header API keys preferred** | Keys out of access logs, proxies, and `Referer`. |
| **Per-session serial queue** | No races on message upsert, ack, and presence for a given instance. |
| **LID ↔ PN map + reconcile** | Modern WhatsApp identities without split chat history. |
| **Listen before long WA boot** | Docker/Swarm healthchecks stay green while reconnect + lid reconcile run in the background. |
| **WAM telemetry** (`@zapo-js/wam`, default on) | Client-side `w:stats` batches like a real WA Web tab — wire parity / less “headless” fingerprint. Disable with `WAM_ENABLED=false`. |

---

## Stability notice

> `zapo-rest` is currently **`0.x`**. The public surface follows SemVer intent: we document breaks in [`CHANGELOG.md`](CHANGELOG.md). From `1.0.0`, breaking changes ship only in a major release.

Underlying engine: use a current [`zapo-js`](https://www.npmjs.com/package/zapo-js) release (see `package.json`).

---

## Production checklist

Use this before exposing the stack beyond localhost. Deeper pipeline guarantees live in [`docs/PRODUCTION-CONSISTENCY.md`](docs/PRODUCTION-CONSISTENCY.md).

### Must do

| Check | Why |
| ----- | --- |
| Strong **`ADMIN_API_KEY`** (`openssl rand -hex 24`, ≥ 16 chars) | Full admin access; compose default is for demo only |
| Unique Postgres / Redis / MinIO (or S3) credentials | Compose uses `zapo` / `minioadmin` — **never** on a public host |
| **HTTPS** at a reverse proxy | Browser, webhooks, and keys in transit |
| Network ACL or auth in front of **`/docs`** and **`/guide`** | OpenAPI + guide are **unauthenticated** by design |
| Prefer **header** API keys (`X-Api-Key` / `Bearer`) | `?apiKey=` leaks into access logs / proxies / Referer |
| Single API process **or** sticky sessions per instance | Live WA sessions are process-local (no multi-replica share yet) |
| Durable volumes for Postgres (+ object storage) | Projections, outbox, media CAS |

### Strongly recommended

| Check | Why |
| ----- | --- |
| Set **`CORS_ORIGINS`** if the UI is on another host | Production default is same-origin only (no open CORS) |
| Tune **`RATE_LIMIT_*`** (app limits `/v1` in production) | Defaults: 300 req / 60s / IP; also rate-limit at the reverse proxy |
| Private media bucket + presigned GET | Compose may set anonymous download on MinIO for local convenience |
| Leave **`WAM_ENABLED=true`** (default) unless you must quiet analytics | Emits WA Web `w:stats` for wire parity; `false` turns the plugin off |
| Rotate instance keys after staff changes | `POST /v1/instances/:name/keys/rotate` |
| Pin image digests (already in `docker-compose.yml`) | Reproducible deploys; override only deliberately |

### Compose knobs (dev → less-bad demo)

```bash
export ADMIN_API_KEY="$(openssl rand -hex 24)"
export MINIO_ROOT_USER="zapo-s3"
export MINIO_ROOT_PASSWORD="$(openssl rand -hex 16)"
docker compose up --build
```

Do **not** treat that as a full production setup — still put a proxy, TLS, and ACL in front.

---

## Quick start (Docker)

### Published images (releases)

On each `v*.*.*` tag, CI publishes multi-arch-ready images to **Docker Hub** and **GHCR**:

```bash
# Docker Hub (recommended)
docker pull rafaelsantana6/zapo-rest:0.1.0
docker pull rafaelsantana6/zapo-rest:latest

# GitHub Container Registry
docker pull ghcr.io/rafaelsantana6/zapo-rest:0.1.0
```

Tags: `latest`, `X.Y.Z`, `X.Y`, `X` (no `latest` on pre-releases).

### Compose (local build)

Minimum path to a running stack (API + Postgres + Redis + MinIO).  
**Local/demo only** — compose defaults are weak on purpose. See [Production checklist](#production-checklist) before any public host.

```bash
git clone https://github.com/rafaelsantana6/zapo-rest.git
cd zapo-rest
cp .env.example .env
# set ADMIN_API_KEY to at least 16 characters (openssl rand -hex 24)

export ADMIN_API_KEY="$(openssl rand -hex 24)"
docker compose up --build
```

| Service | URL |
| ------- | --- |
| API + dashboard | http://localhost:3000 |
| Scalar | http://localhost:3000/docs |
| Guide SPA | http://localhost:3000/guide/ |
| Health | http://localhost:3000/health |
| MinIO API | http://localhost:19000 |
| MinIO console | http://localhost:19001 (default `minioadmin` / `minioadmin` — **dev only**) |

Create an instance and fetch a QR:

```bash
export BASE=http://localhost:3000
export KEY='your-ADMIN_API_KEY'

curl -s -X POST "$BASE/v1/instances" \
 -H "X-Api-Key: $KEY" -H 'content-type: application/json' \
 -d '{"name":"sales-1"}'

curl -s "$BASE/v1/instances/sales-1/qr" -H "X-Api-Key: $KEY"
```

---

## Local development

Requirements: **Node ≥ 24.18**, pnpm (Corepack), Docker for dependencies, **ffmpeg** on `PATH` (media), native deps for `@roamhq/wrtc` (VoIP).

```bash
cp .env.example .env
docker compose up -d postgres redis minio minio-init

pnpm install
pnpm --dir dashboard install

pnpm dev
# optional:
pnpm --dir dashboard dev # Vite :5173 → proxies /v1 + VoIP WS
pnpm --dir docs-site dev # guide SPA
```

Useful checks:

```bash
pnpm format          # Biome format check
pnpm lint            # Biome lint
pnpm typecheck
pnpm test
pnpm test:coverage
pnpm test:e2e
pnpm openapi:export
```

---

## Authentication

| Key | Source | Scope |
| --- | ------ | ----- |
| Admin | `ADMIN_API_KEY` env (≥ 16 chars) | All instances |
| Instance | `apiKey` returned on create | That instance only |

Headers (preferred):

```http
X-Api-Key: <key>
# or
Authorization: Bearer <key>
```

Query `?apiKey=` is supported only as a **fallback** for native `EventSource` and some browser WebSocket clients. Prefer headers everywhere else (avoids keys in access logs / proxies / Referer).

---

## Realtime: SSE + VoIP WebSocket

| Channel | Transport | Purpose |
| ------- | --------- | ------- |
| App events | **SSE** `GET /v1/events` | messages, connection, presence, chatstate, calls metadata, … |
| VoIP control | **WS** `/v1/voip` | signaling (offer/accept/reject/…) |
| Call audio | **WS** `.../calls/:callId/stream` | bidirectional PCM (Float32 LE, 16 kHz mono) |

SSE example (header auth):

```bash
curl -N -H "X-Api-Key: $KEY" -H "Accept: text/event-stream" \
 "$BASE/v1/events?instance=sales-1"
```

```js
const res = await fetch(`${BASE}/v1/events?instance=sales-1`, {
 headers: { 'X-Api-Key': KEY, Accept: 'text/event-stream' },
})
// read res.body with TextDecoder — avoid native EventSource if you can set headers
```

> General event streaming used to be discussed as WebSocket in older drafts.
> **Current code is SSE-only for app events.** VoIP remains WebSocket because it is bidirectional.

---

## Architecture decisions

### Message storage: upsert projection (not full event-sourcing)

| Approach | Pros | Cons |
| -------- | ---- | ---- |
| Event-sourcing ledger | Perfect audit trail, true replay | High write amp, hard edits/acks, awkward “latest message” queries |
| **Upsert projection (multi-config)** ✅ | Simple API, natural edits/acks/deletes | Not a full audit log |

**What we do:**

1. **zapo mailbox** (`mailbox_*`) — protocol store via `@zapo-js/store-postgres`
2. **App projections** (`app_messages`, `app_chats`, `app_contacts`) — decoded rows upserted by natural keys
3. **Idempotency ledger** (`processed_events`) — short-lived keys so webhook side-effects fire once
4. **Webhook outbox** — durable delivery with retries / HMAC

### History on QR pair

`HISTORY_SYNC_ENABLED=true` (default). zapo processes history notifications; we mirror mailbox → `app_*` and emit `history.sync` webhooks. On-demand: `POST.../chats/:chatId/history-sync`.

### WAM telemetry (session wire parity)

WhatsApp Web clients send analytics batches on the `w:stats` channel (**WAM**). zapo-rest attaches [`@zapo-js/wam`](https://zapo.to/guides/wam) on every session **by default** so the wire footprint is closer to a real browser tab (protocol events + synthetic UI telemetry). This is **not** your app’s metrics and does **not** change the public API.

| Env | Default | Effect |
| --- | ------- | ------ |
| `WAM_ENABLED` | `true` | Load `wamPlugin()` next to VoIP when creating each `WaClient` |
| `WAM_ENABLED=false` | — | No WAM plugin; quieter headless footprint |

Restart the process after changing the env. Details: [`docs/DESIGN-DECISIONS.md`](docs/DESIGN-DECISIONS.md) · guide [Architecture](https://rafaelsantana6.github.io/zapo-rest/architecture) / [FAQ](https://rafaelsantana6.github.io/zapo-rest/faq).

### Media (CAS + rehydrate)

`MEDIA_STORAGE=local|s3` with standard S3 env vars. Auto-download inbound media when `MEDIA_AUTO_DOWNLOAD=true`.

| Behavior | Detail |
| -------- | ------ |
| **Dedup** | Content-addressed **per instance** (`…/cas/sha256/{hash}{ext}`). Identical payloads share one object. |
| **Isolation** | Instances never share keys — delete instance removes `{name}/…` only. |
| **Serve** | Prefer **302** to storage (presigned/public URL) instead of proxying every byte. |
| **Missing object** | Re-download from WhatsApp, re-store, then deliver; 404 only if WA can no longer provide the file. |
| **Webhooks** | Stage 1 `message` with `mediaStage: "meta"`; stage 2 `message.media.stored` / `.failed` after CAS. |

See [`docs/DESIGN-DECISIONS.md`](docs/DESIGN-DECISIONS.md) and the [guide Media page](https://rafaelsantana6.github.io/zapo-rest/media).

### Redis

Optional (`REDIS_URL`). Cache + pub/sub fanout. Falls back to in-memory when unset.

---

## Feature overview

- **Instances** — create / connect / disconnect / QR / pairing / restart / delete / rotate key
- **Messages** — text, reply, image, video, audio, document, sticker, location, poll, react, edit, revoke, contact, forward, star/unstar
- **Chats** — list, messages, read, archive, delete, history-sync
- **Contacts** — list, check exists, about, profile picture, blocklist, BR 9th-digit aware resolve
- **Groups** — create, metadata, invite, participants, promote/demote, picture
- **Profile / presence / privacy / status stories / labels / lids**
- **Webhooks** — multi-config, HMAC-SHA512, exponential retries, custom headers
- **Realtime SSE** + **VoIP WebSocket**
- **Dashboard** + **OpenAPI** + narrative **guide** at `/guide`

Parity matrices: [`docs/API-COVERAGE.md`](docs/API-COVERAGE.md), [`docs/FEATURE-MAP-FULL.md`](docs/FEATURE-MAP-FULL.md).

---

## Main endpoints

```http
# Instances
POST/GET /v1/instances
GET/DELETE /v1/instances/:name
POST /v1/instances/:name/connect|disconnect|restart
GET /v1/instances/:name/qr

# Messages
POST /v1/instances/:name/messages/{text,reply,image,video,audio,document,sticker,location,poll,react,edit,revoke}

# Chats / history
GET /v1/instances/:name/chats
GET /v1/instances/:name/chats/:chatId/messages
POST /v1/instances/:name/chats/:chatId/messages/read
POST /v1/instances/:name/chats/:chatId/history-sync

# Realtime SSE (prefer header auth)
GET /v1/events?instance=optional
X-Api-Key: …

# VoIP remains WebSocket
# /v1/voip · /v1/instances/:name/calls/:id/stream
```

Full contract: `/docs` or `pnpm openapi:export` → `openapi.json`.

### Webhooks (multi-config)

```bash
curl -s -X POST "$BASE/v1/instances/sales-1/webhooks" \
 -H "X-Api-Key: $KEY" -H 'content-type: application/json' \
 -d '{
 "url": "https://webhook.site/xxx",
 "events": ["message", "instance.connection"],
 "hmac": { "key": "super-secret" },
 "retries": { "policy": "exponential", "delaySeconds": 2, "attempts": 5 },
 "customHeaders": [{ "name": "X-Source", "value": "zapo-rest" }]
 }'
```

Envelope:

```json
{
 "id": "01H…",
 "event": "message",
 "instance": "sales-1",
 "timestamp": 1710000000000,
 "engine": "zapo",
 "payload": {}
}
```

HMAC headers: `X-Webhook-Hmac` / `X-Webhook-Hmac-Sha512` (hex SHA-512 of body).

### BR nono dígito / JID

Same idea as local createJid + batch usync variants:

```bash
curl -s -X POST "$BASE/v1/instances/sales-1/contacts/resolve" \
 -H "X-Api-Key: $KEY" -H 'content-type: application/json' \
 -d '{"numbers":["5568981159096","5511999999999"]}'
```

Outbound sends resolve the correct JID automatically (cache + usync).

---

## Project layout

```text
src/
 auth/ admin + instance API keys
 instances/ multi-session WaClient manager
 events/ decode + processor + realtime bus (SSE)
 store/ app_* projections + processed_events
 webhooks/ multi-config + outbox
 media/ local + S3
 routes/ Fastify + Zod OpenAPI (+ events-sse, voip-ws)
 voip/ PCM bridge + recording
dashboard/ Vite + React UI
docs-site/ Guide SPA (/guide)
docs/ parity maps, design notes, review artifacts
tests/ unit · integration · e2e
```

---

## Documentation

| Resource | Description |
| -------- | ----------- |
| **[Guide (GitHub Pages)](https://rafaelsantana6.github.io/zapo-rest/)** | Public product guide (pt / en / es) — architecture, auth, webhooks, VoIP, FAQ |
| **[Scalar (GitHub Pages)](https://rafaelsantana6.github.io/zapo-rest/docs/)** | Interactive OpenAPI reference (static; same contract as a running API) |
| `/docs` | Interactive OpenAPI (Scalar) on a running API |
| `/guide` | Same guide SPA when `docs-site` is built into the Docker image |
| [`docs/DESIGN-DECISIONS.md`](docs/DESIGN-DECISIONS.md) | Deep dive on **why** (CAS, outbox, SSE, LID, …) |
| **[Why / advantages (guide)](https://rafaelsantana6.github.io/zapo-rest/why)** | Same summary as README — no need to open the MD |
| [`CONTRIBUTING.md`](CONTRIBUTING.md) | Setup, PR rules, SemVer |
| [`AGENTS.md`](AGENTS.md) | Architecture contract for contributors & agents |
| [`docs/API-COVERAGE.md`](docs/API-COVERAGE.md) | other multi-session APIs parity |
| [`docs/CODE-REVIEW.md`](docs/CODE-REVIEW.md) | Massive review snapshot |
| [`docs/TEST-COVERAGE.md`](docs/TEST-COVERAGE.md) | Coverage status & gaps |
| [`docs/PRODUCTION-CONSISTENCY.md`](docs/PRODUCTION-CONSISTENCY.md) | Pipeline guarantees + production ops |
| [zapo.to](https://zapo.to/) | Upstream zapo-js guides |

---

## Versioning

Semantic Versioning on the root package:

| Bump | Meaning |
| ---- | ------- |
| **patch** | Bug fixes, docs, internal refactors |
| **minor** | Backward-compatible features / endpoints |
| **major** | Breaking HTTP, auth, or env contract |

```bash
# after updating CHANGELOG.md [Unreleased]
pnpm version patch # or minor / major
git push && git push --tags
```

CI builds on every PR. Tagged releases (`v*.*.*`) create a GitHub Release and push
container images to **Docker Hub** (`rafaelsantana6/zapo-rest`) and **GHCR**
(`ghcr.io/rafaelsantana6/zapo-rest`). Repo secrets required: `DOCKERHUB_USERNAME`,
`DOCKERHUB_TOKEN` (Docker Hub access token).

---

## Credits

This project stands on **[zapo](https://github.com/vinikjkkj/zapo)** / **[zapo-js](https://www.npmjs.com/package/zapo-js)** by **[vinikjkkj](https://github.com/vinikjkkj)** — a lightweight, high-performance TypeScript library for the WhatsApp Web protocol (multi-session scale, Signal, media, app state).

- Documentation: [zapo.to](https://zapo.to/)
- Sponsor the engine: [github.com/sponsors/vinikjkkj](https://github.com/sponsors/vinikjkkj)

Optional packages used here: `@zapo-js/store-postgres`, `@zapo-js/media-utils`, `@zapo-js/voip`, `@zapo-js/fake-server` (tests).

---

## Contributing

Pull requests are welcome. See [`CONTRIBUTING.md`](CONTRIBUTING.md) for the full workflow.

Contributors also agree to the [Code of Conduct](CODE_OF_CONDUCT.md), including the **AI-Assisted Contributions** policy (disclosure, human ownership, no prompt-injection).

---

## Security

Found an auth, multi-tenancy, or secret-handling issue? **Do not open a public issue.** Follow [`SECURITY.md`](SECURITY.md).

Protocol/crypto issues in the engine belong upstream: [zapo security policy](https://github.com/vinikjkkj/zapo/blob/master/SECURITY.md).

---

## License

[MIT](LICENSE) © Rafael Santana.

The WhatsApp protocol implementation is provided by **zapo-js** under its own MIT license © vinikjkkj. This application is **not affiliated with or endorsed by WhatsApp / Meta**.

---

## Disclaimer

Use this software in accordance with WhatsApp’s terms and applicable law. You are solely responsible for how you operate instances, store messages, and contact end users. The authors provide the software “as is”, without warranty.
