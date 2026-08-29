# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Dependencies

- **Runtime**: `zapo-js` 1.8.0 → [1.8.1](https://github.com/vinikjkkj/zapo/releases/tag/v1.8.1) (#95) —
  upstream fixes only, no API changes: retry ladder now reaches count 3 before the placeholder
  resend (vinikjkkj/zapo#262), the streaming sidecar is skipped for non-streamable mp4
  (vinikjkkj/zapo#263), and stored history messages resolve the author from the top-level
  participant (vinikjkkj/zapo#264).

## [0.8.0] - 2026-08-21

### Security

- **`@fastify/multipart` 10.1.0 → 10.1.1** — fixes [GHSA-62qx-hpj5-j6hc](https://github.com/fastify/fastify-multipart/security/advisories/GHSA-62qx-hpj5-j6hc)
  and [GHSA-vmph-573x-85f6](https://github.com/fastify/fastify-multipart/security/advisories/GHSA-vmph-573x-85f6),
  both on the multipart path this gateway uses for media and avatar uploads (#92).

### Changed

- **Trust proxy no longer uses a hop count.** `fastify@5.12.1` stopped honouring a numeric
  `trustProxy` and now fails closed, because a hop count cannot validate the immediate peer
  and a directly-connected client could spoof `X-Forwarded-*` by supplying enough hops.
  Left as-is, `X-Forwarded-*` would have been silently ignored: `request.ip` would resolve to
  the proxy's address, collapsing every client behind the proxy into a **single rate-limit
  bucket** (`@fastify/rate-limit` keys on `request.ip`) and recording the proxy in request
  logs. `TRUST_PROXY` now resolves through `resolveTrustProxy()` instead (#92).

  | Config | Behaviour |
  | ------ | --------- |
  | `TRUST_PROXY=false` | Trust nothing — `X-Forwarded-*` ignored |
  | `TRUST_PROXY=true` + `TRUST_PROXY_CIDRS` set | Trust only those proxy IPs/CIDRs; the immediate peer is validated |
  | `TRUST_PROXY=true`, no CIDRs | Trust any peer |

### Added

- **`TRUST_PROXY_CIDRS`** — comma-separated proxy IPs/CIDRs to trust, e.g.
  `10.0.0.0/8,172.16.0.0/12`. Preferred over the old hop count: it validates the immediate
  peer, so `X-Forwarded-*` cannot be spoofed by a client connecting directly (#92).

### Deprecated

- **`TRUST_PROXY_HOPS`** — still parsed so existing deployments keep booting, but no longer
  reaches Fastify and has no effect. Set `TRUST_PROXY_CIDRS` instead. **Deployments relying on
  a hop count now trust any peer by default** — set `TRUST_PROXY_CIDRS` to restore a validated
  allowlist (#92).

### Dependencies

- **Runtime**: `zapo-js` 1.5.0 → 1.8.0 · `@zapo-js/store-postgres` 1.0.2 → 1.2.0 ·
  `fastify` 5.5.0 → 5.12.0 · `@fastify/swagger` 9.5.1 → 9.8.1 · `@fastify/static` 10.1.0 → 10.1.3 ·
  `@fastify/rate-limit` 11.1.0 → 11.2.0 · `@scalar/fastify-api-reference` 1.62.5 → 1.66.1 ·
  `@aws-sdk/*` 3.1085.0 → 3.1115.0 · `pg` 8.16.3 → 8.23.0 · `file-type` 22.0.1 → 22.0.2
- **Dev**: `@biomejs/biome` 2.1.1 → 2.5.9 · `@zapo-js/fake-server` 1.0.0 → 1.3.0 ·
  `tsc-alias` 1.8.16 → 1.9.2 · `ws` 8.18.2 → 8.21.3 · `@types/node` 26.1.1 → 26.2.0 ·
  `@types/pg` 8.15.4 → 8.23.1 · `tsx` 4.23.1 → 4.23.12
- **Frontends**: `react`/`react-dom` 19.1.0 → 19.2.8 · `vite` 8.1.4 → 8.2.2 ·
  `@vitejs/plugin-react` 5.2.0 → 6.1.0 (dashboard) · `react-router-dom` 7.6.2 → 7.18.2 ·
  `tailwindcss` 4.1.8 → 4.3.3
- **CI**: `actions/setup-node` v6 → v7 · `actions/upload-pages-artifact` v3 → v5 ·
  `actions/deploy-pages` v4 → v5

  The `@aws-sdk/client-s3` and `@aws-sdk/s3-request-presigner` bumps had to land together —
  split across separate PRs their types diverged and `src/media/storage.ts` failed to
  typecheck (#88).

### Internal

- Dependabot now opens **one grouped PR per ecosystem per week**, split by patch/minor vs
  major, capped so a new PR cannot open while its group's previous one is still open. Replaces
  the one-PR-per-dependency flood that had reached 22 open PRs (#88, #91).

## [0.7.2] - 2026-07-14

### Fixed

- **Multipart avatar upload (502)**: raise Fastify `bodyLimit` to `MEDIA_UPLOAD_MAX_BYTES`
  (was 1 MiB default — large multipart uploads failed at the edge). Profile/group picture
  set now re-encodes uploads to compact JPEG via sharp before WhatsApp IQ; WA rejections
  return **400** with a clear message instead of opaque **502** `WA_IQ_FAILED`
  (#55).

### Changed

- **Scalar Try It**: all media routes list `multipart/form-data` first with binary `file` +
  `encoding` so the docs UI shows a file picker by default (JSON still available)
  (#55).

## [0.7.1] - 2026-07-14

### Changed

- **OpenAPI / guide**: media routes advertise `multipart/form-data` with binary `file`
  (Scalar file picker) alongside JSON; guide (pt/en/es), README, and swagger intro document
  URL · base64 · multipart. Regenerated `openapi.json` for short paths + 0.7.x surface
  (#53).

## [0.7.0] - 2026-07-14

### Added

- **Multipart media uploads** on POST/PUT media routes: profile/group avatar,
  messages (image/video/audio/document/sticker), status media, and call blast.
  Accept `mediaUrl`, `mediaBase64`, or `multipart/form-data` field `file` (aliases
  `media` / `audio` / …). Cap via env `MEDIA_UPLOAD_MAX_BYTES` (default 100 MiB)
  (#51).

## [0.6.0] - 2026-07-14

### Changed

- **Avatars prefer full-res**: own-profile sync and picture notifications follow
  env `AVATAR_FETCH_TYPES` (`both` default = download `image` then `preview`;
  also `image` / `preview` only). Instance/`GET /profile` `avatarUrl` prefers
  stored full-res over preview. On-demand still uses
  `GET .../profile-picture?type=preview|image` (default `preview` for lists)
  (#49).

### Fixed

- **`GET /v1/profile` aligned with instance enrichment**: uses bare PN JID for
  status/picture IQs (device suffix breaks WA), and returns the same
  `pushName` / `avatarUrl` path as `GET /v1/instance` (#49).

## [0.5.0] - 2026-07-14

### Changed

- **Breaking (0.x):** Operational routes no longer accept `/v1/instances/:name/...`.
  Session methods require an **instance API key** and use short paths (`/v1/messages/...`,
  `/v1/instance/connect`, …). Admin key is limited to create/list/delete/rotate under
  `/v1/instances` (+ `DELETE` / `.../keys/rotate` with `:name`) (#47).
- **pushName / avatarUrl** on list/get: resolve display name from `meDisplayName` as well
  as `pushName`, and revalidate own avatar from WhatsApp (TTL + durable storage) (#47).

## [0.4.0] - 2026-07-14

### Added

- **Profile push name + avatar**: `PUT /v1/profile/name` (and named path) updates
  WhatsApp display name (`setPushName`); `PUT /v1/profile/image` (alias
  `/profile/picture`) sets the avatar from `mediaUrl` or `mediaBase64`. Also
  `DELETE /v1/profile/image|picture`. Short form works with instance API key (#45).
- **Instance inference from API key (dual routing)**: instance-scoped routes
  accept both `/v1/instances/:name/...` (admin + explicit) and a short form
  without the name (`/v1/...` for resources, `/v1/instance/...` for lifecycle).
  With an **instance** API key the target is inferred from the key. With the
  **admin** API key the name is **required** (short form without name → 400).
  Documented in DESIGN-DECISIONS, README, guide `auth`/`why`/`quickstart`/`faq`
  (pt/en/es), FEATURE-MAP, and OpenAPI description (#45).

### Changed

- **Instance API keys are plaintext end-to-end**: stored as `instances.api_key`
  (`NOT NULL`, unique), **always** returned on list/get/create/rotate (never
  null/omitted), and used for auth via direct lookup (no `api_key_hash`).
  Also returns `pushName` and `avatarUrl` when known. Upgrade mints new keys
  for any row that still lacked plaintext after the hash-era drop (#45).

## [0.3.0] - 2026-07-14

### Added

- **Audio blast + STT**: `POST /v1/instances/:name/calls/blast` places an outbound
  VoIP call, plays a WAV from `audioUrl`, optionally records the remote leg, and
  can transcribe via Groq/OpenAI-compatible Whisper (`STT_*` env).  
  `POST /v1/instances/:name/calls/:callId/transcribe` re-transcribes an existing
  call recording. `audioUrl` is SSRF-guarded; empty compose `STT_API_URL` is safe.
  Guide VoIP/FAQ (pt/en/es), OpenAPI/Scalar, unit/integration/e2e tests (#43).

## [0.2.0] - 2026-07-13

### Added

- Optional WhatsApp Web **WAM** telemetry (`@zapo-js/wam`) on every session for
  wire parity / anti-fingerprinting. **Enabled by default**; set
  `WAM_ENABLED=false` to disable. Does not change REST/SSE/VoIP contracts.
  Documented in README, `docs/DESIGN-DECISIONS.md`, and guide `/why` +
  `/architecture` + FAQ (pt/en/es).
- GitHub Pages deploy for the product guide SPA (`docs-site`) at
  https://rafaelsantana6.github.io/zapo-rest/ and static Scalar OpenAPI at
  https://rafaelsantana6.github.io/zapo-rest/docs/ (workflow `docs-pages.yml`;
  `DOCS_BASE` for project-site path; guide header links to GitHub + Scalar).
- Documented production-facing design choices (CAS media dedup, webhook
  outbox, SSE vs VoIP WS, LID map, …) in `docs/DESIGN-DECISIONS.md`, README
  **Design advantages (summary)**, and guide page `/why` (+ architecture/media/webhooks).
- AGENTS.md *Design surface triad*: keep DESIGN-DECISIONS + README summary +
  guide `why`/feature pages in sync when shipping material design wins.
- Track `docs/*.md` in git (removed accidental root `.gitignore` entry `docs`
  that hid DESIGN-DECISIONS, PRODUCTION-CONSISTENCY, coverage notes, etc.).

## [0.1.4] - 2026-07-13

### Fixed

- Startup no longer awaits WA auto-connect + lid reconcile before
  `app.listen()` — Docker Swarm healthchecks were killing the task as
  unhealthy while `mailbox_contacts` reconcile ran for minutes (API never
  bound `:3000`).
- Lid map bootstrap uses batched `lid_map` multi-row upserts instead of
  one `save()` per contact pair.

## [0.1.3] - 2026-07-13

### Fixed

- Webhooks filtered to `message` only never received stage-2 media events
  (`message.media.stored` / `message.media.failed`) after CAS download, so
  receivers only saw the instant meta payload without a permanent storage
  URL. Subscribing to `message` now also matches those media stage-2 events.
  Legacy instance `webhookEvents` uses the same matcher.
- Media URL after CAS: private R2/S3 API hosts are not used as `mediaUrl`
  (not browser-fetchable); fall back to the authenticated API media path.
- History import: `WaContactStore` has no `list()` (zapo-js / store-postgres) —
  import no longer throws `contactStore?.list is not a function`; falls back to
  reading `mailbox_contacts` via the shared Postgres pool.
- Thread import: stop using `threadStore.list()` as a truthiness probe (double
  call); check `typeof list === 'function'` first.
- Boot: pre-run `@zapo-js/store-postgres` migrations serially so concurrent
  first writes do not race `CREATE TABLE IF NOT EXISTS` →
  `pg_type_typname_nsp_index` write-behind errors.
- Migrate log: applying schema from disk is `info` (warn only for inline
  fallback).

## [0.1.2] - 2026-07-13

### Fixed

- VoIP call PCM stream auth: instance API keys were compared against the
  masked `***` field after hashing-at-rest, so non-admin softphones always
  got `4403 forbidden` on `/calls/:id/stream` — accept hung forever and the
  peer kept ringing. Auth now uses the same hash lookup as the rest of `/v1`.
- Softphone: reject when the audio WS closes before `ready` (no more hung
  Promise); accept signaling runs before opening the stream so the peer stops
  ringing even if audio setup is slow.
- VoIP control WebSocket (`/v1/voip`): register `message` handlers
  **synchronously** so client frames (`call:start`, `call:accept`, …) are not
  dropped while auth/attach await (softphone timeouts with no server log).
- Accept (REST + VoIP WS) no longer awaits full `acceptCall` / SCTP
  `connectRelays` before ack — fire-and-forget after optimistic `connecting`
  so the softphone does not hang on Atender.
- Softphone: optimistic UI on Atender (connecting immediately), no phase
  regression back to `incoming_ringing` from stale snapshots; longer
  `call:start` timeout for usync + media init.
- Dashboard static assets: `@fastify/static` wildcard + no SPA HTML fallback
  for `.js`/`.css` (rebuilds without restart no longer get wrong MIME).
- OpenAPI `CallInfo`: nullable duration/endReason and related fields so live
  call snapshots validate; empty reject/end bodies coerce to `{}`.

### Changed

- Call recording starts only **after answer** (`connecting` / `active` /
  `on_hold`). Ring/dial only writes history with `recording_status: none`
  (no empty/ring WAVs for unanswered calls).

## [0.1.1] - 2026-07-13

### Changed

- Release workflow publishes container images to **Docker Hub**
  (`rafaelsantana6/zapo-rest`) in addition to GHCR; supports
  `workflow_dispatch` to re-publish an existing tag.
- Docker Hub repository overview enriched with GitHub links, docs,
  env notes, and OCI image labels; synced via
  `scripts/sync-dockerhub-readme.sh` + `docker/DOCKERHUB.md` on each release.
- Consolidated dependency bumps (Dependabot batch): `zapo-js` 1.5,
  Fastify plugins (`multipart`/`static`/`fastify-plugin`), `file-type` 22,
  `sharp` 0.35, TypeScript 7 + `@types/node` 26, dashboard/docs-site Vite
  stack, Actions `checkout@v7` / `pnpm/action-setup@v6`. docs-site now uses
  pnpm lockfile. `tsconfig` paths updated for TypeScript 7 (no `baseUrl`).
- CI Actions bumped to Node 24 runtimes (`build-push-action@v7`, etc.).

## [0.1.0] - 2026-07-12

First public release of **zapo-rest**: multi-session WhatsApp gateway over
[zapo-js](https://github.com/vinikjkkj/zapo).

### Added

- Multi-session REST API (`/v1` contract) over zapo-js.
- Instance lifecycle: create, connect, QR, pairing, restart, delete,
  rotate API key.
- Messages: text, reply, image, video, audio, document, sticker, location,
  poll, react, edit, revoke, contact, forward.
- Chats, contacts (BR 9th digit / batch resolve), groups, labels, lids,
  presence, privacy, profile, status/stories.
- Upsert projections (`app_messages`, `app_chats`, `app_contacts`) +
  `processed_events` idempotency ledger + webhook outbox (HMAC-SHA512,
  multi-config).
- History sync on pair + on-demand `POST .../chats/:chatId/history-sync`.
- Media storage: local filesystem or S3-compatible (MinIO/R2/AWS); CAS
  storage, presigned redirect downloads, WhatsApp rehydrate on missing object.
- Two-stage media realtime (mode A): `message` fires immediately with
  `mediaStage: "meta"`; after CAS store (or failure) the gateway emits
  `message.media.stored` / `message.media.failed` (also on SSE). History
  imports still skip these side-effects.
- Optional Redis cache with in-memory fallback.
- Realtime **SSE** at `GET /v1/events` (prefer `X-Api-Key` header).
- VoIP: control WebSocket `/v1/voip` + live PCM stream + optional recording.
- Dashboard (Vite/React) and docs guide SPA (`/guide`, `pt-BR` / `en` / `es`)
  + Swagger/Scalar (`/docs`).
- Docker Compose stack: API + Postgres + Redis + MinIO.
- Open-source scaffolding: `LICENSE`, `CODE_OF_CONDUCT.md`,
  `CONTRIBUTING.md`, `SECURITY.md`, `AGENTS.md`, GitHub CI/templates,
  expanded README.
- SemVer release guidance and `pnpm version` workflow documentation.
- **Coverage sprints 0–5:** EventProcessor, outbox HMAC, SSE auth matrix,
  local media, OpenAPI Zod I/O contracts; Postgres store/repo suites
  (`MessageStore`, `ChatStore`, `WebhookConfigRepo`, `InstanceRepo` on
  `zapo_test`); InstanceManager dryRun + fake-server testHooks e2e;
  VoIP serialize + call-stream auth; groups/contacts/presence/calls
  validation matrices. See `docs/TEST-COVERAGE.md`.
- **Sprint C coverage:** mock-WA route inject suite (messages/chats/contacts/
  groups/labels/lids/presence/privacy) + `phone-resolve` unit tests;
  overall lines **~60%**; CI gate raised to 58% lines/statements.
- README **Production checklist** + `docs/PRODUCTION-CONSISTENCY.md`
  (pipeline guarantees, media rehydrate, reverse-proxy sketches).
- Unit + integration + e2e smoke tests (Vitest).

### Security

- Webhook list/get no longer re-echo HMAC secrets (`hmac: { configured: true }` only).
- Metrics resources: non-admin callers no longer receive the full `liveSessionNames` list.
- SSE connection caps (`SSE_MAX_CONNECTIONS`, `SSE_MAX_CONNECTIONS_PER_ACTOR`).
- `TRUST_PROXY` / `TRUST_PROXY_HOPS` env (was always `trustProxy: true`).
- Validation errors return pathname only (strip `?apiKey=` from client-facing `url`).
- Avatar CDN download uses SSRF guard + size cap; media `putAt` rejects path traversal.
- Security headers plugin (nosniff, frame, CSP baseline for SPA/docs).
- **Sprint B hardening:** `CORS_ORIGINS` allowlist (prod default: no open CORS);
  app-level `@fastify/rate-limit` on `/v1` (`RATE_LIMIT_ENABLED` / `MAX` /
  `TIME_WINDOW_MS`, on by default in production).

### Fixed

- `message.any` webhook matching now only matches `message*` events (was a global catch-all).
- History sync full mailbox import is debounced (`HISTORY_IMPORT_DEBOUNCE_MS`) so
  every chunk no longer re-scans the mailbox on the live session queue.
- Live media download no longer head-of-line blocks the session queue (async +
  `MEDIA_DOWNLOAD_CONCURRENCY` semaphore).
- Outbound media/location/poll/reply sends now upsert into `app_messages` projections.
- Call PCM recorder caps duration (`CALL_RECORDING_MAX_SECONDS`).
- `.env.example` Redis host port aligned with compose (`16379`).

### Changed

- Realtime event channel documented as **SSE** (`GET /v1/events`); VoIP
  remains WebSocket (`/v1/voip` + PCM stream).
- Docker multi-stage build pruned to production dependencies for a smaller
  runtime image.
- `docker-compose.yml` images pinned to immutable tags **+ digests**
  (postgres 16.8, redis 7.4, MinIO server + `mc`); MinIO credentials overridable
  via `MINIO_ROOT_USER` / `MINIO_ROOT_PASSWORD`.
- Repository URLs set to `github.com/rafaelsantana6/zapo-rest`.
- `pnpm build:api` cleans `dist/` first (avoids stale artifacts like old `events-ws`).

[Unreleased]: https://github.com/rafaelsantana6/zapo-rest/compare/v0.8.0...HEAD
[0.8.0]: https://github.com/rafaelsantana6/zapo-rest/compare/v0.7.2...v0.8.0
[0.7.2]: https://github.com/rafaelsantana6/zapo-rest/compare/v0.7.1...v0.7.2
[0.7.1]: https://github.com/rafaelsantana6/zapo-rest/compare/v0.7.0...v0.7.1
[0.7.0]: https://github.com/rafaelsantana6/zapo-rest/compare/v0.6.0...v0.7.0
[0.6.0]: https://github.com/rafaelsantana6/zapo-rest/compare/v0.5.0...v0.6.0
[0.5.0]: https://github.com/rafaelsantana6/zapo-rest/compare/v0.4.0...v0.5.0
[0.4.0]: https://github.com/rafaelsantana6/zapo-rest/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/rafaelsantana6/zapo-rest/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/rafaelsantana6/zapo-rest/compare/v0.1.4...v0.2.0
[0.1.4]: https://github.com/rafaelsantana6/zapo-rest/compare/v0.1.3...v0.1.4
[0.1.3]: https://github.com/rafaelsantana6/zapo-rest/compare/v0.1.2...v0.1.3
[0.1.2]: https://github.com/rafaelsantana6/zapo-rest/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/rafaelsantana6/zapo-rest/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/rafaelsantana6/zapo-rest/releases/tag/v0.1.0
