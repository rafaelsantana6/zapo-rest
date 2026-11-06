import { EventEmitter } from 'node:events'
import type pg from 'pg'
import type { WaGroupEvent } from 'zapo-js'
import { describe, expect, it, vi } from 'vitest'
import { parseEnv, resetEnvCache } from '~/config/env'
import { InstanceManager } from '~/instances/manager'
import type { WebhookDispatcher } from '~/webhooks/dispatcher'
import { MemoryInstanceRepo } from '../helpers/memory-repo'

/** Named fake: records webhook emits instead of delivering them. */
function recordingWebhooks() {
  return { emit: vi.fn(async (_row: unknown, _event: string, _data: unknown) => undefined) }
}

async function wiredManager() {
  resetEnvCache()
  const repo = new MemoryInstanceRepo()
  repo.seed({ name: 'sales-1', apiKey: 'zr_test', status: 'open' })
  const webhooks = recordingWebhooks()
  const manager = new InstanceManager({
    env: parseEnv(),
    pool: { query: async () => ({ rows: [], rowCount: 0 }) } as unknown as pg.Pool,
    // @ts-expect-error memory repo
    repo,
    webhooks: webhooks as unknown as WebhookDispatcher,
    dryRun: true,
  })
  const client = new EventEmitter()
  const wire = (manager as unknown as { wireEvents: (name: string, session: unknown) => void }).wireEvents
  wire.call(manager, 'sales-1', { client, reconnectAttempt: 0, reconnectTimer: null, disposed: false })
  return { client, webhooks }
}

function fakeGroupModeEvent(mode: string) {
  const groupJid = '12036@g.us'
  const rawActionNode = { tag: 'member_add_mode', attrs: {}, content: Buffer.from(mode) }
  const rawNode = { tag: 'notification', attrs: { from: groupJid, type: 'w:gp2' }, content: [rawActionNode] }
  return { action: 'member_add_mode', groupJid, mode, rawNode, rawActionNode } satisfies WaGroupEvent
}

describe('group mode events', () => {
  it.each(['admin_add', 'all_member_add'])(
    'forwards phone member_add_mode %s as group.update with REST names',
    async (mode) => {
      const { client, webhooks } = await wiredManager()
      const event = fakeGroupModeEvent(mode)
      client.emit('group', event)
      await vi.waitFor(() =>
        expect(webhooks.emit).toHaveBeenCalledExactlyOnceWith(
          expect.objectContaining({ name: 'sales-1' }),
          'group.update',
          { ...event, memberAddMode: mode },
        ),
      )
    },
  )
})
