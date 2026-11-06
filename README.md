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
| Voice & video calls | **WebSocket** control + live PCM stream (`@zapo-js/voip`); a second WS carries H.264 (1:1 and group, upgrade mid-call, screen share) — not a second events bus |
| Media | Local or S3/MinIO/R2 with **CAS dedup**, rehydrate-from-WA, optional auto-download |
| Ops UI | Dashboard for QR, chat, send tester, webhooks, softphone |

Not affiliated with WhatsApp/Meta. Independent gateway for engineering and interoperability.

### Design advantages (summary)

You do **not** need to open another file to see why this stack is shaped this way. Same summary lives in the
[guide → Why zapo-rest](https://rafaelsantana6.github.io/zapo-rest/why) page. Longer narrative for operators:
[`docs/DESIGN-DECISIONS.md`](docs/DESIGN-DECISIONS.md).

**At a glance**

- **Cheaper media** — CAS dedup (SHA-256 per instance); forwards/stickers do not multiply objects
- **Recoverable media** — missing object re-downloads from WhatsApp; an expired CDN blob (404/410) asks the sender to re-upload once
- **Reliable webhooks** — persist chat first, outbox + retries, HMAC, no double-fire on redelivery
- **Right realtime** — SSE for app events; WebSocket only for VoIP
- **Modern WA identity** — LID ↔ PN map + reconcile (no split history)
- **Ops-friendly boot** — HTTP listens before long reconnect/reconcile (healthchecks stay green)
- **WA Web wire parity** — WAM telemetry (`@zapo-js/wam`) on by default; set `WAM_ENABLED=false` to disable
- **Instance from API key** — instance-key clients may omit `:name` (`/v1/messages/...`, `/v1/instance`); admin always names the target
- **@handle and late group history** — send to `@handle`; members who join a group later still receive shared history (`HISTORY_GROUP_BUNDLES`)
- **Synced chat settings** — successful actions and phone app-state update Postgres; mute expiration is reflected on reads; durable action metadata preserves deletions and newer settings across mailbox imports/replays
- **Video on its own binary channel** — H.264 frames never share the PCM socket; a lagging viewer drops to the next key frame instead of growing server memory or blocking audio

| Decision | Benefit |
| -------- | ------- |
| **Content-addressed media (CAS)** — `{instance}/cas/sha256/{hash}{ext}` | Same bytes inside one instance are stored **once**. Less object storage; stable identity. |
| **Rehydrate from WhatsApp** if the object is missing | Media stays recoverable after storage loss; 404 only when WA itself cannot provide the file. |
| **Expired CDN blob → sender re-upload** | History media WhatsApp already dropped (404/410) is fetched once from the sender's phone, then stored. A primary that re-encrypts on reupload fails fast instead of retrying forever. |
| **302 + presigned GET** | Clients download from S3/R2 directly; the API is not a permanent bandwidth middleman. |
| **Two-stage media events** (`mediaStage: meta` → `stored`) | Fast “message arrived”, then permanent URL after CAS (`message.media.stored`). |
| **Persist projections before webhooks** | Chat store stays consistent even if a receiver is down; outbox retries separately. |
| **`processed_events` claim** | Protocol redelivery does not double-fire side-effects. |
| **SSE for app events / WS for VoIP only** | Right tool per job; no fragile general events WebSocket. |
| **Header API keys preferred** | Keys out of access logs, proxies, and `Referer`. |
| **Instance inferred from API key** (dual routes) | Named `/v1/instances/:name/...` always works; short `/v1/...` and `/v1/instance/...` for instance keys. Admin must pass `:name`. |
| **Per-session serial queue** | No races on message upsert, ack, and presence for a given instance. |
| **LID ↔ PN map + reconcile** | Modern WhatsApp identities without split chat history. |
| **Listen before long WA boot** | Docker/Swarm healthchecks stay green while reconnect + lid reconcile run in the background. |
| **WAM telemetry** (`@zapo-js/wam`, default on) | Client-side `w:stats` batches like a real WA Web tab — wire parity / less “headless” fingerprint. Disable with `WAM_ENABLED=false`. |
| **Group history bundles** (`HISTORY_GROUP_BUNDLES`, default on) | History a member shares after you join lands in projections. A third party triggers the download — set `false` to skip it. |
| **Chat settings projected from app-state** | Pin/mute/lock match phone changes; timed mute reads expire without a new event. Durable cutoffs/settings survive mailbox imports; clear/delete preserve newer messages and empty cleared chats stay listed. |
| **Video on a dedicated WS, drop-until-keyframe backpressure** | `.../calls/:callId/video` never blocks or slows the PCM stream; when a viewer lags, frames are dropped until the next key frame — bounded memory, no stale video. |

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
| Only set **`STORE_L1_CACHE=true`** with a single process or sticky sessions per instance | The L1 cache sits in front of the Postgres Signal session/identity rows — unsafe across replicas without sticky routing |
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
| Instance | `apiKey` on list/get/create/rotate (plaintext) | That instance only |

Headers (preferred):

```http
X-Api-Key: <key>
# or
Authorization: Bearer <key>
```

Query `?apiKey=` is supported only as a **fallback** for native `EventSource` and some browser WebSocket clients. Prefer headers everywhere else (avoids keys in access logs / proxies / Referer).

### Instance scope (dual paths)

| Who | Path |
| --- | ---- |
| **Admin** | Always name the instance: `/v1/instances/:name/...` (short form without name → **400**) |
| **Instance key** | Named **or** short form — target is inferred from the key |

Short form examples (instance key):

```http
POST /v1/messages/text          # same as POST /v1/instances/:name/messages/text
GET  /v1/instance               # same as GET  /v1/instances/:name
POST /v1/instance/connect       # same as POST /v1/instances/:name/connect
```

Lifecycle short form uses singular `/v1/instance` so it never collides with the admin collection `/v1/instances`.

---

## Realtime: SSE + VoIP WebSocket

| Channel | Transport | Purpose |
| ------- | --------- | ------- |
| App events | **SSE** `GET /v1/events` | messages, connection, presence, chatstate, calls metadata, … |
| VoIP control | **WS** `/v1/voip` | signaling (offer/accept/reject/…) |
| Call audio | **WS** `.../calls/:callId/stream` | bidirectional PCM (Float32 LE, 16 kHz mono) |
| Call video | **WS** `.../calls/:callId/video` | H.264 Annex-B, 12-byte header |

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

In-call hand raise (`POST .../calls/:callId/hand`, WS `call:hand`) and emoji reactions (`POST .../calls/:callId/reaction`, WS `call:reaction`) round-trip to the peer as `call.peer_mute`, `call.hand_raise`, and `call.reaction` (webhook + WS). The call snapshot adds `peerAudioMuted`, `handRaised`, and `raisedHands`.

Video: `isVideo: true` on 1:1 and group calls; an audio call upgrades with `POST .../calls/:callId/video/upgrade` (the peer's own request arrives as `call.video_state` with `upgradeRequested: true`), a group camera toggles with `.../video`, and `.../screen-share` swaps the camera for the screen. Frames ride `.../calls/:callId/video`, one `streamId` per sender (`stream_end` when it leaves). Control WS: `call:video_upgrade`, `call:video_upgrade_accept|reject|cancel`, `call:video`, `call:screen_share`. Events: `call.video_state`, `call.video_upgraded`, `call.screen_share` (WS `call:screen_share_changed`). `mediaType` reads `video` once a 1:1 call upgraded. The dashboard softphone tests and switches the camera and shares the screen.

Group calls: `POST .../calls` with `groupId` + `participants` (resolved to LIDs; `400` with `details.missing` otherwise) instead of `to`. `POST .../calls/:callId/leave` (WS `call:leave`), `.../join` (WS `call:join`) and `.../participants/mute` (WS `call:mute_participant`). Roster and media changes arrive as `call.participants_changed`, `call.mute_requested`, and `call.participant_media`; the snapshot adds `isGroup`, `groupJid`, and `participants`.

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

`HISTORY_GROUP_BUNDLES=true` (default) does the same for a bundle another member shares after this account joins a group (`history.group`). Send one with `POST .../groups/:groupId/share-history` when the account has `group_history_send`.

### WAM telemetry (session wire parity)

WhatsApp Web clients send analytics batches on the `w:stats` channel (**WAM**). zapo-rest attaches [`@zapo-js/wam`](https://zapo.to/guides/wam) on every session **by default** so the wire footprint is closer to a real browser tab (protocol events + synthetic UI telemetry). This is **not** your app’s metrics and does **not** change the public API.

| Env | Default | Effect |
| --- | ------- | ------ |
| `WAM_ENABLED` | `true` | Load `wamPlugin()` next to VoIP when creating each `WaClient` |
| `WAM_ENABLED=false` | — | No WAM plugin; quieter headless footprint |
| `WA_DEVICE_BROWSER` / `WA_DEVICE_OS` | unset (Firefox + host OS) | Companion identity sent at pairing (e.g. `Chrome` / `Windows`); re-pair to apply |

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
- **Chat actions** — pin/unpin, mute/unmute (ISO or duration; forever by default), lock/unlock, clear with starred preservation, synced chat delete and delete-message-for-me; reads include `pinned` (numeric), `muted`, `muteUntil`, `locked`
- **Contacts** — list, check exists, about, profile picture, blocklist, BR 9th-digit aware resolve
- **Groups** — create, metadata, invite, participants, promote/demote, picture; admin/member permissions to add members, share invite links, and share history
- **Group join requests** — list, approve/reject, cancel our requests; `membership_approval_mode` toggle; notifications through `group.update`
- **Communities** — create/deactivate, metadata, sub-group link/unlink/join, merged participants, suggestions and ownership transfer; community flags also appear in group reads
- **Profile / presence / privacy / status stories / labels / lids**
- **Webhooks** — multi-config, HMAC-SHA512, exponential retries, custom headers
- **Realtime SSE** + **VoIP WebSocket**
- **Dashboard** + **OpenAPI** + narrative **guide** at `/guide`

Member modes use explicit `/settings/...` routes with `{ mode }`; boolean settings keep `{ enabled }` at `/settings/:setting`. Invalid modes return 400 with accepted values, unknown groups 404, and WhatsApp admin denials 403. Reads omit modes WhatsApp does not report (or values outside the supported enums); the original `memberShareGroupHistoryMode` metadata field remains for compatibility. `historyShareMode` governs who may send history bundles; `HISTORY_GROUP_BUNDLES` controls receiving them. Phone changes to add mode arrive on `group.update` as `action: "member_add_mode"`, `mode`, and `memberAddMode`. zapo-js 1.11.0 does not decode link/history mode notifications; use metadata reads for those changes. See the [groups guide](https://rafaelsantana6.github.io/zapo-rest/guide/groups).

Parity matrices: [`docs/API-COVERAGE.md`](docs/API-COVERAGE.md), [`docs/FEATURE-MAP-FULL.md`](docs/FEATURE-MAP-FULL.md).

---

## Main endpoints

Named paths work for **admin** and **instance** keys. With an **instance** key you may also drop the name (short form).

```http
# Instances (admin collection)
POST/GET /v1/instances

# Instance lifecycle — named (admin must use this)
GET/DELETE /v1/instances/:name
POST /v1/instances/:name/connect|disconnect|restart
GET /v1/instances/:name/qr
# Instance lifecycle — short (instance key only)
GET  /v1/instance
POST /v1/instance/connect|disconnect|restart
GET  /v1/instance/qr

# Messages — named or short
POST /v1/instances/:name/messages/{text,reply,image,…}
POST /v1/messages/{text,reply,image,…}          # instance key

# Own profile (push name, avatar, @handle) — instance key + short paths
PUT /v1/profile/name
PUT /v1/profile/image                           # JSON mediaUrl|mediaBase64 OR multipart -F file=@…
DELETE /v1/profile/image                        # alias: /profile/picture
GET/PUT/DELETE /v1/profile/username
GET /v1/profile/username/check?username=loja
POST /v1/profile/username/resolve               # { "username": "@loja" }

# Group member modes — instance key; changing these requires group admin
PUT /v1/groups/:groupId/settings/member-add-mode     # { "mode": "admin_add" | "all_member_add" }
PUT /v1/groups/:groupId/settings/member-link-mode    # { "mode": "admin_link" | "all_member_link" }
PUT /v1/groups/:groupId/settings/history-share-mode  # { "mode": "admin_share" | "all_member_share" }
GET /v1/groups/:groupId                            # group.memberAddMode, memberLinkMode, historyShareMode
GET /v1/groups                                    # same fields in groups[]

# Group history shared with members who joined later (subject to historyShareMode)
POST /v1/groups/:groupId/share-history          # { "to": ["@lid-or-phone"], "count": 50 }
GET  /v1/groups/:groupId/membership-requests   # { requests: [{ jid, requestedAt, ... }] }
POST /v1/groups/:groupId/membership-requests/approve # { "participants": ["phone-or-jid"] }
POST /v1/groups/:groupId/membership-requests/reject  # { "participants": ["phone-or-jid"] }
POST /v1/groups/:groupId/membership-requests/cancel  # own pending requests only
PUT  /v1/groups/:groupId/settings/membership_approval_mode # { "enabled": true }
POST /v1/communities                           # { "subject": "My community", "description": "..." }
GET  /v1/communities/:communityId              # { community } (full group metadata)
DELETE /v1/communities/:communityId            # deactivate → { ok: true }
GET  /v1/communities/:communityId/subgroups    # { communityJid, announcementGroup, subGroups }
GET  /v1/communities/:communityId/participants # { participants } (merged across linked groups)
GET  /v1/communities/:communityId/subgroups/suggestions?hint=:groupId
POST /v1/communities/:communityId/subgroups/link   # { "groups": ["120363...@g.us"] }
POST /v1/communities/:communityId/subgroups/unlink # { "groups": ["120363..."], "removeOrphanedMembers": true }
POST /v1/communities/:communityId/subgroups/:groupId/join # optional { "type": "..." } → { ok: true }
POST /v1/communities/:communityId/owner         # { "user": "phone, JID, LID or @handle" }

# Chats / history — named or short
GET /v1/instances/:name/chats
GET /v1/chats                                   # instance key
GET /v1/instances/:name/chats/:chatId/messages
POST /v1/instances/:name/chats/:chatId/messages/read
POST /v1/instances/:name/chats/:chatId/history-sync
POST /v1/chats/:chatId/pin                     # { "pinned": true }
POST /v1/chats/:chatId/mute                    # { "muted": true, "durationSeconds": 3600 } or "until": ISO
POST /v1/chats/:chatId/lock                    # { "locked": true }
POST /v1/chats/:chatId/clear                   # { "deleteStarred": false, "deleteMedia": false }
POST /v1/chats/:chatId/delete                  # { "deleteMedia": false }; synced account deletion
DELETE /v1/chats/:chatId                       # legacy local chat projection only; messages kept
DELETE /v1/chats/:chatId/messages/:messageId/for-me # optional ?deleteMedia=true; recipients keep copies

# Realtime SSE (prefer header auth)
GET /v1/events?instance=optional
X-Api-Key: …

# VoIP remains WebSocket
# /v1/voip · /v1/calls/:id/stream  (instance key; ?apiKey= for browsers)
# /v1/calls/:id/video — H.264, one stream id per sender; also on audio calls (they can upgrade)
# POST /v1/instances/:name/calls/blast
# POST /v1/instances/:name/calls/:id/transcribe

# In-call hand raise / reactions — named or short
POST /v1/calls/:callId/hand                     # { "raised": true }
POST /v1/calls/:callId/reaction                 # { "reaction": "👍" }

# Group calls — named or short
POST /v1/calls                                  # { "groupId": "1203…@g.us", "participants": ["5511…"] }
POST /v1/calls/:callId/leave
POST /v1/calls/:callId/join
POST /v1/calls/:callId/participants/mute        # { "participant": "…@lid" }

# Video — named or short (frames on /v1/calls/:id/video)
POST /v1/calls                                  # { "to": "5511…", "isVideo": true }  (or groupId + participants)
POST /v1/calls/:callId/video/upgrade            # audio → video; → { "result": "accepted" | … }
POST /v1/calls/:callId/video/upgrade/accept     # also /reject, /cancel
POST /v1/calls/:callId/video                    # { "enabled": true } — group camera
POST /v1/calls/:callId/screen-share             # { "sharing": true }
```

Community and sub-group ids accept bare digits or `@g.us` JIDs, including legacy hyphenated
group JIDs such as `5511999999999-1234567890@g.us`. Creation also accepts
`membershipApprovalMode` (`open` / `request_required`, default `request_required`),
`allowNonAdminSubGroupCreation` and `createGeneralChat`. Link/unlink return the upstream
`result` with `linkedJids` / `unlinkedJids` and per-group `failed` entries (`jid`, `error`):
HTTP 200 can contain partial failures. Existing-community operations verify parent metadata
first (404 for unknown communities or ordinary groups). Sub-group listing, suggestions and
ownership transfer require the upstream MEX transport (503 when absent). Recognized MEX
query failures return 502 with a static public message; IQ failures keep their existing
status mapping. Join accepts an optional request body and acknowledges success; read
`GET /v1/groups/:groupId` for the joined group's metadata. The existing `group.update`
webhook/SSE event preserves `action: link | unlink | linked_group_promote | linked_group_demote`,
`linkedGroups` (`jid`, `subject`, `subjectTimestampSeconds`, `hiddenSubgroup`) and
`contextGroupJid` when upstream supplies them.


Full contract: `/docs` or `pnpm openapi:export` → `openapi.json`.

### Media inputs (URL · base64 · multipart)

Avatar, message media (`image|video|audio|document|sticker`), status, group picture, and call blast accept **one** of:

| Input | How |
| ----- | --- |
| Public HTTPS URL | JSON `mediaUrl` (blast: `audioUrl`) |
| Base64 | JSON `mediaBase64` |
| File upload | `multipart/form-data` field `file` (aliases: `media`, `audio`, …) |

Max size: env `MEDIA_UPLOAD_MAX_BYTES` (default 100 MiB; Fastify `bodyLimit` matches). In Scalar `/docs`, media routes **default to multipart/form-data** with a **file** picker (JSON still available). Profile/group avatars are re-encoded server-side to compact JPEG (≤640px) before WhatsApp.

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
 voip/ PCM + H.264 video bridge, recording
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
