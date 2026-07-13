# Code review massivo — zapo-rest (status)

**Original review:** 2026-07-12  
**Last updated:** 2026-07-12 (post coverage sprints + media CAS + guide i18n)  
**Scope:** `src/`, `dashboard/`, `docs-site/`, Docker, tests, docs consistency  

Severity: **P0** must-fix before public launch · **P1** soon · **P2** nice-to-have · **OK** solid · **DONE** addressed since original review.

---

## Executive summary

| Area | Original | Now |
| ---- | -------- | --- |
| Architecture (projections, outbox, session queues) | Strong | **Still strong** (+ CAS media, wipe, rehydrate) |
| Auth model (admin vs instance) | Good | **Unchanged — OK** |
| Realtime (SSE vs WS) | Correct | **OK** (guide + SSE header-first) |
| Test coverage | ~32.6% / thin processor | **~60% lines · 228 tests (41 files) · processor 87% · outbox 99%** — see [`TEST-COVERAGE.md`](TEST-COVERAGE.md) |
| Docker | Good baseline | **Prod deps + `.dockerignore` + MinIO pin** (mc still `:latest`) |
| Open-source readiness | Incomplete | **Mostly done** — LICENSE/CoC/CI/Dependabot landed; GitHub owner **`rafaelsantana6/zapo-rest`** |
| Security surface | Acceptable 0.x | **Improved (Sprint B):** rate limit + CORS allowlist; `/docs` still public (ops ACL) |
| Guide / docs-site | PT-only, some drift | **i18n pt-BR / en / es** + architecture/SSE fixes |

---

## What was done since the original review

### Launch / open-source checklist

| Item | Status |
| ---- | ------ |
| MIT LICENSE | ✅ |
| CODE_OF_CONDUCT / CONTRIBUTING / SECURITY / CHANGELOG / AGENTS | ✅ |
| README (zapo credits, MinIO ports) | ✅ |
| CI (`lint` · `typecheck` · `test` · build · docker build) | ✅ |
| SemVer + release workflow (`release.yml` on tags) | ✅ |
| Dockerfile multi-stage, non-root, **prod-only deps** | ✅ |
| `.dockerignore` | ✅ |
| Dependabot (npm root/dashboard/docs-site + GHA + docker) | ✅ |
| Pin compose image digests | ✅ **Sprint A** — postgres/redis/minio/mc tag+digest; MinIO creds overridable |
| GitHub owner `rafaelsantana6/zapo-rest` | ✅ package.json, README, CONTRIBUTING, CHANGELOG |
| Branch protection on CI | ❌ ops on GitHub (not in repo) |
| Rate limit + production CORS | ✅ **Sprint B** — `CORS_ORIGINS` + `/v1` rate limit in app; proxy sketches remain for defense in depth |
| Production checklist in README | ✅ **Sprint A** |

### Coverage sprint (was P1 critical)

| Item | Original | Now |
| ---- | -------- | --- |
| Overall line coverage | ~32.6% | **~60%** (gate ≥58% lines/statements, ≥60% functions/branches) |
| Unit/integration tests | 56 | **228** (41 files, green) |
| `events/processor.ts` | ~0% | **~87%** |
| Webhook outbox + HMAC | untested | **~99%** outbox · dispatcher tests |
| SSE auth matrix | thin | **integration suite** |
| Local media storage | thin | **unit suite** + filename/CAS helpers |
| Postgres store tests | missing | **`tests/db/*`** (soft-skip if DB down) |
| InstanceManager | missing | **dryRun unit** + e2e soft-skip on fake-server HMAC |

Remaining mass (toward 60→85%): route handlers with mocked client, VoIP recording manager, labels/lids/contacts stores, live manager reconnect e2e (fake-server HMAC alignment).

### Media & storage (product work after review)

| Item | Status |
| ---- | ------ |
| Per-instance content-addressed storage (`cas/sha256/{hash}{ext}`) | ✅ |
| Dedup same content within one instance | ✅ |
| Original `media_filename` on download + presigned `Content-Disposition` | ✅ |
| Prefer **302 redirect** to storage (API traffic offload) | ✅ `MEDIA_REDIRECT_DOWNLOADS` |
| If CAS object deleted → **rehydrate from WhatsApp** → re-store → deliver; 404 only if WA fails | ✅ `ensureStoredMedia` + `revive-raw` (bytes/Long after JSONB) |
| Full instance wipe (DB + zapo session + storage prefix) | ✅ |

Still thin on automated tests: media **route** rehydrate path (unit covers revive helpers + local storage, not full GET inject).

### Docs / guide / API surface

| Item | Status |
| ---- | ------ |
| Guide architecture “WS subscribers” → SSE | ✅ |
| SSE examples header-first | ✅ |
| README MinIO host ports (19000/19001) | ✅ |
| OpenAPI via Zod + Fastify swagger + Scalar | ✅ (live `/docs`) |
| Guide multi-language **pt-BR / en / es** + topbar selector | ✅ |
| OpenAPI endpoint narratives still mixed language | P2 (generated from route schemas) |
| `openapi.json` export lag | P2 — export in CI/release still optional |

### Docker / Node

| Item | Status |
| ---- | ------ |
| Node **24.18.0** pin (CI + Dockerfile) | ✅ |
| Brand scrub (no Evolution/WAHA/fzap leftovers in product surface) | ✅ (session work) |

---

## Architecture — OK / strong (unchanged core)

### Session isolation

`InstanceManager` serializes work per instance via `sessionQueues`. Shutdown sets `shuttingDown` to skip side-effects during close storms.

### Storage model

- mailbox (`@zapo-js/store-postgres`) for protocol truth  
- `app_*` for API-friendly history  
- `processed_events` for webhook idempotency  
- webhook outbox for at-least-once HTTP delivery  
- **media CAS** per instance + optional WA rehydrate on miss  

### Realtime bus

In-process `realtimeBus` → SSE. **Single process owns live WA sessions** — multi-replica needs sticky sessions or a shared bus. Documented in [`PRODUCTION-CONSISTENCY.md`](PRODUCTION-CONSISTENCY.md) §5.

### VoIP

Control WS + PCM stream; app events stay SSE. `@roamhq/wrtc` → Debian bookworm (not Alpine).

---

## Auth & multi-tenancy

| Finding | Sev | Status |
| ------- | --- | ------ |
| Timing-safe key compare (`safeEqual`) | OK | Unchanged |
| `/v1` gated; `/docs` + `/guide` public | P1 | Still public by design — ops doc says ACL/VPN; **not enforced in app** |
| Query `apiKey` fallback | OK / P2 | Documented as last resort for EventSource/WS |
| Instance scoping (`canAccessInstance`) | OK | Any new route must call it |
| CORS open by default | P1 | **DONE (Sprint B)** — `CORS_ORIGINS`; prod default same-origin only |
| Dashboard stores key client-side | P2 | Expected for SPA; HTTPS only |

---

## Correctness & reliability

| Finding | Sev | Status |
| ------- | --- | ------ |
| Event processor complexity / coverage | P1 → **improved** | Large file remains; **~87% unit coverage** |
| Webhook outbox tests | P1 → **DONE** | retry/HMAC covered |
| Phone/JID BR variants | OK | Solid unit tests |
| Media auto-download failures | P2 | Log + continue; rehydrate on GET if CAS missing |
| Reconnect storm / jitter | P2 | `RECONNECT_MAX_ATTEMPTS` exists; multi-instance boot jitter not stress-tested |
| Stale `dist/routes/events-ws.*` | P2 | **Still present locally** if old builds leave artifacts — CI builds fresh `dist/`; clean before publish |

---

## Security

| Finding | Sev | Status |
| ------- | --- | ------ |
| Secrets in env (Zod min length) | OK | Unchanged |
| Webhook HMAC SHA-512 | OK | Tested |
| S3/MinIO defaults in compose | P1 | Dev defaults — README/dev-only; **do not ship to prod** |
| Static SPA + API same origin | OK | Unchanged |
| Rate limiting on `/v1` | P1 | **DONE (Sprint B)** — `@fastify/rate-limit` + env knobs |
| Trust proxy | OK | Ensure hop count in real deploy |
| Dependabot | P2 → **DONE** | Config present |
| Secret scanning CI | P2 | Not added (gitleaks/trufflehog optional) |

---

## API & docs consistency

| Finding | Sev | Status |
| ------- | --- | ------ |
| Events as WS in old notes | P0 | **Fixed** (SSE) |
| SSE `?apiKey=` as primary example | P1 | **Fixed** (header-first) |
| README MinIO ports | P0 | **Fixed** |
| OpenAPI VoIP stream injection | OK | Manual OAS workaround still valid |
| Guide i18n | — | **pt-BR / en / es** |
| OpenAPI / Scalar language mix | P2 | Route `description`s not fully i18n |
| Live `openapi.json` lag vs code | P2 | Prefer CI export or always serve from running app |

---

## Frontend (dashboard)

| Finding | Sev | Status |
| ------- | --- | ------ |
| `openEventsSse` via fetch stream | OK | Header auth |
| Softphone PCM WS | OK | Matches backend |
| Deprecated `openEventsSocket` alias | P2 | Keep until external callers migrate |
| No automated UI tests | P2 | Playwright smoke still missing |

---

## Docker / supply chain

| Finding | Sev | Status |
| ------- | --- | ------ |
| Multi-stage + non-root + dumb-init + healthcheck | OK | Solid |
| Prod-only `node_modules` in image | P0 | **DONE** |
| `.dockerignore` | P0 | **DONE** |
| Pin MinIO server tag | P1 | **DONE** (`RELEASE.2025-04-22…` + digest) |
| Pin `minio/mc`, postgres, redis digests | P1 | **DONE** (Sprint A) |
| Stale `dist/` on build | P2 | **DONE** — `build:api` runs `rm -rf dist` |
| `pnpm install --frozen-lockfile` in CI/Docker | P2 → **OK** | CI + Dockerfile use frozen lockfile |
| ffmpeg in image | OK | Required |

---

## Code quality hotspots (still relevant)

1. **`src/events/processor.ts`** — still large; now well unit-tested — continue extracting pure handlers when touching.
2. **`src/instances/manager.ts`** — lifecycle + event bindings; dryRun tested, live reconnect paths thin.
3. **`src/routes/*.ts`** — repetitive auth/resolve; shared preHandlers would reduce miss risk.
4. **`src/lib/avatar-resolve.ts` / `phone-resolve.ts`** — complex; good unit value.
5. **Media routes** — rehydrate + redirect are production-critical; add inject/integration tests.
6. **Dashboard VoIP** — keep comments in sync with `src/voip/call-stream.ts`.

---

## Launch checklist (updated)

### Done

- [x] MIT LICENSE
- [x] CODE_OF_CONDUCT / CONTRIBUTING / SECURITY / CHANGELOG / AGENTS
- [x] README with zapo credits
- [x] CI workflow (lint, typecheck, test, build, docker)
- [x] SemVer docs + release workflow skeleton
- [x] Dockerfile hardened / smaller prod deps + `.dockerignore`
- [x] Dependabot config
- [x] Coverage sprints on processor + outbox + SSE + media storage (≥ critical paths baseline)
- [x] Media CAS + redirect + WA rehydrate fallback
- [x] Guide i18n (pt-BR / en / es)
- [x] **Sprint A — Publish polish:** image digests, prod checklist, ops doc, clean `dist` on build
- [x] GitHub owner `rafaelsantana6/zapo-rest`
- [x] **Sprint B — Hardening:** `CORS_ORIGINS` + `/v1` rate limit; media rehydrate integration tests
- [x] **Sprint C — Coverage 60:** mock-WA route inject + phone-resolve; ~60% lines

### Still open

- [ ] Branch protection requiring CI on default branch (GitHub settings)
- [ ] Optional: secret scanning in CI
- [ ] Raise coverage toward **75%** then **85%** (VoIP, manager live paths, stores SQL)
- [ ] Playwright smoke: login + instances list
- [ ] Align `@zapo-js/fake-server` pair HMAC with current zapo-js (unlock live manager e2e)
- [ ] Multi-replica story: sticky vs Redis/NATS bus (design + doc; implementation later)

---

## What is already good (keep doing)

- Zod env parsing with fail-fast  
- Per-session serial queues + `runSafe`  
- Webhook multi-config + outbox + HMAC (tested)  
- SSE over WS for unidirectional events  
- OpenAPI/Scalar as integrator surface  
- Clear credit path to zapo-js  
- Content-addressed media + rehydrate on missing object  
- Coverage gate and TEST-COVERAGE living doc  

---

## What we should do next (prioritized backlog)

### P0 / launch blockers

~~Production posture docs + image pins~~ → **Sprint A done**. Remaining P0 is operational (set secrets on your host, enable branch protection on GitHub).

### P1 / soon (Sprint D / E prep)

1. Branch protection + required CI checks on GitHub.
2. Coverage → **75%** — VoIP stream, manager reconnect, SQL stores, media fetch.

### P2 / quality of life

3. Playwright smoke (dashboard).  
4. Secret scanning CI.  
5. Fake-server HMAC fix → real manager e2e green without soft-skip.  
6. Multi-replica design note (sticky vs shared bus).  
7. OpenAPI i18n or “English-only OpenAPI / localized guide” policy written down.  
8. Redis-backed rate-limit store for multi-process counters.

### Suggested sprint order

| Sprint | Focus | Outcome |
| ------ | ----- | ------- |
| **A — Publish polish** | Image pins, prod checklist, ops doc | ✅ **Done** |
| **B — Hardening** | Rate limit + CORS + media rehydrate tests | ✅ **Done** |
| **C — Coverage 60** | Mock-WA route inject + phone-resolve | ✅ **Done** (~60% lines) |
| **D — Ops** | Multi-replica doc, metrics dashboards, runbook | Operability |
| **E — 1.0 freeze** | OpenAPI stability promise + changelog discipline | SemVer trust |

---

## Reference docs

| Doc | Role |
| --- | ---- |
| [`TEST-COVERAGE.md`](TEST-COVERAGE.md) | Coverage numbers, sprint log, how to run |
| [`PRODUCTION-CONSISTENCY.md`](PRODUCTION-CONSISTENCY.md) | Pipeline guarantees, media, webhooks, ops checklist |
| [`API-COVERAGE.md`](API-COVERAGE.md) | Endpoint inventory |
| Guide SPA `/guide` | Narrative docs (pt-BR / en / es) |
| Scalar `/docs` | Interactive OpenAPI |
