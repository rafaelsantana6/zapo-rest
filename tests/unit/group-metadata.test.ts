import { describe, expect, it } from 'vitest'
import { serializeGroupEvent, serializeGroupMetadata } from '~/groups/metadata'

describe('group metadata serializer', () => {
  it.each([
    ['admin_add', 'admin_link', 'admin_share'],
    ['all_member_add', 'all_member_link', 'all_member_share'],
  ])('exposes %s, %s and %s without losing upstream metadata', (memberAddMode, memberLinkMode, historyShareMode) => {
    const group = {
      jid: '12036@g.us',
      subject: 'Modes',
      participants: [],
      memberAddMode,
      memberLinkMode,
      memberShareGroupHistoryMode: historyShareMode,
    }
    expect(serializeGroupMetadata(group)).toEqual({ ...group, historyShareMode })
  })

  it('does not invent defaults for missing upstream modes', () => {
    expect(JSON.parse(JSON.stringify(serializeGroupMetadata({ memberAddMode: undefined })))).toEqual({})
  })

  it('omits modes outside the public enums', () => {
    const result = serializeGroupMetadata({
      memberAddMode: 'future',
      memberLinkMode: 'future',
      memberShareGroupHistoryMode: 'future',
    })
    expect(result.memberAddMode).toBeUndefined()
    expect(result.memberLinkMode).toBeUndefined()
    expect(result.historyShareMode).toBeUndefined()
  })
})

const rawNode = { tag: 'notification', attrs: {}, content: [] }
const rawActionNode = { tag: 'member_add_mode', attrs: {}, content: [] }

describe('group event serializer', () => {
  it.each(['admin_add', 'all_member_add'])('adds the REST memberAddMode field for %s', (mode) => {
    const event = { action: 'member_add_mode' as const, groupJid: '12036@g.us', mode, rawNode, rawActionNode }
    expect(serializeGroupEvent(event)).toEqual({ ...event, memberAddMode: mode })
  })

  it('preserves unrelated group events', () => {
    const event = { action: 'subject' as const, groupJid: '12036@g.us', subject: 'New subject', rawNode, rawActionNode }
    expect(serializeGroupEvent(event)).toBe(event)
  })
})
