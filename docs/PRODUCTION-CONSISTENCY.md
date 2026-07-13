# Production consistency practices (zapo-rest)

Primary goal: do not lose WhatsApp event handling; keep projections reliable; keep media recoverable.

Product-facing “why we chose this” write-up (CAS, outbox, SSE split, LID): [`DESIGN-DECISIONS.md`](./DESIGN-DECISIONS.md).

---

## 1. Principles

| Principle | zapo-rest |
|-----------|-----------|
| Persist before side-effect | Upsert `app_messages` + `app_chats` **before** webhooks |
| Dedup side-effects | `processed_events` claim + upsert `(instance, message_id)` |
| Webhook delivery | Postgres **outbox** + retry/backoff + HMAC |
| Handler failure isolation | `runSafe` + per-session serial queue — does not drop the listener |
| Order per session | Promise chain `sessionQueues` per instance |
| Media | Auto-download (retry) + CAS storage + **rehydrate from WA** if object missing |
| LID/PN | `lid_map` + rekey + merge + reconcile |
| Existence cache | Optional Redis on resolve/check |

---

## 2. Event pipeline

```
WhatsApp stanza (zapo-js)
  │
  ▼
InstanceManager.runSafe / enqueueSessionTask(name)
  │ (serial per instance; errors isolated)
  ▼
EventProcessor.onMessage(event, client)
  │
  ├─ decode + LID↔PN map
  ├─ upsert message (media_url = WA CDN if present)
  ├─ upsert chat / contact
  ├─ tryClaim processed_events
  ├─ MEDIA_AUTO_DOWNLOAD? downloadAndStoreMedia (retry 5×) → setMedia
  ├─ if !isNew: return (projection updated, no re-emit)
  └─ webhooks.emit → outbox.enqueue (does not block on client HTTP)
```

Realtime SSE (`GET /v1/events`) mirrors the same bus for the dashboard; it does **not** replace durable webhook delivery.

---

## 3. Media reliability

| Behavior | Detail |
|----------|--------|
| Retry on inbound | 5 attempts, backoff 1s×attempt (cap 3s) |
| Storage | local filesystem or S3-compatible; **CAS** key per instance `…/cas/sha256/{hash}{ext}` |
| Download GET | Prefer **302** to storage (presign); ensure object exists first |
| Missing object | Re-download from WhatsApp (`raw` + mediaKey), re-store, then deliver |
| Base64 | `POST .../getBase64FromMediaMessage` (same ensure path) |
| Fallback failure | 404 only if storage empty **and** WA cannot provide media |

---

## 4. Webhooks

- Multiple URLs per instance.
- Empty `events` = all events; `*` and `message.any` supported.
- HMAC-SHA512 headers: `X-Webhook-Hmac` / `X-Webhook-Hmac-Sha512`.
- Outbox worker polls with `WEBHOOK_WORKER_INTERVAL_MS`.

---

## 5. Production checklist (ops)

### Secrets & identity

1. **`ADMIN_API_KEY`** ≥ 16 characters — generate with `openssl rand -hex 24`. Never leave compose defaults on a public host.
2. **Postgres / Redis / S3 passwords** — unique, not `zapo` / `minioadmin`.
3. **Instance API keys** — returned in plaintext by design for ops/dashboard; treat as bearer secrets, rotate via `POST.../keys/rotate`.

### Network surface

4. Terminate **HTTPS** at a reverse proxy (Caddy, nginx, Traefik, cloud LB).
5. **`/docs` and `/guide` are public** (no API key). Put them behind VPN, IP allowlist, or basic auth on the proxy in production.
6. Prefer **header** auth for SSE (`X-Api-Key` / `Authorization: Bearer`). Avoid `?apiKey=` in production logs.
7. **CORS** — set `CORS_ORIGINS` (comma-separated) in production when the dashboard or SPA is on another origin. Unset in production = CORS disabled (same-origin only). Development defaults to allow any Origin.
8. **Rate limit** — app limits `/v1` by default in production (`RATE_LIMIT_MAX` / `RATE_LIMIT_TIME_WINDOW_MS`). Still put a reverse-proxy limit in front (defense in depth; see §6).

### Process model

9. **Single process owns live WA sessions.** Horizontal scale needs sticky routing per instance (or a future shared bus). Do not run multiple replicas of the API against the same sessions without sticky sessions.
10. Durable volumes for Postgres (+ MinIO/S3). Redis optional.

### Compose / images

11. Compose images are **pinned by tag + digest** (see `docker-compose.yml` header). Override only deliberately.
12. MinIO in compose is **dev-oriented** (often public-read bucket for easy media). Production: private bucket + presigned GET only.

---

## 6. Reverse-proxy sketch (rate limit + docs ACL)

Minimal **Caddy** ideas (adapt domains/secrets):

```caddy
api.example.com {
  # Optional: hide OpenAPI + guide from the public internet
  @docs path /docs* /guide*
  basicauth @docs {
    ops $2a$14$… # caddy hash-password
  }

  # Basic rate limit (Caddy v2.8+ rate_limit module or use Cloudflare)
  reverse_proxy 127.0.0.1:3000
}
```

**nginx** sketch:

```nginx
limit_req_zone $binary_remote_addr zone=zapo_v1:10m rate=30r/s;

server {
  listen 443 ssl http2;
  server_name api.example.com;

  location /v1/ {
    limit_req zone=zapo_v1 burst=60 nodelay;
    proxy_pass http://127.0.0.1:3000;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    # SSE
    proxy_buffering off;
    proxy_read_timeout 3600s;
  }

  location ~ ^/(docs|guide) {
    allow 10.0.0.0/8;   # office / VPN
    deny all;
    proxy_pass http://127.0.0.1:3000;
  }

  location / {
    proxy_pass http://127.0.0.1:3000;
  }
}
```

---

## 7. Future (optional)

1. Shared event bus for multi-process fanout.
2. Kafka/Rabbit adapters only if the deployment already has that infrastructure.
3. Redis-backed rate-limit store for multi-process counters.
