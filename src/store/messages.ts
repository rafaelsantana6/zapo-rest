import type pg from 'pg'
import {
  CHAT_ACTION_ALIASES_SQL,
  CHAT_DELETED_SQL,
  refreshChatRows,
  ChatActionStateStore,
  withChatProjectionLock,
  type ClearChatProjection,
} from './chat-action-state'

export type AppMessage = {
  instanceName: string
  messageId: string
  chatJid: string
  senderJid: string | null
  participantJid: string | null
  fromMe: boolean
  timestampMs: number | null
  ack: number
  type: string
  body: string | null
  caption: string | null
  mediaUrl: string | null
  mediaMime: string | null
  mediaFilename: string | null
  mediaStorageKey: string | null
  hasMedia: boolean
  isDeleted: boolean
  isEdited: boolean
  starred: boolean
  pushName: string | null
  source: string
  raw: unknown
  createdAt: Date
  updatedAt: Date
}

type Row = {
  instance_name: string
  message_id: string
  chat_jid: string
  sender_jid: string | null
  participant_jid: string | null
  from_me: boolean
  timestamp_ms: string | number | null
  ack: number
  type: string
  body: string | null
  caption: string | null
  media_url: string | null
  media_mime: string | null
  media_filename: string | null
  media_storage_key: string | null
  has_media: boolean
  is_deleted: boolean
  is_edited: boolean
  starred: boolean
  push_name: string | null
  source: string
  raw: unknown
  created_at: Date
  updated_at: Date
}

function mapRow(row: Row): AppMessage {
  return {
    instanceName: row.instance_name,
    messageId: row.message_id,
    chatJid: row.chat_jid,
    senderJid: row.sender_jid,
    participantJid: row.participant_jid,
    fromMe: row.from_me,
    timestampMs: row.timestamp_ms == null ? null : Number(row.timestamp_ms),
    ack: row.ack,
    type: row.type,
    body: row.body,
    caption: row.caption,
    mediaUrl: row.media_url,
    mediaMime: row.media_mime,
    mediaFilename: row.media_filename,
    mediaStorageKey: row.media_storage_key,
    hasMedia: row.has_media,
    isDeleted: row.is_deleted,
    isEdited: row.is_edited,
    starred: row.starred,
    pushName: row.push_name,
    source: row.source,
    raw: row.raw,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export type UpsertMessageInput = {
  instanceName: string
  messageId: string
  chatJid: string
  senderJid?: string | null
  participantJid?: string | null
  fromMe?: boolean
  timestampMs?: number | null
  ack?: number
  type?: string
  body?: string | null
  caption?: string | null
  mediaUrl?: string | null
  mediaMime?: string | null
  mediaFilename?: string | null
  mediaStorageKey?: string | null
  hasMedia?: boolean
  isDeleted?: boolean
  isEdited?: boolean
  starred?: boolean
  pushName?: string | null
  source?: string
  raw?: unknown
}

export function toPublicMessage(m: AppMessage, opts?: { instanceName?: string }) {
  /**
   * Two download options (CAS may share bytes across messages):
   * - `mediaUrl` / storage public URL: direct object (has type extension, loses original name)
   * - `mediaDownloadUrl`: API path that sets Content-Disposition with this message's original filename
   */
  const apiDownload =
    m.hasMedia && opts?.instanceName
      ? `/v1/instances/${encodeURIComponent(opts.instanceName)}/messages/${encodeURIComponent(m.messageId)}/media`
      : null
  // Prefer stored public storage URL when present (S3/local base); else API path
  let mediaUrl = m.mediaUrl
  if (!mediaUrl && apiDownload) mediaUrl = apiDownload
  return {
    id: m.messageId,
    chatId: m.chatJid,
    from: m.senderJid,
    participant: m.participantJid,
    fromMe: m.fromMe,
    timestamp: m.timestampMs,
    ack: m.ack,
    type: m.type,
    body: m.body,
    caption: m.caption,
    hasMedia: m.hasMedia,
    mediaUrl,
    /** API download with original `mediaFilename` (use `?download=1` for attachment). */
    mediaDownloadUrl: apiDownload,
    mediaMime: m.mediaMime,
    mediaFilename: m.mediaFilename,
    mediaStorageKey: m.mediaStorageKey,
    isDeleted: m.isDeleted,
    isEdited: m.isEdited,
    starred: m.starred,
    pushName: m.pushName,
    source: m.source,
    _data: m.raw,
  }
}

export class MessageStore {
  readonly actions: ChatActionStateStore
  constructor(private readonly pool: pg.Pool) {
    this.actions = new ChatActionStateStore(pool)
  }

  /**
   * Upsert message by (instance, message_id).
   * Idempotent: replaying the same WA event updates fields without duplicating.
   */
  async upsert(input: UpsertMessageInput): Promise<AppMessage | null> {
    return withChatProjectionLock(this.pool, input.instanceName, async (client) => {
      const { rows } = await client.query<Row>(
        `WITH aliases AS (
 SELECT $3::text AS jid UNION SELECT pn FROM lid_map WHERE instance_name = $1 AND lid = $3
 UNION SELECT lid FROM lid_map WHERE instance_name = $1 AND pn = $3
 UNION SELECT sibling.lid FROM lid_map source JOIN lid_map sibling ON sibling.instance_name = source.instance_name AND sibling.pn = source.pn WHERE source.instance_name = $1 AND source.lid = $3
 ), state AS (
 SELECT COALESCE((SELECT starred FROM app_message_actions WHERE instance_name = $1 AND message_id = $2), $19,
 (SELECT starred FROM app_messages WHERE instance_name = $1 AND message_id = $2), false) AS starred
 ) INSERT INTO app_messages (
 instance_name, message_id, chat_jid, sender_jid, participant_jid,
 from_me, timestamp_ms, ack, type, body, caption,
 media_url, media_mime, media_filename, media_storage_key, has_media,
 is_deleted, is_edited, starred, push_name, source, raw
 ) SELECT $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,state.starred,$20,$21,$22::jsonb FROM state
 WHERE NOT EXISTS (SELECT 1 FROM app_message_actions WHERE instance_name = $1 AND message_id = $2 AND deleted)
 AND NOT EXISTS (SELECT 1 FROM app_chat_actions WHERE instance_name = $1 AND chat_jid IN (SELECT jid FROM aliases)
 AND (COALESCE($7::bigint, 0) <= clear_starred_before_ms OR (NOT state.starred AND COALESCE($7::bigint, 0) <= clear_before_ms)))
 ON CONFLICT (instance_name, message_id) DO UPDATE SET
 chat_jid = EXCLUDED.chat_jid,
 sender_jid = COALESCE(EXCLUDED.sender_jid, app_messages.sender_jid),
 participant_jid = COALESCE(EXCLUDED.participant_jid, app_messages.participant_jid),
 from_me = EXCLUDED.from_me,
 timestamp_ms = COALESCE(EXCLUDED.timestamp_ms, app_messages.timestamp_ms),
 ack = GREATEST(app_messages.ack, EXCLUDED.ack),
 type = CASE WHEN EXCLUDED.type = 'unknown' THEN app_messages.type ELSE EXCLUDED.type END,
 body = COALESCE(EXCLUDED.body, app_messages.body),
 caption = COALESCE(EXCLUDED.caption, app_messages.caption),
 media_url = COALESCE(EXCLUDED.media_url, app_messages.media_url),
 media_mime = COALESCE(EXCLUDED.media_mime, app_messages.media_mime),
 media_filename = COALESCE(EXCLUDED.media_filename, app_messages.media_filename),
 media_storage_key = COALESCE(EXCLUDED.media_storage_key, app_messages.media_storage_key),
 has_media = app_messages.has_media OR EXCLUDED.has_media,
 is_deleted = app_messages.is_deleted OR EXCLUDED.is_deleted,
 is_edited = app_messages.is_edited OR EXCLUDED.is_edited,
 starred = CASE WHEN $23 OR EXISTS (SELECT 1 FROM app_message_actions WHERE instance_name = $1 AND message_id = $2 AND starred IS NOT NULL) THEN EXCLUDED.starred ELSE app_messages.starred END,
 push_name = COALESCE(EXCLUDED.push_name, app_messages.push_name),
 source = CASE WHEN app_messages.source = 'history' AND EXCLUDED.source = 'live' THEN 'live' ELSE app_messages.source END,
 raw = CASE WHEN EXCLUDED.raw::text = '{}'::text THEN app_messages.raw ELSE EXCLUDED.raw END,
 updated_at = now()
 RETURNING *`,
        [
          input.instanceName,
          input.messageId,
          input.chatJid,
          input.senderJid ?? null,
          input.participantJid ?? null,
          input.fromMe ?? false,
          input.timestampMs ?? null,
          input.ack ?? 0,
          input.type ?? 'unknown',
          input.body ?? null,
          input.caption ?? null,
          input.mediaUrl ?? null,
          input.mediaMime ?? null,
          input.mediaFilename ?? null,
          input.mediaStorageKey ?? null,
          input.hasMedia ?? false,
          input.isDeleted ?? false,
          input.isEdited ?? false,
          input.starred ?? null,
          input.pushName ?? null,
          input.source ?? 'live',
          JSON.stringify(input.raw ?? {}),
          input.starred !== undefined,
        ],
      )
      const row = rows[0]
      return row ? mapRow(row) : null
    })
  }

  async get(instanceName: string, messageId: string): Promise<AppMessage | null> {
    const { rows } = await this.pool.query<Row>(
      `SELECT * FROM app_messages WHERE instance_name = $1 AND message_id = $2`,
      [instanceName, messageId],
    )
    return rows[0] ? mapRow(rows[0]) : null
  }

  /**
   * List messages for a chat. Pass `chatJids` (aliases: PN + LIDs) to merge
   * threads using LID↔PN aliases.
   */
  async listByChat(
    instanceName: string,
    chatJid: string,
    opts: {
      limit?: number
      beforeTs?: number
      afterTs?: number
      fromMe?: boolean
      /** Extra JIDs (LID aliases) that belong to the same conversation */
      chatJids?: string[]
    } = {},
  ): Promise<AppMessage[]> {
    const limit = Math.min(opts.limit ?? 50, 200)
    const jids = [...new Set([chatJid, ...(opts.chatJids ?? [])])]
    const conditions = ['instance_name = $1']
    const values: unknown[] = [instanceName]
    let i = 2

    if (jids.length === 1) {
      conditions.push(`chat_jid = $${i++}`)
      values.push(jids[0])
    } else {
      conditions.push(`chat_jid = ANY($${i++}::text[])`)
      values.push(jids)
    }

    if (opts.beforeTs != null) {
      conditions.push(`timestamp_ms < $${i++}`)
      values.push(opts.beforeTs)
    }
    if (opts.afterTs != null) {
      conditions.push(`timestamp_ms > $${i++}`)
      values.push(opts.afterTs)
    }
    if (opts.fromMe != null) {
      conditions.push(`from_me = $${i++}`)
      values.push(opts.fromMe)
    }
    values.push(limit)
    const { rows } = await this.pool.query<Row>(
      `SELECT * FROM app_messages
 WHERE ${conditions.join(' AND ')}
 ORDER BY timestamp_ms DESC NULLS LAST, message_id DESC
 LIMIT $${i}`,
      values,
    )
    return rows.map(mapRow)
  }

  /** Re-key all messages from one chat_jid to another (after LID→PN resolve). */
  async rekeyChat(instanceName: string, fromJid: string, toJid: string): Promise<number> {
    if (fromJid === toJid) return 0
    return withChatProjectionLock(this.pool, instanceName, async (client) => {
      await client.query(
        `WITH aliases AS (${CHAT_ACTION_ALIASES_SQL} UNION SELECT $3::text AS jid)
 DELETE FROM app_messages m WHERE m.instance_name = $1 AND m.chat_jid IN (SELECT jid FROM aliases)
 AND (EXISTS (SELECT 1 FROM app_message_actions WHERE instance_name = $1 AND message_id = m.message_id AND deleted)
 OR EXISTS (SELECT 1 FROM app_chat_actions WHERE instance_name = $1 AND chat_jid IN (SELECT jid FROM aliases)
 AND (COALESCE(m.timestamp_ms, 0) <= clear_starred_before_ms OR (NOT COALESCE((SELECT starred FROM app_message_actions WHERE instance_name = $1 AND message_id = m.message_id), m.starred) AND COALESCE(m.timestamp_ms, 0) <= clear_before_ms))))`,
        [instanceName, toJid, fromJid],
      )
      const res = await client.query(
        `UPDATE app_messages m SET chat_jid = $3,
 starred = COALESCE((SELECT starred FROM app_message_actions WHERE instance_name = $1 AND message_id = m.message_id), m.starred), updated_at = now()
 WHERE instance_name = $1 AND chat_jid = $2`,
        [instanceName, fromJid, toJid],
      )
      const { rows } = await client.query<{ jid: string }>(`${CHAT_ACTION_ALIASES_SQL} UNION SELECT $3::text AS jid`, [
        instanceName,
        toJid,
        fromJid,
      ])
      const aliases = rows.map((row) => row.jid)
      await client.query(
        `WITH deletion AS (${CHAT_DELETED_SQL}) DELETE FROM app_chats WHERE instance_name = $1 AND chat_jid = ANY($3::text[]) AND (SELECT deleted FROM deletion)`,
        [instanceName, toJid, aliases],
      )
      await refreshChatRows(client, instanceName, aliases)
      return res.rowCount ?? 0
    })
  }

  async clearChat(instanceName: string, chatJids: string[], options: ClearChatProjection): Promise<void> {
    await withChatProjectionLock(this.pool, instanceName, async (client) => {
      await client.query(
        `WITH remembered AS (
 INSERT INTO app_chat_actions (instance_name, chat_jid, clear_before_ms, clear_starred_before_ms, deleted_before_ms, keep_empty, action_timestamp_ms)
 SELECT $1, unnest($2::text[]), $4::bigint, CASE WHEN $3 THEN $4::bigint ELSE -1 END, CASE WHEN $5 THEN $4::bigint ELSE -1 END, NOT $5, $6::bigint
 ON CONFLICT (instance_name, chat_jid) DO UPDATE SET
 clear_before_ms = GREATEST(app_chat_actions.clear_before_ms, EXCLUDED.clear_before_ms),
 clear_starred_before_ms = GREATEST(app_chat_actions.clear_starred_before_ms, EXCLUDED.clear_starred_before_ms),
 deleted_before_ms = GREATEST(app_chat_actions.deleted_before_ms, EXCLUDED.deleted_before_ms),
 keep_empty = CASE WHEN EXCLUDED.action_timestamp_ms >= app_chat_actions.action_timestamp_ms THEN EXCLUDED.keep_empty ELSE app_chat_actions.keep_empty END,
 action_timestamp_ms = GREATEST(app_chat_actions.action_timestamp_ms, EXCLUDED.action_timestamp_ms)
 RETURNING chat_jid
 ) DELETE FROM app_messages WHERE instance_name = $1 AND chat_jid IN (SELECT chat_jid FROM remembered)
 AND ($3 OR NOT starred) AND COALESCE(timestamp_ms, 0) <= $4`,
        [
          instanceName,
          chatJids,
          options.deleteStarred,
          options.beforeMs,
          options.deleteChat === true,
          options.timestampMs ?? options.beforeMs,
        ],
      )
      if (options.deleteChat)
        await client.query(
          `DELETE FROM app_chats WHERE instance_name = $1 AND chat_jid = ANY($2::text[])
 AND NOT EXISTS (SELECT 1 FROM app_messages WHERE instance_name = $1 AND chat_jid = ANY($2::text[]))
 AND NOT EXISTS (SELECT 1 FROM app_chat_actions WHERE instance_name = $1 AND chat_jid = ANY($2::text[]) AND keep_empty)`,
          [instanceName, chatJids],
        )
      await refreshChatRows(client, instanceName, chatJids, options.beforeMs)
    })
  }

  async deleteForMe(instanceName: string, chatJid: string, messageId: string): Promise<void> {
    await withChatProjectionLock(this.pool, instanceName, async (client) => {
      await client.query(
        `WITH remembered AS (
 INSERT INTO app_message_actions (instance_name, message_id, deleted) VALUES ($1, $3, true)
 ON CONFLICT (instance_name, message_id) DO UPDATE SET deleted = true RETURNING message_id
 ) DELETE FROM app_messages WHERE instance_name = $1 AND chat_jid = $2 AND message_id IN (SELECT message_id FROM remembered)`,
        [instanceName, chatJid, messageId],
      )
    })
  }

  async updateAck(instanceName: string, messageId: string, ack: number): Promise<AppMessage | null> {
    const { rows } = await this.pool.query<Row>(
      `UPDATE app_messages
 SET ack = GREATEST(ack, $3), updated_at = now()
 WHERE instance_name = $1 AND message_id = $2
 RETURNING *`,
      [instanceName, messageId, ack],
    )
    return rows[0] ? mapRow(rows[0]) : null
  }

  async setStarred(instanceName: string, messageId: string, starred: boolean, timestampMs = Date.now()): Promise<void> {
    await withChatProjectionLock(this.pool, instanceName, async (client) => {
      await new ChatActionStateStore(client).rememberStar(instanceName, messageId, starred, timestampMs)
      await client.query(
        `UPDATE app_messages SET starred = (SELECT starred FROM app_message_actions WHERE instance_name = $1 AND message_id = $2), updated_at = now() WHERE instance_name = $1 AND message_id = $2`,
        [instanceName, messageId],
      )
    })
  }

  async markDeleted(instanceName: string, messageId: string): Promise<AppMessage | null> {
    const { rows } = await this.pool.query<Row>(
      `UPDATE app_messages
 SET is_deleted = true, updated_at = now()
 WHERE instance_name = $1 AND message_id = $2
 RETURNING *`,
      [instanceName, messageId],
    )
    return rows[0] ? mapRow(rows[0]) : null
  }

  async markEdited(instanceName: string, messageId: string, body: string, raw?: unknown): Promise<AppMessage | null> {
    const { rows } = await this.pool.query<Row>(
      `UPDATE app_messages
 SET is_edited = true, body = $3, raw = COALESCE($4::jsonb, raw), updated_at = now()
 WHERE instance_name = $1 AND message_id = $2
 RETURNING *`,
      [instanceName, messageId, body, raw ? JSON.stringify(raw) : null],
    )
    return rows[0] ? mapRow(rows[0]) : null
  }

  async setMedia(
    instanceName: string,
    messageId: string,
    media: { url?: string | null; storageKey?: string | null; mime?: string | null; filename?: string | null },
  ): Promise<void> {
    await this.pool.query(
      `UPDATE app_messages SET
 media_url = COALESCE($3, media_url),
 media_storage_key = COALESCE($4, media_storage_key),
 media_mime = COALESCE($5, media_mime),
 media_filename = COALESCE($6, media_filename),
 has_media = true,
 updated_at = now()
 WHERE instance_name = $1 AND message_id = $2`,
      [
        instanceName,
        messageId,
        media.url ?? null,
        media.storageKey ?? null,
        media.mime ?? null,
        media.filename ?? null,
      ],
    )
  }
}
