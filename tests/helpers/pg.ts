import pg from 'pg'
import { migrate } from '~/db/migrate'

/**
 * Real Postgres for store/repo integration tests.
 * Defaults to the docker-compose host port (5555) / database `zapo_test`.
 * Soft-skip pattern: `const pool = await tryCreateTestPool(); if (!pool) return`
 */
export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  process.env.DATABASE_URL?.replace(/\/[^/]+$/, '/zapo_test') ??
  'postgresql://zapo:zapo@127.0.0.1:5555/zapo_test'

/** One shared pool + one-time migrate for the whole vitest process. */
let sharedPool: pg.Pool | null = null
let initPromise: Promise<pg.Pool | null> | null = null

async function initSharedPool(): Promise<pg.Pool | null> {
  const pool = new pg.Pool({
    connectionString: TEST_DATABASE_URL,
    max: 8,
    connectionTimeoutMillis: 5_000,
  })
  try {
    await pool.query('SELECT 1')
    // Serialize DDL across workers / files
    const client = await pool.connect()
    try {
      await client.query('SELECT pg_advisory_lock($1)', [8_724_201])
      try {
        await migrate(pool)
      } finally {
        await client.query('SELECT pg_advisory_unlock($1)', [8_724_201])
      }
    } finally {
      client.release()
    }
    sharedPool = pool
    return pool
  } catch (err) {
    await pool.end().catch(() => undefined)
    console.warn('[tests/db] Postgres unavailable — skipping DB suite:', err instanceof Error ? err.message : err)
    return null
  }
}

export async function tryCreateTestPool(): Promise<pg.Pool | null> {
  if (sharedPool) return sharedPool
  if (!initPromise) initPromise = initSharedPool()
  return initPromise
}

/** Unique instance name per test file run. */
export function uniqueName(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`
}

export async function seedInstance(pool: pg.Pool, name: string, apiKey = `zr_${name}`): Promise<void> {
  await pool.query(
    `INSERT INTO instances (name, api_key, status)
     VALUES ($1, $2, 'open')
     ON CONFLICT (name) DO UPDATE SET api_key = EXCLUDED.api_key, status = 'open'`,
    [name, apiKey],
  )
}

export async function wipeInstance(pool: pg.Pool, name: string): Promise<void> {
  await pool.query(`DELETE FROM instances WHERE name = $1`, [name])
}

/** Do not call pool.end() from individual files — shared process pool. */
export async function closeSharedPool(): Promise<void> {
  if (sharedPool) {
    await sharedPool.end().catch(() => undefined)
    sharedPool = null
    initPromise = null
  }
}
