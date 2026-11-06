import type pg from 'pg'

export type ChatSettings = { archived?: boolean; pinned?: number; muteEndMs?: number | null; locked?: boolean }
export type MutationCursor = { collection: string; index: string; timestamp: number }
export type ClearChatProjection = {
  deleteStarred: boolean
  beforeMs: number
  deleteChat?: boolean
  timestampMs?: number
}

/** Shared SQL identity expansion keeps decisions made under a LID effective after PN reconciliation. */
export const CHAT_ACTION_ALIASES_SQL = `
 SELECT $2::text AS jid
 UNION SELECT pn FROM lid_map WHERE instance_name = $1 AND lid = $2
 UNION SELECT lid FROM lid_map WHERE instance_name = $1 AND pn = $2
 UNION SELECT sibling.lid FROM lid_map source JOIN lid_map sibling
 ON sibling.instance_name = source.instance_name AND sibling.pn = source.pn
 WHERE source.instance_name = $1 AND source.lid = $2`

export const PRESERVED_CHAT_SQL = `EXISTS (
 SELECT 1 FROM app_chat_actions action
 LEFT JOIN lid_map action_lid ON action_lid.instance_name = action.instance_name AND action_lid.lid = action.chat_jid
 LEFT JOIN lid_map chat_lid ON chat_lid.instance_name = c.instance_name AND chat_lid.lid = c.chat_jid
 WHERE action.instance_name = c.instance_name
 AND COALESCE(action_lid.pn, action.chat_jid) = COALESCE(chat_lid.pn, c.chat_jid)
 AND (action.keep_empty OR action.settings <> '{}'::jsonb))`

export const CHAT_SETTINGS_SQL = `WITH aliases AS (${CHAT_ACTION_ALIASES_SQL}), latest AS (
 SELECT DISTINCT ON (s.key) s.key, s.value FROM app_chat_actions a
 CROSS JOIN LATERAL jsonb_each(a.settings) s
 WHERE a.instance_name = $1 AND a.chat_jid IN (SELECT jid FROM aliases)
 ORDER BY s.key, (a.setting_times ->> s.key)::bigint DESC, a.chat_jid
 ) SELECT COALESCE(jsonb_object_agg(key, value), '{}'::jsonb) AS settings FROM latest`

export const CHAT_DELETED_SQL = `WITH aliases AS (${CHAT_ACTION_ALIASES_SQL}), latest AS (
 SELECT deleted_before_ms, keep_empty FROM app_chat_actions WHERE instance_name = $1 AND chat_jid IN (SELECT jid FROM aliases)
 ORDER BY action_timestamp_ms DESC LIMIT 1
 ) SELECT COALESCE((SELECT deleted_before_ms >= 0 AND NOT keep_empty FROM latest), false)
 AND NOT EXISTS (SELECT 1 FROM app_messages WHERE instance_name = $1 AND chat_jid IN (SELECT jid FROM aliases)) AS deleted`

/** The separate lock statement gives the following read a fresh READ COMMITTED snapshot. */
export async function withChatProjectionLock<T>(
  pool: pg.Pool,
  instanceName: string,
  action: (client: pg.PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    // Match the session queue granularity; aliases and message ids share one instance lock.
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 624809))', [instanceName])
    const result = await action(client)
    await client.query('COMMIT')
    return result
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined)
    throw error
  } finally {
    client.release()
  }
}

/** Durable projection metadata, independent of the short-lived webhook dedupe ledger. */
export class ChatActionStateStore {
  constructor(private readonly pool: Pick<pg.Pool, 'query'>) {}

  async acceptMutation(instanceName: string, cursor: MutationCursor): Promise<boolean> {
    const { rowCount } = await this.pool.query(
      `INSERT INTO app_state_projection_cursors (instance_name, collection, mutation_index, timestamp_ms)
 VALUES ($1, $2, $3, $4)
 ON CONFLICT (instance_name, collection, mutation_index) DO UPDATE SET timestamp_ms = EXCLUDED.timestamp_ms
 WHERE EXCLUDED.timestamp_ms >= app_state_projection_cursors.timestamp_ms`,
      [instanceName, cursor.collection, cursor.index, cursor.timestamp],
    )
    return (rowCount ?? 0) > 0
  }

  async rememberSettings(
    instanceName: string,
    chatJid: string,
    settings: ChatSettings,
    timestampMs: number,
  ): Promise<void> {
    if (!Object.values(settings).some((value) => value !== undefined)) return
    await this.pool.query(
      `INSERT INTO app_chat_actions (instance_name, chat_jid, settings, setting_times, keep_empty, action_timestamp_ms)
 VALUES ($1, $2, $3::jsonb, (SELECT jsonb_object_agg(key, $4::bigint) FROM jsonb_each($3::jsonb)), true, $4)
 ON CONFLICT (instance_name, chat_jid) DO UPDATE SET
 keep_empty = CASE WHEN $4 > app_chat_actions.action_timestamp_ms THEN true ELSE app_chat_actions.keep_empty END,
 action_timestamp_ms = GREATEST(app_chat_actions.action_timestamp_ms, $4),
 settings = app_chat_actions.settings || COALESCE((
 SELECT jsonb_object_agg(key, value) FROM jsonb_each(EXCLUDED.settings)
 WHERE COALESCE((app_chat_actions.setting_times ->> key)::bigint, -1) <= $4), '{}'::jsonb),
 setting_times = app_chat_actions.setting_times || COALESCE((
 SELECT jsonb_object_agg(key, $4::bigint) FROM jsonb_each(EXCLUDED.settings)
 WHERE COALESCE((app_chat_actions.setting_times ->> key)::bigint, -1) <= $4), '{}'::jsonb)`,
      [instanceName, chatJid, JSON.stringify(settings), timestampMs],
    )
  }

  async getSettings(instanceName: string, chatJid: string): Promise<ChatSettings> {
    const { rows } = await this.pool.query<{ settings: ChatSettings }>(CHAT_SETTINGS_SQL, [instanceName, chatJid])
    return rows[0]?.settings ?? {}
  }

  async isDeleted(instanceName: string, chatJid: string): Promise<boolean> {
    const { rows } = await this.pool.query<{ deleted: boolean }>(CHAT_DELETED_SQL, [instanceName, chatJid])
    return rows[0]?.deleted ?? false
  }

  async rememberStar(instanceName: string, messageId: string, starred: boolean, timestampMs: number): Promise<void> {
    await this.pool.query(
      `INSERT INTO app_message_actions (instance_name, message_id, starred, star_timestamp_ms)
 VALUES ($1, $2, $3, $4)
 ON CONFLICT (instance_name, message_id) DO UPDATE SET starred = EXCLUDED.starred, star_timestamp_ms = EXCLUDED.star_timestamp_ms
 WHERE EXCLUDED.star_timestamp_ms >= app_message_actions.star_timestamp_ms`,
      [instanceName, messageId, starred, timestampMs],
    )
  }
}

/** Refresh surviving aliases without reviving previews from suppressed mailbox records. */
export async function refreshChatRows(
  client: Pick<pg.Pool, 'query'>,
  instanceName: string,
  chatJids: string[],
  beforeMs?: number,
): Promise<void> {
  await client.query(
    `UPDATE app_chats SET
 last_message_id = (SELECT message_id FROM app_messages WHERE instance_name = $1 AND chat_jid = ANY($2::text[]) ORDER BY timestamp_ms DESC NULLS LAST, message_id DESC LIMIT 1),
 last_message_preview = (SELECT COALESCE(body, caption, type) FROM app_messages WHERE instance_name = $1 AND chat_jid = ANY($2::text[]) ORDER BY timestamp_ms DESC NULLS LAST, message_id DESC LIMIT 1),
 last_message_ts = (SELECT timestamp_ms FROM app_messages WHERE instance_name = $1 AND chat_jid = ANY($2::text[]) ORDER BY timestamp_ms DESC NULLS LAST, message_id DESC LIMIT 1),
 unread_count = CASE WHEN $3::bigint IS NULL OR EXISTS (SELECT 1 FROM app_messages WHERE instance_name = $1 AND chat_jid = ANY($2::text[]) AND timestamp_ms > $3) THEN unread_count ELSE 0 END,
 marked_as_unread = CASE WHEN $3::bigint IS NULL OR EXISTS (SELECT 1 FROM app_messages WHERE instance_name = $1 AND chat_jid = ANY($2::text[]) AND timestamp_ms > $3) THEN marked_as_unread ELSE false END,
 updated_at = now() WHERE instance_name = $1 AND chat_jid = ANY($2::text[])`,
    [instanceName, chatJids, beforeMs ?? null],
  )
}
