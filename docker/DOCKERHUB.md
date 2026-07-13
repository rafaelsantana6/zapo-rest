# zapo-rest

**Multi-session REST API for WhatsApp**, powered by [zapo-js](https://github.com/vinikjkkj/zapo).

Instances · messages · media · webhooks · live **SSE** events · VoIP · built-in dashboard  
Clean `/v1` contract for multi-session WhatsApp.

> Independent project. **Not affiliated with WhatsApp / Meta.**

---

## Links

| | |
| --- | --- |
| **Source** | https://github.com/rafaelsantana6/zapo-rest |
| **Releases / changelog** | https://github.com/rafaelsantana6/zapo-rest/releases · [CHANGELOG](https://github.com/rafaelsantana6/zapo-rest/blob/main/CHANGELOG.md) |
| **Full README** | https://github.com/rafaelsantana6/zapo-rest#readme |
| **Contributing** | https://github.com/rafaelsantana6/zapo-rest/blob/main/CONTRIBUTING.md |
| **Security** | https://github.com/rafaelsantana6/zapo-rest/blob/main/SECURITY.md |
| **Production notes** | https://github.com/rafaelsantana6/zapo-rest/blob/main/docs/PRODUCTION-CONSISTENCY.md |
| **Issues** | https://github.com/rafaelsantana6/zapo-rest/issues |
| **Engine (zapo-js)** | https://github.com/vinikjkkj/zapo · https://zapo.to/ |
| **Sponsor the engine** | https://github.com/sponsors/vinikjkkj |
| **Also on GHCR** | `ghcr.io/rafaelsantana6/zapo-rest` |

---

## Quick pull

```bash
docker pull rafaelsantana6/zapo-rest:latest
# pin a release
docker pull rafaelsantana6/zapo-rest:0.1.0
```

**Tags** (from SemVer git tags `vX.Y.Z`):

| Tag | Meaning |
| --- | --- |
| `latest` | Latest non-prerelease |
| `X.Y.Z` | Exact release |
| `X.Y` | Latest patch in minor |
| `X` | Latest in major (0.x still evolving) |

---

## What you get

| Capability | Details |
| --- | --- |
| Multi-session | Many WhatsApp numbers in one process, each with its own API key |
| REST + OpenAPI | Fastify 5, Zod, Scalar UI at `/docs` |
| Durable chat store | Postgres projections (`app_messages`, `app_chats`, …) |
| Webhooks | Multi-URL configs, HMAC-SHA512, retries, outbox worker |
| Live events | **SSE** `GET /v1/events` (prefer `X-Api-Key` header) |
| Voice | **WebSocket** `/v1/voip` + live PCM stream |
| Media | Local disk or S3-compatible (MinIO / R2 / AWS) |
| Ops UI | Dashboard (QR, chat, send tester, webhooks, softphone) |
| Guide | Multi-language SPA at `/guide/` |

---

## Minimal run (needs Postgres)

This image is the **API + dashboard + guide**. You still need Postgres (and optionally Redis / S3).

```bash
# example — point DATABASE_URL at your Postgres
docker run --rm -p 3000:3000 \
  -e ADMIN_API_KEY="$(openssl rand -hex 24)" \
  -e DATABASE_URL="postgres://user:pass@host:5432/zapo" \
  rafaelsantana6/zapo-rest:latest
```

| Endpoint | URL |
| --- | --- |
| API + dashboard | http://localhost:3000 |
| OpenAPI (Scalar) | http://localhost:3000/docs |
| Guide | http://localhost:3000/guide/ |
| Health | http://localhost:3000/health |

Full stack with Postgres + Redis + MinIO: use the repo’s
[`docker-compose.yml`](https://github.com/rafaelsantana6/zapo-rest/blob/main/docker-compose.yml)
and [`.env.example`](https://github.com/rafaelsantana6/zapo-rest/blob/main/.env.example).

```bash
git clone https://github.com/rafaelsantana6/zapo-rest.git
cd zapo-rest
cp .env.example .env
# set ADMIN_API_KEY (>= 16 chars)
docker compose up --build
```

---

## Important env (non-exhaustive)

| Variable | Notes |
| --- | --- |
| `ADMIN_API_KEY` | **Required**, ≥ 16 chars — full admin access |
| `DATABASE_URL` | **Required** — Postgres |
| `REDIS_URL` | Optional — falls back to in-memory |
| `MEDIA_STORAGE` | `local` (default) or `s3` |
| `S3_*` | When using object storage |
| `CORS_ORIGINS` | Prod default: same-origin only |
| `TRUST_PROXY` / `TRUST_PROXY_HOPS` | Behind reverse proxies |

See [`.env.example`](https://github.com/rafaelsantana6/zapo-rest/blob/main/.env.example) for the full list.

---

## Production checklist (short)

- Strong `ADMIN_API_KEY` (not compose defaults)
- HTTPS + reverse proxy; ACL `/docs` and `/guide` (public by design)
- Prefer header auth (`X-Api-Key` / `Bearer`) over `?apiKey=`
- Unique DB / Redis / object-storage credentials
- Single process or sticky sessions (live WA sessions are process-local)

Full notes: [docs/PRODUCTION-CONSISTENCY.md](https://github.com/rafaelsantana6/zapo-rest/blob/main/docs/PRODUCTION-CONSISTENCY.md)

---

## Architecture notes

- **Do not** reimplement Noise/Signal/stanza here — fix upstream [zapo-js](https://github.com/vinikjkkj/zapo), then bump the dependency.
- App events: **SSE only** (`GET /v1/events`). Bidirectional audio stays on VoIP WebSocket.
- License: **MIT** — https://github.com/rafaelsantana6/zapo-rest/blob/main/LICENSE

---

## Support

- Bugs / features: https://github.com/rafaelsantana6/zapo-rest/issues  
- Engine questions / sponsorship: [vinikjkkj/zapo](https://github.com/vinikjkkj/zapo)

Built with ❤️ on **[zapo](https://github.com/vinikjkkj/zapo)** by [vinikjkkj](https://github.com/vinikjkkj).
