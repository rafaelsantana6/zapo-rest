# AGENTS.md – `zapo-rest`

Guide for humans and coding agents. Keep this file true to the codebase.

---

## What this is

Multi-session **WhatsApp gateway** over [`zapo-js`](https://github.com/vinikjkkj/zapo):

- REST `/v1` — Fastify 5 + Zod + OpenAPI
- Live events — **SSE** `GET /v1/events` (server → client only)
- VoIP — **WS** `/v1/voip` + call PCM stream
- Postgres projections, webhook outbox, optional Redis / S3 / React dashboard / docs SPA

**Do not** reimplement Noise/Signal/stanza here — fix upstream zapo-js, then bump the dependency.

Inventory: `docs/API-COVERAGE.md`, `docs/FEATURE-MAP-FULL.md`. Coverage notes: `docs/TEST-COVERAGE.md`.  
**Why these shapes exist** (CAS, outbox, projections, SSE/WS split): [`docs/DESIGN-DECISIONS.md`](./docs/DESIGN-DECISIONS.md) · public summary in README + guide `/why`.

---

## Non-negotiables

| Principle | Meaning |
| --------- | ------- |
| `contract-first` | Public surface = OpenAPI + env. Breaking → SemVer (or clear `0.x` notes). |
| `sse-for-events` | App events only via SSE (`src/routes/events-sse.ts`). No general events WebSocket. |
| `ws-for-voip-only` | Bidirectional audio/signaling stays on VoIP WS + call stream. |
| `header-auth` | Prefer `X-Api-Key` / `Bearer`. Query `?apiKey=` only for native EventSource / browser WS. |
| `upsert-projections` | History upserts into `app_*` tables (not pure event-sourcing). |
| `idempotent-sidefx` | Webhook side-effects claim via `processed_events`. |
| `no-secret-logs` | Never log API keys, HMAC secrets, or Signal/auth material. |
| `no-overengineering` | Direct Fastify routes + stores. No new frameworks. |
| `design-surface-sync` | Product-relevant design wins (cost, reliability, security, contract) must be **highlighted in three places** — see [Design surface triad](#design-surface-triad). |

---

## Design surface triad

When you ship a **material** design choice or production advantage (examples: CAS media, webhook outbox, media rehydrate, SSE vs WS split, LID reconcile, listen-before-boot, two-stage media events), **do not** leave it only in code comments or a single internal note.

Update **all three** in the same change (or immediately after):

| Surface | What to update | Audience |
| ------- | -------------- | -------- |
| 1. [`docs/DESIGN-DECISIONS.md`](./docs/DESIGN-DECISIONS.md) | Canonical write-up: decision + why + trade-off | Contributors / deep dive |
| 2. **README** — section **Design advantages (summary)** | Short row or bullet the visitor sees without opening another file | GitHub / stars |
| 3. **Guide** (`docs-site`) | Page **`why`** (full summary table) **and** the feature page when it applies (`media`, `webhooks`, `architecture`, `realtime`, …) — **pt / en / es** | Integrators on `/guide` & GitHub Pages |

Also:

- Bump [`CHANGELOG.md`](./CHANGELOG.md) when the behavior is user-facing.
- Keep the **at a glance** bullets in README and the guide `why` page aligned with each other (same claims; wording may differ by locale).
- Skip the triad for pure refactors, typo fixes, or internal renames with no operator/integrator benefit.

**Checklist (relevant features):**

- [ ] `docs/DESIGN-DECISIONS.md` — decision + benefit
- [ ] README **Design advantages (summary)** — bullet and/or table row
- [ ] Guide `why` page (all locales) + feature page if users hit that path
- [ ] `CHANGELOG.md` when user-visible

---

## Layout

```text
src/
  server.ts, app.ts
  auth/          # admin + instance API keys
  config/env.ts  # Zod env schema
  db/            # pool, schema.sql, migrate
  events/        # decode-message, processor, realtime bus
  instances/     # manager, repo, WaClient factory
  routes/        # HTTP + SSE + VoIP WS
  http/          # cors, openapi-schemas
  store/         # Postgres projections
  webhooks/      # configs, outbox, dispatcher
  media/ redis/ voip/ plugins/ lib/
dashboard/       # Vite + React admin
docs-site/       # guide SPA at /guide
docs/ tests/ scripts/
```

Alias: `~/...` → `src/...` (`tsconfig.json`). Node **≥ 24.18**, pnpm 9, TypeScript ESM.

---

## Realtime (do not drift)

| Channel | Transport | Auth |
| ------- | --------- | ---- |
| App events | SSE `GET /v1/events` | `X-Api-Key` preferred |
| VoIP signaling | WS `/v1/voip` | query `apiKey` ok (browsers) |
| Call audio | WS `.../calls/:id/stream` | query `apiKey` ok |

Dashboard: `dashboard/src/api/client.ts` → `openEventsSse` uses `fetch` + stream (not native `EventSource`) so the key stays in headers.

Contract changes must update README, `docs-site/src/content/*`, OpenAPI, dashboard Events page, and `CHANGELOG.md`.

---

## Auth

| Actor | Source | Scope |
| ----- | ------ | ----- |
| Admin | `ADMIN_API_KEY` env (≥ 16 chars) | All instances |
| Instance | per-row `apiKey` | Own instance only |

Enforce with `canAccessInstance` / `isAdmin` (`src/auth/types.ts`) on every `:name` route. `/docs` OpenAPI UI is public by design — network-ACL in prod if needed.

---

## Data model

1. **Mailbox** (`mailbox_*`) — protocol store via `@zapo-js/store-postgres`
2. **Projections** (`app_messages`, `app_chats`, `app_contacts`, …) — upsert by natural keys
3. **`processed_events`** — short-lived side-effect dedupe
4. **Webhook outbox** — durable delivery + retries

Edits/acks/revokes update the same projection row (`GREATEST(ack)`, flags).

---

## Code style

Stack conventions (not generic framework advice):

- **TS ESM**, strict; named exports preferred; no `any` / untyped public APIs
- Functions ~4–20 lines; files under ~500 lines; one responsibility per module
- Names specific — avoid vague `data` / `handler` / `Manager`
- Early returns; max ~2 indentation levels; no copy-paste (extract shared helpers)
- Errors: include offending value + expected shape; use `src/lib/errors.ts` (`badRequest`, `unauthorized`, …)
- Zod on request bodies/params; share schemas with OpenAPI when possible
- Inject deps via constructor/params; wrap third-party behind a thin project-owned edge when it sprawls
- Prefer `ulid` for public event/delivery ids
- **Comments:** keep intent comments on refactor; write WHY not WHAT; public APIs: short intent + one usage example
- **Logs:** pino structured — static message + context object; never secrets
- **Format/lint:** Biome only (`pnpm format` / `pnpm lint` / `pnpm lint:fix`). Don’t bikeshed style beyond that.

### Do not

- Reintroduce general `events-ws`
- Put secrets in URL query in docs (except labeled browser fallbacks)
- Commit `.env`, session dumps, or media blobs
- Unbounded in-memory maps on hot paths (TTL/size limits)

---

## Testing

| Suite | Command |
| ----- | ------- |
| Unit + integration | `pnpm test` |
| Unit only | `pnpm test:unit` |
| Integration | `pnpm test:integration` |
| DB | `pnpm test:db` |
| Critical subset | `pnpm test:unit:critical` |
| E2E (fake-server) | `pnpm test:e2e` |
| Coverage | `pnpm test:coverage` |

Rules:

- New logic gets a test; bug fixes get a regression test
- Mock external I/O (API, DB, FS) with **named fakes**, not inline stubs
- F.I.R.S.T.: fast, independent, repeatable, self-validating, timely
- No committed `test.skip` / `.only`

Coverage is intentionally imperfect (~60% lines of `src/**`, CI gates in `docs/TEST-COVERAGE.md`). Prefer tests on risky paths (processor, outbox/HMAC, SSE auth, media, phone/JID resolve) over vanity % on thin route wrappers.

---

## Docker / ops

- Multi-stage Node **24** bookworm (glibc needed for `@roamhq/wrtc`; not Alpine)
- Runtime user `zapo`; entrypoint `dumb-init` → `node dist/server.js`
- Compose MinIO host: **19000** API / **19001** console; in-network `S3_ENDPOINT=http://minio:9000`

---

## Versioning

Single package SemVer in root `package.json`. User-facing changes → `CHANGELOG.md`. Tags `vX.Y.Z`. See `CONTRIBUTING.md` for patch/minor/major.

---

## Before finishing

- [ ] SSE/WS contract still holds
- [ ] New env vars in `src/config/env.ts` **and** `.env.example`
- [ ] OpenAPI updated if surface changed
- [ ] Tests for non-trivial logic
- [ ] `pnpm format && pnpm lint && pnpm typecheck && pnpm test`
- [ ] No secrets in logs or commits
- [ ] README / guide / CHANGELOG consistent when user-facing
- [ ] If a **design advantage** shipped: [Design surface triad](#design-surface-triad) (DESIGN-DECISIONS + README summary + guide `why` / feature pages)

---

## Upstream

Protocol: **zapo-js** by [vinikjkkj](https://github.com/vinikjkkj) — <https://github.com/vinikjkkj/zapo> · <https://zapo.to/>

Independent project; **not affiliated with WhatsApp/Meta**.
