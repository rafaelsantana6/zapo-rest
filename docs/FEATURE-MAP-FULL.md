# Feature map — zapo-rest

Last updated: 2026-07-14

**Legend:** ✅ implemented · 🟡 partial · ❌ not yet · N/A not applicable

---

## 1. Core HTTP surface

| Area | Status |
|------|--------|
| Instances (create/connect/QR/pairing/restart/delete) | ✅ |
| Dual instance paths (named `/v1/instances/:name/...` + short `/v1/...` / `/v1/instance/...`; admin must name) | ✅ |
| Messages (text/media/sticker/location/contact/reaction/poll/status/star) | ✅ |
| Interactive response buttons/native flow/single-select list | ✅ raw proto (`/messages/buttons`, `/interactive`, `/list`) |
| Carousel image/video | ✅ `/messages/carousel`; upstream 1.11 has no carousel biz addon, device verification pending |
| Business app native forms + structured responses | ✅ `/messages/native-form`, 1:1 only, flowToken + fields/answers |
| PIX / review-and-pay charge | ✅ `/messages/pix`, `/messages/charge`, validated key formats and integer money |
| Real catalog product card | ✅ `/messages/product`, uploaded optional image, catalog product required |
| Group-safe private quick replies | ✅ opt-in `groupSafe` on buttons/interactive, own PN wa.me links |
| Standalone catalog_message | ❌ upstream biz-name fix pending; working alternative: cta_catalog in interactive/carousel (include URL CTA on mobile cards) |
| Cloud templates | ❌ |
| Chats (list/messages/read/archive/history-sync) | ✅ |
| Contacts (resolve/check/block/picture/about) | ✅ |
| Groups (full lifecycle) | ✅ |
| Labels | ✅ |
| Calls / VoIP (offer/accept/reject/end/mute/stream) | ✅ |
| In-call hand raise + emoji reactions (`/calls/:id/hand`, `/calls/:id/reaction`) | ✅ |
| Group calls (`groupId` + `participants`, `/calls/:id/leave`, `/calls/:id/join`, `/calls/:id/participants/mute`) | ✅ |
| Video calls, 1:1 and group (`isVideo`, H.264 WS `.../calls/:id/video`) | ✅ |
| Video upgrade, group camera, screen share (`/calls/:id/video/upgrade`, `/calls/:id/video`, `/calls/:id/screen-share`) | ✅ |
| Audio blast + STT (`/calls/blast`, `/calls/:id/transcribe`) | ✅ |
| WAM telemetry (`@zapo-js/wam`, `WAM_ENABLED` default on) | ✅ |
| Postgres L1 read cache (`STORE_L1_CACHE`, single-process/sticky-sessions only) | ✅ |
| Profile / presence / privacy / status stories | ✅ |
| Username `@handle` (get/set/check/resolve, `@handle` on send) | ✅ |
| Group history receive (`HISTORY_GROUP_BUNDLES`) + share | ✅ |
| Profile set push name + avatar (`/profile/name`, `/profile/image` — URL/base64/multipart) | ✅ |
| Media send: URL · base64 · multipart (`MEDIA_UPLOAD_MAX_BYTES`) | ✅ |
| Media local/S3 + stream + getBase64 | ✅ |
| Multi-webhook + HMAC + outbox | ✅ |
| SSE `GET /v1/events` | ✅ |
| Message brokers (Rabbit/Kafka/SQS/…) | ❌ |
| Chatbot product integrations | ❌ (out of core scope) |
| Meta Cloud channel | ❌ |

---

## 2. Media pipeline

1. Inbound message with media → optional auto-download (`MEDIA_AUTO_DOWNLOAD`).
2. Retry download (5×, backoff). CDN 404/410 asks the sender to re-upload once, then stores in local or S3-compatible storage.
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

## Interactive receive

Existing message webhooks/SSE expose readable buttons/list/interactive/carousel/product/order and response types. Optional `interactive` includes selected ID/text, first native button name/parsed params, or native-form fields across screens, answers, sensitivity and quoted flowToken. Decoder extension lives in `src/events/decode-interactive.ts`. One pure builder per send format stays isolated under `src/messages/interactive/`; upstream owns secrets/biz/encryption. See [wire contract and limitations](../README.md#interactive-and-business-messages).
