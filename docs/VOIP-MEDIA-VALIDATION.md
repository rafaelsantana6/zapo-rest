# VoIP media validation — 2026-11-06

Commands and observations for `feat/calls-remote-media`. No live WhatsApp call was made.

## Lossy 3% comparison

Full `pnpm test:call-quality` runs with `CALL_HARNESS_MLOW_RED=false` and `true`.
RED is enabled on the zapo sender only; the fake phone continues to send normal MLow.
The phone uses upstream `decodeSequenced` for PT 120/121, including RED recovery.

| Direction | RED | Audio beeps | Audio latency p50 / p95 ms | Audio gaps | Video decodable fps | Longest visual freeze ms |
| --- | --- | --- | --- | --- | --- | --- |
| phone → zapo | off | 9/9 | 147.5 / 163.3 | 0 | 5.0 | 2935.1 |
| zapo → phone | off | 9/9 | 137.3 / 245.9 | 0 | 2.3 | 2999.8 |
| phone → zapo | on | 9/9 | 151.7 / 214.3 | 0 | 3.2 | 1869.9 |
| zapo → phone | on | 9/9 | 142.4 / 155.7 | 0 | 2.7 | 2600.7 |

Both lossy-3pct scenarios passed. These are single runs, not a statistically controlled comparison:
RED changes packet scheduling/bandwidth; unrelated video metrics and the unchanged inbound sender also vary.
Both had zero audio gaps, so this run does not establish a loss-recovery improvement.

Full suite results:

- RED off: **4 passed, 2 failed (6)**; Wi-Fi visual freeze 2066.9 ms and congested-uplink 1971.1 ms exceeded the existing 1500 ms limit.
- RED on: **5 passed, 1 failed (6)**; Wi-Fi visual freeze 2068.5 ms exceeded the existing 1500 ms limit.
- Thresholds were kept unchanged. These video failures remain visible; passing the audio comparison does not make the full quality suite green.

Raw generated report names (cache artifacts):

- `call-quality-2026-11-06T06-27-10-420Z.{json,md}` — RED off
- `call-quality-2026-11-06T06-29-19-095Z.{json,md}` — RED on

## Browser smoke test

Chromium on localhost with fake microphone/camera, the real WASM codec, AudioWorklet and browser adapters.
The listener was attached before gesture-bound audio startup; `host` and `resync` were emitted.
H.264 was looped directly from `WaWebCallVideoSender` into `WaWebCallVideoReceiver`, outside the server.
**438 frames encoded and decoded**, no adapter errors. Hangup released camera/sender/receiver and returned real `WaCallMediaStats`.
This validates browser codecs/adapters and cleanup, not connectivity to a production WhatsApp relay.

Automated tests cover upstream wire encoding, instance authorization/isolation, live plans, late client connection,
resync snapshots, invalid host events, no plan/PCM leakage into bus/webhooks/logs, local-only guards,
gesture ordering, no-WebCodecs audio fallback, VideoFrame closure, playback-buffer ordering and file cleanup.

## Deliberate limits

- Mode is fixed per instance client and currently comes from the environment; finish live calls and restart the server to recreate clients. No generic instance update route exists; persisted per-instance overrides were deferred.
- Browser group hosting is blocked by upstream's `group/1` + `raw-udp` requirement and reported as a sanitized call error.
- `setVideoSubscriptions` is unsupported upstream. Optional start-call file inputs and participant recordings were not added.

## Original delivery verification

- `pnpm format`: passed (274 files).
- `pnpm lint`: passed; one existing CSS specificity warning and the existing Biome schema/CLI version notice.
- `pnpm typecheck`: passed, no errors.
- `pnpm test`: **70 passed | 4 skipped (74 files)**; **473 passed | 8 skipped (481 tests)**.
- `pnpm -C docs-site build`: passed (50 modules).
- `pnpm -C dashboard build`: passed (120 modules; bundle-size warnings).
- Dashboard `tsc --noEmit`: 37 existing errors, none in touched files.
- OpenAPI exported: 128 paths; generated documentation: 148 endpoints.

## Independent review follow-up

An independent agent reviewed the five original commits and reported eight confirmed defects plus one optional improvement. All were addressed:

1. Revalidate authorization before each ordered private plan/host event; regressions rotate an API key, reject a revoked host and delete/recreate the same instance name.
2. Apply retained microphone mute before the first capture block.
3. Treat authenticated `ready` as connection readiness and disable cold dialing until media mode is known.
4. Serialize video-source attachment and track its generation/ownership, releasing late screen/camera resources after hangup.
5. Request the selected microphone in the gesture, manage the supplied AudioContext/streams, and clean up late acquisition or failed device switching.
6. Release only the rejected accept attempt's media. Browser UI validation used a fixture rejecting both WS and HTTP accept: one acquired microphone ended, with zero unhandled rejections.
7. Apply the existing responsive remote-video canvas class.
8. Serialize output changes and show errors instead of leaking rejected promises.
9. Reject remote multipart playback before parsing or downloading its media URL.

Tests include delayed sender start/replace, late microphone/adapter acquisition, selected input, output rejection/retry, and responsive canvas assignment. Tests use named fakes and real upstream media statistics where practical.

The follow-up review also caught and cleared an authorization-lookup race: a closed binding must be checked again after the lookup, and must not close a successor binding sharing the same socket. Three regressions cover successful/failed late lookups and late host events.

The independent reviewer rechecked all corrections and reported no confirmed remaining findings (37 targeted tests passed). Final repository checks after the corrections:

- `pnpm format`, `pnpm lint`, `pnpm typecheck`: passed (278 files checked; existing lint notices unchanged).
- `pnpm test`: **73 passed | 4 skipped (77 files)**; **492 passed | 8 skipped (500 tests)**.
- Guide and dashboard production builds passed; dashboard typecheck retains 37 existing errors, none in touched files.
- Chromium with a selected fake microphone confirmed the selected device id, 170 decoded H.264 frames, and zero unhandled rejections. At 360 px viewport, the 480 px canvas rendered at 240 px with `object-fit: contain`; hangup ended all acquired audio/video tracks.
- The earlier RED comparison was not rerun: this review changed authorization and browser/device lifecycle, without changing local codec/RED or the quality harness.
