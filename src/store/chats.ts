import type pg from 'pg'
import { isNoiseChatJid } from '~/lib/jid-canon'

export type AppChat = {
  instanceName: string
  chatJid: string
  name: string | null
  isGroup: boolean
  unreadCount: number
  archived: boolean
  pinned: number
  locked: boolean
  muteEndMs: number | null
  markedAsUnread: boolean
  lastMessageId: string | null
  lastMessagePreview: string | null
  lastMessageTs: number | null
  raw: unknown
  createdAt: Date
  updatedAt: Date
  /** Aliases collapsed into this chat (LIDs), when list(merge=true) */
  altJids?: string[]
}

type Row = {
  instance_name: string
  chat_jid: string
  name: string | null
  is_group: boolean
  unread_count: number
  archived: boolean
  pinned: number
  locked: boolean
  mute_end_ms: string | number | null
  marked_as_unread: boolean
  last_message_id: string | null
  last_message_preview: string | null
  last_message_ts: string | number | null
  raw: unknown
  created_at: Date
  updated_at: Date
}

function mapRow(row: Row): AppChat {
  return {
    instanceName: row.instance_name,
    chatJid: row.chat_jid,
    name: row.name,
    isGroup: row.is_group,
    unreadCount: row.unread_count,
    archived: row.archived,
    pinned: row.pinned,
    locked: row.locked,
    muteEndMs: row.mute_end_ms == null ? null : Number(row.mute_end_ms),
    markedAsUnread: row.marked_as_unread,
    lastMessageId: row.last_message_id,
    lastMessagePreview: row.last_message_preview,
    lastMessageTs: row.last_message_ts == null ? null : Number(row.last_message_ts),
    raw: row.raw,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export function toPublicChat(c: AppChat) {
  const muted = c.muteEndMs != null && c.muteEndMs > Date.now()
  return {
    id: c.chatJid,
    name: c.name,
    isGroup: c.isGroup,
    unreadCount: c.unreadCount,
    archived: c.archived,
    pinned: c.pinned,
    muteEndMs: c.muteEndMs,
    muted,
    muteUntil: muted && c.muteEndMs != null ? new Date(c.muteEndMs).toISOString() : null,
    locked: c.locked,
    markedAsUnread: c.markedAsUnread,
    lastMessage: c.lastMessageId
      ? {
          id: c.lastMessageId,
          preview: c.lastMessagePreview,
          timestamp: c.lastMessageTs,
        }
      : null,
    /** LID aliases merged into this conversation */
    altJids: c.altJids ?? [],
    _data: c.raw,
  }
}

export type UpsertChatInput = {
  instanceName: string
  chatJid: string
  name?: string | null
  isGroup?: boolean
  unreadCount?: number
  archived?: boolean
  pinned?: number
  locked?: boolean
  muteEndMs?: number | null
  markedAsUnread?: boolean
  lastMessageId?: string | null
  lastMessagePreview?: string | null
  lastMessageTs?: number | null
  raw?: unknown
}

export class ChatStore {
  constructor(readonly pool: pg.Pool) {}

  async upsert(input: UpsertChatInput): Promise<AppChat> {
    const isGroup = input.isGroup ?? input.chatJid.endsWith('@g.us')
    const { rows } = await this.pool.query<Row>(
      `INSERT INTO app_chats (
 instance_name, chat_jid, name, is_group, unread_count, archived, pinned,
 mute_end_ms, marked_as_unread, last_message_id, last_message_preview, last_message_ts, raw, locked
 ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb,$14)
 ON CONFLICT (instance_name, chat_jid) DO UPDATE SET
 name = COALESCE(EXCLUDED.name, app_chats.name),
 is_group = EXCLUDED.is_group OR app_chats.is_group,
 unread_count = CASE WHEN $15 THEN EXCLUDED.unread_count ELSE app_chats.unread_count END,
 archived = CASE WHEN $16 THEN EXCLUDED.archived ELSE app_chats.archived END,
 pinned = CASE WHEN $17 THEN EXCLUDED.pinned ELSE app_chats.pinned END,
 mute_end_ms = CASE WHEN $18 THEN EXCLUDED.mute_end_ms ELSE app_chats.mute_end_ms END,
 marked_as_unread = CASE WHEN $19 THEN EXCLUDED.marked_as_unread ELSE app_chats.marked_as_unread END,
 locked = CASE WHEN $20 THEN EXCLUDED.locked ELSE app_chats.locked END,
 last_message_id = CASE
 WHEN EXCLUDED.last_message_ts IS NOT NULL
 AND (app_chats.last_message_ts IS NULL OR EXCLUDED.last_message_ts >= app_chats.last_message_ts)
 THEN EXCLUDED.last_message_id
 ELSE app_chats.last_message_id
 END,
 last_message_preview = CASE
 WHEN EXCLUDED.last_message_ts IS NOT NULL
 AND (app_chats.last_message_ts IS NULL OR EXCLUDED.last_message_ts >= app_chats.last_message_ts)
 THEN EXCLUDED.last_message_preview
 ELSE app_chats.last_message_preview
 END,
 last_message_ts = CASE
 WHEN EXCLUDED.last_message_ts IS NOT NULL
 AND (app_chats.last_message_ts IS NULL OR EXCLUDED.last_message_ts >= app_chats.last_message_ts)
 THEN EXCLUDED.last_message_ts
 ELSE app_chats.last_message_ts
 END,
 raw = CASE WHEN EXCLUDED.raw::text = '{}'::text THEN app_chats.raw ELSE EXCLUDED.raw END,
 updated_at = now()
 RETURNING *`,
      [
        input.instanceName,
        input.chatJid,
        input.name ?? null,
        isGroup,
        input.unreadCount ?? 0,
        input.archived ?? false,
        input.pinned ?? 0,
        input.muteEndMs ?? null,
        input.markedAsUnread ?? false,
        input.lastMessageId ?? null,
        input.lastMessagePreview ?? null,
        input.lastMessageTs ?? null,
        JSON.stringify(input.raw ?? {}),
        input.locked ?? false,
        input.unreadCount !== undefined,
        input.archived !== undefined,
        input.pinned !== undefined,
        input.muteEndMs !== undefined,
        input.markedAsUnread !== undefined,
        input.locked !== undefined,
      ],
    )
    const row = rows[0]
    if (!row) throw new Error('upsert returned no row')
    return mapRow(row)
  }

  /**
   * List chats. With `merge: true` (default) collapses LID + PN rows that share
   * a lid_map entry into a single conversation, preferring the PN id.
   */
  async list(
    instanceName: string,
    opts: { limit?: number; offset?: number; archived?: boolean; merge?: boolean; before?: number } = {},
  ): Promise<AppChat[]> {
    const limit = Math.min(opts.limit ?? 50, 200)
    const offset = opts.offset ?? 0
    const merge = opts.merge !== false

    if (!merge) {
      return this.listRaw(instanceName, { limit, offset, archived: opts.archived })
    }
    return this.listMerged(instanceName, { limit, offset, archived: opts.archived, before: opts.before })
  }

  /**
   * Collapse LID+PN rows sharing a lid_map entry into one conversation (prefer
   * the PN id). Winner + altJids come from a single window pass — no extra
   * GROUP BY + join over the same set.
   *
   * Pass `before` (a `last_message_ts`) to page by keyset instead of a deep
   * OFFSET: the deep-OFFSET path recomputes and discards `offset` rows every
   * call, so it degrades on later pages. Keyset is applied *after* the collapse
   * (never inside the window input) — filtering the pre-collapse set by ts would
   * resurrect an alias of a still-visible chat as a duplicate on the next page.
   * With no `before`, the OFFSET path is byte-for-byte the previous behavior so
   * the route contract is untouched.
   *
   * @example chats.list('inst', { limit: 50, before: lastTsFromPrevPage })
   */
  private async listMerged(
    instanceName: string,
    opts: { limit: number; offset: number; archived?: boolean; before?: number },
  ): Promise<AppChat[]> {
    const archivedClause =
      opts.archived == null ? '' : opts.archived ? 'AND c.archived = true' : 'AND c.archived = false'

    const params: unknown[] = [instanceName, opts.limit]
    let pageClause = ''
    let orderClause = 'ORDER BY r.pinned DESC, r.last_message_ts DESC NULLS LAST LIMIT $2 OFFSET $3'
    if (opts.before != null) {
      params.push(opts.before)
      pageClause = 'AND r.last_message_ts < $3'
      orderClause = 'ORDER BY r.last_message_ts DESC NULLS LAST LIMIT $2'
    } else {
      params.push(opts.offset)
    }

    const { rows } = await this.pool.query<Row & { alt_jids: string[] | null }>(
      `
 WITH annotated AS (
 SELECT
 c.*,
 COALESCE(lm.pn, CASE WHEN c.chat_jid LIKE '%@lid' THEN NULL ELSE c.chat_jid END, c.chat_jid)
 AS primary_jid,
 CASE WHEN c.chat_jid LIKE '%@lid' THEN 1 ELSE 0 END AS primary_priority
 FROM app_chats c
 LEFT JOIN lid_map lm
 ON lm.instance_name = c.instance_name AND lm.lid = c.chat_jid
 WHERE c.instance_name = $1
 ${archivedClause}
 AND c.chat_jid NOT LIKE '%@broadcast'
 AND c.chat_jid NOT LIKE '%@newsletter'
 AND c.chat_jid <> 'status@broadcast'
 AND c.chat_jid NOT LIKE '0@%'
 -- Only real conversations (have activity)
 AND (
 c.is_group = true
 OR c.last_message_ts IS NOT NULL
 OR c.unread_count > 0
 )
 AND COALESCE(c.last_message_preview, '') NOT IN ('[protocol]')
 ),
 ranked AS (
 SELECT
 a.*,
 ROW_NUMBER() OVER (
 PARTITION BY a.primary_jid
 ORDER BY a.last_message_ts DESC NULLS LAST, a.primary_priority ASC
 ) AS rn,
 -- chat_jid is unique per instance, so DISTINCT is redundant here
 array_agg(a.chat_jid) FILTER (
 WHERE a.chat_jid IS DISTINCT FROM a.primary_jid
 ) OVER (PARTITION BY a.primary_jid) AS alt_jids
 FROM annotated a
 )
 SELECT r.instance_name, r.primary_jid AS chat_jid, r.name, r.is_group, r.unread_count,
 r.archived, r.pinned, r.locked, r.mute_end_ms, r.marked_as_unread,
 r.last_message_id, r.last_message_preview, r.last_message_ts, r.raw,
 r.created_at, r.updated_at, r.alt_jids
 FROM ranked r
 WHERE r.rn = 1
 ${pageClause}
 ${orderClause}
 `,
      params,
    )

    return rows.map((row) => {
      const chat = mapRow(row)
      chat.chatJid = row.chat_jid // already primary_jid from SELECT alias
      chat.altJids = (row.alt_jids ?? []).filter(Boolean)
      return chat
    })
  }

  private async listRaw(
    instanceName: string,
    opts: { limit: number; offset: number; archived?: boolean },
  ): Promise<AppChat[]> {
    const conditions = ['instance_name = $1']
    const values: unknown[] = [instanceName]
    let i = 2
    if (opts.archived != null) {
      conditions.push(`archived = $${i++}`)
      values.push(opts.archived)
    }
    values.push(opts.limit, opts.offset)
    const { rows } = await this.pool.query<Row>(
      `SELECT * FROM app_chats WHERE ${conditions.join(' AND ')}
 ORDER BY pinned DESC, last_message_ts DESC NULLS LAST
 LIMIT $${i} OFFSET $${i + 1}`,
      values,
    )
    return rows.map(mapRow).filter((c) => !isNoiseChatJid(c.chatJid))
  }

  /**
   * After a new LID→PN mapping, merge the LID chat row into the PN chat and
   * drop the duplicate LID conversation.
   */
  async mergeLidIntoPn(instanceName: string, lid: string, pn: string): Promise<void> {
    if (lid === pn) return
    const lidChat = await this.get(instanceName, lid)
    if (!lidChat) return

    const pnChat = await this.get(instanceName, pn)
    if (!pnChat) {
      // Rename LID row to PN
      await this.pool.query(
        `UPDATE app_chats SET chat_jid = $3, updated_at = now()
 WHERE instance_name = $1 AND chat_jid = $2`,
        [instanceName, lid, pn],
      )
      return
    }

    // Merge metadata: keep best name / latest message
    const name = pnChat.name || lidChat.name
    const last =
      (pnChat.lastMessageTs ?? 0) >= (lidChat.lastMessageTs ?? 0)
        ? {
            id: pnChat.lastMessageId,
            preview: pnChat.lastMessagePreview,
            ts: pnChat.lastMessageTs,
          }
        : {
            id: lidChat.lastMessageId,
            preview: lidChat.lastMessagePreview,
            ts: lidChat.lastMessageTs,
          }

    await this.pool.query(
      `UPDATE app_chats SET
 name = COALESCE($3, name),
 unread_count = GREATEST(unread_count, $4),
 last_message_id = $5,
 last_message_preview = $6,
 last_message_ts = $7,
 updated_at = now()
 WHERE instance_name = $1 AND chat_jid = $2`,
      [instanceName, pn, name, (pnChat.unreadCount ?? 0) + (lidChat.unreadCount ?? 0), last.id, last.preview, last.ts],
    )
    await this.delete(instanceName, lid)
  }

  async get(instanceName: string, chatJid: string): Promise<AppChat | null> {
    const { rows } = await this.pool.query<Row>(`SELECT * FROM app_chats WHERE instance_name = $1 AND chat_jid = $2`, [
      instanceName,
      chatJid,
    ])
    return rows[0] ? mapRow(rows[0]) : null
  }

  async setArchived(instanceName: string, chatJid: string, archived: boolean): Promise<AppChat | null> {
    const { rows } = await this.pool.query<Row>(
      `UPDATE app_chats SET archived = $3, pinned = CASE WHEN $3 THEN 0 ELSE pinned END, updated_at = now()
 WHERE instance_name = $1 AND chat_jid = $2 RETURNING *`,
      [instanceName, chatJid, archived],
    )
    return rows[0] ? mapRow(rows[0]) : null
  }

  async setUnread(instanceName: string, chatJid: string, unreadCount: number): Promise<void> {
    await this.pool.query(
      `UPDATE app_chats SET unread_count = $3, marked_as_unread = ($3 > 0), updated_at = now()
 WHERE instance_name = $1 AND chat_jid = $2`,
      [instanceName, chatJid, unreadCount],
    )
  }

  /** Recompute the preview after destructive actions, including preserved starred messages. */
  async refreshLastMessage(instanceName: string, chatJid: string, chatJids: string[]): Promise<void> {
    await this.pool.query(
      `UPDATE app_chats SET
 last_message_id = (SELECT message_id FROM app_messages WHERE instance_name = $1 AND chat_jid = ANY($3::text[]) ORDER BY timestamp_ms DESC NULLS LAST, message_id DESC LIMIT 1),
 last_message_preview = (SELECT COALESCE(body, caption, type) FROM app_messages WHERE instance_name = $1 AND chat_jid = ANY($3::text[]) ORDER BY timestamp_ms DESC NULLS LAST, message_id DESC LIMIT 1),
 last_message_ts = (SELECT timestamp_ms FROM app_messages WHERE instance_name = $1 AND chat_jid = ANY($3::text[]) ORDER BY timestamp_ms DESC NULLS LAST, message_id DESC LIMIT 1),
 updated_at = now()
 WHERE instance_name = $1 AND chat_jid = $2`,
      [instanceName, chatJid, chatJids],
    )
  }

  async delete(instanceName: string, chatJid: string): Promise<boolean> {
    const res = await this.pool.query(`DELETE FROM app_chats WHERE instance_name = $1 AND chat_jid = $2`, [
      instanceName,
      chatJid,
    ])
    return (res.rowCount ?? 0) > 0
  }
}
