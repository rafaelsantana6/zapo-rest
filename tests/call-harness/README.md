# Call harness

Real video calls without WhatsApp, measured end to end in both directions.

```text
FakePhone ──UDP──▶ FakeFnaRelay ──UDP──▶ @zapo-js/voip (real WaClient on FakeWaServer)
   ▲            (latency, jitter,                 │
   │             loss, bandwidth)                 ▼
   └──────────── same path back ◀── zapo-rest /v1/calls/:id/stream + /video ◀──▶ DashboardClient (Node)
```

| File               | Role                                                                                                                                               |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `fake-wa.ts`       | FakeWaServer + paired `WaClient` with the voip plugin (the production zapo leg)                                                                    |
| `fake-phone.ts`    | Remote handset: Signal-encrypted offer via a `FakePeer`, then SRTP / MLow / WhatsApp-packed H.264 over UDP using the plugin's own internals        |
| `fake-relay.ts`    | WhatsApp "FNA" relay stand-in (plain UDP) with a seeded network model per direction                                                                |
| `zapo-api.ts`      | Our auth plugin + call routes on an ephemeral port; `DashboardClient` speaks both call sockets                                                     |
| `media-fixture.ts` | Downloads a 10 s clip once (`.cache/call-harness/`), transcodes to phone-like H.264 CBP + 16 kHz PCM, tags frames (SEI) and mixes 1 kHz sync beeps |
| `metrics.ts`       | Video (fps, latency, jitter, freezes, **decodable** frames) and audio (beep latency, gaps) probes, A/V skew                                        |
| `call-scenario.ts` | One call: ring → REST accept → both sockets → real-time streaming both ways → report                                                               |

Run: `pnpm test:call-quality` (needs ffmpeg; falls back to ffmpeg test signals offline). Each run writes
`.cache/call-harness/reports/call-quality-*.md|json`.

Knobs:

- `CALL_HARNESS_FIXTURE='{"bitrateKbps":350,"gopSeconds":1}'` — compare encoder settings.
- `CALL_HARNESS_LOG=1` — zapo-js console logging.
- `CALL_HARNESS_DUMP=<dir>` — write received PCM per direction for offline analysis.

Limits: the relay is FNA (UDP), so the plugin runs with `useRawUdpTransport: true`. Real WhatsApp
relays usually run over WebRTC SCTP data channels, so this does not model SCTP send-buffer growth.
The fake phone reuses the plugin's own SRTP, SSRC derivation and H.264 (de)packetizer
(`voip-internals.ts`), so an upstream packing bug that both sides share goes unnoticed: this
measures transport and pacing, not wire compatibility with real phones. The thresholds in
`tests/e2e/video-call-quality.test.ts` are regression floors, not quality targets; `lossy-3pct`
sits close to them on voip 1.4 and can fail on a slow run. The fake phone streams a pre-encoded clip, so it
does not react to key-frame requests (PLI/FIR). The browser WebCodecs path is not exercised.
"Decodable" means the frame arrived byte-intact and every frame since the last IDR also arrived
intact. It is how the metrics estimate what a real decoder would display.

MLow RED comparison (zapo → phone; the phone still sends normal MLow):

```sh
CALL_HARNESS_MLOW_RED=false pnpm test:call-quality
CALL_HARNESS_MLOW_RED=true pnpm test:call-quality
```
The fake phone uses upstream `decodeSequenced` for PT 120/121, including RED recovery. RED disables DTX and adds bandwidth for loss recovery. Reports go to the same cache directory; preserve each run before the next one.
