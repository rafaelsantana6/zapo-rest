import { EventEmitter } from 'node:events'
import type pg from 'pg'
import { describe, expect, it, vi } from 'vitest'
import { parseEnv, resetEnvCache } from '~/config/env'
import { realtimeBus } from '~/events/bus'
import { InstanceManager } from '~/instances/manager'
import { sanitizeForWebhook, WebhookDispatcher } from '~/webhooks/dispatcher'
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

async function wiredCommunityManager<T extends Pick<WebhookDispatcher, 'emit'>>(webhooks: T) {
  resetEnvCache()
  const repo = new MemoryInstanceRepo()
  repo.seed({ name: 'community-events', apiKey: 'zr_test', status: 'open' })
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
  it.each(['link', 'unlink'])('publishes %s through the real dispatcher to the SSE bus', async (action) => {
    resetEnvCache()
    const dispatcher = new WebhookDispatcher({ env: parseEnv() })
    const { client } = await wiredCommunityManager(dispatcher)
    const seen: unknown[] = []
    const unsubscribe = realtimeBus.onInstance('community-events', (event) => seen.push(event))
    const notification = {
      action,
      groupJid: COMMUNITY_JID,
      contextGroupJid: COMMUNITY_JID,
      linkedGroups: [
        { jid: SUBGROUP_JID, subject: 'Linked group', subjectTimestampSeconds: 123, hiddenSubgroup: true },
      ],
      rawNode: { tag: 'notification', attrs: {} },
    }
    try {
      client.emit('group', notification)
      await vi.waitFor(() => expect(seen).toHaveLength(1))
      expect(seen[0]).toMatchObject({
        event: 'group.update',
        instance: 'community-events',
        eventId: expect.any(String),
        timestamp: expect.any(String),
        data: {
          action,
          groupJid: COMMUNITY_JID,
          contextGroupJid: COMMUNITY_JID,
          linkedGroups: notification.linkedGroups,
        },
      })
      expect(seen[0]).not.toHaveProperty('data.rawNode')
    } finally {
      unsubscribe()
    }
  })

  it.each(['link', 'unlink', 'linked_group_promote', 'linked_group_demote'])(
    'preserves %s community notification fields',
    async (action) => {
      const { client, webhooks } = await wiredCommunityManager(recordingCommunityWebhooks())
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
