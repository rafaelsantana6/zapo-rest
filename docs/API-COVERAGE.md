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
| Buttons / native flow / single-select list | ✅ `/messages/buttons`, `/interactive`, `/list` (raw proto, not Cloud templates) |
| Image/video carousel | ✅ `/messages/carousel` (2–10 cards; 1.11 has no carousel biz addon; verify on devices) |
| Phone-created native form | ✅ `/messages/native-form` (1:1 only; returned flowToken) |
| PIX key / review-and-pay charge | ✅ `/messages/pix`, `/messages/charge` |
| Real catalog product | ✅ `/messages/product` (catalog membership required) |
| Catalog CTA | ✅ `catalog`/`cta_catalog` inside `/messages/interactive` or carousel (mobile cards also need URL CTA) |
| Standalone catalog_message | ❌ Pending upstream biz-name fix (1.11 selects mixed → unsupported); use catalog CTA above |
| Cloud template send | ❌ |
| Forward | ✅ |
| Calendar event / response | ✅ `POST .../messages/event` (ISO dates) · `.../event/respond` (stored identity + secret) |
| Pin / unpin · keep / unkeep | ✅ `POST .../messages/pin` (24h/7d/30d; default 24h) · `.../keep` |
| Poll votes | ✅ `POST .../messages/poll/vote` (non-empty option names; stored identity + secret) |
| Round video note (PTV) | ✅ `POST .../messages/ptv` — URL/base64/multipart; no caption |
| Sticker packs | ✅ `POST .../messages/sticker-pack` — gateway cap 30; URL/base64 for stickers/tray/cover; JPEG cover derived from tray when omitted; total MEDIA_UPLOAD_MAX_BYTES budget; no accessibilityLabel upstream |
| Safe send context | ✅ `contextInfo.expirationSeconds` / `ephemeralSettingTimestamp` on typed sends; raw messageContextInfo not exposed |
| Extended inbound decoding | ✅ event / event-response / pin / unpin / keep / unkeep / poll-vote / ptv / sticker-pack with summaries |

---

## Chats / history

| Feature | Status |
|---------|--------|
| List chats / get messages | ✅ |
| Mark read / archive / unread | ✅ |
| Delete chat (local store) | ✅ |
| Pin/unpin, mute/unmute, lock/unlock | ✅ `POST /chats/:chatId/{pin,mute,lock}`; projected phone mutations |
| Clear chat (preserve starred by default) | ✅ `POST /chats/:chatId/clear` |
| Delete chat on own linked devices | ✅ `POST /chats/:chatId/delete`; legacy DELETE remains local chat-row only |
| Delete message for me | ✅ `DELETE /chats/:chatId/messages/:messageId/for-me` |
| Durable chat actions | ✅ deletion cutoffs, pending stars, timestamp ordering; history/replay-safe and LID-aware |
| Chat flags | ✅ numeric `pinned`, `muted`, ISO `muteUntil`, `locked`; existing `muteEndMs` retained |
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
| Who can add members | ✅ `PUT /v1/groups/:groupId/settings/member-add-mode` — `admin_add` / `all_member_add` |
| Who can share invite links | ✅ `PUT /v1/groups/:groupId/settings/member-link-mode` — `admin_link` / `all_member_link` |
| Who can share history bundles | ✅ `PUT /v1/groups/:groupId/settings/history-share-mode` — `admin_share` / `all_member_share`; governs `share-history`, not `HISTORY_GROUP_BUNDLES` receiving |
| Member mode reads | ✅ `GET /v1/groups/:groupId` + list: `memberAddMode`, `memberLinkMode`, `historyShareMode` when reported |
| Member mode notifications | 🟡 `group.update` adds `memberAddMode` for `member_add_mode`; link/history notifications are not decoded by zapo-js 1.11.0 (query metadata) |
| Group membership requests | ✅ `GET .../groups/:groupId/membership-requests`; `POST .../approve`, `.../reject`, `.../cancel` (our requests); existing `membership_approval_mode` setting |
| Membership request notifications | ✅ `group.update` with membership `type`, `requesterJid` or `requests[].jid` when supplied upstream |
| Communities lifecycle + metadata | ✅ `POST /v1/communities`, `GET/DELETE /v1/communities/:communityId`; community flags also in group reads |
| Community sub-groups + participants + suggestions | ✅ `GET .../:communityId/subgroups`, `.../participants`, `.../subgroups/suggestions?hint=`; listing/suggestions require MEX |
| Community links + join + ownership | ✅ `POST .../:communityId/subgroups/link`, `.../unlink` (per-group results), `.../:groupId/join`, `.../:communityId/owner` (recipient resolution; MEX) |
| Community notifications | ✅ Existing `group.update` webhook/SSE preserves `link`/`unlink`, `linkedGroups`, `contextGroupJid`; no new event names |
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

### Interactive receive details

Existing message webhook/SSE types: `buttons`, `list`, `interactive` (first native button name), `carousel`, `product`, `order`, `buttons_response`, `list_response`, `template_reply`, `native_flow_response`, `native_form_response`. Readable `body` plus optional `interactive` selection/params/form fields, answers, sensitivity and quoted flowToken. No additional event names. `groupSafe` is opt-in on buttons/interactive; amounts: charge major BRL units → cents/100, product prices in thousandths. See [README](../README.md#interactive-and-business-messages).


## WhatsApp Channels / Newsletters

| Capability | Status |
|------------|--------|
| Followed list, metadata, invite lookup, directory search + cursor, recommendations | ✅ `GET /v1/newsletters`, `/:jid`, `/by-invite/:code`, `/search`, `/recommended`; absent lookup metadata → 404 |
| Message pages and update ranges | 🟡 `/:jid/messages`, `/:jid/updates`: JSON transport envelope with base64 bytes; upstream 1.11 has no public decoded page API. Updates require exactly one `before`/`after`; messages permit at most one |
| Follow/unfollow, mute, temporary live subscription | ✅ `POST /:jid/follow`, `/unfollow`, `/mute`, `/live-updates`; caller renews `durationSeconds` |
| Reactions, poll votes, view receipts | ✅ `/:jid/messages/:messageId/react`, `/vote`, `/view`; numeric server IDs and base64 poll hashes |
| Channel create/update/delete, admin info + capabilities, followers | ✅ `POST /v1/newsletters`, `PATCH/DELETE /:jid`, `GET /:jid/admin`, `/followers` (count only); picture is a decodable JPEG ≤256 KiB / 16 MP |
| Admin invite/accept/revoke/demote, ownership, pending invites | ✅ `/:jid/admins/invite`, `/invite/accept`, `/invite/revoke`, `/demote`, `/:jid/owner`, `/:jid/pending-invites`; admin targets are resolved PN/LID users only |
| Text/image/video/audio/document publishing, edit, revoke | ✅ `POST /:jid/messages`, `PATCH/DELETE /:jid/messages/:messageId`; URL/base64/multipart; detect absent MIME or return 400 for unknown formats |
| Channel events | ✅ `newsletter.update`, `newsletter.message_update` via webhook/SSE; no raw protobuf |
| Local channel projections / stored channel media | N/A — deliberately excluded; read from WhatsApp directly |

VoIP errors and queued playback completion: ✅ `call.error` / `call.audio_finished` (webhook/SSE), `call:error` / `call:audio_finished` (control WS). Errors carry `call: null` because upstream drops call identity; public errors exclude private messages, keys and stacks.

VoIP file playback: ✅ `POST /v1/calls/:callId/audio` (`loadAudio`), URL/base64/multipart via capped media helpers, ffmpeg required (503), selects file playback and removes temporary files after decoding.

MLow RED: `VOIP_MLOW_RED=false` (opt-in). Local media sends previous-frame redundancy for loss recovery; DTX is disabled and bandwidth increases. Remote receivers must enable it on the host. Harness comparison: `CALL_HARNESS_MLOW_RED=false|true pnpm test:call-quality`.

Per-participant PCM (local only): `VOIP_PARTICIPANT_AUDIO=false` by default. Opt in via `/v1/calls/:callId/stream?participants=1`: every server frame gains a 4-byte header (`u8 version=1`, `u8 reserved=0`, `u16 BE streamId`), then f32le PCM. Mix id 0; participant ids announced with JSON `stream` (`participantJid`) and retired with `stream_end`. Client frames stay raw PCM. Without the flag, protocol unchanged. Disabled opt-in: close 4409. No PCM on SSE/webhooks; no separate participant recordings.

Remote call media: ✅ `VOIP_MEDIA_MODE=local|remote` (default local, fixed per instance client; restart after changes). `mediaMode` in instance/call reads; private WS `call:media` / `call:media_event` with upstream wire strings, snapshots on late join/resync, direct browser MLow/SRTP/H.264 and stop stats. Secret plans bypass bus/webhooks/logs/persistence. Local-only file/PCM/video/recording/blast/STT → 409 / WS 4409 in remote mode. Browser group host → `call.error` (`REMOTE_GROUP_UNSUPPORTED`, needs group/1 + raw-udp). Deferred: persisted per-instance mode override, start-call audioFile/audioUrl, participant recordings. Upstream unsupported: `setVideoSubscriptions`.
