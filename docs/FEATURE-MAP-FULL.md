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
| Calendar event + response (`/messages/event`, `/messages/event/respond`) | ✅ ISO dates; original identity + secret for responses |
| Pin/unpin + keep/unkeep (`/messages/pin`, `/messages/keep`) | ✅ stored targets; explicit pin duration, default 24h |
| Poll vote (`/messages/poll/vote`) | ✅ original author/fromMe/participant + secret; non-empty names |
| Video note (`/messages/ptv`) | ✅ URL/base64/multipart; no caption |
| Sticker pack (`/messages/sticker-pack`) | ✅ gateway cap 30; SSRF-guarded URL/base64 media; JPEG cover derived from tray when omitted; total MEDIA_UPLOAD_MAX_BYTES budget; no accessibilityLabel upstream |
| Typed send context + extended inbound types | ✅ safe contextInfo expiration settings; event / event-response / pin / keep / poll-vote / ptv / sticker-pack summaries |
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


## WhatsApp Channels / Newsletters

| Feature | Status |
|---------|--------|
| Dedicated `/v1/newsletters` area (28 operations, instance key only) | ✅ |
| Discovery, search + cursor, invite lookup and recommendations | ✅ |
| Follow/unfollow/mute and live subscription duration | ✅ caller-managed renewal |
| Reactions, poll votes and view receipts | ✅ numeric server message IDs; option hashes in base64 |
| Metadata CRUD, admin capabilities, followers and admin/ownership lifecycle | ✅ follower count only (no upstream cursor); JPEG pictures ≤256 KiB / 16 MP, PN/LID admin targets |
| Text/image/video/audio/document publish/edit/revoke | ✅ existing URL/base64/multipart helpers; newsletter coordinator; missing MIME is detected, unknown formats → 400 |
| `newsletter.update` / `newsletter.message_update` on webhooks and SSE | ✅ JSON-safe payloads without raw protobuf |
| Channel read/update pages | 🟡 typed transport envelope; decoded pages require an upstream public API; updates require exactly one `before`/`after` cursor, messages allow at most one |
| Channel projection into `app_messages`/chats and chat media storage | N/A — deliberately excluded; existing rows retained |

VoIP errors and queued playback completion: ✅ `call.error` / `call.audio_finished` (webhook/SSE), `call:error` / `call:audio_finished` (control WS). Errors carry `call: null` because upstream drops call identity; public errors exclude private messages, keys and stacks.

VoIP file playback: ✅ `POST /v1/calls/:callId/audio` (`loadAudio`), URL/base64/multipart via capped media helpers, ffmpeg required (503), selects file playback and removes temporary files after decoding.

MLow RED: `VOIP_MLOW_RED=false` (opt-in). Local media sends previous-frame redundancy for loss recovery; DTX is disabled and bandwidth increases. Remote receivers must enable it on the host. Harness comparison: `CALL_HARNESS_MLOW_RED=false|true pnpm test:call-quality`.
