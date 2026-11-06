import { describe, expect, it } from 'vitest'
import type { WaIncomingNewsletterEvent, WaIncomingNewsletterMessageUpdateEvent } from 'zapo-js'
import { NewsletterNodeSchema } from '~/http/newsletter-schemas'
import {
  serializeAdmin,
  serializeDirectory,
  serializeFollowers,
  serializeNewsletter,
  serializeNewsletterEvent,
  serializeNewsletterMessageUpdate,
  serializeNewsletterNode,
  serializePublish,
} from '~/newsletters/serialize'
import { NEWSLETTER_JID, newsletterMetadata, newsletterPublishResult } from '../helpers/fake-newsletter'

describe('newsletter serializers', () => {
  it('whitelists metadata including nested pictures without exposing MEX internals', () => {
    const metadata = {
      ...newsletterMetadata,
      creationTime: 100,
      viewerRole: 'OWNER' as const,
      picture: { id: 'p', directPath: '/picture', secret: 'hidden' },
      thread_metadata: { secret: 'hidden' },
    }
    expect(serializeNewsletter(metadata)).toEqual({
      ...newsletterMetadata,
      creationTime: 100,
      viewerRole: 'OWNER',
      picture: { id: 'p', directPath: '/picture' },
    })
    expect(() => serializeNewsletter({ ...newsletterMetadata, jid: '' })).toThrow('Channel not found')
    expect(() => serializeNewsletter({ ...newsletterMetadata, state: 'NON_EXISTING' })).toThrow('Channel not found')
  })
  it('serializes directory pagination and follower profiles without extra properties', () => {
    const page = {
      results: [newsletterMetadata],
      pageInfo: { endCursor: 'next', hasNextPage: true },
      xwa2_newsletter: 'hidden',
    }
    expect(serializeDirectory(page)).toEqual({
      results: [newsletterMetadata],
      pageInfo: { endCursor: 'next', hasNextPage: true },
    })
    const followers = {
      followers: [
        { id: '111@lid', displayName: 'Name', adminProfile: { name: 'Admin', secret: 'hidden' }, hidden: true },
      ],
      secret: 'hidden',
    }
    expect(serializeFollowers(followers)).toEqual({
      followers: [{ id: '111@lid', displayName: 'Name', adminProfile: { name: 'Admin' } }],
    })
  })
  it('serializes capabilities as a sorted array and hides publish transport/upload internals', () => {
    expect(serializeAdmin({ adminCount: 2, adminProfile: null }, new Set(['B', 'A']))).toEqual({
      adminCount: 2,
      adminProfile: null,
      capabilities: ['A', 'B'],
    })
    const result = serializePublish({
      ...newsletterPublishResult,
      upload: { url: 'https://cdn.example.com/a', directPath: '/a', fileSha256: new Uint8Array(32), fileLength: 10 },
    })
    expect(result).toEqual({ id: 'CHANNEL01', attempts: 1, ack: { timestamp: '100', refreshLid: false } })
    expect(() => JSON.stringify(result)).not.toThrow()
  })
  it('serializes nested read envelopes, binary, text and empty nodes using the shared schema', () => {
    const result = serializeNewsletterNode({
      tag: 'iq',
      attrs: { type: 'result' },
      content: [
        { tag: 'bytes', attrs: {}, content: new Uint8Array([1, 2]) },
        { tag: 'text', attrs: {}, content: 'hello' },
        { tag: 'empty', attrs: {} },
      ],
    })
    expect(NewsletterNodeSchema.parse(result)).toEqual({
      name: 'iq',
      attributes: { type: 'result' },
      children: [
        { name: 'bytes', attributes: {}, bytesBase64: 'AQI=' },
        { name: 'text', attributes: {}, text: 'hello' },
        { name: 'empty', attributes: {} },
      ],
    })
  })
  it('serializes newsletter notifications without rawNode, nested objects or bigint', () => {
    const event: WaIncomingNewsletterEvent = {
      newsletterJid: NEWSLETTER_JID,
      action: 'subscribers_count_change',
      stanzaId: 'S1',
      offline: true,
      rawNode: { tag: 'notification', attrs: {} },
      details: {
        count: 12,
        name: 'News',
        enabled: true,
        absent: null,
        large: 9007199254740993n,
        nested: { proto: true },
        bytes: new Uint8Array(32),
      },
    }
    const result = serializeNewsletterEvent(event)
    expect(result).toEqual({
      jid: NEWSLETTER_JID,
      action: 'subscribers_count_change',
      stanzaId: 'S1',
      offline: true,
      details: { count: 12, name: 'News', enabled: true, absent: null, large: '9007199254740993' },
    })
    expect(() => JSON.stringify(result)).not.toThrow()
  })
  it.each([
    { kind: 'revoke' },
    { kind: 'reaction', isSender: true, revoked: false, reactions: [{ code: '🔥', count: 2 }] },
    { kind: 'counters', views: 12, forwards: 2, responses: 1 },
  ] as const)('preserves typed %s updates', (update) => {
    const event: WaIncomingNewsletterMessageUpdateEvent = {
      chatJid: NEWSLETTER_JID,
      rawNode: { tag: 'message', attrs: {} },
      parentMessageServerId: 42,
      timestampSeconds: 100,
      update,
    }
    expect(serializeNewsletterMessageUpdate(event)).toEqual({
      jid: NEWSLETTER_JID,
      serverId: 42,
      timestampSeconds: 100,
      update,
    })
  })
  it('projects edited content without plaintext/protobuf, even when it contains bigint', () => {
    const event: WaIncomingNewsletterMessageUpdateEvent = {
      chatJid: NEWSLETTER_JID,
      stanzaId: 'S1',
      rawNode: { tag: 'message', attrs: {} },
      update: {
        kind: 'edit',
        plaintext: new Uint8Array([8]),
        message: { conversation: 'Updated', messageContextInfo: { messageSecret: new Uint8Array(32) } },
      },
    }
    const result = serializeNewsletterMessageUpdate(event)
    expect(result.update).toEqual({
      kind: 'edit',
      content: { type: 'text', text: 'Updated', caption: null, mimetype: null, fileName: null },
    })
    expect(JSON.stringify(result)).not.toMatch(/plaintext|messageSecret|rawNode/)
  })
  it('encodes poll option hashes as base64', () => {
    const result = serializeNewsletterMessageUpdate({
      chatJid: NEWSLETTER_JID,
      rawNode: { tag: 'message', attrs: {} },
      update: { kind: 'poll_vote', isSender: false, votes: [{ optionHash: new Uint8Array(32), count: 3 }] },
    })
    expect(result.update).toEqual({
      kind: 'poll_vote',
      isSender: false,
      votes: [{ optionHash: Buffer.alloc(32).toString('base64'), count: 3 }],
    })
  })
})
