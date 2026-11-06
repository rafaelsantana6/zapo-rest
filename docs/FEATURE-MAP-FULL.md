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
| Interactive buttons/list/template Cloud | ❌ |
| Chats (list/messages/read/archive/history-sync) | ✅ |
| Chat pin/mute/lock + phone app-state projection | ✅ numeric pinned, muted, muteUntil, locked; chat.update |
| Durable action metadata / stale-replay guard / retained empty chats | ✅ survives restart and mailbox imports; canonical alias flags |
| Clear chat / synced delete chat / delete message for me | ✅ preserve starred by default; own devices only; legacy DELETE remains projection-only |
| Contacts (resolve/check/block/picture/about) | ✅ |
| Groups (full lifecycle) | ✅ |
| Group member modes (add, invite link, history bundles) | ✅ Admin-only `PUT /v1/groups/:groupId/settings/{member-add-mode,member-link-mode,history-share-mode}` with `{ mode }`; metadata single/list exposes `memberAddMode`, `memberLinkMode`, `historyShareMode` |
| Group member mode events | 🟡 `group.update` includes `memberAddMode`; zapo-js 1.11.0 has no decoded link/history mode notifications — read metadata |
| Group membership requests | ✅ `GET .../groups/:groupId/membership-requests`; `POST .../approve`, `.../reject`, `.../cancel` (our requests); existing `membership_approval_mode` setting |
| Membership request notifications | ✅ `group.update` with membership `type`, `requesterJid` or `requests[].jid` when supplied upstream |
| Communities lifecycle + metadata | ✅ `POST /v1/communities`, `GET/DELETE /v1/communities/:communityId`; community flags also in group reads |
| Community sub-groups + participants + suggestions | ✅ `GET .../:communityId/subgroups`, `.../participants`, `.../subgroups/suggestions?hint=`; listing/suggestions require MEX |
| Community links + join + ownership | ✅ `POST .../:communityId/subgroups/link`, `.../unlink` (per-group results), `.../:groupId/join`, `.../:communityId/owner` (recipient resolution; MEX) |
| Community notifications | ✅ Existing `group.update` webhook/SSE preserves `link`/`unlink`, `linkedGroups`, `contextGroupJid`; no new event names |
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
