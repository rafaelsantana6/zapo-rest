# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Fixed

- Webhooks filtered to `message` only never received stage-2 media events
  (`message.media.stored` / `message.media.failed`) after CAS download, so
  receivers only saw the instant meta payload without a permanent storage
  URL. Subscribing to `message` now also matches those media stage-2 events.
  Legacy instance `webhookEvents` uses the same matcher.
- Media URL after CAS: private R2/S3 API hosts are not used as `mediaUrl`
  (not browser-fetchable); fall back to the authenticated API media path.

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

[Unreleased]: https://github.com/rafaelsantana6/zapo-rest/compare/v0.1.2...HEAD
[0.1.2]: https://github.com/rafaelsantana6/zapo-rest/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/rafaelsantana6/zapo-rest/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/rafaelsantana6/zapo-rest/releases/tag/v0.1.0
