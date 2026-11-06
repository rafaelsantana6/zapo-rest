import type pg from 'pg'
import { describe, expect, it, vi } from 'vitest'
import { MessageStore } from '~/store/messages'
import { tryCreateTestPool, uniqueName } from '../helpers/pg'

/** Bind a store to a real connection so the test can observe its transaction waiting. */
function connectionPool(client: pg.PoolClient): pg.Pool {
  const query = client.query.bind(client)
  return { query, connect: async () => ({ query, release: () => undefined }) } as unknown as pg.Pool
}

async function expectAdvisoryWait(observer: pg.PoolClient, pid: number): Promise<void> {
  await vi.waitFor(
    async () => {
      const { rows } = await observer.query<{ wait_event: string }>(
        'SELECT wait_event FROM pg_stat_activity WHERE pid = $1',
        [pid],
      )
      expect(rows[0]?.wait_event).toBe('advisory')
    },
    { timeout: 3000, interval: 10 },
  )
}

const pool = await tryCreateTestPool()
describe.runIf(pool)('concurrent chat action projection (Postgres)', () => {
  const db = pool as pg.Pool
  it('serializes an in-flight old-message insert before clear and removes it', async () => {
    const schema = uniqueName('chat_race')
    const instanceName = uniqueName('chat_race_instance')
    const gate = 98165724
    const first = await db.connect()
    const second = await db.connect()
    const blocker = await db.connect()
    let inserting: Promise<unknown> | undefined
    let clearing: Promise<unknown> | undefined
    try {
      await first.query(`CREATE SCHEMA "${schema}"`)
      for (const table of ['app_messages', 'app_chat_actions', 'app_message_actions', 'lid_map', 'app_chats']) {
        await first.query(`CREATE TABLE "${schema}".${table} (LIKE ${table} INCLUDING ALL)`)
      }
      await first.query(`SET search_path TO "${schema}", public`)
      await second.query(`SET search_path TO "${schema}", public`)
      await first.query(`CREATE FUNCTION pause_message_insert() RETURNS trigger LANGUAGE plpgsql AS $$
 BEGIN PERFORM pg_advisory_xact_lock(${gate}); RETURN NEW; END $$`)
      await first.query(
        'CREATE TRIGGER pause_message_insert BEFORE INSERT ON app_messages FOR EACH ROW EXECUTE FUNCTION pause_message_insert()',
      )
      await blocker.query('SELECT pg_advisory_lock($1)', [gate])
      const firstPid = (await first.query<{ pid: number }>('SELECT pg_backend_pid() AS pid')).rows[0]?.pid
      const secondPid = (await second.query<{ pid: number }>('SELECT pg_backend_pid() AS pid')).rows[0]?.pid
      if (!firstPid || !secondPid) throw new Error('expected database connection ids')
      const importer = new MessageStore(connectionPool(first))
      const actions = new MessageStore(connectionPool(second))
      inserting = importer.upsert({ instanceName, chatJid: '123@lid', messageId: 'old', timestampMs: 1000 })
      await expectAdvisoryWait(blocker, firstPid)
      clearing = actions.clearChat(instanceName, ['123@lid'], { deleteStarred: true, beforeMs: 2000 })
      await expectAdvisoryWait(blocker, secondPid)
      await blocker.query('SELECT pg_advisory_unlock($1)', [gate])
      await Promise.all([inserting, clearing])
      expect(await actions.get(instanceName, 'old')).toBeNull()
      expect(await actions.upsert({ instanceName, chatJid: '123@lid', messageId: 'old', timestampMs: 1000 })).toBeNull()
    } finally {
      await blocker.query('SELECT pg_advisory_unlock($1)', [gate])
      await Promise.allSettled([inserting, clearing])
      await first.query('SET search_path TO public')
      await second.query('SET search_path TO public')
      await first.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`)
      first.release()
      second.release()
      blocker.release()
    }
  })
})
