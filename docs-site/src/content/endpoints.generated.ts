/** Auto-generated from openapi.json — do not hand-edit endpoint list structure. */
export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'

export type EndpointDoc = {
  id: string
  method: HttpMethod
  path: string
  summary: string
  description: string
  tags: string[]
  security: boolean
  bodyExample?: unknown
  responseExample?: unknown
  notes?: string[]
}

export const ENDPOINTS: EndpointDoc[] = [
  {
    "id": "get-_guide",
    "method": "GET",
    "path": "/guide",
    "summary": "",
    "description": "",
    "tags": [],
    "security": false,
    "params": [],
    "bodyExample": null,
    "responses": [
      "200"
    ]
  },
  {
    "id": "get-_health",
    "method": "GET",
    "path": "/health",
    "summary": "Liveness probe",
    "description": "Returns `200 { \"status\": \"ok\" }` when the process is up. **No authentication.**\n\nUse for load balancers / Kubernetes liveness probes.",
    "tags": [
      "Health"
    ],
    "security": false,
    "params": [],
    "bodyExample": null,
    "responses": [
      "200"
    ]
  },
  {
    "id": "get-_ready",
    "method": "GET",
    "path": "/ready",
    "summary": "Readiness probe",
    "description": "Checks Postgres connectivity with `SELECT 1`.\n\n- `200 { \"status\": \"ready\" }` when the database is reachable\n- `503 { \"status\": \"not_ready\" }` otherwise\n\n**No authentication.** Use for readiness gates before sending traffic.",
    "tags": [
      "Health"
    ],
    "security": false,
    "params": [],
    "bodyExample": null,
    "responses": [
      "200",
      "503"
    ]
  },
  {
    "id": "get-_v1_events",
    "method": "GET",
    "path": "/v1/events",
    "summary": "SSE event stream (server → client)",
    "description": "Unidirectional live event stream (messages, connection, presence, calls, …).\n\n**Auth: put the API key in headers**, not in the URL (avoids access logs, proxies, Referer).\n\n### curl (recommended)\n```bash\ncurl -N -H \"X-Api-Key: $KEY\" -H \"Accept: text/event-stream\" \\\n  \"$BASE/v1/events?instance=sales-1\"\n```\n\n### Browser (fetch + stream — can send headers)\n```js\nconst res = await fetch(`/v1/events?instance=sales-1`, {\n  headers: { \"X-Api-Key\": key, Accept: \"text/event-stream\" },\n})\n// read res.body with TextDecoder…\n```\n\nNative `EventSource` cannot set headers — only then use `?apiKey=` (discouraged).\n\n- **Instance keys** are always scoped to their instance.\n- **Admin** may omit `instance` (all) or filter with `instance=`.\n- First event: `{ \"event\": \"connected\", \"role\", \"instance\", \"timestamp\" }`.\n- Keepalive: SSE comments every 15s (`: ping …`).",
    "tags": [
      "Realtime"
    ],
    "security": true,
    "params": [],
    "bodyExample": null,
    "responses": [
      "200"
    ]
  },
  {
    "id": "get-_v1_instances",
    "method": "GET",
    "path": "/v1/instances",
    "summary": "List instances",
    "description": "**Admin only.** Returns every instance with full metadata. The **`apiKey` is not included** — it is only shown once at create/rotate. Use `POST .../keys/rotate` to mint a new one.\n\n```bash\ncurl -s \"$BASE/v1/instances\" -H \"X-Api-Key: $ADMIN_API_KEY\"\n```",
    "tags": [
      "Instances"
    ],
    "security": true,
    "params": [],
    "bodyExample": null,
    "responses": [
      "200",
      "401",
      "403"
    ]
  },
  {
    "id": "post-_v1_instances",
    "method": "POST",
    "path": "/v1/instances",
    "summary": "Create instance",
    "description": "**Admin only.** Provisions a new WhatsApp session.\n\n- Generates a unique **instance API key**, returned **once** in this response (stored hashed — save it now)\n- Does **not** open the socket yet — call `POST .../connect` next\n- `name` becomes the zapo `sessionId` (stable across restarts)\n\n**Example body**\n```json\n{\n  \"name\": \"sales-1\",\n  \"webhookUrl\": \"https://example.com/webhooks/zapo\",\n  \"webhookEvents\": [\n    \"instance.qr\",\n    \"instance.connection\",\n    \"message.inbound\",\n    \"call.incoming\"\n  ]\n}\n```\n\n**Example**\n```bash\ncurl -s -X POST \"$BASE/v1/instances\" \\\n  -H \"X-Api-Key: $ADMIN_API_KEY\" -H \"content-type: application/json\" \\\n  -d '{\"name\":\"sales-1\",\"webhookUrl\":\"https://example.com/webhooks/zapo\",\"webhookEvents\":[\"instance.qr\",\"instance.connection\",\"message.inbound\",\"call.incoming\"]}'\n```",
    "tags": [
      "Instances"
    ],
    "security": true,
    "params": [],
    "bodyExample": {
      "name": "sales-1",
      "webhookUrl": "https://example.com/webhooks/zapo",
      "webhookEvents": [
        "instance.qr",
        "instance.connection",
        "message.inbound",
        "call.incoming"
      ]
    },
    "responses": [
      "200",
      "400",
      "401",
      "403",
      "409"
    ]
  },
  {
    "id": "get-_v1_instances_name",
    "method": "GET",
    "path": "/v1/instances/{name}",
    "summary": "Get instance",
    "description": "Returns one instance. The **`apiKey` is not included** (shown only once at create/rotate).\n\n- **Admin** may read any instance\n- **Instance key** may only read its own `name` (otherwise `403`)\n\n```bash\ncurl -s \"$BASE/v1/instances/sales-1\" -H \"X-Api-Key: $KEY\"\n```",
    "tags": [
      "Instances"
    ],
    "security": true,
    "params": [
      {
        "name": "name",
        "in": "path",
        "required": true,
        "description": "Unique instance name / zapo sessionId (e.g. `sales-1`). Alphanumeric, `_` and `-` only.",
        "schema": {
          "type": "string",
          "minLength": 1,
          "maxLength": 64,
          "pattern": "^[a-zA-Z0-9_-]+$"
        }
      }
    ],
    "bodyExample": null,
    "responses": [
      "200",
      "401",
      "403",
      "404"
    ]
  },
  {
    "id": "delete-_v1_instances_name",
    "method": "DELETE",
    "path": "/v1/instances/{name}",
    "summary": "Delete instance (logout)",
    "description": "**Admin only.** Unlinks the companion device when possible (`logout`), stops the client, and deletes metadata.\n\nIrreversible without re-pairing. Prefer `disconnect` if you only want to stop the process temporarily.",
    "tags": [
      "Instances"
    ],
    "security": true,
    "params": [
      {
        "name": "name",
        "in": "path",
        "required": true,
        "description": "Unique instance name / zapo sessionId (e.g. `sales-1`). Alphanumeric, `_` and `-` only.",
        "schema": {
          "type": "string",
          "minLength": 1,
          "maxLength": 64,
          "pattern": "^[a-zA-Z0-9_-]+$"
        }
      }
    ],
    "bodyExample": null,
    "responses": [
      "200",
      "401",
      "403",
      "404"
    ]
  },
  {
    "id": "get-_v1_instances_name_blocklist",
    "method": "GET",
    "path": "/v1/instances/{name}/blocklist",
    "summary": "Get blocklist",
    "description": "",
    "tags": [
      "Contacts"
    ],
    "security": true,
    "params": [
      {
        "name": "name",
        "in": "path",
        "required": true,
        "description": "Unique instance name / zapo sessionId (e.g. `sales-1`). Alphanumeric, `_` and `-` only.",
        "schema": {
          "type": "string",
          "minLength": 1,
          "maxLength": 64,
          "pattern": "^[a-zA-Z0-9_-]+$"
        }
      }
    ],
    "bodyExample": null,
    "responses": [
      "200"
    ]
  },
  {
    "id": "post-_v1_instances_name_business_profile",
    "method": "POST",
    "path": "/v1/instances/{name}/business/profile",
    "summary": "Fetch business profiles for JIDs/phones",
    "description": "",
    "tags": [
      "Business"
    ],
    "security": true,
    "params": [
      {
        "name": "name",
        "in": "path",
        "required": true,
        "description": "Unique instance name / zapo sessionId (e.g. `sales-1`). Alphanumeric, `_` and `-` only.",
        "schema": {
          "type": "string",
          "minLength": 1,
          "maxLength": 64,
          "pattern": "^[a-zA-Z0-9_-]+$"
        }
      }
    ],
    "bodyExample": null,
    "responses": [
      "200"
    ]
  },
  {
    "id": "get-_v1_instances_name_business_profile_phone",
    "method": "GET",
    "path": "/v1/instances/{name}/business/profile/{phone}",
    "summary": "Fetch one business profile",
    "description": "",
    "tags": [
      "Business"
    ],
    "security": true,
    "params": [
      {
        "name": "name",
        "in": "path",
        "required": true,
        "description": "Unique instance name / zapo sessionId (e.g. `sales-1`). Alphanumeric, `_` and `-` only.",
        "schema": {
          "type": "string",
          "minLength": 1,
          "maxLength": 64,
          "pattern": "^[a-zA-Z0-9_-]+$"
        }
      },
      {
        "name": "phone",
        "in": "path",
        "required": true,
        "description": "",
        "schema": {
          "type": "string",
          "minLength": 1
        }
      }
    ],
    "bodyExample": null,
    "responses": [
      "200"
    ]
  },
  {
    "id": "get-_v1_instances_name_calls",
    "method": "GET",
    "path": "/v1/instances/{name}/calls",
    "summary": "List active calls",
    "description": "Lists in-memory calls for the instance (`client.voip.getCalls()`), including ringing and active.",
    "tags": [
      "Calls"
    ],
    "security": true,
    "params": [
      {
        "name": "name",
        "in": "path",
        "required": true,
        "description": "Unique instance name / zapo sessionId (e.g. `sales-1`). Alphanumeric, `_` and `-` only.",
        "schema": {
          "type": "string",
          "minLength": 1,
          "maxLength": 64,
          "pattern": "^[a-zA-Z0-9_-]+$"
        }
      }
    ],
    "bodyExample": null,
    "responses": [
      "200",
      "401",
      "403",
      "404",
      "503"
    ]
  },
  {
    "id": "post-_v1_instances_name_calls",
    "method": "POST",
    "path": "/v1/instances/{name}/calls",
    "summary": "Start outbound voice call",
    "description": "Places an **audio-only** WhatsApp voice call (`client.voip.startCall`).\n\nReturns `callId` immediately after the offer is sent. Progress continues via webhooks `call.state` / `call.ended` and the live PCM WebSocket.\n\n**No file / audioUrl playback** — open the stream and send live mic PCM.\n\n**Example body**\n```json\n{\n  \"to\": \"5511888888888\"\n}\n```\n\n```bash\ncurl -s -X POST \"$BASE/v1/instances/sales-1/calls\" \\\n  -H \"X-Api-Key: $KEY\" -H \"content-type: application/json\" \\\n  -d '{\"to\":\"5511888888888\"}'\n```",
    "tags": [
      "Calls"
    ],
    "security": true,
    "params": [
      {
        "name": "name",
        "in": "path",
        "required": true,
        "description": "Unique instance name / zapo sessionId (e.g. `sales-1`). Alphanumeric, `_` and `-` only.",
        "schema": {
          "type": "string",
          "minLength": 1,
          "maxLength": 64,
          "pattern": "^[a-zA-Z0-9_-]+$"
        }
      }
    ],
    "bodyExample": {
      "to": "5511888888888"
    },
    "responses": [
      "200",
      "400",
      "401",
      "403",
      "404",
      "503"
    ]
  },
  {
    "id": "post-_v1_instances_name_calls_blast",
    "method": "POST",
    "path": "/v1/instances/{name}/calls/blast",
    "summary": "Audio blast — call + play predefined audio + record response",
    "description": "Outbound VoIP **audio blast**: dial → wait for answer → play WAV → optional remote-leg record + Whisper STT.\n\n### Audio\n- **WAV only** (PCM 8/16/24/32-bit or float32). Any rate/channels → resampled to **16 kHz mono**.\n- `audioUrl` is fetched server-side with **SSRF protection** (public HTTPS only, no redirects, size/time caps).\n\n### Recording & STT\n- With `recordResponse` (default true) the remote PCM is stored and linked on the call row — `GET .../calls/{callId}/recording` and `POST .../transcribe` work afterwards.\n- Transcription runs when `transcribe` is not false **and** `STT_ENABLED` + `STT_API_URL` + `STT_API_KEY` are set (Groq Whisper recommended).\n\n### Timeouts\nThe HTTP request stays open until the blast finishes. Raise your client timeout for long WAVs (`callTimeoutMs` + audio duration + `responseTimeoutMs`).\n\n**Example**\n```bash\ncurl -s -X POST \"$BASE/v1/instances/sales-1/calls/blast\" \\\n  -H \"X-Api-Key: $KEY\" -H \"content-type: application/json\" \\\n  -d '{\"to\":\"5511999999999\",\"audioUrl\":\"https://cdn.example.com/prompt.wav\",\"responseTimeoutMs\":5000,\"recordResponse\":true,\"transcribe\":true,\"sttLanguage\":\"pt\"}'\n```",
    "tags": [
      "Calls"
    ],
    "security": true,
    "params": [
      {
        "name": "name",
        "in": "path",
        "required": true,
        "description": "Unique instance name / zapo sessionId (e.g. `sales-1`). Alphanumeric, `_` and `-` only.",
        "schema": {
          "type": "string",
          "minLength": 1,
          "maxLength": 64,
          "pattern": "^[a-zA-Z0-9_-]+$"
        }
      }
    ],
    "bodyExample": {
      "to": "5511888888888",
      "audioUrl": "https://example.com/message.wav",
      "responseTimeoutMs": 5000,
      "callTimeoutMs": 30000,
      "recordResponse": true,
      "transcribe": true,
      "sttLanguage": "pt"
    },
    "responses": [
      "200",
      "400",
      "401",
      "403",
      "404",
      "503"
    ]
  },
  {
    "id": "get-_v1_instances_name_calls_history",
    "method": "GET",
    "path": "/v1/instances/{name}/calls/history",
    "summary": "List call history (DB)",
    "description": "Persisted calls for the instance. Use `withRecording=true` to only list calls with downloadable recordings.",
    "tags": [
      "Calls"
    ],
    "security": true,
    "params": [
      {
        "name": "name",
        "in": "path",
        "required": true,
        "description": "Unique instance name / zapo sessionId (e.g. `sales-1`). Alphanumeric, `_` and `-` only.",
        "schema": {
          "type": "string",
          "minLength": 1,
          "maxLength": 64,
          "pattern": "^[a-zA-Z0-9_-]+$"
        }
      }
    ],
    "bodyExample": null,
    "responses": [
      "200"
    ]
  },
  {
    "id": "get-_v1_instances_name_calls_callId",
    "method": "GET",
    "path": "/v1/instances/{name}/calls/{callId}",
    "summary": "Get call snapshot",
    "description": "Returns a single call snapshot, or `{ \"call\": null }` if unknown / already GC’d.",
    "tags": [
      "Calls"
    ],
    "security": true,
    "params": [
      {
        "name": "name",
        "in": "path",
        "required": true,
        "description": "Instance name",
        "schema": {
          "type": "string",
          "minLength": 1
        }
      },
      {
        "name": "callId",
        "in": "path",
        "required": true,
        "description": "Call id from start or webhook",
        "schema": {
          "type": "string",
          "minLength": 1
        }
      }
    ],
    "bodyExample": null,
    "responses": [
      "200",
      "401",
      "403",
      "404",
      "503"
    ]
  },
  {
    "id": "post-_v1_instances_name_calls_callId_accept",
    "method": "POST",
    "path": "/v1/instances/{name}/calls/{callId}/accept",
    "summary": "Accept incoming call",
    "description": "Accepts a ringing inbound call (`canAccept: true` on the call snapshot / `call.incoming` webhook).",
    "tags": [
      "Calls"
    ],
    "security": true,
    "params": [
      {
        "name": "name",
        "in": "path",
        "required": true,
        "description": "Instance name",
        "schema": {
          "type": "string",
          "minLength": 1
        }
      },
      {
        "name": "callId",
        "in": "path",
        "required": true,
        "description": "Call id from start or webhook",
        "schema": {
          "type": "string",
          "minLength": 1
        }
      }
    ],
    "bodyExample": null,
    "responses": [
      "200",
      "401",
      "403",
      "404",
      "503"
    ]
  },
  {
    "id": "post-_v1_instances_name_calls_callId_end",
    "method": "POST",
    "path": "/v1/instances/{name}/calls/{callId}/end",
    "summary": "End active call",
    "description": "Hangs up an active/connecting call. Optional body `{ \"reason\": \"...\" }`.",
    "tags": [
      "Calls"
    ],
    "security": true,
    "params": [
      {
        "name": "name",
        "in": "path",
        "required": true,
        "description": "Instance name",
        "schema": {
          "type": "string",
          "minLength": 1
        }
      },
      {
        "name": "callId",
        "in": "path",
        "required": true,
        "description": "Call id from start or webhook",
        "schema": {
          "type": "string",
          "minLength": 1
        }
      }
    ],
    "bodyExample": {
      "reason": "busy"
    },
    "responses": [
      "200",
      "401",
      "403",
      "404",
      "503"
    ]
  },
  {
    "id": "post-_v1_instances_name_calls_callId_mute",
    "method": "POST",
    "path": "/v1/instances/{name}/calls/{callId}/mute",
    "summary": "Mute / unmute local audio",
    "description": "Mutes or unmutes the local outbound audio track.\n\n```json\n{ \"muted\": true }\n```",
    "tags": [
      "Calls"
    ],
    "security": true,
    "params": [
      {
        "name": "name",
        "in": "path",
        "required": true,
        "description": "Instance name",
        "schema": {
          "type": "string",
          "minLength": 1
        }
      },
      {
        "name": "callId",
        "in": "path",
        "required": true,
        "description": "Call id from start or webhook",
        "schema": {
          "type": "string",
          "minLength": 1
        }
      }
    ],
    "bodyExample": {
      "muted": true
    },
    "responses": [
      "200",
      "400",
      "401",
      "403",
      "404",
      "503"
    ]
  },
  {
    "id": "get-_v1_instances_name_calls_callId_recording",
    "method": "GET",
    "path": "/v1/instances/{name}/calls/{callId}/recording",
    "summary": "Download call recording (WAV)",
    "description": "Streams the stored WAV when call recording was enabled and capture completed. Requires media storage and softphone/stream to capture the local leg.",
    "tags": [
      "Calls"
    ],
    "security": true,
    "params": [
      {
        "name": "name",
        "in": "path",
        "required": true,
        "description": "Instance name",
        "schema": {
          "type": "string",
          "minLength": 1
        }
      },
      {
        "name": "callId",
        "in": "path",
        "required": true,
        "description": "Call id from start or webhook",
        "schema": {
          "type": "string",
          "minLength": 1
        }
      }
    ],
    "bodyExample": null,
    "responses": [
      "404"
    ]
  },
  {
    "id": "post-_v1_instances_name_calls_callId_reject",
    "method": "POST",
    "path": "/v1/instances/{name}/calls/{callId}/reject",
    "summary": "Reject incoming call",
    "description": "Rejects a ringing inbound call. Optional body `{ \"reason\": \"...\" }`.",
    "tags": [
      "Calls"
    ],
    "security": true,
    "params": [
      {
        "name": "name",
        "in": "path",
        "required": true,
        "description": "Instance name",
        "schema": {
          "type": "string",
          "minLength": 1
        }
      },
      {
        "name": "callId",
        "in": "path",
        "required": true,
        "description": "Call id from start or webhook",
        "schema": {
          "type": "string",
          "minLength": 1
        }
      }
    ],
    "bodyExample": {
      "reason": "busy"
    },
    "responses": [
      "200",
      "401",
      "403",
      "404",
      "503"
    ]
  },
  {
    "id": "get-_v1_instances_name_calls_callId_stream",
    "method": "GET",
    "path": "/v1/instances/{name}/calls/{callId}/stream",
    "summary": "WebSocket live PCM audio stream",
    "description": "**WebSocket upgrade** for bidirectional live VoIP audio (not a plain HTTP JSON response).\n\n### URL\n```\nws(s)://<host>/v1/instances/{name}/calls/{callId}/stream?apiKey=<key>\n```\n\nAuth: query `apiKey` (browsers) and/or header `X-Api-Key`.\n\n### Protocol\n1. Server → JSON text: `{ \"op\": \"ready\", \"sampleRate\": 16000, \"channels\": 1, \"format\": \"f32le\", \"callId\": \"...\" }`\n2. Client → server **binary**: Float32 LE mono PCM @ 16 kHz (microphone)\n3. Server → client **binary**: same format (peer audio)\n4. Backpressure JSON: `{ \"op\": \"backpressure\", \"pause\": true | false, \"bufferedMs\": N }`\n5. End: `{ \"op\": \"ended\", \"callId\": \"...\" }` then socket close\n\nUses `setExternalAudioMode` — **no file autoplay**. Multi-call supported up to `VOIP_MAX_CONCURRENT_CALLS`.",
    "tags": [
      "Calls"
    ],
    "security": true,
    "params": [
      {
        "name": "name",
        "in": "path",
        "required": true,
        "description": "Instance name",
        "schema": {
          "type": "string"
        }
      },
      {
        "name": "callId",
        "in": "path",
        "required": true,
        "description": "Call id from POST.../calls or webhook call.incoming",
        "schema": {
          "type": "string"
        }
      }
    ],
    "bodyExample": null,
    "responses": [
      "101",
      "401",
      "403",
      "404"
    ]
  },
  {
    "id": "post-_v1_instances_name_calls_callId_transcribe",
    "method": "POST",
    "path": "/v1/instances/{name}/calls/{callId}/transcribe",
    "summary": "Transcribe a call recording (STT via Groq / OpenAI-compatible)",
    "description": "Runs speech-to-text on a **stored call recording** (`recordingStatus=ready`) via a Groq/OpenAI-compatible API.\n\n### Env\n| Var | Role |\n| --- | --- |\n| `STT_ENABLED` | must be `true` |\n| `STT_API_URL` | base URL, e.g. `https://api.groq.com/openai` |\n| `STT_API_KEY` | Bearer token |\n| `STT_MODEL` | default `whisper-large-v3` |\n| `STT_LANGUAGE` | optional ISO 639-1 hint |\n\nRecordings come from **audio blast** (`POST .../calls/blast`) or softphone call-recording.\n\n**Example**\n```bash\ncurl -s -X POST \"$BASE/v1/instances/sales-1/calls/$CALL_ID/transcribe\" \\\n  -H \"X-Api-Key: $KEY\"\n```",
    "tags": [
      "Calls"
    ],
    "security": true,
    "params": [
      {
        "name": "name",
        "in": "path",
        "required": true,
        "description": "Instance name",
        "schema": {
          "type": "string",
          "minLength": 1
        }
      },
      {
        "name": "callId",
        "in": "path",
        "required": true,
        "description": "Call id from start or webhook",
        "schema": {
          "type": "string",
          "minLength": 1
        }
      }
    ],
    "bodyExample": null,
    "responses": [
      "200",
      "400",
      "401",
      "403",
      "404",
      "503"
    ]
  },
  {
    "id": "post-_v1_instances_name_chat_getBase64FromMediaMessage",
    "method": "POST",
    "path": "/v1/instances/{name}/chat/getBase64FromMediaMessage",
    "summary": "Alias: getBase64FromMediaMessage (legacy path)",
    "description": "",
    "tags": [
      "Media"
    ],
    "security": true,
    "params": [
      {
        "name": "name",
        "in": "path",
        "required": true,
        "description": "Unique instance name / zapo sessionId (e.g. `sales-1`). Alphanumeric, `_` and `-` only.",
        "schema": {
          "type": "string",
          "minLength": 1,
          "maxLength": 64,
          "pattern": "^[a-zA-Z0-9_-]+$"
        }
      }
    ],
    "bodyExample": null,
    "responses": [
      "200"
    ]
  },
  {
    "id": "get-_v1_instances_name_chats",
    "method": "GET",
    "path": "/v1/instances/{name}/chats",
    "summary": "List chats",
    "description": "Returns chat projections. **merge=true (default)** collapses multiple `@lid` rows that map to the same phone JID ( style), preferring `@s.whatsapp.net`.",
    "tags": [
      "Chats"
    ],
    "security": true,
    "params": [
      {
        "name": "name",
        "in": "path",
        "required": true,
        "description": "Unique instance name / zapo sessionId (e.g. `sales-1`). Alphanumeric, `_` and `-` only.",
        "schema": {
          "type": "string",
          "minLength": 1,
          "maxLength": 64,
          "pattern": "^[a-zA-Z0-9_-]+$"
        }
      }
    ],
    "bodyExample": null,
    "responses": [
      "200",
      "401"
    ]
  },
  {
    "id": "post-_v1_instances_name_chats_reconcile-lids",
    "method": "POST",
    "path": "/v1/instances/{name}/chats/reconcile-lids",
    "summary": "Reconcile LID→PN chats",
    "description": "Rebuilds lid_map from contacts, merges duplicate LID/PN conversations, deletes empty LID ghosts.",
    "tags": [
      "Chats"
    ],
    "security": true,
    "params": [
      {
        "name": "name",
        "in": "path",
        "required": true,
        "description": "Unique instance name / zapo sessionId (e.g. `sales-1`). Alphanumeric, `_` and `-` only.",
        "schema": {
          "type": "string",
          "minLength": 1,
          "maxLength": 64,
          "pattern": "^[a-zA-Z0-9_-]+$"
        }
      }
    ],
    "bodyExample": null,
    "responses": [
      "200"
    ]
  },
  {
    "id": "get-_v1_instances_name_chats_chatId",
    "method": "GET",
    "path": "/v1/instances/{name}/chats/{chatId}",
    "summary": "Get chat",
    "description": "",
    "tags": [
      "Chats"
    ],
    "security": true,
    "params": [
      {
        "name": "name",
        "in": "path",
        "required": true,
        "description": "Unique instance name / zapo sessionId (e.g. `sales-1`). Alphanumeric, `_` and `-` only.",
        "schema": {
          "type": "string",
          "minLength": 1,
          "maxLength": 64,
          "pattern": "^[a-zA-Z0-9_-]+$"
        }
      },
      {
        "name": "chatId",
        "in": "path",
        "required": true,
        "description": "Chat JID or phone digits (LID or PN — aliases merged)",
        "schema": {
          "type": "string",
          "minLength": 1
        }
      }
    ],
    "bodyExample": null,
    "responses": [
      "200",
      "404"
    ]
  },
  {
    "id": "delete-_v1_instances_name_chats_chatId",
    "method": "DELETE",
    "path": "/v1/instances/{name}/chats/{chatId}",
    "summary": "Delete chat from local store",
    "description": "",
    "tags": [
      "Chats"
    ],
    "security": true,
    "params": [
      {
        "name": "name",
        "in": "path",
        "required": true,
        "description": "Unique instance name / zapo sessionId (e.g. `sales-1`). Alphanumeric, `_` and `-` only.",
        "schema": {
          "type": "string",
          "minLength": 1,
          "maxLength": 64,
          "pattern": "^[a-zA-Z0-9_-]+$"
        }
      },
      {
        "name": "chatId",
        "in": "path",
        "required": true,
        "description": "Chat JID or phone digits (LID or PN — aliases merged)",
        "schema": {
          "type": "string",
          "minLength": 1
        }
      }
    ],
    "bodyExample": null,
    "responses": [
      "200"
    ]
  },
  {
    "id": "post-_v1_instances_name_chats_chatId_archive",
    "method": "POST",
    "path": "/v1/instances/{name}/chats/{chatId}/archive",
    "summary": "Archive chat",
    "description": "",
    "tags": [
      "Chats"
    ],
    "security": true,
    "params": [
      {
        "name": "name",
        "in": "path",
        "required": true,
        "description": "Unique instance name / zapo sessionId (e.g. `sales-1`). Alphanumeric, `_` and `-` only.",
        "schema": {
          "type": "string",
          "minLength": 1,
          "maxLength": 64,
          "pattern": "^[a-zA-Z0-9_-]+$"
        }
      },
      {
        "name": "chatId",
        "in": "path",
        "required": true,
        "description": "Chat JID or phone digits (LID or PN — aliases merged)",
        "schema": {
          "type": "string",
          "minLength": 1
        }
      }
    ],
    "bodyExample": null,
    "responses": [
      "200"
    ]
  },
  {
    "id": "post-_v1_instances_name_chats_chatId_history-sync",
    "method": "POST",
    "path": "/v1/instances/{name}/chats/{chatId}/history-sync",
    "summary": "Request on-demand history sync for a chat",
    "description": "Asks WhatsApp to backfill older messages via `message.requestHistorySync`. Chunks arrive as `history.sync` events.",
    "tags": [
      "Chats"
    ],
    "security": true,
    "params": [
      {
        "name": "name",
        "in": "path",
        "required": true,
        "description": "Unique instance name / zapo sessionId (e.g. `sales-1`). Alphanumeric, `_` and `-` only.",
        "schema": {
          "type": "string",
          "minLength": 1,
          "maxLength": 64,
          "pattern": "^[a-zA-Z0-9_-]+$"
        }
      },
      {
        "name": "chatId",
        "in": "path",
        "required": true,
        "description": "Chat JID or phone digits (LID or PN — aliases merged)",
        "schema": {
          "type": "string",
          "minLength": 1
        }
      }
    ],
    "bodyExample": null,
    "responses": [
      "200"
    ]
  },
  {
    "id": "get-_v1_instances_name_chats_chatId_labels",
    "method": "GET",
    "path": "/v1/instances/{name}/chats/{chatId}/labels",
    "summary": "List labels on a chat",
    "description": "",
    "tags": [
      "Labels"
    ],
    "security": true,
    "params": [
      {
        "name": "name",
        "in": "path",
        "required": true,
        "description": "Unique instance name / zapo sessionId (e.g. `sales-1`). Alphanumeric, `_` and `-` only.",
        "schema": {
          "type": "string",
          "minLength": 1,
          "maxLength": 64,
          "pattern": "^[a-zA-Z0-9_-]+$"
        }
      },
      {
        "name": "chatId",
        "in": "path",
        "required": true,
        "description": "",
        "schema": {
          "type": "string"
        }
      }
    ],
    "bodyExample": null,
    "responses": [
      "200"
    ]
  },
  {
    "id": "get-_v1_instances_name_chats_chatId_messages",
    "method": "GET",
    "path": "/v1/instances/{name}/chats/{chatId}/messages",
    "summary": "List chat messages",
    "description": "Paginated history (newest first). Includes messages stored under any LID alias of the chat.",
    "tags": [
      "Chats"
    ],
    "security": true,
    "params": [
      {
        "name": "name",
        "in": "path",
        "required": true,
        "description": "Unique instance name / zapo sessionId (e.g. `sales-1`). Alphanumeric, `_` and `-` only.",
        "schema": {
          "type": "string",
          "minLength": 1,
          "maxLength": 64,
          "pattern": "^[a-zA-Z0-9_-]+$"
        }
      },
      {
        "name": "chatId",
        "in": "path",
        "required": true,
        "description": "Chat JID or phone digits (LID or PN — aliases merged)",
        "schema": {
          "type": "string",
          "minLength": 1
        }
      }
    ],
    "bodyExample": null,
    "responses": [
      "200"
    ]
  },
  {
    "id": "post-_v1_instances_name_chats_chatId_messages_read",
    "method": "POST",
    "path": "/v1/instances/{name}/chats/{chatId}/messages/read",
    "summary": "Mark chat messages as read",
    "description": "",
    "tags": [
      "Chats"
    ],
    "security": true,
    "params": [
      {
        "name": "name",
        "in": "path",
        "required": true,
        "description": "Unique instance name / zapo sessionId (e.g. `sales-1`). Alphanumeric, `_` and `-` only.",
        "schema": {
          "type": "string",
          "minLength": 1,
          "maxLength": 64,
          "pattern": "^[a-zA-Z0-9_-]+$"
        }
      },
      {
        "name": "chatId",
        "in": "path",
        "required": true,
        "description": "Chat JID or phone digits (LID or PN — aliases merged)",
        "schema": {
          "type": "string",
          "minLength": 1
        }
      }
    ],
    "bodyExample": null,
    "responses": [
      "200"
    ]
  },
  {
    "id": "get-_v1_instances_name_chats_chatId_messages_messageId",
    "method": "GET",
    "path": "/v1/instances/{name}/chats/{chatId}/messages/{messageId}",
    "summary": "Get message by id",
    "description": "",
    "tags": [
      "Chats"
    ],
    "security": true,
    "params": [
      {
        "name": "name",
        "in": "path",
        "required": true,
        "description": "Unique instance name / zapo sessionId (e.g. `sales-1`). Alphanumeric, `_` and `-` only.",
        "schema": {
          "type": "string",
          "minLength": 1,
          "maxLength": 64,
          "pattern": "^[a-zA-Z0-9_-]+$"
        }
      },
      {
        "name": "chatId",
        "in": "path",
        "required": true,
        "description": "Chat JID or phone digits (LID or PN — aliases merged)",
        "schema": {
          "type": "string",
          "minLength": 1
        }
      },
      {
        "name": "messageId",
        "in": "path",
        "required": true,
        "description": "",
        "schema": {
          "type": "string",
          "minLength": 1
        }
      }
    ],
    "bodyExample": null,
    "responses": [
      "200",
      "404"
    ]
  },
  {
    "id": "post-_v1_instances_name_chats_chatId_unarchive",
    "method": "POST",
    "path": "/v1/instances/{name}/chats/{chatId}/unarchive",
    "summary": "Unarchive chat",
    "description": "",
    "tags": [
      "Chats"
    ],
    "security": true,
    "params": [
      {
        "name": "name",
        "in": "path",
        "required": true,
        "description": "Unique instance name / zapo sessionId (e.g. `sales-1`). Alphanumeric, `_` and `-` only.",
        "schema": {
          "type": "string",
          "minLength": 1,
          "maxLength": 64,
          "pattern": "^[a-zA-Z0-9_-]+$"
        }
      },
      {
        "name": "chatId",
        "in": "path",
        "required": true,
        "description": "Chat JID or phone digits (LID or PN — aliases merged)",
        "schema": {
          "type": "string",
          "minLength": 1
        }
      }
    ],
    "bodyExample": null,
    "responses": [
      "200"
    ]
  },
  {
    "id": "post-_v1_instances_name_chats_chatId_unread",
    "method": "POST",
    "path": "/v1/instances/{name}/chats/{chatId}/unread",
    "summary": "Mark chat as unread (app-state)",
    "description": "",
    "tags": [
      "Chats"
    ],
    "security": true,
    "params": [
      {
        "name": "name",
        "in": "path",
        "required": true,
        "description": "Unique instance name / zapo sessionId (e.g. `sales-1`). Alphanumeric, `_` and `-` only.",
        "schema": {
          "type": "string",
          "minLength": 1,
          "maxLength": 64,
          "pattern": "^[a-zA-Z0-9_-]+$"
        }
      },
      {
        "name": "chatId",
        "in": "path",
        "required": true,
        "description": "Chat JID or phone digits (LID or PN — aliases merged)",
        "schema": {
          "type": "string",
          "minLength": 1
        }
      }
    ],
    "bodyExample": null,
    "responses": [
      "200"
    ]
  },
  {
    "id": "post-_v1_instances_name_chats_jid_chatstate",
    "method": "POST",
    "path": "/v1/instances/{name}/chats/{jid}/chatstate",
    "summary": "Send typing / recording indicator",
    "description": "Sends a chat-state into a conversation:\n\n| state | Meaning |\n|-------|---------|\n| `composing` | Typing… |\n| `recording` | Recording voice note |\n| `paused` | Stopped |\n\nPath param `jid` may be digits or a full JID (URL-encode `@` as `%40`).\n\n```bash\ncurl -s -X POST \"$BASE/v1/instances/sales-1/chats/5511999999999/chatstate\" \\\n  -H \"X-Api-Key: $KEY\" -H \"content-type: application/json\" \\\n  -d '{ \"state\": \"composing\" }'\n```",
    "tags": [
      "Presence"
    ],
    "security": true,
    "params": [
      {
        "name": "name",
        "in": "path",
        "required": true,
        "description": "Instance name",
        "schema": {
          "type": "string",
          "minLength": 1
        }
      },
      {
        "name": "jid",
        "in": "path",
        "required": true,
        "description": "Chat JID or phone (URL-encode `@` as %40). Example: 5511999999999",
        "schema": {
          "type": "string",
          "minLength": 1
        }
      }
    ],
    "bodyExample": {
      "state": "composing"
    },
    "responses": [
      "200",
      "400",
      "401",
      "403",
      "404",
      "503"
    ]
  },
  {
    "id": "post-_v1_instances_name_connect",
    "method": "POST",
    "path": "/v1/instances/{name}/connect",
    "summary": "Connect / start session",
    "description": "Opens the WhatsApp Web socket for the instance (zapo `client.connect()`).\n\n- First time: emits QR (`status: qr`) or pairing flow\n- After pairing: resumes from stored credentials (`status: open`)\n- Spawns reconnect-with-backoff on transient disconnects\n\nPoll `GET .../qr` or listen to webhook `instance.qr` while pairing.\n\n```bash\ncurl -s -X POST \"$BASE/v1/instances/sales-1/connect\" -H \"X-Api-Key: $KEY\"\n```",
    "tags": [
      "Instances"
    ],
    "security": true,
    "params": [
      {
        "name": "name",
        "in": "path",
        "required": true,
        "description": "Unique instance name / zapo sessionId (e.g. `sales-1`). Alphanumeric, `_` and `-` only.",
        "schema": {
          "type": "string",
          "minLength": 1,
          "maxLength": 64,
          "pattern": "^[a-zA-Z0-9_-]+$"
        }
      }
    ],
    "bodyExample": null,
    "responses": [
      "200",
      "401",
      "403",
      "404",
      "503"
    ]
  },
  {
    "id": "get-_v1_instances_name_contacts",
    "method": "GET",
    "path": "/v1/instances/{name}/contacts",
    "summary": "List stored contacts",
    "description": "",
    "tags": [
      "Contacts"
    ],
    "security": true,
    "params": [
      {
        "name": "name",
        "in": "path",
        "required": true,
        "description": "Unique instance name / zapo sessionId (e.g. `sales-1`). Alphanumeric, `_` and `-` only.",
        "schema": {
          "type": "string",
          "minLength": 1,
          "maxLength": 64,
          "pattern": "^[a-zA-Z0-9_-]+$"
        }
      }
    ],
    "bodyExample": null,
    "responses": [
      "200"
    ]
  },
  {
    "id": "post-_v1_instances_name_contacts_block",
    "method": "POST",
    "path": "/v1/instances/{name}/contacts/block",
    "summary": "Block contact",
    "description": "",
    "tags": [
      "Contacts"
    ],
    "security": true,
    "params": [
      {
        "name": "name",
        "in": "path",
        "required": true,
        "description": "Unique instance name / zapo sessionId (e.g. `sales-1`). Alphanumeric, `_` and `-` only.",
        "schema": {
          "type": "string",
          "minLength": 1,
          "maxLength": 64,
          "pattern": "^[a-zA-Z0-9_-]+$"
        }
      }
    ],
    "bodyExample": null,
    "responses": [
      "200"
    ]
  },
  {
    "id": "get-_v1_instances_name_contacts_check",
    "method": "GET",
    "path": "/v1/instances/{name}/contacts/check",
    "summary": "Check one number (query)",
    "description": "single-number check: `?phone=5568981159096`",
    "tags": [
      "Contacts"
    ],
    "security": true,
    "params": [
      {
        "name": "name",
        "in": "path",
        "required": true,
        "description": "Unique instance name / zapo sessionId (e.g. `sales-1`). Alphanumeric, `_` and `-` only.",
        "schema": {
          "type": "string",
          "minLength": 1,
          "maxLength": 64,
          "pattern": "^[a-zA-Z0-9_-]+$"
        }
      }
    ],
    "bodyExample": null,
    "responses": [
      "200"
    ]
  },
  {
    "id": "post-_v1_instances_name_contacts_check",
    "method": "POST",
    "path": "/v1/instances/{name}/contacts/check",
    "summary": "Check if numbers exist on WhatsApp (batch)",
    "description": "Batch existence check with BR/MX/AR digit variants. Uses a **single** usync call for all numbers+variants.\n\nAlias of resolve with a flatter response shape ( compatible fields).",
    "tags": [
      "Contacts"
    ],
    "security": true,
    "params": [
      {
        "name": "name",
        "in": "path",
        "required": true,
        "description": "Unique instance name / zapo sessionId (e.g. `sales-1`). Alphanumeric, `_` and `-` only.",
        "schema": {
          "type": "string",
          "minLength": 1,
          "maxLength": 64,
          "pattern": "^[a-zA-Z0-9_-]+$"
        }
      }
    ],
    "bodyExample": {
      "phones": [
        "5511999999999",
        "5511888888888"
      ]
    },
    "responses": [
      "200",
      "400",
      "503"
    ]
  },
  {
    "id": "post-_v1_instances_name_contacts_jid",
    "method": "POST",
    "path": "/v1/instances/{name}/contacts/jid",
    "summary": "Build JID locally (createJid)",
    "description": "Applies local phone normalization (BR 9th digit, MX/AR) **without** calling WhatsApp.\n\nFor the **server-confirmed** JID, use `POST.../contacts/resolve` or `.../check`.\n\nExample: `5568981159096` → `556881159096@s.whatsapp.net`",
    "tags": [
      "Contacts"
    ],
    "security": true,
    "params": [
      {
        "name": "name",
        "in": "path",
        "required": true,
        "description": "Unique instance name / zapo sessionId (e.g. `sales-1`). Alphanumeric, `_` and `-` only.",
        "schema": {
          "type": "string",
          "minLength": 1,
          "maxLength": 64,
          "pattern": "^[a-zA-Z0-9_-]+$"
        }
      }
    ],
    "bodyExample": null,
    "responses": [
      "200"
    ]
  },
  {
    "id": "post-_v1_instances_name_contacts_resolve",
    "method": "POST",
    "path": "/v1/instances/{name}/contacts/resolve",
    "summary": "Resolve correct WhatsApp JID for numbers",
    "description": "Like `POST /chat/whatsappNumbers`:\n- expands BR **nono dígito** / MX-AR variants\n- **one** `getLidsByPhoneNumbers` batch (no spam)\n- returns the WA-confirmed `jid` when `exists`\n- caches results (Redis/memory) for 24h",
    "tags": [
      "Contacts"
    ],
    "security": true,
    "params": [
      {
        "name": "name",
        "in": "path",
        "required": true,
        "description": "Unique instance name / zapo sessionId (e.g. `sales-1`). Alphanumeric, `_` and `-` only.",
        "schema": {
          "type": "string",
          "minLength": 1,
          "maxLength": 64,
          "pattern": "^[a-zA-Z0-9_-]+$"
        }
      }
    ],
    "bodyExample": null,
    "responses": [
      "200"
    ]
  },
  {
    "id": "post-_v1_instances_name_contacts_unblock",
    "method": "POST",
    "path": "/v1/instances/{name}/contacts/unblock",
    "summary": "Unblock contact",
    "description": "",
    "tags": [
      "Contacts"
    ],
    "security": true,
    "params": [
      {
        "name": "name",
        "in": "path",
        "required": true,
        "description": "Unique instance name / zapo sessionId (e.g. `sales-1`). Alphanumeric, `_` and `-` only.",
        "schema": {
          "type": "string",
          "minLength": 1,
          "maxLength": 64,
          "pattern": "^[a-zA-Z0-9_-]+$"
        }
      }
    ],
    "bodyExample": null,
    "responses": [
      "200"
    ]
  },
  {
    "id": "post-_v1_instances_name_contacts_whatsapp-numbers",
    "method": "POST",
    "path": "/v1/instances/{name}/contacts/whatsapp-numbers",
    "summary": "whatsappNumbers alias",
    "description": "Same as `POST.../contacts/resolve` (legacy naming).",
    "tags": [
      "Contacts"
    ],
    "security": true,
    "params": [
      {
        "name": "name",
        "in": "path",
        "required": true,
        "description": "Unique instance name / zapo sessionId (e.g. `sales-1`). Alphanumeric, `_` and `-` only.",
        "schema": {
          "type": "string",
          "minLength": 1,
          "maxLength": 64,
          "pattern": "^[a-zA-Z0-9_-]+$"
        }
      }
    ],
    "bodyExample": null,
    "responses": [
      "200"
    ]
  },
  {
    "id": "get-_v1_instances_name_contacts_jid",
    "method": "GET",
    "path": "/v1/instances/{name}/contacts/{jid}",
    "summary": "Get contact",
    "description": "",
    "tags": [
      "Contacts"
    ],
    "security": true,
    "params": [
      {
        "name": "name",
        "in": "path",
        "required": true,
        "description": "Unique instance name / zapo sessionId (e.g. `sales-1`). Alphanumeric, `_` and `-` only.",
        "schema": {
          "type": "string",
          "minLength": 1,
          "maxLength": 64,
          "pattern": "^[a-zA-Z0-9_-]+$"
        }
      },
      {
        "name": "jid",
        "in": "path",
        "required": true,
        "description": "",
        "schema": {
          "type": "string"
        }
      }
    ],
    "bodyExample": null,
    "responses": [
      "200"
    ]
  },
  {
    "id": "get-_v1_instances_name_contacts_phone_about",
    "method": "GET",
    "path": "/v1/instances/{name}/contacts/{phone}/about",
    "summary": "Get contact about status",
    "description": "",
    "tags": [
      "Contacts"
    ],
    "security": true,
    "params": [
      {
        "name": "name",
        "in": "path",
        "required": true,
        "description": "Instance name",
        "schema": {
          "type": "string",
          "minLength": 1
        }
      },
      {
        "name": "phone",
        "in": "path",
        "required": true,
        "description": "Phone digits or JID of the contact",
        "schema": {
          "type": "string",
          "minLength": 1
        }
      }
    ],
    "bodyExample": null,
    "responses": [
      "200"
    ]
  },
  {
    "id": "get-_v1_instances_name_contacts_phone_profile-picture",
    "method": "GET",
    "path": "/v1/instances/{name}/contacts/{phone}/profile-picture",
    "summary": "Get profile picture (durable storage + TTL revalidation)",
    "description": "Returns contact avatar with **bytes in object storage** (deterministic key, overwrite on change).\n\n- Within TTL: serve our stored file **without** hitting WhatsApp.\n- After TTL (or `refresh=true`): revalidate via IQ; compare `id`/sha256; download+overwrite only if changed.\n- Privacy / no pic: delete stored object (no orphans).\n- Binary stream: `GET.../profile-picture/file`.\nDo not spam `refresh` (WhatsApp rate-overlimit).",
    "tags": [
      "Contacts"
    ],
    "security": true,
    "params": [
      {
        "name": "name",
        "in": "path",
        "required": true,
        "description": "Instance name",
        "schema": {
          "type": "string",
          "minLength": 1
        }
      },
      {
        "name": "phone",
        "in": "path",
        "required": true,
        "description": "Phone digits or JID of the contact",
        "schema": {
          "type": "string",
          "minLength": 1
        }
      }
    ],
    "bodyExample": null,
    "responses": [
      "200",
      "400",
      "503"
    ]
  },
  {
    "id": "get-_v1_instances_name_contacts_phone_profile-picture_file",
    "method": "GET",
    "path": "/v1/instances/{name}/contacts/{phone}/profile-picture/file",
    "summary": "Stream stored profile picture bytes",
    "description": "Streams the durable avatar from object storage. Triggers resolve (with TTL) first so the file exists when possible.",
    "tags": [
      "Contacts"
    ],
    "security": true,
    "params": [
      {
        "name": "name",
        "in": "path",
        "required": true,
        "description": "Instance name",
        "schema": {
          "type": "string",
          "minLength": 1
        }
      },
      {
        "name": "phone",
        "in": "path",
        "required": true,
        "description": "Phone digits or JID of the contact",
        "schema": {
          "type": "string",
          "minLength": 1
        }
      }
    ],
    "bodyExample": null,
    "responses": [
      "404",
      "503"
    ]
  },
  {
    "id": "post-_v1_instances_name_disconnect",
    "method": "POST",
    "path": "/v1/instances/{name}/disconnect",
    "summary": "Disconnect session",
    "description": "Gracefully closes the socket **without** unlinking the device (`client.disconnect()`).\n\nCredentials remain in the zapo store — next `connect` resumes without a new QR.\n\nDo **not** confuse with `DELETE` (logout + remove).",
    "tags": [
      "Instances"
    ],
    "security": true,
    "params": [
      {
        "name": "name",
        "in": "path",
        "required": true,
        "description": "Unique instance name / zapo sessionId (e.g. `sales-1`). Alphanumeric, `_` and `-` only.",
        "schema": {
          "type": "string",
          "minLength": 1,
          "maxLength": 64,
          "pattern": "^[a-zA-Z0-9_-]+$"
        }
      }
    ],
    "bodyExample": null,
    "responses": [
      "200",
      "401",
      "403",
      "404"
    ]
  },
  {
    "id": "get-_v1_instances_name_groups",
    "method": "GET",
    "path": "/v1/instances/{name}/groups",
    "summary": "List groups",
    "description": "",
    "tags": [
      "Groups"
    ],
    "security": true,
    "params": [
      {
        "name": "name",
        "in": "path",
        "required": true,
        "description": "Unique instance name / zapo sessionId (e.g. `sales-1`). Alphanumeric, `_` and `-` only.",
        "schema": {
          "type": "string",
          "minLength": 1,
          "maxLength": 64,
          "pattern": "^[a-zA-Z0-9_-]+$"
        }
      }
    ],
    "bodyExample": null,
    "responses": [
      "200",
      "503"
    ]
  },
  {
    "id": "post-_v1_instances_name_groups",
    "method": "POST",
    "path": "/v1/instances/{name}/groups",
    "summary": "Create group",
    "description": "",
    "tags": [
      "Groups"
    ],
    "security": true,
    "params": [
      {
        "name": "name",
        "in": "path",
        "required": true,
        "description": "Unique instance name / zapo sessionId (e.g. `sales-1`). Alphanumeric, `_` and `-` only.",
        "schema": {
          "type": "string",
          "minLength": 1,
          "maxLength": 64,
          "pattern": "^[a-zA-Z0-9_-]+$"
        }
      }
    ],
    "bodyExample": null,
    "responses": [
      "200"
    ]
  },
  {
    "id": "post-_v1_instances_name_groups_join",
    "method": "POST",
    "path": "/v1/instances/{name}/groups/join",
    "summary": "Join group via invite code",
    "description": "",
    "tags": [
      "Groups"
    ],
    "security": true,
    "params": [
      {
        "name": "name",
        "in": "path",
        "required": true,
        "description": "Unique instance name / zapo sessionId (e.g. `sales-1`). Alphanumeric, `_` and `-` only.",
        "schema": {
          "type": "string",
          "minLength": 1,
          "maxLength": 64,
          "pattern": "^[a-zA-Z0-9_-]+$"
        }
      }
    ],
    "bodyExample": null,
    "responses": [
      "200"
    ]
  },
  {
    "id": "get-_v1_instances_name_groups_join-info",
    "method": "GET",
    "path": "/v1/instances/{name}/groups/join-info",
    "summary": "Preview group invite",
    "description": "",
    "tags": [
      "Groups"
    ],
    "security": true,
    "params": [
      {
        "name": "name",
        "in": "path",
        "required": true,
        "description": "Unique instance name / zapo sessionId (e.g. `sales-1`). Alphanumeric, `_` and `-` only.",
        "schema": {
          "type": "string",
          "minLength": 1,
          "maxLength": 64,
          "pattern": "^[a-zA-Z0-9_-]+$"
        }
      }
    ],
    "bodyExample": null,
    "responses": [
      "200"
    ]
  },
  {
    "id": "get-_v1_instances_name_groups_groupId",
    "method": "GET",
    "path": "/v1/instances/{name}/groups/{groupId}",
    "summary": "Get group metadata",
    "description": "",
    "tags": [
      "Groups"
    ],
    "security": true,
    "params": [
      {
        "name": "name",
        "in": "path",
        "required": true,
        "description": "Unique instance name / zapo sessionId (e.g. `sales-1`). Alphanumeric, `_` and `-` only.",
        "schema": {
          "type": "string",
          "minLength": 1,
          "maxLength": 64,
          "pattern": "^[a-zA-Z0-9_-]+$"
        }
      },
      {
        "name": "groupId",
        "in": "path",
        "required": true,
        "description": "",
        "schema": {
          "type": "string",
          "minLength": 1
        }
      }
    ],
    "bodyExample": null,
    "responses": [
      "200"
    ]
  },
  {
    "id": "post-_v1_instances_name_groups_groupId_admin_demote",
    "method": "POST",
    "path": "/v1/instances/{name}/groups/{groupId}/admin/demote",
    "summary": "Demote admins",
    "description": "",
    "tags": [
      "Groups"
    ],
    "security": true,
    "params": [
      {
        "name": "name",
        "in": "path",
        "required": true,
        "description": "Unique instance name / zapo sessionId (e.g. `sales-1`). Alphanumeric, `_` and `-` only.",
        "schema": {
          "type": "string",
          "minLength": 1,
          "maxLength": 64,
          "pattern": "^[a-zA-Z0-9_-]+$"
        }
      },
      {
        "name": "groupId",
        "in": "path",
        "required": true,
        "description": "",
        "schema": {
          "type": "string",
          "minLength": 1
        }
      }
    ],
    "bodyExample": null,
    "responses": [
      "200"
    ]
  },
  {
    "id": "post-_v1_instances_name_groups_groupId_admin_promote",
    "method": "POST",
    "path": "/v1/instances/{name}/groups/{groupId}/admin/promote",
    "summary": "Promote admins",
    "description": "",
    "tags": [
      "Groups"
    ],
    "security": true,
    "params": [
      {
        "name": "name",
        "in": "path",
        "required": true,
        "description": "Unique instance name / zapo sessionId (e.g. `sales-1`). Alphanumeric, `_` and `-` only.",
        "schema": {
          "type": "string",
          "minLength": 1,
          "maxLength": 64,
          "pattern": "^[a-zA-Z0-9_-]+$"
        }
      },
      {
        "name": "groupId",
        "in": "path",
        "required": true,
        "description": "",
        "schema": {
          "type": "string",
          "minLength": 1
        }
      }
    ],
    "bodyExample": null,
    "responses": [
      "200"
    ]
  },
  {
    "id": "put-_v1_instances_name_groups_groupId_description",
    "method": "PUT",
    "path": "/v1/instances/{name}/groups/{groupId}/description",
    "summary": "Set group description",
    "description": "",
    "tags": [
      "Groups"
    ],
    "security": true,
    "params": [
      {
        "name": "name",
        "in": "path",
        "required": true,
        "description": "Unique instance name / zapo sessionId (e.g. `sales-1`). Alphanumeric, `_` and `-` only.",
        "schema": {
          "type": "string",
          "minLength": 1,
          "maxLength": 64,
          "pattern": "^[a-zA-Z0-9_-]+$"
        }
      },
      {
        "name": "groupId",
        "in": "path",
        "required": true,
        "description": "",
        "schema": {
          "type": "string",
          "minLength": 1
        }
      }
    ],
    "bodyExample": null,
    "responses": [
      "200"
    ]
  },
  {
    "id": "get-_v1_instances_name_groups_groupId_invite-code",
    "method": "GET",
    "path": "/v1/instances/{name}/groups/{groupId}/invite-code",
    "summary": "Get invite code",
    "description": "",
    "tags": [
      "Groups"
    ],
    "security": true,
    "params": [
      {
        "name": "name",
        "in": "path",
        "required": true,
        "description": "Unique instance name / zapo sessionId (e.g. `sales-1`). Alphanumeric, `_` and `-` only.",
        "schema": {
          "type": "string",
          "minLength": 1,
          "maxLength": 64,
          "pattern": "^[a-zA-Z0-9_-]+$"
        }
      },
      {
        "name": "groupId",
        "in": "path",
        "required": true,
        "description": "",
        "schema": {
          "type": "string",
          "minLength": 1
        }
      }
    ],
    "bodyExample": null,
    "responses": [
      "200"
    ]
  },
  {
    "id": "post-_v1_instances_name_groups_groupId_invite-code_revoke",
    "method": "POST",
    "path": "/v1/instances/{name}/groups/{groupId}/invite-code/revoke",
    "summary": "Revoke invite code",
    "description": "",
    "tags": [
      "Groups"
    ],
    "security": true,
    "params": [
      {
        "name": "name",
        "in": "path",
        "required": true,
        "description": "Unique instance name / zapo sessionId (e.g. `sales-1`). Alphanumeric, `_` and `-` only.",
        "schema": {
          "type": "string",
          "minLength": 1,
          "maxLength": 64,
          "pattern": "^[a-zA-Z0-9_-]+$"
        }
      },
      {
        "name": "groupId",
        "in": "path",
        "required": true,
        "description": "",
        "schema": {
          "type": "string",
          "minLength": 1
        }
      }
    ],
    "bodyExample": null,
    "responses": [
      "200"
    ]
  },
  {
    "id": "post-_v1_instances_name_groups_groupId_leave",
    "method": "POST",
    "path": "/v1/instances/{name}/groups/{groupId}/leave",
    "summary": "Leave group",
    "description": "",
    "tags": [
      "Groups"
    ],
    "security": true,
    "params": [
      {
        "name": "name",
        "in": "path",
        "required": true,
        "description": "Unique instance name / zapo sessionId (e.g. `sales-1`). Alphanumeric, `_` and `-` only.",
        "schema": {
          "type": "string",
          "minLength": 1,
          "maxLength": 64,
          "pattern": "^[a-zA-Z0-9_-]+$"
        }
      },
      {
        "name": "groupId",
        "in": "path",
        "required": true,
        "description": "",
        "schema": {
          "type": "string",
          "minLength": 1
        }
      }
    ],
    "bodyExample": null,
    "responses": [
      "200"
    ]
  },
  {
    "id": "post-_v1_instances_name_groups_groupId_participants_add",
    "method": "POST",
    "path": "/v1/instances/{name}/groups/{groupId}/participants/add",
    "summary": "Add participants",
    "description": "",
    "tags": [
      "Groups"
    ],
    "security": true,
    "params": [
      {
        "name": "name",
        "in": "path",
        "required": true,
        "description": "Unique instance name / zapo sessionId (e.g. `sales-1`). Alphanumeric, `_` and `-` only.",
        "schema": {
          "type": "string",
          "minLength": 1,
          "maxLength": 64,
          "pattern": "^[a-zA-Z0-9_-]+$"
        }
      },
      {
        "name": "groupId",
        "in": "path",
        "required": true,
        "description": "",
        "schema": {
          "type": "string",
          "minLength": 1
        }
      }
    ],
    "bodyExample": null,
    "responses": [
      "200"
    ]
  },
  {
    "id": "post-_v1_instances_name_groups_groupId_participants_remove",
    "method": "POST",
    "path": "/v1/instances/{name}/groups/{groupId}/participants/remove",
    "summary": "Remove participants",
    "description": "",
    "tags": [
      "Groups"
    ],
    "security": true,
    "params": [
      {
        "name": "name",
        "in": "path",
        "required": true,
        "description": "Unique instance name / zapo sessionId (e.g. `sales-1`). Alphanumeric, `_` and `-` only.",
        "schema": {
          "type": "string",
          "minLength": 1,
          "maxLength": 64,
          "pattern": "^[a-zA-Z0-9_-]+$"
        }
      },
      {
        "name": "groupId",
        "in": "path",
        "required": true,
        "description": "",
        "schema": {
          "type": "string",
          "minLength": 1
        }
      }
    ],
    "bodyExample": null,
    "responses": [
      "200"
    ]
  },
  {
    "id": "get-_v1_instances_name_groups_groupId_picture",
    "method": "GET",
    "path": "/v1/instances/{name}/groups/{groupId}/picture",
    "summary": "Get group picture",
    "description": "",
    "tags": [
      "Groups"
    ],
    "security": true,
    "params": [
      {
        "name": "name",
        "in": "path",
        "required": true,
        "description": "Unique instance name / zapo sessionId (e.g. `sales-1`). Alphanumeric, `_` and `-` only.",
        "schema": {
          "type": "string",
          "minLength": 1,
          "maxLength": 64,
          "pattern": "^[a-zA-Z0-9_-]+$"
        }
      },
      {
        "name": "groupId",
        "in": "path",
        "required": true,
        "description": "",
        "schema": {
          "type": "string",
          "minLength": 1
        }
      }
    ],
    "bodyExample": null,
    "responses": [
      "200"
    ]
  },
  {
    "id": "put-_v1_instances_name_groups_groupId_picture",
    "method": "PUT",
    "path": "/v1/instances/{name}/groups/{groupId}/picture",
    "summary": "Set group picture (JPEG bytes via URL or base64)",
    "description": "",
    "tags": [
      "Groups"
    ],
    "security": true,
    "params": [
      {
        "name": "name",
        "in": "path",
        "required": true,
        "description": "Unique instance name / zapo sessionId (e.g. `sales-1`). Alphanumeric, `_` and `-` only.",
        "schema": {
          "type": "string",
          "minLength": 1,
          "maxLength": 64,
          "pattern": "^[a-zA-Z0-9_-]+$"
        }
      },
      {
        "name": "groupId",
        "in": "path",
        "required": true,
        "description": "",
        "schema": {
          "type": "string",
          "minLength": 1
        }
      }
    ],
    "bodyExample": null,
    "responses": [
      "200"
    ]
  },
  {
    "id": "delete-_v1_instances_name_groups_groupId_picture",
    "method": "DELETE",
    "path": "/v1/instances/{name}/groups/{groupId}/picture",
    "summary": "Delete group picture",
    "description": "",
    "tags": [
      "Groups"
    ],
    "security": true,
    "params": [
      {
        "name": "name",
        "in": "path",
        "required": true,
        "description": "Unique instance name / zapo sessionId (e.g. `sales-1`). Alphanumeric, `_` and `-` only.",
        "schema": {
          "type": "string",
          "minLength": 1,
          "maxLength": 64,
          "pattern": "^[a-zA-Z0-9_-]+$"
        }
      },
      {
        "name": "groupId",
        "in": "path",
        "required": true,
        "description": "",
        "schema": {
          "type": "string",
          "minLength": 1
        }
      }
    ],
    "bodyExample": null,
    "responses": [
      "200"
    ]
  },
  {
    "id": "put-_v1_instances_name_groups_groupId_settings_security_info-admin-only",
    "method": "PUT",
    "path": "/v1/instances/{name}/groups/{groupId}/settings/security/info-admin-only",
    "summary": "Group info admin-only (restrict)",
    "description": "",
    "tags": [
      "Groups"
    ],
    "security": true,
    "params": [
      {
        "name": "name",
        "in": "path",
        "required": true,
        "description": "Unique instance name / zapo sessionId (e.g. `sales-1`). Alphanumeric, `_` and `-` only.",
        "schema": {
          "type": "string",
          "minLength": 1,
          "maxLength": 64,
          "pattern": "^[a-zA-Z0-9_-]+$"
        }
      },
      {
        "name": "groupId",
        "in": "path",
        "required": true,
        "description": "",
        "schema": {
          "type": "string",
          "minLength": 1
        }
      }
    ],
    "bodyExample": null,
    "responses": [
      "200"
    ]
  },
  {
    "id": "put-_v1_instances_name_groups_groupId_settings_security_messages-admin-only",
    "method": "PUT",
    "path": "/v1/instances/{name}/groups/{groupId}/settings/security/messages-admin-only",
    "summary": "Messages admin-only (announcement)",
    "description": "",
    "tags": [
      "Groups"
    ],
    "security": true,
    "params": [
      {
        "name": "name",
        "in": "path",
        "required": true,
        "description": "Unique instance name / zapo sessionId (e.g. `sales-1`). Alphanumeric, `_` and `-` only.",
        "schema": {
          "type": "string",
          "minLength": 1,
          "maxLength": 64,
          "pattern": "^[a-zA-Z0-9_-]+$"
        }
      },
      {
        "name": "groupId",
        "in": "path",
        "required": true,
        "description": "",
        "schema": {
          "type": "string",
          "minLength": 1
        }
      }
    ],
    "bodyExample": null,
    "responses": [
      "200"
    ]
  },
  {
    "id": "put-_v1_instances_name_groups_groupId_settings_setting",
    "method": "PUT",
    "path": "/v1/instances/{name}/groups/{groupId}/settings/{setting}",
    "summary": "Toggle group setting",
    "description": "Settings: `announcement` (messages admin-only), `restrict` (info admin-only), `ephemeral`, `membership_approval_mode`, `group_history`, etc.",
    "tags": [
      "Groups"
    ],
    "security": true,
    "params": [
      {
        "name": "name",
        "in": "path",
        "required": true,
        "description": "Unique instance name / zapo sessionId (e.g. `sales-1`). Alphanumeric, `_` and `-` only.",
        "schema": {
          "type": "string",
          "minLength": 1,
          "maxLength": 64,
          "pattern": "^[a-zA-Z0-9_-]+$"
        }
      },
      {
        "name": "groupId",
        "in": "path",
        "required": true,
        "description": "",
        "schema": {
          "type": "string",
          "minLength": 1
        }
      },
      {
        "name": "setting",
        "in": "path",
        "required": true,
        "description": "",
        "schema": {
          "type": "string",
          "enum": [
            "announcement",
            "restrict",
            "ephemeral",
            "membership_approval_mode",
            "allow_non_admin_sub_group_creation",
            "group_history",
            "allow_admin_reports",
            "no_frequently_forwarded"
          ]
        }
      }
    ],
    "bodyExample": null,
    "responses": [
      "200"
    ]
  },
  {
    "id": "put-_v1_instances_name_groups_groupId_subject",
    "method": "PUT",
    "path": "/v1/instances/{name}/groups/{groupId}/subject",
    "summary": "Set group subject",
    "description": "",
    "tags": [
      "Groups"
    ],
    "security": true,
    "params": [
      {
        "name": "name",
        "in": "path",
        "required": true,
        "description": "Unique instance name / zapo sessionId (e.g. `sales-1`). Alphanumeric, `_` and `-` only.",
        "schema": {
          "type": "string",
          "minLength": 1,
          "maxLength": 64,
          "pattern": "^[a-zA-Z0-9_-]+$"
        }
      },
      {
        "name": "groupId",
        "in": "path",
        "required": true,
        "description": "",
        "schema": {
          "type": "string",
          "minLength": 1
        }
      }
    ],
    "bodyExample": null,
    "responses": [
      "200"
    ]
  },
  {
    "id": "post-_v1_instances_name_keys_rotate",
    "method": "POST",
    "path": "/v1/instances/{name}/keys/rotate",
    "summary": "Rotate instance API key",
    "description": "**Admin only.** Generates a new instance `apiKey`, invalidates the previous one, and returns the instance with the new key **shown once**.\n\nUpdate all integrations immediately after rotation.",
    "tags": [
      "Instances"
    ],
    "security": true,
    "params": [
      {
        "name": "name",
        "in": "path",
        "required": true,
        "description": "Unique instance name / zapo sessionId (e.g. `sales-1`). Alphanumeric, `_` and `-` only.",
        "schema": {
          "type": "string",
          "minLength": 1,
          "maxLength": 64,
          "pattern": "^[a-zA-Z0-9_-]+$"
        }
      }
    ],
    "bodyExample": null,
    "responses": [
      "200",
      "401",
      "403",
      "404"
    ]
  },
  {
    "id": "get-_v1_instances_name_labels",
    "method": "GET",
    "path": "/v1/instances/{name}/labels",
    "summary": "List labels",
    "description": "WhatsApp Business labels (app-state LabelEdit). Stored locally + synced via chat.set.",
    "tags": [
      "Labels"
    ],
    "security": true,
    "params": [
      {
        "name": "name",
        "in": "path",
        "required": true,
        "description": "Unique instance name / zapo sessionId (e.g. `sales-1`). Alphanumeric, `_` and `-` only.",
        "schema": {
          "type": "string",
          "minLength": 1,
          "maxLength": 64,
          "pattern": "^[a-zA-Z0-9_-]+$"
        }
      }
    ],
    "bodyExample": null,
    "responses": [
      "200"
    ]
  },
  {
    "id": "post-_v1_instances_name_labels",
    "method": "POST",
    "path": "/v1/instances/{name}/labels",
    "summary": "Create / upsert label",
    "description": "",
    "tags": [
      "Labels"
    ],
    "security": true,
    "params": [
      {
        "name": "name",
        "in": "path",
        "required": true,
        "description": "Unique instance name / zapo sessionId (e.g. `sales-1`). Alphanumeric, `_` and `-` only.",
        "schema": {
          "type": "string",
          "minLength": 1,
          "maxLength": 64,
          "pattern": "^[a-zA-Z0-9_-]+$"
        }
      }
    ],
    "bodyExample": null,
    "responses": [
      "200"
    ]
  },
  {
    "id": "put-_v1_instances_name_labels_labelId",
    "method": "PUT",
    "path": "/v1/instances/{name}/labels/{labelId}",
    "summary": "Update label",
    "description": "",
    "tags": [
      "Labels"
    ],
    "security": true,
    "params": [
      {
        "name": "name",
        "in": "path",
        "required": true,
        "description": "Unique instance name / zapo sessionId (e.g. `sales-1`). Alphanumeric, `_` and `-` only.",
        "schema": {
          "type": "string",
          "minLength": 1,
          "maxLength": 64,
          "pattern": "^[a-zA-Z0-9_-]+$"
        }
      },
      {
        "name": "labelId",
        "in": "path",
        "required": true,
        "description": "",
        "schema": {
          "type": "string",
          "minLength": 1
        }
      }
    ],
    "bodyExample": null,
    "responses": [
      "200"
    ]
  },
  {
    "id": "delete-_v1_instances_name_labels_labelId",
    "method": "DELETE",
    "path": "/v1/instances/{name}/labels/{labelId}",
    "summary": "Delete label",
    "description": "",
    "tags": [
      "Labels"
    ],
    "security": true,
    "params": [
      {
        "name": "name",
        "in": "path",
        "required": true,
        "description": "Unique instance name / zapo sessionId (e.g. `sales-1`). Alphanumeric, `_` and `-` only.",
        "schema": {
          "type": "string",
          "minLength": 1,
          "maxLength": 64,
          "pattern": "^[a-zA-Z0-9_-]+$"
        }
      },
      {
        "name": "labelId",
        "in": "path",
        "required": true,
        "description": "",
        "schema": {
          "type": "string",
          "minLength": 1
        }
      }
    ],
    "bodyExample": null,
    "responses": [
      "200",
      "404"
    ]
  },
  {
    "id": "get-_v1_instances_name_labels_labelId_chats",
    "method": "GET",
    "path": "/v1/instances/{name}/labels/{labelId}/chats",
    "summary": "List chats with this label",
    "description": "",
    "tags": [
      "Labels"
    ],
    "security": true,
    "params": [
      {
        "name": "name",
        "in": "path",
        "required": true,
        "description": "Unique instance name / zapo sessionId (e.g. `sales-1`). Alphanumeric, `_` and `-` only.",
        "schema": {
          "type": "string",
          "minLength": 1,
          "maxLength": 64,
          "pattern": "^[a-zA-Z0-9_-]+$"
        }
      },
      {
        "name": "labelId",
        "in": "path",
        "required": true,
        "description": "",
        "schema": {
          "type": "string",
          "minLength": 1
        }
      }
    ],
    "bodyExample": null,
    "responses": [
      "200"
    ]
  },
  {
    "id": "post-_v1_instances_name_labels_labelId_chats",
    "method": "POST",
    "path": "/v1/instances/{name}/labels/{labelId}/chats",
    "summary": "Associate / remove label on a chat",
    "description": "",
    "tags": [
      "Labels"
    ],
    "security": true,
    "params": [
      {
        "name": "name",
        "in": "path",
        "required": true,
        "description": "Unique instance name / zapo sessionId (e.g. `sales-1`). Alphanumeric, `_` and `-` only.",
        "schema": {
          "type": "string",
          "minLength": 1,
          "maxLength": 64,
          "pattern": "^[a-zA-Z0-9_-]+$"
        }
      },
      {
        "name": "labelId",
        "in": "path",
        "required": true,
        "description": "",
        "schema": {
          "type": "string",
          "minLength": 1
        }
      }
    ],
    "bodyExample": null,
    "responses": [
      "200"
    ]
  },
  {
    "id": "get-_v1_instances_name_lids",
    "method": "GET",
    "path": "/v1/instances/{name}/lids",
    "summary": "List LID ↔ phone mappings",
    "description": "multi-config LID directory from app_contacts + zapo mailbox_contacts.\nPopulated as contacts/history/usync resolve PN↔LID pairs.",
    "tags": [
      "Lids"
    ],
    "security": true,
    "params": [
      {
        "name": "name",
        "in": "path",
        "required": true,
        "description": "Unique instance name / zapo sessionId (e.g. `sales-1`). Alphanumeric, `_` and `-` only.",
        "schema": {
          "type": "string",
          "minLength": 1,
          "maxLength": 64,
          "pattern": "^[a-zA-Z0-9_-]+$"
        }
      }
    ],
    "bodyExample": null,
    "responses": [
      "200"
    ]
  },
  {
    "id": "get-_v1_instances_name_lids_count",
    "method": "GET",
    "path": "/v1/instances/{name}/lids/count",
    "summary": "Count known LIDs",
    "description": "",
    "tags": [
      "Lids"
    ],
    "security": true,
    "params": [
      {
        "name": "name",
        "in": "path",
        "required": true,
        "description": "Unique instance name / zapo sessionId (e.g. `sales-1`). Alphanumeric, `_` and `-` only.",
        "schema": {
          "type": "string",
          "minLength": 1,
          "maxLength": 64,
          "pattern": "^[a-zA-Z0-9_-]+$"
        }
      }
    ],
    "bodyExample": null,
    "responses": [
      "200"
    ]
  },
  {
    "id": "get-_v1_instances_name_lids_pn_phone",
    "method": "GET",
    "path": "/v1/instances/{name}/lids/pn/{phone}",
    "summary": "Get LID by phone number",
    "description": "",
    "tags": [
      "Lids"
    ],
    "security": true,
    "params": [
      {
        "name": "name",
        "in": "path",
        "required": true,
        "description": "Unique instance name / zapo sessionId (e.g. `sales-1`). Alphanumeric, `_` and `-` only.",
        "schema": {
          "type": "string",
          "minLength": 1,
          "maxLength": 64,
          "pattern": "^[a-zA-Z0-9_-]+$"
        }
      },
      {
        "name": "phone",
        "in": "path",
        "required": true,
        "description": "",
        "schema": {
          "type": "string"
        }
      }
    ],
    "bodyExample": null,
    "responses": [
      "200"
    ]
  },
  {
    "id": "get-_v1_instances_name_lids_lid",
    "method": "GET",
    "path": "/v1/instances/{name}/lids/{lid}",
    "summary": "Get phone number by LID",
    "description": "",
    "tags": [
      "Lids"
    ],
    "security": true,
    "params": [
      {
        "name": "name",
        "in": "path",
        "required": true,
        "description": "Unique instance name / zapo sessionId (e.g. `sales-1`). Alphanumeric, `_` and `-` only.",
        "schema": {
          "type": "string",
          "minLength": 1,
          "maxLength": 64,
          "pattern": "^[a-zA-Z0-9_-]+$"
        }
      },
      {
        "name": "lid",
        "in": "path",
        "required": true,
        "description": "",
        "schema": {
          "type": "string"
        }
      }
    ],
    "bodyExample": null,
    "responses": [
      "404"
    ]
  },
  {
    "id": "post-_v1_instances_name_media_getBase64FromMediaMessage",
    "method": "POST",
    "path": "/v1/instances/{name}/media/getBase64FromMediaMessage",
    "summary": "Get media as base64 (API parity)",
    "description": "Downloads media for a message id (from storage if present, else live decrypt via client). Mirrors `chat/getBase64FromMediaMessage`.",
    "tags": [
      "Media"
    ],
    "security": true,
    "params": [
      {
        "name": "name",
        "in": "path",
        "required": true,
        "description": "Unique instance name / zapo sessionId (e.g. `sales-1`). Alphanumeric, `_` and `-` only.",
        "schema": {
          "type": "string",
          "minLength": 1,
          "maxLength": 64,
          "pattern": "^[a-zA-Z0-9_-]+$"
        }
      }
    ],
    "bodyExample": null,
    "responses": [
      "404"
    ]
  },
  {
    "id": "post-_v1_instances_name_messages_audio",
    "method": "POST",
    "path": "/v1/instances/{name}/messages/audio",
    "summary": "Send audio / voice note",
    "description": "",
    "tags": [
      "Messages"
    ],
    "security": true,
    "params": [
      {
        "name": "name",
        "in": "path",
        "required": true,
        "description": "Unique instance name / zapo sessionId (e.g. `sales-1`). Alphanumeric, `_` and `-` only.",
        "schema": {
          "type": "string",
          "minLength": 1,
          "maxLength": 64,
          "pattern": "^[a-zA-Z0-9_-]+$"
        }
      }
    ],
    "bodyExample": {
      "to": "5511999999999",
      "mediaUrl": "https://picsum.photos/800",
      "mimetype": "image/jpeg",
      "caption": "Foto do produto"
    },
    "responses": [
      "200",
      "400",
      "503"
    ]
  },
  {
    "id": "post-_v1_instances_name_messages_contact",
    "method": "POST",
    "path": "/v1/instances/{name}/messages/contact",
    "summary": "Send contact vCard(s)",
    "description": "Sends one or more contacts as WhatsApp contactMessage / contactsArrayMessage (vCard 3.0).",
    "tags": [
      "Messages"
    ],
    "security": true,
    "params": [
      {
        "name": "name",
        "in": "path",
        "required": true,
        "description": "Unique instance name / zapo sessionId (e.g. `sales-1`). Alphanumeric, `_` and `-` only.",
        "schema": {
          "type": "string",
          "minLength": 1,
          "maxLength": 64,
          "pattern": "^[a-zA-Z0-9_-]+$"
        }
      }
    ],
    "bodyExample": null,
    "responses": [
      "200"
    ]
  },
  {
    "id": "post-_v1_instances_name_messages_document",
    "method": "POST",
    "path": "/v1/instances/{name}/messages/document",
    "summary": "Send document",
    "description": "",
    "tags": [
      "Messages"
    ],
    "security": true,
    "params": [
      {
        "name": "name",
        "in": "path",
        "required": true,
        "description": "Unique instance name / zapo sessionId (e.g. `sales-1`). Alphanumeric, `_` and `-` only.",
        "schema": {
          "type": "string",
          "minLength": 1,
          "maxLength": 64,
          "pattern": "^[a-zA-Z0-9_-]+$"
        }
      }
    ],
    "bodyExample": {
      "to": "5511999999999",
      "mediaUrl": "https://picsum.photos/800",
      "mimetype": "image/jpeg",
      "caption": "Foto do produto"
    },
    "responses": [
      "200",
      "400",
      "503"
    ]
  },
  {
    "id": "post-_v1_instances_name_messages_edit",
    "method": "POST",
    "path": "/v1/instances/{name}/messages/edit",
    "summary": "Edit a sent text message",
    "description": "",
    "tags": [
      "Messages"
    ],
    "security": true,
    "params": [
      {
        "name": "name",
        "in": "path",
        "required": true,
        "description": "Unique instance name / zapo sessionId (e.g. `sales-1`). Alphanumeric, `_` and `-` only.",
        "schema": {
          "type": "string",
          "minLength": 1,
          "maxLength": 64,
          "pattern": "^[a-zA-Z0-9_-]+$"
        }
      }
    ],
    "bodyExample": null,
    "responses": [
      "200"
    ]
  },
  {
    "id": "post-_v1_instances_name_messages_forward",
    "method": "POST",
    "path": "/v1/instances/{name}/messages/forward",
    "summary": "Forward a stored message",
    "description": "Forwards a message from the local store to another chat (`forward: true`). Text is re-sent from `body`; other types use the raw proto payload when available.",
    "tags": [
      "Messages"
    ],
    "security": true,
    "params": [
      {
        "name": "name",
        "in": "path",
        "required": true,
        "description": "Unique instance name / zapo sessionId (e.g. `sales-1`). Alphanumeric, `_` and `-` only.",
        "schema": {
          "type": "string",
          "minLength": 1,
          "maxLength": 64,
          "pattern": "^[a-zA-Z0-9_-]+$"
        }
      }
    ],
    "bodyExample": null,
    "responses": [
      "200"
    ]
  },
  {
    "id": "post-_v1_instances_name_messages_image",
    "method": "POST",
    "path": "/v1/instances/{name}/messages/image",
    "summary": "Send image",
    "description": "",
    "tags": [
      "Messages"
    ],
    "security": true,
    "params": [
      {
        "name": "name",
        "in": "path",
        "required": true,
        "description": "Unique instance name / zapo sessionId (e.g. `sales-1`). Alphanumeric, `_` and `-` only.",
        "schema": {
          "type": "string",
          "minLength": 1,
          "maxLength": 64,
          "pattern": "^[a-zA-Z0-9_-]+$"
        }
      }
    ],
    "bodyExample": {
      "to": "5511999999999",
      "mediaUrl": "https://picsum.photos/800",
      "mimetype": "image/jpeg",
      "caption": "Foto do produto"
    },
    "responses": [
      "200",
      "400",
      "503"
    ]
  },
  {
    "id": "post-_v1_instances_name_messages_location",
    "method": "POST",
    "path": "/v1/instances/{name}/messages/location",
    "summary": "Send location",
    "description": "",
    "tags": [
      "Messages"
    ],
    "security": true,
    "params": [
      {
        "name": "name",
        "in": "path",
        "required": true,
        "description": "Unique instance name / zapo sessionId (e.g. `sales-1`). Alphanumeric, `_` and `-` only.",
        "schema": {
          "type": "string",
          "minLength": 1,
          "maxLength": 64,
          "pattern": "^[a-zA-Z0-9_-]+$"
        }
      }
    ],
    "bodyExample": null,
    "responses": [
      "200"
    ]
  },
  {
    "id": "post-_v1_instances_name_messages_poll",
    "method": "POST",
    "path": "/v1/instances/{name}/messages/poll",
    "summary": "Send poll",
    "description": "",
    "tags": [
      "Messages"
    ],
    "security": true,
    "params": [
      {
        "name": "name",
        "in": "path",
        "required": true,
        "description": "Unique instance name / zapo sessionId (e.g. `sales-1`). Alphanumeric, `_` and `-` only.",
        "schema": {
          "type": "string",
          "minLength": 1,
          "maxLength": 64,
          "pattern": "^[a-zA-Z0-9_-]+$"
        }
      }
    ],
    "bodyExample": null,
    "responses": [
      "200"
    ]
  },
  {
    "id": "post-_v1_instances_name_messages_react",
    "method": "POST",
    "path": "/v1/instances/{name}/messages/react",
    "summary": "React to a message",
    "description": "",
    "tags": [
      "Messages"
    ],
    "security": true,
    "params": [
      {
        "name": "name",
        "in": "path",
        "required": true,
        "description": "Unique instance name / zapo sessionId (e.g. `sales-1`). Alphanumeric, `_` and `-` only.",
        "schema": {
          "type": "string",
          "minLength": 1,
          "maxLength": 64,
          "pattern": "^[a-zA-Z0-9_-]+$"
        }
      }
    ],
    "bodyExample": null,
    "responses": [
      "200"
    ]
  },
  {
    "id": "post-_v1_instances_name_messages_reply",
    "method": "POST",
    "path": "/v1/instances/{name}/messages/reply",
    "summary": "Reply to a message",
    "description": "",
    "tags": [
      "Messages"
    ],
    "security": true,
    "params": [
      {
        "name": "name",
        "in": "path",
        "required": true,
        "description": "Unique instance name / zapo sessionId (e.g. `sales-1`). Alphanumeric, `_` and `-` only.",
        "schema": {
          "type": "string",
          "minLength": 1,
          "maxLength": 64,
          "pattern": "^[a-zA-Z0-9_-]+$"
        }
      }
    ],
    "bodyExample": null,
    "responses": [
      "200"
    ]
  },
  {
    "id": "post-_v1_instances_name_messages_revoke",
    "method": "POST",
    "path": "/v1/instances/{name}/messages/revoke",
    "summary": "Revoke / delete for everyone",
    "description": "",
    "tags": [
      "Messages"
    ],
    "security": true,
    "params": [
      {
        "name": "name",
        "in": "path",
        "required": true,
        "description": "Unique instance name / zapo sessionId (e.g. `sales-1`). Alphanumeric, `_` and `-` only.",
        "schema": {
          "type": "string",
          "minLength": 1,
          "maxLength": 64,
          "pattern": "^[a-zA-Z0-9_-]+$"
        }
      }
    ],
    "bodyExample": null,
    "responses": [
      "200"
    ]
  },
  {
    "id": "post-_v1_instances_name_messages_star",
    "method": "POST",
    "path": "/v1/instances/{name}/messages/star",
    "summary": "Star / unstar a message (app-state)",
    "description": "",
    "tags": [
      "Messages"
    ],
    "security": true,
    "params": [
      {
        "name": "name",
        "in": "path",
        "required": true,
        "description": "Unique instance name / zapo sessionId (e.g. `sales-1`). Alphanumeric, `_` and `-` only.",
        "schema": {
          "type": "string",
          "minLength": 1,
          "maxLength": 64,
          "pattern": "^[a-zA-Z0-9_-]+$"
        }
      }
    ],
    "bodyExample": null,
    "responses": [
      "200"
    ]
  },
  {
    "id": "post-_v1_instances_name_messages_sticker",
    "method": "POST",
    "path": "/v1/instances/{name}/messages/sticker",
    "summary": "Send sticker",
    "description": "",
    "tags": [
      "Messages"
    ],
    "security": true,
    "params": [
      {
        "name": "name",
        "in": "path",
        "required": true,
        "description": "Unique instance name / zapo sessionId (e.g. `sales-1`). Alphanumeric, `_` and `-` only.",
        "schema": {
          "type": "string",
          "minLength": 1,
          "maxLength": 64,
          "pattern": "^[a-zA-Z0-9_-]+$"
        }
      }
    ],
    "bodyExample": {
      "to": "5511999999999",
      "mediaUrl": "https://picsum.photos/800",
      "mimetype": "image/jpeg",
      "caption": "Foto do produto"
    },
    "responses": [
      "200"
    ]
  },
  {
    "id": "post-_v1_instances_name_messages_text",
    "method": "POST",
    "path": "/v1/instances/{name}/messages/text",
    "summary": "Send text message",
    "description": "Sends a plain-text WhatsApp message via `client.message.send`.\n\n**Requirements:** instance connected (`status: open`).\n\n**Example body**\n```json\n{\n  \"to\": \"5511999999999\",\n  \"text\": \"Olá! Mensagem enviada via zapo-rest 👋\",\n  \"linkPreview\": true\n}\n```",
    "tags": [
      "Messages"
    ],
    "security": true,
    "params": [
      {
        "name": "name",
        "in": "path",
        "required": true,
        "description": "Unique instance name / zapo sessionId (e.g. `sales-1`). Alphanumeric, `_` and `-` only.",
        "schema": {
          "type": "string",
          "minLength": 1,
          "maxLength": 64,
          "pattern": "^[a-zA-Z0-9_-]+$"
        }
      }
    ],
    "bodyExample": {
      "to": "5511999999999",
      "text": "Olá! Mensagem enviada via zapo-rest 👋",
      "linkPreview": true
    },
    "responses": [
      "200",
      "400",
      "503"
    ]
  },
  {
    "id": "post-_v1_instances_name_messages_video",
    "method": "POST",
    "path": "/v1/instances/{name}/messages/video",
    "summary": "Send video",
    "description": "",
    "tags": [
      "Messages"
    ],
    "security": true,
    "params": [
      {
        "name": "name",
        "in": "path",
        "required": true,
        "description": "Unique instance name / zapo sessionId (e.g. `sales-1`). Alphanumeric, `_` and `-` only.",
        "schema": {
          "type": "string",
          "minLength": 1,
          "maxLength": 64,
          "pattern": "^[a-zA-Z0-9_-]+$"
        }
      }
    ],
    "bodyExample": {
      "to": "5511999999999",
      "mediaUrl": "https://picsum.photos/800",
      "mimetype": "image/jpeg",
      "caption": "Foto do produto"
    },
    "responses": [
      "200"
    ]
  },
  {
    "id": "get-_v1_instances_name_messages_messageId",
    "method": "GET",
    "path": "/v1/instances/{name}/messages/{messageId}",
    "summary": "Get stored message by id",
    "description": "",
    "tags": [
      "Messages"
    ],
    "security": true,
    "params": [
      {
        "name": "name",
        "in": "path",
        "required": true,
        "description": "Unique instance name / zapo sessionId (e.g. `sales-1`). Alphanumeric, `_` and `-` only.",
        "schema": {
          "type": "string",
          "minLength": 1,
          "maxLength": 64,
          "pattern": "^[a-zA-Z0-9_-]+$"
        }
      },
      {
        "name": "messageId",
        "in": "path",
        "required": true,
        "description": "",
        "schema": {
          "type": "string"
        }
      }
    ],
    "bodyExample": null,
    "responses": [
      "200"
    ]
  },
  {
    "id": "get-_v1_instances_name_messages_messageId_media",
    "method": "GET",
    "path": "/v1/instances/{name}/messages/{messageId}/media",
    "summary": "Download media for a message (original filename)",
    "description": "Authorizes access, ensures the object exists in storage, then **redirects (302)** to storage\nwhen possible (default) so file bytes do not transit the API.\n\nIf the CAS object was deleted from storage, the API **re-downloads from WhatsApp** (using\nthe stored message `raw`), re-uploads to storage, then redirects/streams. Only fails if\nWhatsApp can no longer provide the media.\n\n- **S3/MinIO:** presigned GET with original filename (ResponseContentDisposition).\n- **`?proxy=1`:** stream through the API (no redirect).\n- **`?download=1`:** attachment disposition.",
    "tags": [
      "Media"
    ],
    "security": true,
    "params": [
      {
        "name": "name",
        "in": "path",
        "required": true,
        "description": "Unique instance name / zapo sessionId (e.g. `sales-1`). Alphanumeric, `_` and `-` only.",
        "schema": {
          "type": "string",
          "minLength": 1,
          "maxLength": 64,
          "pattern": "^[a-zA-Z0-9_-]+$"
        }
      },
      {
        "name": "messageId",
        "in": "path",
        "required": true,
        "description": "",
        "schema": {
          "type": "string",
          "minLength": 1
        }
      }
    ],
    "bodyExample": null,
    "responses": [
      "404"
    ]
  },
  {
    "id": "get-_v1_instances_name_metrics",
    "method": "GET",
    "path": "/v1/instances/{name}/metrics",
    "summary": "Instance metrics summary",
    "description": "Aggregated messages, calls, media and storage for an instance over a time range (default last 7 days).",
    "tags": [
      "Metrics"
    ],
    "security": true,
    "params": [
      {
        "name": "name",
        "in": "path",
        "required": true,
        "description": "Unique instance name / zapo sessionId (e.g. `sales-1`). Alphanumeric, `_` and `-` only.",
        "schema": {
          "type": "string",
          "minLength": 1,
          "maxLength": 64,
          "pattern": "^[a-zA-Z0-9_-]+$"
        }
      }
    ],
    "bodyExample": null,
    "responses": [
      "400",
      "403"
    ]
  },
  {
    "id": "get-_v1_instances_name_metrics_resources",
    "method": "GET",
    "path": "/v1/instances/{name}/metrics/resources",
    "summary": "Live resource snapshot for instance / process",
    "description": "Process memory & CPU (Node process), live session share estimate, and storage usage for this instance. CPU/memory are process-wide (multi-session); heap is split equally among live sessions when possible.",
    "tags": [
      "Metrics"
    ],
    "security": true,
    "params": [
      {
        "name": "name",
        "in": "path",
        "required": true,
        "description": "Unique instance name / zapo sessionId (e.g. `sales-1`). Alphanumeric, `_` and `-` only.",
        "schema": {
          "type": "string",
          "minLength": 1,
          "maxLength": 64,
          "pattern": "^[a-zA-Z0-9_-]+$"
        }
      }
    ],
    "bodyExample": null,
    "responses": [
      "403"
    ]
  },
  {
    "id": "get-_v1_instances_name_metrics_timeseries",
    "method": "GET",
    "path": "/v1/instances/{name}/metrics/timeseries",
    "summary": "Instance metrics time series (for charts)",
    "description": "Bucketed message and call counts for plotting. `bucket=hour||day` (default day).",
    "tags": [
      "Metrics"
    ],
    "security": true,
    "params": [
      {
        "name": "name",
        "in": "path",
        "required": true,
        "description": "Unique instance name / zapo sessionId (e.g. `sales-1`). Alphanumeric, `_` and `-` only.",
        "schema": {
          "type": "string",
          "minLength": 1,
          "maxLength": 64,
          "pattern": "^[a-zA-Z0-9_-]+$"
        }
      }
    ],
    "bodyExample": null,
    "responses": [
      "400",
      "403"
    ]
  },
  {
    "id": "post-_v1_instances_name_pairing-code",
    "method": "POST",
    "path": "/v1/instances/{name}/pairing-code",
    "summary": "Request pairing code",
    "description": "Requests an 8-character pairing code (`client.auth.requestPairingCode`).\n\n**Prerequisites:** instance must be **connected** and in a pairing-capable state.\nOn the phone: WhatsApp → Linked devices → **Link with phone number instead**.\n\n**Example body**\n```json\n{ \"phone\": \"5511999999999\" }\n```",
    "tags": [
      "Instances"
    ],
    "security": true,
    "params": [
      {
        "name": "name",
        "in": "path",
        "required": true,
        "description": "Unique instance name / zapo sessionId (e.g. `sales-1`). Alphanumeric, `_` and `-` only.",
        "schema": {
          "type": "string",
          "minLength": 1,
          "maxLength": 64,
          "pattern": "^[a-zA-Z0-9_-]+$"
        }
      }
    ],
    "bodyExample": {
      "phone": "5511999999999"
    },
    "responses": [
      "200",
      "400",
      "401",
      "403",
      "404",
      "503"
    ]
  },
  {
    "id": "post-_v1_instances_name_presence",
    "method": "POST",
    "path": "/v1/instances/{name}/presence",
    "summary": "Set online presence",
    "description": "Broadcasts account presence: `available` (online) or `unavailable`.\n\n```json\n{ \"type\": \"available\" }\n```",
    "tags": [
      "Presence"
    ],
    "security": true,
    "params": [
      {
        "name": "name",
        "in": "path",
        "required": true,
        "description": "Unique instance name / zapo sessionId (e.g. `sales-1`). Alphanumeric, `_` and `-` only.",
        "schema": {
          "type": "string",
          "minLength": 1,
          "maxLength": 64,
          "pattern": "^[a-zA-Z0-9_-]+$"
        }
      }
    ],
    "bodyExample": {
      "type": "available"
    },
    "responses": [
      "200",
      "400",
      "401",
      "403",
      "404",
      "503"
    ]
  },
  {
    "id": "post-_v1_instances_name_presence_subscribe",
    "method": "POST",
    "path": "/v1/instances/{name}/presence/subscribe",
    "summary": "Subscribe to peer presence & chatstate",
    "description": "Subscribes to online/offline and typing/recording indicators for a chat JID. Must be re-subscribed after reconnect. Events: `presence.update`, `chatstate`.",
    "tags": [
      "Presence"
    ],
    "security": true,
    "params": [
      {
        "name": "name",
        "in": "path",
        "required": true,
        "description": "Unique instance name / zapo sessionId (e.g. `sales-1`). Alphanumeric, `_` and `-` only.",
        "schema": {
          "type": "string",
          "minLength": 1,
          "maxLength": 64,
          "pattern": "^[a-zA-Z0-9_-]+$"
        }
      }
    ],
    "bodyExample": null,
    "responses": [
      "200"
    ]
  },
  {
    "id": "get-_v1_instances_name_privacy",
    "method": "GET",
    "path": "/v1/instances/{name}/privacy",
    "summary": "Get privacy settings",
    "description": "",
    "tags": [
      "Privacy"
    ],
    "security": true,
    "params": [
      {
        "name": "name",
        "in": "path",
        "required": true,
        "description": "Unique instance name / zapo sessionId (e.g. `sales-1`). Alphanumeric, `_` and `-` only.",
        "schema": {
          "type": "string",
          "minLength": 1,
          "maxLength": 64,
          "pattern": "^[a-zA-Z0-9_-]+$"
        }
      }
    ],
    "bodyExample": null,
    "responses": [
      "200"
    ]
  },
  {
    "id": "post-_v1_instances_name_privacy",
    "method": "POST",
    "path": "/v1/instances/{name}/privacy",
    "summary": "Set one privacy setting",
    "description": "",
    "tags": [
      "Privacy"
    ],
    "security": true,
    "params": [
      {
        "name": "name",
        "in": "path",
        "required": true,
        "description": "Unique instance name / zapo sessionId (e.g. `sales-1`). Alphanumeric, `_` and `-` only.",
        "schema": {
          "type": "string",
          "minLength": 1,
          "maxLength": 64,
          "pattern": "^[a-zA-Z0-9_-]+$"
        }
      }
    ],
    "bodyExample": null,
    "responses": [
      "200"
    ]
  },
  {
    "id": "get-_v1_instances_name_profile",
    "method": "GET",
    "path": "/v1/instances/{name}/profile",
    "summary": "Get own profile snapshot",
    "description": "",
    "tags": [
      "Profile"
    ],
    "security": true,
    "params": [
      {
        "name": "name",
        "in": "path",
        "required": true,
        "description": "Unique instance name / zapo sessionId (e.g. `sales-1`). Alphanumeric, `_` and `-` only.",
        "schema": {
          "type": "string",
          "minLength": 1,
          "maxLength": 64,
          "pattern": "^[a-zA-Z0-9_-]+$"
        }
      }
    ],
    "bodyExample": null,
    "responses": [
      "200",
      "503"
    ]
  },
  {
    "id": "put-_v1_instances_name_profile_name",
    "method": "PUT",
    "path": "/v1/instances/{name}/profile/name",
    "summary": "Set push name (display name)",
    "description": "",
    "tags": [
      "Profile"
    ],
    "security": true,
    "params": [
      {
        "name": "name",
        "in": "path",
        "required": true,
        "description": "Unique instance name / zapo sessionId (e.g. `sales-1`). Alphanumeric, `_` and `-` only.",
        "schema": {
          "type": "string",
          "minLength": 1,
          "maxLength": 64,
          "pattern": "^[a-zA-Z0-9_-]+$"
        }
      }
    ],
    "bodyExample": null,
    "responses": [
      "200"
    ]
  },
  {
    "id": "put-_v1_instances_name_profile_picture",
    "method": "PUT",
    "path": "/v1/instances/{name}/profile/picture",
    "summary": "Set profile picture (JPEG bytes via URL or base64)",
    "description": "",
    "tags": [
      "Profile"
    ],
    "security": true,
    "params": [
      {
        "name": "name",
        "in": "path",
        "required": true,
        "description": "Unique instance name / zapo sessionId (e.g. `sales-1`). Alphanumeric, `_` and `-` only.",
        "schema": {
          "type": "string",
          "minLength": 1,
          "maxLength": 64,
          "pattern": "^[a-zA-Z0-9_-]+$"
        }
      }
    ],
    "bodyExample": null,
    "responses": [
      "200"
    ]
  },
  {
    "id": "delete-_v1_instances_name_profile_picture",
    "method": "DELETE",
    "path": "/v1/instances/{name}/profile/picture",
    "summary": "Delete profile picture",
    "description": "",
    "tags": [
      "Profile"
    ],
    "security": true,
    "params": [
      {
        "name": "name",
        "in": "path",
        "required": true,
        "description": "Unique instance name / zapo sessionId (e.g. `sales-1`). Alphanumeric, `_` and `-` only.",
        "schema": {
          "type": "string",
          "minLength": 1,
          "maxLength": 64,
          "pattern": "^[a-zA-Z0-9_-]+$"
        }
      }
    ],
    "bodyExample": null,
    "responses": [
      "200"
    ]
  },
  {
    "id": "put-_v1_instances_name_profile_status",
    "method": "PUT",
    "path": "/v1/instances/{name}/profile/status",
    "summary": "Set about status",
    "description": "",
    "tags": [
      "Profile"
    ],
    "security": true,
    "params": [
      {
        "name": "name",
        "in": "path",
        "required": true,
        "description": "Unique instance name / zapo sessionId (e.g. `sales-1`). Alphanumeric, `_` and `-` only.",
        "schema": {
          "type": "string",
          "minLength": 1,
          "maxLength": 64,
          "pattern": "^[a-zA-Z0-9_-]+$"
        }
      }
    ],
    "bodyExample": null,
    "responses": [
      "200"
    ]
  },
  {
    "id": "get-_v1_instances_name_qr",
    "method": "GET",
    "path": "/v1/instances/{name}/qr",
    "summary": "Get current QR payload",
    "description": "Returns the last cached QR string from event `auth_qr`.\n\n- Render `qr` as a QR **image** (dashboard does this automatically)\n- `null` when already paired or not in QR state\n- WhatsApp rotates QR; keep polling (~2–3s) or use webhook `instance.qr`\n\n```bash\ncurl -s \"$BASE/v1/instances/sales-1/qr\" -H \"X-Api-Key: $KEY\"\n```",
    "tags": [
      "Instances"
    ],
    "security": true,
    "params": [
      {
        "name": "name",
        "in": "path",
        "required": true,
        "description": "Unique instance name / zapo sessionId (e.g. `sales-1`). Alphanumeric, `_` and `-` only.",
        "schema": {
          "type": "string",
          "minLength": 1,
          "maxLength": 64,
          "pattern": "^[a-zA-Z0-9_-]+$"
        }
      }
    ],
    "bodyExample": null,
    "responses": [
      "200",
      "401",
      "403",
      "404"
    ]
  },
  {
    "id": "post-_v1_instances_name_restart",
    "method": "POST",
    "path": "/v1/instances/{name}/restart",
    "summary": "Restart session",
    "description": "Shortcut for `disconnect` then `connect`. Useful after stuck state or config changes.",
    "tags": [
      "Instances"
    ],
    "security": true,
    "params": [
      {
        "name": "name",
        "in": "path",
        "required": true,
        "description": "Unique instance name / zapo sessionId (e.g. `sales-1`). Alphanumeric, `_` and `-` only.",
        "schema": {
          "type": "string",
          "minLength": 1,
          "maxLength": 64,
          "pattern": "^[a-zA-Z0-9_-]+$"
        }
      }
    ],
    "bodyExample": null,
    "responses": [
      "200",
      "401",
      "403",
      "404",
      "503"
    ]
  },
  {
    "id": "get-_v1_instances_name_settings_call-recording",
    "method": "GET",
    "path": "/v1/instances/{name}/settings/call-recording",
    "summary": "Get call recording setting",
    "description": "",
    "tags": [
      "Calls"
    ],
    "security": true,
    "params": [
      {
        "name": "name",
        "in": "path",
        "required": true,
        "description": "Unique instance name / zapo sessionId (e.g. `sales-1`). Alphanumeric, `_` and `-` only.",
        "schema": {
          "type": "string",
          "minLength": 1,
          "maxLength": 64,
          "pattern": "^[a-zA-Z0-9_-]+$"
        }
      }
    ],
    "bodyExample": null,
    "responses": [
      "200"
    ]
  },
  {
    "id": "put-_v1_instances_name_settings_call-recording",
    "method": "PUT",
    "path": "/v1/instances/{name}/settings/call-recording",
    "summary": "Enable/disable call recording",
    "description": "Requires media storage (`MEDIA_STORAGE=local|s3`). Recordings are WAV stereo (local | remote) stored in object storage.",
    "tags": [
      "Calls"
    ],
    "security": true,
    "params": [
      {
        "name": "name",
        "in": "path",
        "required": true,
        "description": "Unique instance name / zapo sessionId (e.g. `sales-1`). Alphanumeric, `_` and `-` only.",
        "schema": {
          "type": "string",
          "minLength": 1,
          "maxLength": 64,
          "pattern": "^[a-zA-Z0-9_-]+$"
        }
      }
    ],
    "bodyExample": null,
    "responses": [
      "200"
    ]
  },
  {
    "id": "post-_v1_instances_name_status_mute",
    "method": "POST",
    "path": "/v1/instances/{name}/status/mute",
    "summary": "Mute / unmute a contact status",
    "description": "",
    "tags": [
      "Status"
    ],
    "security": true,
    "params": [
      {
        "name": "name",
        "in": "path",
        "required": true,
        "description": "Unique instance name / zapo sessionId (e.g. `sales-1`). Alphanumeric, `_` and `-` only.",
        "schema": {
          "type": "string",
          "minLength": 1,
          "maxLength": 64,
          "pattern": "^[a-zA-Z0-9_-]+$"
        }
      }
    ],
    "bodyExample": null,
    "responses": [
      "200"
    ]
  },
  {
    "id": "post-_v1_instances_name_status_privacy",
    "method": "POST",
    "path": "/v1/instances/{name}/status/privacy",
    "summary": "Set status distribution privacy",
    "description": "",
    "tags": [
      "Status"
    ],
    "security": true,
    "params": [
      {
        "name": "name",
        "in": "path",
        "required": true,
        "description": "Unique instance name / zapo sessionId (e.g. `sales-1`). Alphanumeric, `_` and `-` only.",
        "schema": {
          "type": "string",
          "minLength": 1,
          "maxLength": 64,
          "pattern": "^[a-zA-Z0-9_-]+$"
        }
      }
    ],
    "bodyExample": null,
    "responses": [
      "200"
    ]
  },
  {
    "id": "post-_v1_instances_name_status_revoke",
    "method": "POST",
    "path": "/v1/instances/{name}/status/revoke",
    "summary": "Revoke a published status",
    "description": "",
    "tags": [
      "Status"
    ],
    "security": true,
    "params": [
      {
        "name": "name",
        "in": "path",
        "required": true,
        "description": "Unique instance name / zapo sessionId (e.g. `sales-1`). Alphanumeric, `_` and `-` only.",
        "schema": {
          "type": "string",
          "minLength": 1,
          "maxLength": 64,
          "pattern": "^[a-zA-Z0-9_-]+$"
        }
      }
    ],
    "bodyExample": null,
    "responses": [
      "200"
    ]
  },
  {
    "id": "post-_v1_instances_name_status_send",
    "method": "POST",
    "path": "/v1/instances/{name}/status/send",
    "summary": "Publish a status / story broadcast",
    "description": "Uses `client.status.send`. Provide `text` and/or media. `recipients` is the fan-out list required by zapo.",
    "tags": [
      "Status"
    ],
    "security": true,
    "params": [
      {
        "name": "name",
        "in": "path",
        "required": true,
        "description": "Unique instance name / zapo sessionId (e.g. `sales-1`). Alphanumeric, `_` and `-` only.",
        "schema": {
          "type": "string",
          "minLength": 1,
          "maxLength": 64,
          "pattern": "^[a-zA-Z0-9_-]+$"
        }
      }
    ],
    "bodyExample": null,
    "responses": [
      "200"
    ]
  },
  {
    "id": "get-_v1_instances_name_webhooks",
    "method": "GET",
    "path": "/v1/instances/{name}/webhooks",
    "summary": "List webhooks (multi-config multi-config)",
    "description": "Multiple webhook endpoints per instance with per-URL events, HMAC, retries, and custom headers.",
    "tags": [
      "Webhooks"
    ],
    "security": true,
    "params": [
      {
        "name": "name",
        "in": "path",
        "required": true,
        "description": "Unique instance name / zapo sessionId (e.g. `sales-1`). Alphanumeric, `_` and `-` only.",
        "schema": {
          "type": "string",
          "minLength": 1,
          "maxLength": 64,
          "pattern": "^[a-zA-Z0-9_-]+$"
        }
      }
    ],
    "bodyExample": null,
    "responses": [
      "200"
    ]
  },
  {
    "id": "post-_v1_instances_name_webhooks",
    "method": "POST",
    "path": "/v1/instances/{name}/webhooks",
    "summary": "Create webhook config",
    "description": "",
    "tags": [
      "Webhooks"
    ],
    "security": true,
    "params": [
      {
        "name": "name",
        "in": "path",
        "required": true,
        "description": "Unique instance name / zapo sessionId (e.g. `sales-1`). Alphanumeric, `_` and `-` only.",
        "schema": {
          "type": "string",
          "minLength": 1,
          "maxLength": 64,
          "pattern": "^[a-zA-Z0-9_-]+$"
        }
      }
    ],
    "bodyExample": null,
    "responses": [
      "200"
    ]
  },
  {
    "id": "get-_v1_instances_name_webhooks_webhookId",
    "method": "GET",
    "path": "/v1/instances/{name}/webhooks/{webhookId}",
    "summary": "Get webhook",
    "description": "",
    "tags": [
      "Webhooks"
    ],
    "security": true,
    "params": [
      {
        "name": "name",
        "in": "path",
        "required": true,
        "description": "Unique instance name / zapo sessionId (e.g. `sales-1`). Alphanumeric, `_` and `-` only.",
        "schema": {
          "type": "string",
          "minLength": 1,
          "maxLength": 64,
          "pattern": "^[a-zA-Z0-9_-]+$"
        }
      },
      {
        "name": "webhookId",
        "in": "path",
        "required": true,
        "description": "",
        "schema": {
          "type": "string",
          "minLength": 1
        }
      }
    ],
    "bodyExample": null,
    "responses": [
      "200"
    ]
  },
  {
    "id": "put-_v1_instances_name_webhooks_webhookId",
    "method": "PUT",
    "path": "/v1/instances/{name}/webhooks/{webhookId}",
    "summary": "Update webhook",
    "description": "",
    "tags": [
      "Webhooks"
    ],
    "security": true,
    "params": [
      {
        "name": "name",
        "in": "path",
        "required": true,
        "description": "Unique instance name / zapo sessionId (e.g. `sales-1`). Alphanumeric, `_` and `-` only.",
        "schema": {
          "type": "string",
          "minLength": 1,
          "maxLength": 64,
          "pattern": "^[a-zA-Z0-9_-]+$"
        }
      },
      {
        "name": "webhookId",
        "in": "path",
        "required": true,
        "description": "",
        "schema": {
          "type": "string",
          "minLength": 1
        }
      }
    ],
    "bodyExample": null,
    "responses": [
      "200"
    ]
  },
  {
    "id": "delete-_v1_instances_name_webhooks_webhookId",
    "method": "DELETE",
    "path": "/v1/instances/{name}/webhooks/{webhookId}",
    "summary": "Delete webhook",
    "description": "",
    "tags": [
      "Webhooks"
    ],
    "security": true,
    "params": [
      {
        "name": "name",
        "in": "path",
        "required": true,
        "description": "Unique instance name / zapo sessionId (e.g. `sales-1`). Alphanumeric, `_` and `-` only.",
        "schema": {
          "type": "string",
          "minLength": 1,
          "maxLength": 64,
          "pattern": "^[a-zA-Z0-9_-]+$"
        }
      },
      {
        "name": "webhookId",
        "in": "path",
        "required": true,
        "description": "",
        "schema": {
          "type": "string",
          "minLength": 1
        }
      }
    ],
    "bodyExample": null,
    "responses": [
      "200"
    ]
  },
  {
    "id": "get-_v1_me",
    "method": "GET",
    "path": "/v1/me",
    "summary": "Resolve current API key",
    "description": "Identifies whether the provided API key is **admin** or an **instance** key.\n\nUsed by the dashboard after login.\n\n**Responses:**\n- Admin: `{ \"role\": \"admin\" }`\n- Instance: `{ \"role\": \"instance\", \"instance\": { ...full instance including apiKey } }`\n\n**Example**\n```bash\ncurl -s \"$BASE/v1/me\" -H \"X-Api-Key: $KEY\"\n```",
    "tags": [
      "Auth"
    ],
    "security": true,
    "params": [],
    "bodyExample": null,
    "responses": [
      "200",
      "401"
    ]
  },
  {
    "id": "get-_v1_media_instance_key",
    "method": "GET",
    "path": "/v1/media/{instance}/{key}",
    "summary": "Get media by storage key",
    "description": "",
    "tags": [
      "Media"
    ],
    "security": true,
    "params": [
      {
        "name": "instance",
        "in": "path",
        "required": true,
        "description": "",
        "schema": {
          "type": "string"
        }
      },
      {
        "name": "key",
        "in": "path",
        "required": true,
        "description": "",
        "schema": {
          "type": "string"
        }
      }
    ],
    "bodyExample": null,
    "responses": [
      "200"
    ]
  }
]
