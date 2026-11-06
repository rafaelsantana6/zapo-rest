import { describe, expect, it } from 'vitest'
import { GroupMembershipRequestSchema } from '~/http/openapi-schemas'
import { serializeMembershipRequest, throwMembershipError } from '~/lib/group-membership'

describe('membership request serializer', () => {
  it('serializes every upstream field and converts seconds to ISO', () => {
    const result = serializeMembershipRequest({
      jid: '111@lid',
      requestor: '111@lid',
      requestorPhone: '5511999999999@s.whatsapp.net',
      requestorUsername: 'someone',
      parentGroupJid: '120363111@g.us',
      requestTime: 1793966400,
      requestMethod: 'invite_link',
    })
    expect(GroupMembershipRequestSchema.parse(result)).toEqual({
      jid: '111@lid',
      requestor: '111@lid',
      phoneNumber: '5511999999999@s.whatsapp.net',
      requestorUsername: 'someone',
      parentGroupJid: '120363111@g.us',
      requestedAt: '2026-11-06T12:00:00.000Z',
      method: 'invite_link',
    })
  })

  it('omits absent optional fields from JSON and preserves the upstream zero timestamp', () => {
    const result = serializeMembershipRequest({ jid: '111@lid', requestTime: 0 })
    expect(JSON.parse(JSON.stringify(result))).toEqual({ jid: '111@lid', requestedAt: '1970-01-01T00:00:00.000Z' })
  })
})

describe('membership error mapping', () => {
  it.each([
    ['not an admin', 403],
    ['membership_approval_mode is off', 409],
    ['group.membershipRequests iq failed (503: service-unavailable)', 503],
  ])('maps %s without losing the message', (message, statusCode) => {
    expect(() => throwMembershipError(new Error(message))).toThrow(expect.objectContaining({ message, statusCode }))
  })

  it('does not hide unexpected upstream failures', () => {
    const error = new Error('unexpected failure')
    expect(() => throwMembershipError(error)).toThrow(error)
  })
})
