import { describe, expect, it } from 'vitest'
import { GroupMetadataSchema } from '~/http/openapi-schemas'
import { normalizeGroupJid, serializeGroupMetadata } from '~/lib/group-metadata'
import { COMMUNITY_JID, communityMetadata, SUBGROUP_JID } from '../helpers/community-client'

describe('shared group metadata serializer', () => {
  it('preserves community flags, parent JID and participant identities through the HTTP schema', () => {
    const metadata = communityMetadata({
      jid: SUBGROUP_JID,
      linkedParentJid: COMMUNITY_JID,
      isParentGroup: false,
      isClosedCommunity: true,
      defaultSubgroup: true,
      generalSubgroup: true,
      hiddenSubgroup: true,
      desc: 'Description',
      memberAddMode: 'admin_add',
    })
    const serialized = serializeGroupMetadata(metadata)
    expect(serialized).toEqual(metadata)
    expect(GroupMetadataSchema.parse(serialized)).toEqual(metadata)
    expect(serialized.participants).not.toBe(metadata.participants)
  })

  it.each(['120363000000000000', COMMUNITY_JID])('normalizes group id %s consistently', (id) => {
    expect(normalizeGroupJid(id)).toBe(COMMUNITY_JID)
  })
})
