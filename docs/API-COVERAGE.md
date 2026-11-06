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
| Pin/unpin, mute/unmute, lock/unlock | ✅ `POST /chats/:chatId/{pin,mute,lock}`; projected phone mutations |
| Clear chat (preserve starred by default) | ✅ `POST /chats/:chatId/clear` |
| Delete chat on own linked devices | ✅ `POST /chats/:chatId/delete`; legacy DELETE remains local chat-row only |
| Delete message for me | ✅ `DELETE /chats/:chatId/messages/:messageId/for-me` |
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
