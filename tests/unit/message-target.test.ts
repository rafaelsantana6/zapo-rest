import { describe, expect, it, vi } from 'vitest'
import { proto, type WaStoredMessageRecord } from 'zapo-js'
import type { InstanceManager } from '~/instances/manager'
import { encryptedMessageParent, loadMessageTarget } from '~/lib/message-target'
import type { LidMapStore } from '~/store/lid-map'
import type { AppMessage, MessageStore } from '~/store/messages'

const GROUP = '120363000000000@g.us'
const PN = '5511999999999@s.whatsapp.net'
const LID = '222222222@lid'
const SECRET = new Uint8Array(32).fill(7)

function fakeTargetDeps() {
  const messages = { get: vi.fn(async (): Promise<AppMessage | null> => null) }
  const mailbox = { getById: vi.fn(async (): Promise<WaStoredMessageRecord | null> => null) }
  const messageSecret = { get: vi.fn(async (): Promise<{ secret: Uint8Array; senderJid: string } | null> => null) }
  const manager = { getMessageStores: vi.fn(() => ({ messages: mailbox, messageSecret })) }
  const lidMap = { expandAliases: vi.fn(async (_name: string, jid: string) => [jid]) }
  return {
    deps: {
      messages: messages as unknown as MessageStore,
      manager: manager as unknown as InstanceManager,
      lidMap: lidMap as unknown as LidMapStore,
    },
    messages,
    mailbox,
    messageSecret,
    lidMap,
  }
}

function fakeStoredMessage(remoteJid = PN, remoteJidAlt?: string): AppMessage {
  return {
    messageId: 'ORIGINAL',
    chatJid: remoteJid,
    fromMe: false,
    raw: { key: { id: 'ORIGINAL', remoteJid, remoteJidAlt, fromMe: false } },
  } as AppMessage
}

describe('stored message targets', () => {
  it('accepts the explicit alternate JID of a stored chat', async () => {
    const fake = fakeTargetDeps()
    fake.messages.get.mockResolvedValue(fakeStoredMessage(PN, LID))
    const original = await loadMessageTarget(fake.deps, { instanceName: 'sales', messageId: 'ORIGINAL', jid: LID })
    expect(original.target.remoteJid).toBe(PN)
    expect(fake.lidMap.expandAliases).not.toHaveBeenCalled()
  })

  it('accepts an alias known by this instance when the original has no cross-reference', async () => {
    const fake = fakeTargetDeps()
    fake.messages.get.mockResolvedValue(fakeStoredMessage())
    fake.lidMap.expandAliases.mockResolvedValue([PN, LID])
    const original = await loadMessageTarget(fake.deps, { instanceName: 'sales', messageId: 'ORIGINAL', jid: LID })
    expect(original.target.remoteJid).toBe(PN)
    expect(fake.lidMap.expandAliases).toHaveBeenCalledWith('sales', LID)
  })

  it('rejects a different chat even after expanding its aliases', async () => {
    const fake = fakeTargetDeps()
    fake.messages.get.mockResolvedValue(fakeStoredMessage())
    fake.lidMap.expandAliases.mockResolvedValue([LID, '5555000000000@s.whatsapp.net'])
    await expect(
      loadMessageTarget(fake.deps, { instanceName: 'sales', messageId: 'ORIGINAL', jid: LID }),
    ).rejects.toMatchObject({ statusCode: 400 })
  })

  it.each(['event', 'poll'] as const)(
    'recovers a received group %s author from mailbox senderJid with a cold cache',
    async (kind) => {
      const fake = fakeTargetDeps()
      fake.mailbox.getById.mockResolvedValue({
        id: 'ORIGINAL',
        threadJid: GROUP,
        senderJid: LID,
        fromMe: false,
        messageBytes: proto.Message.encode({
          ...(kind === 'event' ? { eventMessage: { name: 'Sync' } } : { pollCreationMessageV3: { name: 'Lunch?' } }),
          messageContextInfo: { messageSecret: SECRET },
        }).finish(),
      })
      const original = await loadMessageTarget(fake.deps, { instanceName: 'sales', messageId: 'ORIGINAL', jid: GROUP })
      expect(original.target.participant).toBe(LID)
      expect(encryptedMessageParent(original, kind)).toEqual({
        id: 'ORIGINAL',
        fromMe: false,
        participant: LID,
        authorJid: LID,
        messageSecret: SECRET,
      })
    },
  )

  it('does not treat the peer as the author of our own DM recovered from history', async () => {
    const fake = fakeTargetDeps()
    fake.mailbox.getById.mockResolvedValue({
      id: 'ORIGINAL',
      threadJid: PN,
      senderJid: PN,
      fromMe: true,
      messageBytes: proto.Message.encode({
        pollCreationMessageV3: { name: 'Lunch?' },
        messageContextInfo: { messageSecret: SECRET },
      }).finish(),
    })
    const original = await loadMessageTarget(fake.deps, { instanceName: 'sales', messageId: 'ORIGINAL', jid: PN })
    expect(original.authorJid).toBeUndefined()
    expect(() => encryptedMessageParent(original, 'poll')).toThrowError(/secret or author/)
  })

  it.each([PN, LID])(
    'rejects the peer %s cached as author of our own DM, including known aliases',
    async (cachedSender) => {
      const fake = fakeTargetDeps()
      fake.mailbox.getById.mockResolvedValue({
        id: 'ORIGINAL',
        threadJid: PN,
        senderJid: PN,
        fromMe: true,
        messageBytes: proto.Message.encode({
          pollCreationMessageV3: { name: 'Lunch?' },
          messageContextInfo: { messageSecret: SECRET },
        }).finish(),
      })
      fake.messageSecret.get.mockResolvedValue({ secret: SECRET, senderJid: cachedSender })
      fake.lidMap.expandAliases.mockResolvedValue([PN, LID])
      const original = await loadMessageTarget(fake.deps, { instanceName: 'sales', messageId: 'ORIGINAL', jid: PN })
      expect(original.authorJid).toBeUndefined()
      expect(() => encryptedMessageParent(original, 'poll')).toThrowError(/secret or author/)
    },
  )

  it('keeps a proven self author when it differs from every known peer alias', async () => {
    const fake = fakeTargetDeps()
    fake.messages.get.mockResolvedValue({
      ...fakeStoredMessage(),
      type: 'poll',
      fromMe: true,
      raw: { key: { id: 'ORIGINAL', remoteJid: PN, fromMe: true } },
    })
    fake.messageSecret.get.mockResolvedValue({ secret: SECRET, senderJid: '888888888@lid' })
    fake.lidMap.expandAliases.mockResolvedValue([PN, LID])
    const original = await loadMessageTarget(fake.deps, { instanceName: 'sales', messageId: 'ORIGINAL', jid: PN })
    expect(encryptedMessageParent(original, 'poll').authorJid).toBe('888888888@lid')
  })

  it.each([GROUP, 'status@broadcast', '123@newsletter'])(
    'refuses a non-user author %s for encrypted parents',
    (authorJid) => {
      expect(() =>
        encryptedMessageParent(
          {
            target: { id: 'ORIGINAL', fromMe: false, remoteJid: GROUP },
            message: { eventMessage: { name: 'Sync' } },
            secret: SECRET,
            authorJid,
          },
          'event',
        ),
      ).toThrowError(/secret or author/)
    },
  )
})
