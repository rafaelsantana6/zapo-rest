# Contributing to `zapo-rest`

Thanks for your interest. This handbook covers setup, layout, tests, CI,
versioning, and PR conventions. Architecture and coding rules for agents
live in [`AGENTS.md`](AGENTS.md).

By contributing you also agree to the
[Code of Conduct](CODE_OF_CONDUCT.md) – including the
**AI-Assisted Contributions** section.

## What this project is

`zapo-rest` is a **REST + SSE + VoIP gateway** on top of
[`zapo-js`](https://github.com/vinikjkkj/zapo). It is **not** a fork of other WhatsApp
libraries. Feature notes live in `docs/API-COVERAGE.md` and `docs/FEATURE-MAP-FULL.md`.

Protocol implementation belongs upstream in zapo-js. This repo owns:

- HTTP contract (`/v1`), OpenAPI, auth
- Multi-session process management
- Postgres projections, webhooks, media storage
- Dashboard and guide SPA

## Requirements

| Tool | Version |
| ----------- | -------------------------------- |
| Node.js | `>= 24.18.0` (CI uses Node 24 LTS) |
| pnpm | via Corepack |
| Docker | optional, for Postgres/Redis/MinIO |
| ffmpeg | on `PATH` for media/VoIP tooling |

## Minimal functional setup

```bash
git clone https://github.com/rafaelsantana6/zapo-rest.git
# then: cp .env.example .env  &&  set a strong ADMIN_API_KEY
cd zapo-rest
cp .env.example .env
# set ADMIN_API_KEY to >= 16 characters

# Infra only
docker compose up -d postgres redis minio minio-init

pnpm install
pnpm --dir dashboard install
pnpm --dir docs-site install # optional, for /guide

pnpm dev
# optional second terminal:
pnpm --dir dashboard dev # Vite on :5173, proxies /v1
```

API: `http://localhost:3000` · Scalar: `/docs` · Health: `/health`

### Full stack in Docker

```bash
cp .env.example .env
docker compose up --build
```

- API + dashboard: http://localhost:3000 
- MinIO API: http://localhost:19000 · console: http://localhost:19001 

### Smoke test

```bash
export BASE=http://localhost:3000
export KEY='your-ADMIN_API_KEY'

curl -s "$BASE/health"
curl -s -X POST "$BASE/v1/instances" \
 -H "X-Api-Key: $KEY" -H 'content-type: application/json' \
 -d '{"name":"demo-1"}'
curl -s "$BASE/v1/instances/demo-1/qr" -H "X-Api-Key: $KEY"
```

## Architecture at a glance

```text
Clients (dashboard / integrators)
 │
 ▼
Fastify /v1 ── Auth (admin | instance key)
 │
 ▼
InstanceManager (per-session queue + WaClient)
 │
 ├── EventProcessor → app_* projections + processed_events
 ├── Webhook outbox (HMAC, retries)
 ├── SSE GET /v1/events (server → client)
 └── VoIP WS /v1/voip + PCM stream (bidirectional)
```

Important paths:

| Path | Role |
| --------------- | ----------------------------------------- |
| `src/routes/` | Fastify + Zod OpenAPI routes |
| `src/instances/`| Multi-session WaClient manager |
| `src/events/` | Decode + processor + realtime bus |
| `src/store/` | Postgres projections |
| `src/webhooks/` | Multi-config + outbox worker |
| `src/media/` | Local / S3 storage |
| `dashboard/` | React admin UI |
| `docs-site/` | Narrative guide at `/guide` |
| `tests/` | unit / integration / e2e |

## Scripts

| Script | Purpose |
| ---------------------- | ------------------------------------ |
| `pnpm dev` | API with file watch |
| `pnpm build` | API + dashboard + docs-site |
| `pnpm start` | Run compiled `dist/server.js` |
| `pnpm typecheck` | `tsc --noEmit` |
| `pnpm format` | Biome format check (CI) |
| `pnpm format:fix` | Biome format write |
| `pnpm lint` | Biome lint (CI) |
| `pnpm lint:fix` | Biome check --write (format + lint + assist) |
| `pnpm check` | Full Biome check (format + lint) |
| `pnpm test` | unit + integration |
| `pnpm test:e2e` | fake-server smoke |
| `pnpm test:coverage` | Vitest + v8 coverage |
| `pnpm openapi:export` | Write root `openapi.json` |

## Continuous Integration

Every PR and push to the default branch runs
[`.github/workflows/ci.yml`](.github/workflows/ci.yml):

- lint (Biome)
- typecheck
- unit + integration tests
- (optional) e2e when secrets/infra allow

## Versioning and releases

We use **Semantic Versioning** on a single package (`zapo-rest`):

| Bump | When |
| ------- | ------------------------------------------------- |
| `patch` | Bug fixes, docs, internal refactors, no API break |
| `minor` | New endpoints/features, backward-compatible |
| `major` | Breaking HTTP/OpenAPI or env contract changes |

Until `1.0.0`, `0.y.z` may still break on minor bumps – document them
clearly in `CHANGELOG.md`.

Release flow:

1. Update `CHANGELOG.md` (`## [Unreleased]` → version section).
2. Bump version:

 ```bash
 pnpm version patch # or minor / major
 # uses npm/pnpm version; creates a commit + tag if configured
 ```

3. Push branch + tag:

 ```bash
 git push && git push origin "v$(node -p "require('./package.json').version")"
 ```

4. GitHub Actions (`.github/workflows/release.yml`) creates a GitHub Release
   and builds/pushes the container image to:
   - **Docker Hub** — `rafaelsantana6/zapo-rest` (needs repo secrets
     `DOCKERHUB_USERNAME` + `DOCKERHUB_TOKEN`)
   - **GHCR** — `ghcr.io/rafaelsantana6/zapo-rest` (uses `GITHUB_TOKEN`)

   To re-publish an existing tag after fixing secrets/workflow:

   ```bash
   gh workflow run release.yml -f tag=v0.1.0
   ```

PR titles should follow
[Conventional Commits](https://www.conventionalcommits.org/):
`feat:`, `fix:`, `docs:`, `chore:`, `test:`, `refactor:`, `perf:`, `ci:`.

## Contribution rules

Before opening a PR:

- [ ] Reproduce the bug or describe the feature against current `main`
- [ ] Prefer small, focused PRs over mega-diffs
- [ ] Add/adjust tests for behavior changes
- [ ] Keep realtime docs accurate: **events = SSE**, **VoIP = WebSocket**
- [ ] Never commit `.env`, credentials, or session data
- [ ] Run `pnpm format && pnpm lint && pnpm typecheck && pnpm test` locally
- [ ] Update `CHANGELOG.md` under `[Unreleased]` when user-facing
- [ ] Update OpenAPI-facing descriptions when routes change

## Credits

Built on [zapo-js](https://github.com/vinikjkkj/zapo) by
[vinikjkkj](https://github.com/vinikjkkj). See the README for full
attribution and disclaimer.
