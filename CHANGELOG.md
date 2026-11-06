# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- `POST /v1/calls/:callId/audio` loads URL/base64/multipart audio through upstream ffmpeg (503 if missing), switches off external audio and cleans temporary files after decoding; completion arrives as `call.audio_finished`.

- VoIP `call.error` and `call.audio_finished` webhook/SSE events and control WS `call:error` / `call:audio_finished`. Errors expose a sanitized public message/code and `call: null` because upstream omits call identity; playback completion includes the call snapshot.
- Seven typed message routes: calendar events (`POST /v1/messages/event`, ISO dates with end ≥ start), event responses (`.../event/respond`), pin/unpin (`.../pin`, explicit 24h/7d/30d TTL), keep/unkeep (`.../keep`), poll votes (`.../poll/vote`), round video notes (`.../ptv`, URL/base64/multipart without caption), and sticker packs (`.../sticker-pack`, gateway limit 30 stickers). All return `{ id, result }`. Targeted actions recover the original instance/chat identity; votes/responses use the original secret from the session cache or stored payload (`404` absent original, `409` unavailable secret/author).
- Safe `contextInfo` (`expirationSeconds`, `ephemeralSettingTimestamp`) on typed sends; raw `messageContextInfo` stays internal. Sticker `accessibilityLabel` is rejected because zapo-js 1.11 does not expose it.
- Inbound type/summary decoding for events, event responses, pin/unpin, keep/unkeep, poll votes and sticker packs; PTV retains its video MIME type.
- **Group member modes.** Admin-only `PUT /v1/groups/:groupId/settings/member-add-mode`, `.../member-link-mode`, and `.../history-share-mode` accept `{ mode }` with the upstream enums. Metadata reads (single and list) expose `memberAddMode`, `memberLinkMode`, and `historyShareMode` when reported. The last controls who can send `share-history` bundles, independently of receiving via `HISTORY_GROUP_BUNDLES`. Invalid modes return 400 with accepted values; WhatsApp missing-group and admin errors map to 404/403.
- `group.update` for upstream `member_add_mode` changes now also carries `memberAddMode`, retaining `action` and `mode`. zapo-js 1.11.0 does not decode link/history-share mode notifications; query metadata to observe those changes.
- **Group join requests.** `GET /v1/groups/:groupId/membership-requests` lists pending requests with ISO timestamps and optional requester metadata. `POST .../membership-requests/approve`, `/reject`, and `/cancel` accept `{ "participants": ["phone-or-jid"] }`; cancel withdraws requests sent by this account. The existing `membership_approval_mode` setting enables approval. Known upstream permission, missing-group and approval-mode errors return 403/404/409 with the upstream message.

- **WhatsApp Communities.** Ten instance-scoped endpoints under `/v1/communities`: create/deactivate, metadata, linked sub-groups, merged participants, suggestions, link/unlink, join and ownership transfer. Creation exposes all upstream community options; unlink supports `removeOrphanedMembers`, join supports optional `type`, and owner inputs use recipient resolution. Group ids accept digits or `@g.us` JIDs. Link/unlink preserve per-group partial failures. Unknown communities and ordinary groups return 404. Sub-group listing, suggestions and ownership transfer require the upstream MEX transport.
- Group and community metadata share serialization and expose `isParentGroup`, `isClosedCommunity`, `defaultSubgroup`, `generalSubgroup`, `hiddenSubgroup`, `allowNonAdminSubGroupCreation` and `linkedParentJid` in OpenAPI. Existing `group.update` webhook/SSE payloads preserve upstream community `link`/`unlink`, `linkedGroups` and `contextGroupJid`; no new event names.

- Chat actions: `POST /v1/chats/:chatId/pin`, `/mute`, `/lock`, `/clear`, `/delete` and `DELETE /v1/chats/:chatId/messages/:messageId/for-me`. Mute accepts ISO `until` or `durationSeconds`, defaulting to forever. Clear preserves starred messages/media by default. Synced delete removes the chat/history for your account, without leaving groups; the existing `DELETE /v1/chats/:chatId` remains projection-only.
- Chat reads expose `muted`, `muteUntil`, `locked` alongside existing numeric `pinned` and `muteEndMs`. Phone app-state pin/mute/lock/archive/read/clear/delete changes update projections and emit the existing `chat.update` webhook/SSE event after persistence. Lock storage is migrated idempotently.

- **WhatsApp Channels (`Newsletters`).** 28 instance-key operations under `/v1/newsletters`: discovery/search/recommendations, message/update reads, follow/unfollow/mute, temporary live subscriptions, reactions/poll votes/view receipts, channel metadata CRUD, admin capabilities/followers/invitations/ownership, and publishing/editing/revoking text or image/video/audio/document media (URL, base64 or multipart). Public metadata and event payloads use explicit schemas. New webhook/SSE events: `newsletter.update` and `newsletter.message_update`.
- Channel guides in Portuguese, English and Spanish, with separate publishing stanza IDs vs numeric server IDs, base64 poll option hashes, and caller-managed live-subscription renewal. Upstream read pages remain typed transport envelopes with base64 bytes because zapo-js 1.11 does not export a decoded page API.

### Changed

- `group.update` preserves its upstream payload and adds `type` for membership notifications: `membership_approval_request` adds `requesterJid` from the upstream author, while `created_membership_requests` / `revoked_membership_requests` add `requests` with requester JIDs when supplied upstream. The event name and SSE transport stay the same.

- Membership notification documentation distinguishes webhook `payload.*` from SSE `data.*`; the OpenAPI webhook example now matches the delivered envelope (`id`, numeric `timestamp`, `engine`, `payload`).

- Chat actions persist per-chat cutoffs, settings and pending message stars/deletions so mailbox imports and live replays cannot restore removed history or overwrite newer settings. Clear/delete preserve messages newer than the action boundary; empty cleared chats remain listed through reconcile, and LID/PN listings use authoritative settings. Stale app-state mutations are rejected by timestamp; current mutations can retry after partial persistence failures. OpenAPI now marks clear/delete bodies optional.
- Chat projection upserts preserve omitted settings, so new messages do not reset pin/archive/mute/read/lock state. New chat-action routes return upstream conflicts as 409 and connection failures as 503, without applying a successful local-only fallback.

- Channel messages are explicitly excluded from new `app_messages`/chat projections and mailbox history imports, consistent with their existing exclusion from chat listings. Existing stored rows are not migrated or deleted; use the dedicated channel read endpoints.

### Fixed

- Community sub-group inputs accept legacy hyphenated `@g.us` JIDs for linking, unlinking, suggestions and joining. The join request body is optional in OpenAPI as well as at runtime. Community operations document 401 and 502 responses; missing MEX transport returns 503, and recognized MEX failures return 502 with a static public message while IQ errors retain their existing status mapping.
- Newsletter update reads now require exactly one `before`/`after` cursor; message pages reject both cursors together. Examples include the cursor required by zapo-js even when `since` is provided.
- Channel base64/data-URL media without `mimetype` now uses file detection before publishing/editing; unrecognized formats return an actionable `400`, with temporary media cleaned on every path.
- Missing channel metadata envelopes from upstream JID/invite lookups now return `404`, while unrelated transport failures remain errors.
- Inline channel pictures are checked as decodable JPEGs (max 256 KiB decoded / 16 megapixels). Admin actions reject group, broadcast and channel targets and require resolved PN/LID user JIDs.

### Changed

- Stored-message targets accept explicit and mapped PN/LID aliases. Group targets recover a valid author from the mailbox sender; group/broadcast/newsletter JIDs cannot be authors. Self-authored direct-message history requires proof of the original author (`409` if unavailable), rather than using the peer.
- Explicit safe context settings are forwarded as send options so the upstream chat-ephemeral auto-injection cannot override the requested expiration.
- Sticker-pack covers are always normalized to JPEG 252×252 and derived from the tray icon when omitted. The complete pack (source files plus generated JPEG) shares one `MEDIA_UPLOAD_MAX_BYTES` budget; over-budget downloads abort and all temporary files are removed.

## [0.10.0] - 2026-11-06

### Added

- **Group calls (voip 1.4).** `POST /v1/calls` takes `groupId` + `participants` (phones, JIDs or LIDs, max 31) instead of `to`; participants are resolved to LIDs and any without one returns `400` with `details.missing`. `POST /v1/calls/:callId/leave` leaves a group call the others stay on (`409` on a 1:1 call), `POST /v1/calls/:callId/join` joins one going on without you, and `POST /v1/calls/:callId/participants/mute` (`{ "participant": "…@lid" }`) asks a participant to mute. Same on the VoIP control WS: `call:leave`, `call:join`, `call:mute_participant`. New webhook/WS events `call.participants_changed`, `call.mute_requested`, `call.participant_media`. The call snapshot gains `isGroup`, `groupJid` and `participants`.
- **Video calls, 1:1 and group.** `POST /v1/calls` accepts `isVideo: true`, with `to` or with `groupId` (`/v1/voip` `call:start`: `video: true`). The response carries `mediaType`. A WebSocket, `GET /v1/calls/:callId/video`, carries bidirectional H.264 (Annex-B, 12-byte binary header) next to the PCM stream. Each remote sender gets its own `streamId` in the header, announced by a JSON `stream` message with its `participantJid` and retired by `stream_end` when it leaves or switches device, so a group call decodes one stream per participant. The socket also opens on audio calls, which can turn into video mid-call.
- **Audio → video mid-call.** `POST /v1/calls/:callId/video/upgrade` (WS `call:video_upgrade`) returns the peer's answer (`accepted`, `rejected`, `timeout`, …); on a group call it asks the server. Answer the peer's request with `.../video/upgrade/accept` or `.../reject`; `.../cancel` withdraws ours. `POST /v1/calls/:callId/video` (`{ "enabled": true }`, WS `call:video`) turns the camera on or off on a group call.
- **Screen share.** `POST /v1/calls/:callId/screen-share` (`{ "sharing": true }`, WS `call:screen_share`). The screen replaces the camera on the same video stream.
- New webhook/WS events: `call.video_state` (peer camera state; `upgradeRequested: true` asks to turn on video), `call.video_upgraded` (a group call became video), and `call.screen_share` (on the control WS `call:screen_share_changed`, since `call:screen_share` is the command). `mediaType` reads `video` once a 1:1 call upgraded mid-call (upstream keeps the negotiated `audio`). The call snapshot gains `videoOff`, `screenSharing`, `peerVideoState`, `peerScreenSharing`, and `participantMedia` (per device: mic, camera, screen, media arriving).
- **Dashboard softphone video.** It has a "Vídeo" call button, one remote tile per participant, a local preview and a camera toggle. It can also upgrade an audio call ("Vídeo"), answer the peer's upgrade request, switch camera mid-call ("Trocar câmera"), and share the screen (Chrome/Edge, WebCodecs). The settings tab picks the camera and tests it with the call's own H.264 encoder, naming the reason when it cannot open (permission, in use, not found, no HTTPS). A status line shows what is being sent and how many frames went out. The encoder runs without a camera, so a camera that fails still leaves screen share working.
- **Call quality harness.** `pnpm test:call-quality` runs real video calls end to end, in both directions, without WhatsApp. A fake phone uses the plugin's own SRTP, MLow and H.264. A local UDP relay simulates network conditions (latency, jitter, loss, bandwidth). The run measures fps, decodable frames, latency, freezes, audio latency and gaps, and A/V skew, and writes a report to `.cache/call-harness/reports/`.

- `WA_DEVICE_BROWSER` / `WA_DEVICE_OS` set the companion identity shown under the phone's "Linked devices" (unset keeps Firefox + host OS). Saved at pairing: re-pair to change it.

### Changed

- WebSocket messages are capped at the largest legitimate frame, one H.264 key frame (`VIDEO_MAX_FRAME_BYTES` + header, about 2 MiB), instead of the `ws` default of 100 MiB.
- `Permissions-Policy` now allows `camera` and `display-capture` for the same origin (was `camera=()`), so the dashboard softphone can open the camera and share the screen.
- Softphone video encoder: 350 kbps, 480×360, IDR every 1 s, constant bitrate (was 600 kbps / 640×480 / 2 s). In the call harness this cuts Wi-Fi freezes from 1.8 s to 0.8 s; on a 450 kbps uplink the phone gets 15 fps instead of no video. The 1 s IDR also shortens the start of our video, which voip 1.4 holds until the peer is ready and then opens on the next key frame.

## [0.9.0] - 2026-11-05

### Added

- **Username (`@handle`).** `GET/PUT/DELETE /v1/profile/username`, `GET /v1/profile/username/check`, and `POST /v1/profile/username/resolve`. Message `to` accepts `@handle` (and `@handle:key`). Inbound events include `senderUsername` and `recipientUsername`. Another device changing the handle emits `profile.username`. The recovery PIN is not returned.
- **Group history for members who joined later.** `HISTORY_GROUP_BUNDLES` defaults on, so a shared bundle is downloaded, imported into `app_*`, and announced as `history.group`. `POST /v1/groups/:groupId/share-history` sends a bundle to specific members when the account has `group_history_send`.
- **In-call hand raise and emoji reactions.** `POST /v1/calls/:callId/hand` (`{ "raised": true }`) raises or lowers the local hand — durable until lowered, announced to the peer; 404 on an unknown call. `POST /v1/calls/:callId/reaction` (`{ "reaction": "👍" }`, 1–32 chars) sends a momentary emoji reaction; 409 when the call is not active or its reaction channel is not open yet. Same ops on the VoIP control WS: `call:hand`, `call:reaction`. Peer-side interactions arrive as webhook/WS `call.peer_mute`, `call.hand_raise`, `call.reaction`. The call snapshot gains `peerAudioMuted`, `handRaised`, `raisedHands`; `endReason` can now also be `accepted_elsewhere`, `rejected_elsewhere`, or `relay_lost`.
- **`instance.pairing_required`** webhook/SSE event, `{ "forceManual": boolean }`. `forceManual: true` means the pending pairing code or QR is dead (refresh budget spent, or zapo could not re-register the code after a reconnect): request a new one.
- Number checks (`POST .../contacts/check`, `.../resolve`, `GET .../contacts/check`) return `status` (`in`, `out`, `invalid`, `error`, `unanswered`, or `local` when no lookup ran) and `lookupError`.
- **`STORE_L1_CACHE`** (default `false`). In-process L1 read cache in front of the Postgres-backed Signal session, identity, sender-key, and privacy-token rows — fewer Postgres reads on the decrypt/encrypt hot path. Safe only with a single process or sticky sessions per instance (the supported deployment model). `STORE_L1_IDLE_TTL_SECONDS` (default `1800`, `0` = only the size cap evicts) bounds how long an idle peer stays cached.

### Changed

- A number lookup the server did not answer (`status` `error` / `unanswered`) is no longer cached. Before, it was stored for 24h as `exists: false`, so a valid number read as "not on WhatsApp" for a day.
- `call.peer_mute` and `call.reaction` carry `participantJid`, the device that sent them (needed to tell participants apart on group calls). `endReason` can also be `setup_failed` (the server refused the offer) or `invisible` (taken off a group call that goes on).
- Inbound auto-download and `GET .../messages/:id/media` rehydrate now ask the sender to re-upload when the WhatsApp CDN returns 404 or 410 (expired blob, typical of history). The new `directPath` is downloaded once; `not_found` fails without repeating the dead URL. Transient errors still retry 5×.
- Meta AI rich responses are stored as text (submessage text, image captions, and code blocks). A bot-forwarded message uses the inner type, so a forwarded image stays media instead of `unknown`.
- `POST .../calls/:callId/mute` now also announces the mute state to the peer (upstream `@zapo-js/voip` 1.2 behavior).
- Media reupload now fails immediately — `media reupload re-encrypted: ...` → `message.media.failed`, no retry — when the re-served blob still fails `media MAC mismatch` / `file hash mismatch`: some primaries re-encrypt on reupload and nothing in the response carries the new key.

### Fixed

- Remote video in video calls. `@zapo-js/voip` 1.1.0 does not mark WhatsApp-packed key frames (SPS+PPS+IDR in one FU-A) as `keyFrame`. The `/video` socket now detects IDR/SPS itself, so browser decoders get a key frame and start (`isH264KeyFrame`).

### Dependencies

- **Runtime**: `zapo-js` 1.8.1 → [1.9.0](https://github.com/vinikjkkj/zapo/releases/tag/v1.9.0).
  Also picks up [1.8.2](https://github.com/vinikjkkj/zapo/releases/tag/v1.8.2): offline resume now
  pulls the next stanza batch until the queue drains (vinikjkkj/zapo#269), and group phash no
  longer fails once a group resolves past 2048 devices (vinikjkkj/zapo#271). 1.9.0 classifies AI
  rich-response messages as text so they deliver (vinikjkkj/zapo#273), honours an HTTP proxy on
  the mobile transport after SMS registration (vinikjkkj/zapo#276), and adds iOS to the
  mobile-primary login payload (vinikjkkj/zapo#285). No zapo-rest API change.
- **Runtime**: `@zapo-js/voip` 1.0.0 → [1.1.0](https://github.com/vinikjkkj/zapo/blob/v1.9.0/packages/voip/CHANGELOG.md)
  (shipped with zapo v1.9.0). Relay dials move to the web-client port 3480 so calls are no longer
  silently one-way (vinikjkkj/zapo#254), incoming offers expose `callerPn`, and the plugin adds
  bidirectional video. The REST/WS call surface is unchanged.
- **Runtime**: `zapo-js` 1.9.0 → [1.10.0](https://github.com/vinikjkkj/zapo/releases/tag/v1.10.0).
  Fixes one-way/silent audio on incoming calls, ends a call here when another linked device
  answers or declines it elsewhere (`endReason: "accepted_elsewhere"` / `"rejected_elsewhere"`),
  stops `ignoreKey` from dropping genuine own-device peer messages, and sends the group member
  list as media.
- **Runtime**: `@zapo-js/voip` 1.1.0 → [1.2.0](https://github.com/vinikjkkj/zapo/releases/tag/v1.10.0).
  Call media moves to `@zapo-js/voip-media`; adds hand raise and in-call emoji reactions, and
  `setMute` now announces the local mic state to the peer. zapo-rest exposes the new interactions
  as described in Added, above.
- **Runtime**: `zapo-js` 1.10.0 → [1.11.0](https://github.com/vinikjkkj/zapo/releases/tag/v1.11.0).
  Lookup status per phone number (used above), pairing code re-registered after a reconnect,
  pairing waits for the server's connection restart, `requireFullSync` sent at pairing, socket
  and noise state bound to their connection, album and group-retry fixes. Also adds group calls,
  `messageContextInfo` on typed sends, `history.sink` and `syncSignalSession({ force })`, not
  exposed yet.
- **Runtime**: `@zapo-js/voip` 1.2.0 → 1.4.0 (with `@zapo-js/voip-media` 0.3.0): call audio at
  parity with the official clients, group calls, and per-participant events.
- **Runtime/Dev**: minor and patch bumps of fastify and plugins, AWS SDK, zod, pg, pino, sharp, ws,
  biome, tsx and `@zapo-js/fake-server` 1.3.1. `vitest` 5 (major) is not included.
- **Runtime**: peer dependency `libmlow-wasm` → `libmlow-wasm-fork` ^0.2.0 — voip 1.2 moved call
  media to `@zapo-js/voip-media`, which forks this native dependency. No zapo-rest API change.

## [0.8.1] - 2026-08-29

### Dependencies

- **Runtime**: `zapo-js` 1.8.0 → [1.8.1](https://github.com/vinikjkkj/zapo/releases/tag/v1.8.1) (#96) —
  upstream fixes only, no API changes: retry ladder now reaches count 3 before the placeholder
  resend (vinikjkkj/zapo#262), the streaming sidecar is skipped for non-streamable mp4
  (vinikjkkj/zapo#263), and stored history messages resolve the author from the top-level
  participant (vinikjkkj/zapo#264).
- **Runtime**: `ioredis` 5.11.1 → 6.0.0 · `pino` 9.14.0 → 10.3.1 (#94)
- **Dev**: `vitest` 3.2.7 → 4.1.11 · `@vitest/coverage-v8` 3.2.7 → 4.1.11 (#94)

## [0.8.0] - 2026-08-21

### Security

- **`@fastify/multipart` 10.1.0 → 10.1.1** — fixes [GHSA-62qx-hpj5-j6hc](https://github.com/fastify/fastify-multipart/security/advisories/GHSA-62qx-hpj5-j6hc)
  and [GHSA-vmph-573x-85f6](https://github.com/fastify/fastify-multipart/security/advisories/GHSA-vmph-573x-85f6),
  both on the multipart path this gateway uses for media and avatar uploads (#92).

### Changed

- **Trust proxy no longer uses a hop count.** `fastify@5.12.1` stopped honouring a numeric
  `trustProxy` and now fails closed, because a hop count cannot validate the immediate peer
  and a directly-connected client could spoof `X-Forwarded-*` by supplying enough hops.
  Left as-is, `X-Forwarded-*` would have been silently ignored: `request.ip` would resolve to
  the proxy's address, collapsing every client behind the proxy into a **single rate-limit
  bucket** (`@fastify/rate-limit` keys on `request.ip`) and recording the proxy in request
  logs. `TRUST_PROXY` now resolves through `resolveTrustProxy()` instead (#92).

  | Config | Behaviour |
  | ------ | --------- |
  | `TRUST_PROXY=false` | Trust nothing — `X-Forwarded-*` ignored |
  | `TRUST_PROXY=true` + `TRUST_PROXY_CIDRS` set | Trust only those proxy IPs/CIDRs; the immediate peer is validated |
  | `TRUST_PROXY=true`, no CIDRs | Trust any peer |

### Added

- **`TRUST_PROXY_CIDRS`** — comma-separated proxy IPs/CIDRs to trust, e.g.
  `10.0.0.0/8,172.16.0.0/12`. Preferred over the old hop count: it validates the immediate
  peer, so `X-Forwarded-*` cannot be spoofed by a client connecting directly (#92).

### Deprecated

- **`TRUST_PROXY_HOPS`** — still parsed so existing deployments keep booting, but no longer
  reaches Fastify and has no effect. Set `TRUST_PROXY_CIDRS` instead. **Deployments relying on
  a hop count now trust any peer by default** — set `TRUST_PROXY_CIDRS` to restore a validated
  allowlist (#92).

### Dependencies

- **Runtime**: `zapo-js` 1.5.0 → 1.8.0 · `@zapo-js/store-postgres` 1.0.2 → 1.2.0 ·
  `fastify` 5.5.0 → 5.12.0 · `@fastify/swagger` 9.5.1 → 9.8.1 · `@fastify/static` 10.1.0 → 10.1.3 ·
  `@fastify/rate-limit` 11.1.0 → 11.2.0 · `@scalar/fastify-api-reference` 1.62.5 → 1.66.1 ·
  `@aws-sdk/*` 3.1085.0 → 3.1115.0 · `pg` 8.16.3 → 8.23.0 · `file-type` 22.0.1 → 22.0.2
- **Dev**: `@biomejs/biome` 2.1.1 → 2.5.9 · `@zapo-js/fake-server` 1.0.0 → 1.3.0 ·
  `tsc-alias` 1.8.16 → 1.9.2 · `ws` 8.18.2 → 8.21.3 · `@types/node` 26.1.1 → 26.2.0 ·
  `@types/pg` 8.15.4 → 8.23.1 · `tsx` 4.23.1 → 4.23.12
- **Frontends**: `react`/`react-dom` 19.1.0 → 19.2.8 · `vite` 8.1.4 → 8.2.2 ·
  `@vitejs/plugin-react` 5.2.0 → 6.1.0 (dashboard) · `react-router-dom` 7.6.2 → 7.18.2 ·
  `tailwindcss` 4.1.8 → 4.3.3
- **CI**: `actions/setup-node` v6 → v7 · `actions/upload-pages-artifact` v3 → v5 ·
  `actions/deploy-pages` v4 → v5

  The `@aws-sdk/client-s3` and `@aws-sdk/s3-request-presigner` bumps had to land together —
  split across separate PRs their types diverged and `src/media/storage.ts` failed to
  typecheck (#88).

### Internal

- Dependabot now opens **one grouped PR per ecosystem per week**, split by patch/minor vs
  major, capped so a new PR cannot open while its group's previous one is still open. Replaces
  the one-PR-per-dependency flood that had reached 22 open PRs (#88, #91).

## [0.7.2] - 2026-07-14

### Fixed

- **Multipart avatar upload (502)**: raise Fastify `bodyLimit` to `MEDIA_UPLOAD_MAX_BYTES`
  (was 1 MiB default — large multipart uploads failed at the edge). Profile/group picture
  set now re-encodes uploads to compact JPEG via sharp before WhatsApp IQ; WA rejections
  return **400** with a clear message instead of opaque **502** `WA_IQ_FAILED`
  (#55).

### Changed

- **Scalar Try It**: all media routes list `multipart/form-data` first with binary `file` +
  `encoding` so the docs UI shows a file picker by default (JSON still available)
  (#55).

## [0.7.1] - 2026-07-14

### Changed

- **OpenAPI / guide**: media routes advertise `multipart/form-data` with binary `file`
  (Scalar file picker) alongside JSON; guide (pt/en/es), README, and swagger intro document
  URL · base64 · multipart. Regenerated `openapi.json` for short paths + 0.7.x surface
  (#53).

## [0.7.0] - 2026-07-14

### Added

- **Multipart media uploads** on POST/PUT media routes: profile/group avatar,
  messages (image/video/audio/document/sticker), status media, and call blast.
  Accept `mediaUrl`, `mediaBase64`, or `multipart/form-data` field `file` (aliases
  `media` / `audio` / …). Cap via env `MEDIA_UPLOAD_MAX_BYTES` (default 100 MiB)
  (#51).

## [0.6.0] - 2026-07-14

### Changed

- **Avatars prefer full-res**: own-profile sync and picture notifications follow
  env `AVATAR_FETCH_TYPES` (`both` default = download `image` then `preview`;
  also `image` / `preview` only). Instance/`GET /profile` `avatarUrl` prefers
  stored full-res over preview. On-demand still uses
  `GET .../profile-picture?type=preview|image` (default `preview` for lists)
  (#49).

### Fixed

- **`GET /v1/profile` aligned with instance enrichment**: uses bare PN JID for
  status/picture IQs (device suffix breaks WA), and returns the same
  `pushName` / `avatarUrl` path as `GET /v1/instance` (#49).

## [0.5.0] - 2026-07-14

### Changed

- **Breaking (0.x):** Operational routes no longer accept `/v1/instances/:name/...`.
  Session methods require an **instance API key** and use short paths (`/v1/messages/...`,
  `/v1/instance/connect`, …). Admin key is limited to create/list/delete/rotate under
  `/v1/instances` (+ `DELETE` / `.../keys/rotate` with `:name`) (#47).
- **pushName / avatarUrl** on list/get: resolve display name from `meDisplayName` as well
  as `pushName`, and revalidate own avatar from WhatsApp (TTL + durable storage) (#47).

## [0.4.0] - 2026-07-14

### Added

- **Profile push name + avatar**: `PUT /v1/profile/name` (and named path) updates
  WhatsApp display name (`setPushName`); `PUT /v1/profile/image` (alias
  `/profile/picture`) sets the avatar from `mediaUrl` or `mediaBase64`. Also
  `DELETE /v1/profile/image|picture`. Short form works with instance API key (#45).
- **Instance inference from API key (dual routing)**: instance-scoped routes
  accept both `/v1/instances/:name/...` (admin + explicit) and a short form
  without the name (`/v1/...` for resources, `/v1/instance/...` for lifecycle).
  With an **instance** API key the target is inferred from the key. With the
  **admin** API key the name is **required** (short form without name → 400).
  Documented in DESIGN-DECISIONS, README, guide `auth`/`why`/`quickstart`/`faq`
  (pt/en/es), FEATURE-MAP, and OpenAPI description (#45).

### Changed

- **Instance API keys are plaintext end-to-end**: stored as `instances.api_key`
  (`NOT NULL`, unique), **always** returned on list/get/create/rotate (never
  null/omitted), and used for auth via direct lookup (no `api_key_hash`).
  Also returns `pushName` and `avatarUrl` when known. Upgrade mints new keys
  for any row that still lacked plaintext after the hash-era drop (#45).

## [0.3.0] - 2026-07-14

### Added

- **Audio blast + STT**: `POST /v1/instances/:name/calls/blast` places an outbound
  VoIP call, plays a WAV from `audioUrl`, optionally records the remote leg, and
  can transcribe via Groq/OpenAI-compatible Whisper (`STT_*` env).  
  `POST /v1/instances/:name/calls/:callId/transcribe` re-transcribes an existing
  call recording. `audioUrl` is SSRF-guarded; empty compose `STT_API_URL` is safe.
  Guide VoIP/FAQ (pt/en/es), OpenAPI/Scalar, unit/integration/e2e tests (#43).

## [0.2.0] - 2026-07-13

### Added

- Optional WhatsApp Web **WAM** telemetry (`@zapo-js/wam`) on every session for
  wire parity / anti-fingerprinting. **Enabled by default**; set
  `WAM_ENABLED=false` to disable. Does not change REST/SSE/VoIP contracts.
  Documented in README, `docs/DESIGN-DECISIONS.md`, and guide `/why` +
  `/architecture` + FAQ (pt/en/es).
- GitHub Pages deploy for the product guide SPA (`docs-site`) at
  https://rafaelsantana6.github.io/zapo-rest/ and static Scalar OpenAPI at
  https://rafaelsantana6.github.io/zapo-rest/docs/ (workflow `docs-pages.yml`;
  `DOCS_BASE` for project-site path; guide header links to GitHub + Scalar).
- Documented production-facing design choices (CAS media dedup, webhook
  outbox, SSE vs VoIP WS, LID map, …) in `docs/DESIGN-DECISIONS.md`, README
  **Design advantages (summary)**, and guide page `/why` (+ architecture/media/webhooks).
- AGENTS.md *Design surface triad*: keep DESIGN-DECISIONS + README summary +
  guide `why`/feature pages in sync when shipping material design wins.
- Track `docs/*.md` in git (removed accidental root `.gitignore` entry `docs`
  that hid DESIGN-DECISIONS, PRODUCTION-CONSISTENCY, coverage notes, etc.).

## [0.1.4] - 2026-07-13

### Fixed

- Startup no longer awaits WA auto-connect + lid reconcile before
  `app.listen()` — Docker Swarm healthchecks were killing the task as
  unhealthy while `mailbox_contacts` reconcile ran for minutes (API never
  bound `:3000`).
- Lid map bootstrap uses batched `lid_map` multi-row upserts instead of
  one `save()` per contact pair.

## [0.1.3] - 2026-07-13

### Fixed

- Webhooks filtered to `message` only never received stage-2 media events
  (`message.media.stored` / `message.media.failed`) after CAS download, so
  receivers only saw the instant meta payload without a permanent storage
  URL. Subscribing to `message` now also matches those media stage-2 events.
  Legacy instance `webhookEvents` uses the same matcher.
- Media URL after CAS: private R2/S3 API hosts are not used as `mediaUrl`
  (not browser-fetchable); fall back to the authenticated API media path.
- History import: `WaContactStore` has no `list()` (zapo-js / store-postgres) —
  import no longer throws `contactStore?.list is not a function`; falls back to
  reading `mailbox_contacts` via the shared Postgres pool.
- Thread import: stop using `threadStore.list()` as a truthiness probe (double
  call); check `typeof list === 'function'` first.
- Boot: pre-run `@zapo-js/store-postgres` migrations serially so concurrent
  first writes do not race `CREATE TABLE IF NOT EXISTS` →
  `pg_type_typname_nsp_index` write-behind errors.
- Migrate log: applying schema from disk is `info` (warn only for inline
  fallback).

## [0.1.2] - 2026-07-13

### Fixed

- VoIP call PCM stream auth: instance API keys were compared against the
  masked `***` field after hashing-at-rest, so non-admin softphones always
  got `4403 forbidden` on `/calls/:id/stream` — accept hung forever and the
  peer kept ringing. Auth now uses the same hash lookup as the rest of `/v1`.
- Softphone: reject when the audio WS closes before `ready` (no more hung
  Promise); accept signaling runs before opening the stream so the peer stops
  ringing even if audio setup is slow.
- VoIP control WebSocket (`/v1/voip`): register `message` handlers
  **synchronously** so client frames (`call:start`, `call:accept`, …) are not
  dropped while auth/attach await (softphone timeouts with no server log).
- Accept (REST + VoIP WS) no longer awaits full `acceptCall` / SCTP
  `connectRelays` before ack — fire-and-forget after optimistic `connecting`
  so the softphone does not hang on Atender.
- Softphone: optimistic UI on Atender (connecting immediately), no phase
  regression back to `incoming_ringing` from stale snapshots; longer
  `call:start` timeout for usync + media init.
- Dashboard static assets: `@fastify/static` wildcard + no SPA HTML fallback
  for `.js`/`.css` (rebuilds without restart no longer get wrong MIME).
- OpenAPI `CallInfo`: nullable duration/endReason and related fields so live
  call snapshots validate; empty reject/end bodies coerce to `{}`.

### Changed

- Call recording starts only **after answer** (`connecting` / `active` /
  `on_hold`). Ring/dial only writes history with `recording_status: none`
  (no empty/ring WAVs for unanswered calls).

## [0.1.1] - 2026-07-13

### Changed

- Release workflow publishes container images to **Docker Hub**
  (`rafaelsantana6/zapo-rest`) in addition to GHCR; supports
  `workflow_dispatch` to re-publish an existing tag.
- Docker Hub repository overview enriched with GitHub links, docs,
  env notes, and OCI image labels; synced via
  `scripts/sync-dockerhub-readme.sh` + `docker/DOCKERHUB.md` on each release.
- Consolidated dependency bumps (Dependabot batch): `zapo-js` 1.5,
  Fastify plugins (`multipart`/`static`/`fastify-plugin`), `file-type` 22,
  `sharp` 0.35, TypeScript 7 + `@types/node` 26, dashboard/docs-site Vite
  stack, Actions `checkout@v7` / `pnpm/action-setup@v6`. docs-site now uses
  pnpm lockfile. `tsconfig` paths updated for TypeScript 7 (no `baseUrl`).
- CI Actions bumped to Node 24 runtimes (`build-push-action@v7`, etc.).

## [0.1.0] - 2026-07-12

First public release of **zapo-rest**: multi-session WhatsApp gateway over
[zapo-js](https://github.com/vinikjkkj/zapo).

### Added

- Multi-session REST API (`/v1` contract) over zapo-js.
- Instance lifecycle: create, connect, QR, pairing, restart, delete,
  rotate API key.
- Messages: text, reply, image, video, audio, document, sticker, location,
  poll, react, edit, revoke, contact, forward.
- Chats, contacts (BR 9th digit / batch resolve), groups, labels, lids,
  presence, privacy, profile, status/stories.
- Upsert projections (`app_messages`, `app_chats`, `app_contacts`) +
  `processed_events` idempotency ledger + webhook outbox (HMAC-SHA512,
  multi-config).
- History sync on pair + on-demand `POST .../chats/:chatId/history-sync`.
- Media storage: local filesystem or S3-compatible (MinIO/R2/AWS); CAS
  storage, presigned redirect downloads, WhatsApp rehydrate on missing object.
- Two-stage media realtime (mode A): `message` fires immediately with
  `mediaStage: "meta"`; after CAS store (or failure) the gateway emits
  `message.media.stored` / `message.media.failed` (also on SSE). History
  imports still skip these side-effects.
- Optional Redis cache with in-memory fallback.
- Realtime **SSE** at `GET /v1/events` (prefer `X-Api-Key` header).
- VoIP: control WebSocket `/v1/voip` + live PCM stream + optional recording.
- Dashboard (Vite/React) and docs guide SPA (`/guide`, `pt-BR` / `en` / `es`)
  + Swagger/Scalar (`/docs`).
- Docker Compose stack: API + Postgres + Redis + MinIO.
- Open-source scaffolding: `LICENSE`, `CODE_OF_CONDUCT.md`,
  `CONTRIBUTING.md`, `SECURITY.md`, `AGENTS.md`, GitHub CI/templates,
  expanded README.
- SemVer release guidance and `pnpm version` workflow documentation.
- **Coverage sprints 0–5:** EventProcessor, outbox HMAC, SSE auth matrix,
  local media, OpenAPI Zod I/O contracts; Postgres store/repo suites
  (`MessageStore`, `ChatStore`, `WebhookConfigRepo`, `InstanceRepo` on
  `zapo_test`); InstanceManager dryRun + fake-server testHooks e2e;
  VoIP serialize + call-stream auth; groups/contacts/presence/calls
  validation matrices. See `docs/TEST-COVERAGE.md`.
- **Sprint C coverage:** mock-WA route inject suite (messages/chats/contacts/
  groups/labels/lids/presence/privacy) + `phone-resolve` unit tests;
  overall lines **~60%**; CI gate raised to 58% lines/statements.
- README **Production checklist** + `docs/PRODUCTION-CONSISTENCY.md`
  (pipeline guarantees, media rehydrate, reverse-proxy sketches).
- Unit + integration + e2e smoke tests (Vitest).

### Security

- Webhook list/get no longer re-echo HMAC secrets (`hmac: { configured: true }` only).
- Metrics resources: non-admin callers no longer receive the full `liveSessionNames` list.
- SSE connection caps (`SSE_MAX_CONNECTIONS`, `SSE_MAX_CONNECTIONS_PER_ACTOR`).
- `TRUST_PROXY` / `TRUST_PROXY_HOPS` env (was always `trustProxy: true`).
- Validation errors return pathname only (strip `?apiKey=` from client-facing `url`).
- Avatar CDN download uses SSRF guard + size cap; media `putAt` rejects path traversal.
- Security headers plugin (nosniff, frame, CSP baseline for SPA/docs).
- **Sprint B hardening:** `CORS_ORIGINS` allowlist (prod default: no open CORS);
  app-level `@fastify/rate-limit` on `/v1` (`RATE_LIMIT_ENABLED` / `MAX` /
  `TIME_WINDOW_MS`, on by default in production).

### Fixed

- `message.any` webhook matching now only matches `message*` events (was a global catch-all).
- History sync full mailbox import is debounced (`HISTORY_IMPORT_DEBOUNCE_MS`) so
  every chunk no longer re-scans the mailbox on the live session queue.
- Live media download no longer head-of-line blocks the session queue (async +
  `MEDIA_DOWNLOAD_CONCURRENCY` semaphore).
- Outbound media/location/poll/reply sends now upsert into `app_messages` projections.
- Call PCM recorder caps duration (`CALL_RECORDING_MAX_SECONDS`).
- `.env.example` Redis host port aligned with compose (`16379`).

### Changed

- Realtime event channel documented as **SSE** (`GET /v1/events`); VoIP
  remains WebSocket (`/v1/voip` + PCM stream).
- Docker multi-stage build pruned to production dependencies for a smaller
  runtime image.
- `docker-compose.yml` images pinned to immutable tags **+ digests**
  (postgres 16.8, redis 7.4, MinIO server + `mc`); MinIO credentials overridable
  via `MINIO_ROOT_USER` / `MINIO_ROOT_PASSWORD`.
- Repository URLs set to `github.com/rafaelsantana6/zapo-rest`.
- `pnpm build:api` cleans `dist/` first (avoids stale artifacts like old `events-ws`).

[Unreleased]: https://github.com/rafaelsantana6/zapo-rest/compare/v0.10.0...HEAD
[0.10.0]: https://github.com/rafaelsantana6/zapo-rest/compare/v0.9.0...v0.10.0
[0.9.0]: https://github.com/rafaelsantana6/zapo-rest/compare/v0.8.1...v0.9.0
[0.8.1]: https://github.com/rafaelsantana6/zapo-rest/compare/v0.8.0...v0.8.1
[0.8.0]: https://github.com/rafaelsantana6/zapo-rest/compare/v0.7.2...v0.8.0
[0.7.2]: https://github.com/rafaelsantana6/zapo-rest/compare/v0.7.1...v0.7.2
[0.7.1]: https://github.com/rafaelsantana6/zapo-rest/compare/v0.7.0...v0.7.1
[0.7.0]: https://github.com/rafaelsantana6/zapo-rest/compare/v0.6.0...v0.7.0
[0.6.0]: https://github.com/rafaelsantana6/zapo-rest/compare/v0.5.0...v0.6.0
[0.5.0]: https://github.com/rafaelsantana6/zapo-rest/compare/v0.4.0...v0.5.0
[0.4.0]: https://github.com/rafaelsantana6/zapo-rest/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/rafaelsantana6/zapo-rest/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/rafaelsantana6/zapo-rest/compare/v0.1.4...v0.2.0
[0.1.4]: https://github.com/rafaelsantana6/zapo-rest/compare/v0.1.3...v0.1.4
[0.1.3]: https://github.com/rafaelsantana6/zapo-rest/compare/v0.1.2...v0.1.3
[0.1.2]: https://github.com/rafaelsantana6/zapo-rest/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/rafaelsantana6/zapo-rest/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/rafaelsantana6/zapo-rest/releases/tag/v0.1.0
