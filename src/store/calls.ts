import type pg from 'pg'

export type CallRecordingStatus = 'none' | 'recording' | 'ready' | 'failed' | 'disabled'

export type AppCall = {
  instanceName: string
  callId: string
  peerJid: string | null
  direction: string
  mediaType: string
  state: string | null
  endReason: string | null
  startedAt: Date
  endedAt: Date | null
  durationSecs: number | null
  recordingEnabled: boolean
  recordingStatus: CallRecordingStatus
  recordingStorageKey: string | null
  recordingUrl: string | null
  recordingMime: string | null
  recordingBytes: number | null
  recordingError: string | null
}

type Row = {
  instance_name: string
  call_id: string
  peer_jid: string | null
  direction: string
  media_type: string
  state: string | null
  end_reason: string | null
  started_at: Date
  ended_at: Date | null
  duration_secs: number | null
  recording_enabled: boolean
  recording_status: string
  recording_storage_key: string | null
  recording_url: string | null
  recording_mime: string | null
  recording_bytes: string | number | null
  recording_error: string | null
}

function mapRow(r: Row): AppCall {
  return {
    instanceName: r.instance_name,
    callId: r.call_id,
    peerJid: r.peer_jid,
    direction: r.direction,
    mediaType: r.media_type,
    state: r.state,
    endReason: r.end_reason,
    startedAt: r.started_at,
    endedAt: r.ended_at,
    durationSecs: r.duration_secs,
    recordingEnabled: r.recording_enabled,
    recordingStatus: r.recording_status as CallRecordingStatus,
    recordingStorageKey: r.recording_storage_key,
    recordingUrl: r.recording_url,
    recordingMime: r.recording_mime,
    recordingBytes: r.recording_bytes == null ? null : Number(r.recording_bytes),
    recordingError: r.recording_error,
  }
}

export function toPublicCall(c: AppCall, opts?: { instanceName?: string }) {
  const hasRecording = c.recordingStatus === 'ready' && Boolean(c.recordingStorageKey)
  const downloadPath =
    hasRecording && opts?.instanceName
      ? `/v1/instances/${encodeURIComponent(opts.instanceName)}/calls/${encodeURIComponent(c.callId)}/recording`
      : null
  return {
    callId: c.callId,
    peerJid: c.peerJid,
    direction: c.direction,
    mediaType: c.mediaType,
    state: c.state,
    endReason: c.endReason,
    startedAt: c.startedAt.toISOString(),
    endedAt: c.endedAt?.toISOString() ?? null,
    durationSecs: c.durationSecs,
    recording: {
      enabled: c.recordingEnabled,
      status: c.recordingStatus,
      mime: c.recordingMime,
      bytes: c.recordingBytes,
      url: c.recordingUrl ?? downloadPath,
      downloadPath,
      error: c.recordingError,
    },
  }
}

export class CallStore {
  constructor(private readonly pool: pg.Pool) {}

  async upsertStart(input: {
    instanceName: string
    callId: string
    peerJid?: string | null
    direction?: string
    mediaType?: string
    state?: string | null
    recordingEnabled?: boolean
  }): Promise<AppCall> {
    // History row only — recording_status stays 'none' until the call is answered
    // (CallRecordingManager starts the PCM recorder on connecting/active).
    const { rows } = await this.pool.query<Row>(
      `INSERT INTO app_calls (
         instance_name, call_id, peer_jid, direction, media_type, state,
         recording_enabled, recording_status
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,'none')
       ON CONFLICT (instance_name, call_id) DO UPDATE SET
         peer_jid = COALESCE(EXCLUDED.peer_jid, app_calls.peer_jid),
         direction = COALESCE(EXCLUDED.direction, app_calls.direction),
         state = COALESCE(EXCLUDED.state, app_calls.state),
         recording_enabled = app_calls.recording_enabled OR EXCLUDED.recording_enabled,
         updated_at = now()
       RETURNING *`,
      [
        input.instanceName,
        input.callId,
        input.peerJid ?? null,
        input.direction ?? 'unknown',
        input.mediaType ?? 'audio',
        input.state ?? null,
        input.recordingEnabled ?? false,
      ],
    )
    const row = rows[0]
    if (!row) throw new Error('upsert returned no row')
    return mapRow(row)
  }

  /** Flip status to `recording` when PCM capture actually begins (post-answer). */
  async markRecordingStarted(instanceName: string, callId: string): Promise<void> {
    await this.pool.query(
      `UPDATE app_calls SET
         recording_status = CASE
           WHEN recording_enabled THEN 'recording'
           ELSE recording_status
         END,
         updated_at = now()
       WHERE instance_name = $1 AND call_id = $2
         AND recording_status IN ('none', 'disabled')`,
      [instanceName, callId],
    )
  }

  async updateState(
    instanceName: string,
    callId: string,
    patch: { state?: string | null; endReason?: string | null },
  ): Promise<void> {
    await this.pool.query(
      `UPDATE app_calls SET
         state = COALESCE($3, state),
         end_reason = COALESCE($4, end_reason),
         updated_at = now()
       WHERE instance_name = $1 AND call_id = $2`,
      [instanceName, callId, patch.state ?? null, patch.endReason ?? null],
    )
  }

  async markEnded(
    instanceName: string,
    callId: string,
    opts: { endReason?: string | null; durationSecs?: number | null; state?: string | null },
  ): Promise<AppCall | null> {
    const { rows } = await this.pool.query<Row>(
      `UPDATE app_calls SET
         ended_at = COALESCE(ended_at, now()),
         duration_secs = COALESCE($3, duration_secs),
         end_reason = COALESCE($4, end_reason),
         state = COALESCE($5, state, 'ended'),
         updated_at = now()
       WHERE instance_name = $1 AND call_id = $2
       RETURNING *`,
      [instanceName, callId, opts.durationSecs ?? null, opts.endReason ?? null, opts.state ?? 'ended'],
    )
    return rows[0] ? mapRow(rows[0]) : null
  }

  async setRecordingResult(
    instanceName: string,
    callId: string,
    result:
      | { status: 'ready'; storageKey: string; url: string | null; mime: string; bytes: number }
      | { status: 'failed'; error: string }
      | { status: 'disabled' | 'none' },
  ): Promise<void> {
    if (result.status === 'ready') {
      await this.pool.query(
        `UPDATE app_calls SET
           recording_status = 'ready',
           recording_storage_key = $3,
           recording_url = $4,
           recording_mime = $5,
           recording_bytes = $6,
           recording_error = NULL,
           updated_at = now()
         WHERE instance_name = $1 AND call_id = $2`,
        [instanceName, callId, result.storageKey, result.url, result.mime, result.bytes],
      )
      return
    }
    if (result.status === 'failed') {
      await this.pool.query(
        `UPDATE app_calls SET
           recording_status = 'failed',
           recording_error = $3,
           updated_at = now()
         WHERE instance_name = $1 AND call_id = $2`,
        [instanceName, callId, result.error],
      )
      return
    }
    await this.pool.query(
      `UPDATE app_calls SET recording_status = $3, updated_at = now()
       WHERE instance_name = $1 AND call_id = $2`,
      [instanceName, callId, result.status],
    )
  }

  async get(instanceName: string, callId: string): Promise<AppCall | null> {
    const { rows } = await this.pool.query<Row>(`SELECT * FROM app_calls WHERE instance_name = $1 AND call_id = $2`, [
      instanceName,
      callId,
    ])
    return rows[0] ? mapRow(rows[0]) : null
  }

  async list(
    instanceName: string,
    opts?: { limit?: number; offset?: number; withRecordingOnly?: boolean },
  ): Promise<AppCall[]> {
    const limit = Math.min(opts?.limit ?? 50, 200)
    const offset = opts?.offset ?? 0
    const { rows } = await this.pool.query<Row>(
      `SELECT * FROM app_calls
       WHERE instance_name = $1
         AND ($4::boolean IS NOT TRUE OR recording_status = 'ready')
       ORDER BY started_at DESC
       LIMIT $2 OFFSET $3`,
      [instanceName, limit, offset, opts?.withRecordingOnly ?? false],
    )
    return rows.map(mapRow)
  }
}
