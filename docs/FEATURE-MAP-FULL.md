# Feature map — zapo-rest

Last updated: 2026-07-12

**Legend:** ✅ implemented · 🟡 partial · ❌ not yet · N/A not applicable

---

## 1. Core HTTP surface

| Area | Status |
|------|--------|
| Instances (create/connect/QR/pairing/restart/delete) | ✅ |
| Messages (text/media/sticker/location/contact/reaction/poll/status/star) | ✅ |
| Interactive buttons/list/template Cloud | ❌ |
| Chats (list/messages/read/archive/history-sync) | ✅ |
| Contacts (resolve/check/block/picture/about) | ✅ |
| Groups (full lifecycle) | ✅ |
| Labels | ✅ |
| Calls / VoIP (offer/accept/reject/end/mute/stream) | ✅ |
| WAM telemetry (`@zapo-js/wam`, `WAM_ENABLED` default on) | ✅ |
| Profile / presence / privacy / status stories | ✅ |
| Media local/S3 + stream + getBase64 | ✅ |
| Multi-webhook + HMAC + outbox | ✅ |
| SSE `GET /v1/events` | ✅ |
| Message brokers (Rabbit/Kafka/SQS/…) | ❌ |
| Chatbot product integrations | ❌ (out of core scope) |
| Meta Cloud channel | ❌ |

---

## 2. Media pipeline

1. Inbound message with media → optional auto-download (`MEDIA_AUTO_DOWNLOAD`).
2. Retry download (5×, backoff) then store in local or S3-compatible storage.
3. Projection + webhook payload prefer durable `mediaUrl`.
4. `GET .../messages/:id/media` and `POST .../media/getBase64FromMediaMessage`.

---

## 3. Event consistency

- Upsert projections (`app_messages` / `app_chats`) before webhook side-effects.
- `processed_events` claim for idempotent webhooks.
- Per-instance serial task queue (failures do not drop the chain).
- Webhook outbox with retries + HMAC-SHA512.

---

## 4. Dashboard modules

| Module | Status |
|--------|--------|
| Instances / home / QR | ✅ |
| Live chat / FullChat | ✅ |
| Softphone / calls | ✅ |
| Webhooks UI | ✅ |
| Contacts / groups / labels / LIDs | ✅ |
| Media / presence / privacy / status | ✅ |
| Metrics / API explorer / send tester / events SSE | ✅ |

---

## 5. Explicit non-goals (core)

- Chatwoot / Typebot / generic bot runtimes
- Meta Cloud API HSM templates
- Multi-region message bus adapters (Kafka/NATS/…) as first-class products
