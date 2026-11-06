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

## Final verification

- `pnpm format`: passed (274 files).
- `pnpm lint`: passed; one existing CSS specificity warning and the existing Biome schema/CLI version notice.
- `pnpm typecheck`: passed, no errors.
- `pnpm test`: **70 passed | 4 skipped (74 files)**; **473 passed | 8 skipped (481 tests)**.
- `pnpm -C docs-site build`: passed (50 modules).
- `pnpm -C dashboard build`: passed (120 modules; bundle-size warnings).
- Dashboard `tsc --noEmit`: 37 existing errors, none in touched files.
- OpenAPI exported: 128 paths; generated documentation: 148 endpoints.
