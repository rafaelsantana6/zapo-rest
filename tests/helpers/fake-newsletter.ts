import { vi } from 'vitest'
import type { BinaryNode, WaClient, WaMessagePublishResult } from 'zapo-js'

export const NEWSLETTER_JID = '1234567890@newsletter'
export const newsletterMetadata: Awaited<ReturnType<WaClient['newsletter']['fetch']>> = {
  jid: NEWSLETTER_JID,
  state: 'ACTIVE',
  name: 'Announcements',
  subscribersCount: 12,
}
export const newsletterPublishResult: WaMessagePublishResult = {
  id: 'CHANNEL01',
  attempts: 1,
  ack: { refreshLid: false, t: '100' },
  ackNode: { tag: 'ack', attrs: {} },
}
export const newsletterPage: BinaryNode = {
  tag: 'iq',
  attrs: { type: 'result' },
  content: [{ tag: 'messages', attrs: {}, content: new Uint8Array([1, 2, 3]) }],
}

/** Named fake for every coordinator operation exposed by the REST area. */
export function fakeNewsletterClient() {
  const newsletter = {
    listSubscribed: vi.fn(async () => [newsletterMetadata]),
    fetch: vi.fn(async (_jid: string) => newsletterMetadata),
    fetchByInvite: vi.fn(async (_code: string) => newsletterMetadata),
    searchDirectory: vi.fn(async (_options: unknown) => ({
      results: [newsletterMetadata],
      pageInfo: { hasNextPage: true, endCursor: 'next' },
    })),
    fetchRecommended: vi.fn(async (_options: unknown) => [newsletterMetadata]),
    fetchMessages: vi.fn(async (_input: unknown) => newsletterPage),
    fetchMessageUpdates: vi.fn(async (_input: unknown) => newsletterPage),
    follow: vi.fn(async (_jid: string) => undefined),
    unfollow: vi.fn(async (_jid: string) => undefined),
    mute: vi.fn(async (_input: unknown) => undefined),
    subscribeLiveUpdates: vi.fn(async (_jid: string) => ({ durationSeconds: 120 })),
    react: vi.fn(async (_input: unknown) => ({ stanzaId: 'REACTION01' })),
    votePoll: vi.fn(async (_input: unknown) => ({ stanzaId: 'VOTE01' })),
    sendViewReceipt: vi.fn(async (_input: unknown) => ({ stanzaId: 'VIEW01' })),
    create: vi.fn(async (_input: unknown) => newsletterMetadata),
    update: vi.fn(async (_jid: string, _input: unknown) => newsletterMetadata),
    delete: vi.fn(async (_jid: string) => undefined),
    fetchAdminInfo: vi.fn(async (_jid: string) => ({ adminCount: 2, adminProfile: { name: 'Admin' } })),
    fetchAdminCapabilities: vi.fn(async (_jid: string) => new Set(['ADMIN_PROFILE'] as const)),
    fetchFollowers: vi.fn(async (_jid: string, _options: unknown) => ({
      followers: [{ id: '111@lid', displayName: 'Follower', adminProfile: null }],
    })),
    createAdminInvite: vi.fn(async (_input: unknown) => ({ inviteId: 'INVITE01', expirationTime: 300 })),
    acceptAdminInvite: vi.fn(async (_jid: string) => undefined),
    revokeAdminInvite: vi.fn(async (_input: unknown) => undefined),
    demoteAdmin: vi.fn(async (_input: unknown) => undefined),
    changeOwner: vi.fn(async (_input: unknown) => undefined),
    fetchPendingInvites: vi.fn(async (_jid: string) => ['111@lid']),
    send: vi.fn(async (_jid: string, _content: unknown) => newsletterPublishResult),
    editMessage: vi.fn(async (_jid: string, _id: string, _content: unknown) => newsletterPublishResult),
    revoke: vi.fn(async (_input: unknown) => ({ stanzaId: 'REVOKE01' })),
  } satisfies Partial<WaClient['newsletter']>
  const profile = {
    getLidsByPhoneNumbers: vi.fn(async (phones: string[]) =>
      phones.map((phoneJid) => ({ phoneJid, exists: true, lidJid: null, status: 'in' })),
    ),
    resolveUsername: vi.fn(async (_options: unknown) => ({ status: 'found', jid: '111@lid' })),
  }
  return { newsletter, profile }
}
