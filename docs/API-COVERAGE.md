# API feature coverage (zapo-rest)

Last updated: 2026-07-12

Legend: ✅ implemented · 🟡 partial · ❌ not yet

---

## Phone / JID / existence

| Capability | Status |
|------------|--------|
| BR 9th digit local normalize | ✅ `createJid` + `toRecipientJid` |
| MX/AR mobile prefix | ✅ |
| Check exists (batch) | ✅ `POST .../contacts/check` + `.../resolve` + `.../whatsapp-numbers` |
| Single check | ✅ `GET .../contacts/check?phone=` |
| Local JID build | ✅ `POST .../contacts/jid` |
| Transparent send (auto-resolve) | ✅ send routes resolve via usync + cache |
| Batch without spam | ✅ single `getLidsByPhoneNumbers` batch including digit variants |

---

## Instances / sessions

| Area | Status |
|------|--------|
| Create / list / delete | ✅ |
| Connect / QR / pairing | ✅ |
| Restart / logout | ✅ restart; logout via disconnect |
| Connection state | ✅ `status` field |
| Presence set | ✅ |

---

## Messages (send)

| Feature | Status |
|---------|--------|
| Text / reply / quote | ✅ |
| Image / video / audio / document / sticker | ✅ |
| Location / contact vCard / poll | ✅ |
| Reaction / edit / revoke | ✅ |
| Star / unstar | ✅ `POST .../messages/star` |
| Status / stories | ✅ send/revoke/privacy/mute |
| Buttons / list / template (Cloud) | ❌ |
| Forward | ✅ |

---

## Chats / history

| Feature | Status |
|---------|--------|
| List chats / get messages | ✅ |
| Mark read / archive / unread | ✅ |
| Delete chat (local store) | ✅ |
| History sync on pair | ✅ |
| On-demand history | ✅ `.../history-sync` |
| Group history receive | ✅ `HISTORY_GROUP_BUNDLES` (default on) → `history.group` |
| Share group history | ✅ `POST .../groups/:groupId/share-history` |
| Media download / base64 / stream | ✅ |

---

## Contacts / groups / profile

| Feature | Status |
|---------|--------|
| List contacts, about, picture | ✅ |
| Block / unblock / blocklist | ✅ |
| LID map list/count/get | ✅ |
| Groups full lifecycle | ✅ |
| Profile get/update | ✅ |
| Username get/set/delete/check/resolve | ✅ `/profile/username` |
| Send to `@handle` | ✅ `to` on messages, calls, blast |

---

## Realtime / webhooks / VoIP

| Feature | Status |
|---------|--------|
| Multi-webhook + HMAC + outbox | ✅ |
| SSE `GET /v1/events` | ✅ |
| VoIP control WS + PCM stream | ✅ |
| In-call hand raise / emoji reactions | ✅ `POST .../calls/:id/hand` · `.../reaction` + WS `call:hand` / `call:reaction` |
| Group calls (start / leave / join / ask to mute) | ✅ `POST .../calls` (`groupId` + `participants`) · `.../calls/:id/leave` · `.../join` · `.../participants/mute` + WS `call:leave` / `call:join` / `call:mute_participant` |
| Video calls, 1:1 and group (`isVideo`, H.264 WS `.../calls/:id/video`) | ✅ |
| Audio → video upgrade, group camera, screen share | ✅ `POST .../calls/:id/video/upgrade` (+ `/accept` `/reject` `/cancel`) · `.../video` · `.../screen-share` + WS `call:video_upgrade*` / `call:video` / `call:screen_share` |
| Group call per-participant video (`setVideoSubscriptions`) | ❌ (upstream does not send it to the relay yet) |
| Message brokers (Kafka/SQS/…) | ❌ |

---

## Ops

| Feature | Status |
|---------|--------|
| Dashboard SPA | ✅ |
| OpenAPI `/docs` + guide `/guide` | ✅ |
| Docker Compose stack | ✅ |
| Metrics routes | ✅ |
