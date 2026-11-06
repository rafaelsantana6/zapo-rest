import type { Pool, PoolClient } from 'pg'
import { getLogger } from '~/lib/logger'
import type { MediaStorage } from '~/media/storage'

const log = getLogger({ component: 'instance-wipe' })

/**
 * App tables keyed by `instance_name` that must be wiped with the instance.
 * Tables with `REFERENCES instances(name) ON DELETE CASCADE` are still deleted
 * explicitly so wipe works even if an older schema is missing FKs.
 */
const APP_INSTANCE_TABLES = [
  'webhook_outbox',
  'processed_events',
  'app_label_chats',
  'app_labels',
  'app_messages',
  'app_chats',
  'app_contacts',
  'contact_avatars',
  'media_objects',
  'lid_map',
  'app_calls',
  'instance_webhooks',
  'app_chat_actions',
  'app_message_actions',
  'app_state_projection_cursors',
] as const

export type InstanceWipeReport = {
  instanceName: string
  appRows: Record<string, number>
  zapoRows: Record<string, number>
  mediaDeleted: number
  instanceDeleted: boolean
}

/**
 * Full wipe of one instance:
 * 1. App projections / outbox / webhooks (`instance_name`)
 * 2. zapo-js postgres protocol tables (`session_id` = instance name)
 * 3. `instances` row
 * 4. Object storage prefix `{instance}/…` (CAS + avatars)
 *
 * Order: disconnect/logout is the caller's responsibility (manager.delete).
 */
export async function wipeInstanceCompletely(
  pool: Pool,
  instanceName: string,
  opts?: { mediaStorage?: MediaStorage | null },
): Promise<InstanceWipeReport> {
  const client = await pool.connect()
  const appRows: Record<string, number> = {}
  const zapoRows: Record<string, number> = {}
  let instanceDeleted = false

  try {
    await client.query('BEGIN')

    // ── App tables (instance_name) ──────────────────────────────────────────
    for (const table of APP_INSTANCE_TABLES) {
      if (!(await tableExists(client, table))) continue
      if (!(await columnExists(client, table, 'instance_name'))) continue
      const n = await deleteWhere(client, table, 'instance_name', instanceName)
      if (n > 0) appRows[table] = n
    }

    // ── zapo protocol / mailbox (session_id) ────────────────────────────────
    const sessionTables = await listTablesWithColumn(client, 'session_id')
    for (const table of sessionTables) {
      // Never touch app tables that might share a column name (none today)
      if ((APP_INSTANCE_TABLES as readonly string[]).includes(table) || table === 'instances') continue
      const n = await deleteWhere(client, table, 'session_id', instanceName)
      if (n > 0) zapoRows[table] = n
    }

    // ── instances row (also cascades any remaining FKs) ─────────────────────
    const inst = await client.query('DELETE FROM instances WHERE name = $1', [instanceName])
    instanceDeleted = (inst.rowCount ?? 0) > 0

    await client.query('COMMIT')
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined)
    throw err
  } finally {
    client.release()
  }

  // ── Object storage (outside TX — external system) ─────────────────────────
  let mediaDeleted = 0
  if (opts?.mediaStorage) {
    try {
      const res = await opts.mediaStorage.deleteInstance(instanceName)
      mediaDeleted = res.deleted
    } catch (err) {
      log.warn({ err, instanceName }, 'media purge failed during instance wipe')
    }
  }

  log.info(
    {
      instanceName,
      instanceDeleted,
      appRows,
      zapoRows,
      mediaDeleted,
    },
    'instance wipe complete',
  )

  return {
    instanceName,
    appRows,
    zapoRows,
    mediaDeleted,
    instanceDeleted,
  }
}

async function tableExists(client: PoolClient, table: string): Promise<boolean> {
  const { rows } = await client.query<{ exists: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM information_schema.tables
       WHERE table_schema = 'public' AND table_name = $1
     ) AS exists`,
    [table],
  )
  return Boolean(rows[0]?.exists)
}

async function columnExists(client: PoolClient, table: string, column: string): Promise<boolean> {
  const { rows } = await client.query<{ exists: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = $1 AND column_name = $2
     ) AS exists`,
    [table, column],
  )
  return Boolean(rows[0]?.exists)
}

async function listTablesWithColumn(client: PoolClient, column: string): Promise<string[]> {
  const { rows } = await client.query<{ table_name: string }>(
    `SELECT c.table_name
     FROM information_schema.columns c
     JOIN information_schema.tables t
       ON t.table_schema = c.table_schema AND t.table_name = c.table_name
     WHERE c.table_schema = 'public'
       AND c.column_name = $1
       AND t.table_type = 'BASE TABLE'
     ORDER BY c.table_name`,
    [column],
  )
  return rows.map((r) => r.table_name)
}

/** Safe identifier: only allow known/discovered public table names (alphanumeric + _). */
async function deleteWhere(
  client: PoolClient,
  table: string,
  column: 'instance_name' | 'session_id',
  value: string,
): Promise<number> {
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(table)) {
    throw new Error(`refusing to wipe unsafe table name: ${table}`)
  }
  const res = await client.query(`DELETE FROM "${table}" WHERE ${column} = $1`, [value])
  return res.rowCount ?? 0
}
