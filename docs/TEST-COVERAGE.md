# Test coverage report

**Measured:** 2026-07-12 (Sprint C)  
**Unit + integration + DB (`pnpm test`):** **228 tests · 41 files · all green** (28 unit + 9 integration + 4 db)  
**E2E (fake-server):** pairing smoke + manager/messaging (soft-skip on HMAC skew) — 3 files, gated by infra, run separately  
**Total test files in repo:** **44** (28 unit + 9 integration + 4 db + 3 e2e)  
**Overall lines:** **~60.3%** of `src/**`  
**Coverage gate (CI):** lines/statements ≥ **58%**, functions/branches ≥ **60%**

## Sprint status

| Sprint | Deliverable | Status |
| ------ | ----------- | ------ |
| 0 | Processor, outbox HMAC, SSE, local media, Zod contracts | ✅ |
| 1 | Postgres `MessageStore` / `ChatStore` / `WebhookConfigRepo` / `InstanceRepo` | ✅ (`tests/db/*`) |
| 2 | `InstanceManager` unit (dryRun) + fake-server `testHooks` e2e | ✅ |
| 3 | VoIP serialize + `attachCallStream` auth / ready frame | ✅ |
| 4 | Groups / contacts / presence / calls validation matrices | ✅ |
| 5 | Raise thresholds + docs | ✅ |
| **A** | Publish polish (images, prod checklist) | ✅ |
| **B** | CORS + rate limit + media rehydrate tests | ✅ |
| **C** | Mock-WA route inject + phone-resolve → **~60% lines** | ✅ |

## Critical modules

| Module | ~Lines |
| ------ | ------ |
| `events/processor.ts` | **~87%** |
| `webhooks/outbox.ts` | **~99%** |
| `webhooks/repo.ts` | **100%** |
| `webhooks/dispatcher.ts` | **~82%** |
| `store/messages.ts` | **~93%** |
| `store/chats.ts` | **~91%** |
| `routes/messages.ts` | **improved** (inject send/edit/revoke/reply/…) |
| `routes/chats.ts` | **improved** (list/get/archive/read) |
| `lib/phone-resolve.ts` | **unit covered** |
| `routes/events-sse.ts` | **~90%** |
| `voip/call-serialize.ts` | **100%** |
| `instances/manager.ts` | dryRun paths; live WA still thin |

## How to run

```bash
pnpm test
pnpm test:coverage
pnpm test:db
pnpm test:e2e
pnpm test:unit:critical
```

Env:

- `TEST_DATABASE_URL` — default `postgresql://zapo:zapo@127.0.0.1:5555/zapo_test`
- Soft-skip if Postgres is down (suite stays green)

## Layout

```text
tests/
  helpers/     memory-repo, memory-stores, mock-wa-app, test-app, fixtures
  unit/        pure + mocked modules (incl. phone-resolve, cors, revive-raw)
  integration/ Fastify inject (auth, SSE, Zod, rate-limit, media rehydrate, route-handlers)
  db/          real Postgres store/repo tests
  e2e/         @zapo-js/fake-server
```

## Toward overall 75–85%

Remaining mass: VoIP recording manager, `call-stream` full protocol, `InstanceManager` reconnect/live, SQL-only stores (labels/lids/avatars/metrics), media fetch, avatar-resolve, chat-reconcile.

Recommended order:

1. Align `@zapo-js/fake-server` pair HMAC → unlock live manager e2e  
2. Postgres tests for labels / lid_map / contacts / calls / metrics stores  
3. VoIP attachCallStream + recording manager unit  
4. Raise vitest thresholds: 58 → 70 → 80  

## Rules

- No `test.skip` / `.only` / empty placeholders in merged code
- Prefer inject + mocked `requireRegisteredClient` for route coverage without real WA
