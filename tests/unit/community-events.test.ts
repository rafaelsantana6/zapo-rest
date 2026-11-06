import { EventEmitter } from 'node:events'
import type pg from 'pg'
import { describe, expect, it, vi } from 'vitest'
import { parseEnv, resetEnvCache } from '~/config/env'
import { InstanceManager } from '~/instances/manager'
import { sanitizeForWebhook, type WebhookDispatcher } from '~/webhooks/dispatcher'
import { COMMUNITY_JID, SUBGROUP_JID } from '../helpers/community-client'
import { MemoryInstanceRepo } from '../helpers/memory-repo'

function recordingCommunityWebhooks() {
  return { emit: vi.fn(async (_row: unknown, _event: string, _payload: unknown) => undefined) }
}
function fakeCommunityEventPool() {
  return { query: async () => ({ rows: [], rowCount: 0 }) } as unknown as pg.Pool
}
function fakeCommunityEventClient() {
  return new EventEmitter()
}

async function wiredCommunityManager() {
  resetEnvCache()
  const repo = new MemoryInstanceRepo()
  repo.seed({ name: 'community-events', apiKey: 'zr_test', status: 'open' })
  const webhooks = recordingCommunityWebhooks()
  const manager = new InstanceManager({
    env: parseEnv(),
    pool: fakeCommunityEventPool(),
    // @ts-expect-error memory repo is compatible with dryRun
    repo,
    webhooks: webhooks as unknown as WebhookDispatcher,
    dryRun: true,
  })
  const client = fakeCommunityEventClient()
  const wire = (manager as unknown as { wireEvents: (name: string, session: unknown) => void }).wireEvents
  wire.call(manager, 'community-events', { client, reconnectAttempt: 0, reconnectTimer: null, disposed: false })
  return { client, webhooks }
}

describe('community group.update forwarding', () => {
  it.each(['link', 'unlink', 'linked_group_promote', 'linked_group_demote'])(
    'preserves %s community notification fields',
    async (action) => {
      const { client, webhooks } = await wiredCommunityManager()
      const event = {
        action,
        groupJid: COMMUNITY_JID,
        contextGroupJid: COMMUNITY_JID,
        linkedGroups: [
          { jid: SUBGROUP_JID, subject: 'Linked group', subjectTimestampSeconds: 123, hiddenSubgroup: true },
        ],
        rawActionNode: { tag: action, attrs: {}, content: [] },
      }
      client.emit('group', event)
      await vi.waitFor(() => expect(webhooks.emit).toHaveBeenCalledOnce())
      expect(webhooks.emit.mock.calls[0]?.slice(1)).toEqual(['group.update', event])
      expect(JSON.parse(JSON.stringify(sanitizeForWebhook(webhooks.emit.mock.calls[0]?.[2])))).toEqual(event)
    },
  )
})
