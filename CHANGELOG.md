# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Changed

- Release workflow publishes container images to **Docker Hub**
  (`rafaelsantana6/zapo-rest`) in addition to GHCR; supports
  `workflow_dispatch` to re-publish an existing tag.

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

[Unreleased]: https://github.com/rafaelsantana6/zapo-rest/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/rafaelsantana6/zapo-rest/releases/tag/v0.1.0
