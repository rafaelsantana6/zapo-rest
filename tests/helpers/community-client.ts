import { type Mock, vi } from 'vitest'
import type { WaGroupCoordinator, WaGroupMetadata } from 'zapo-js'

export const COMMUNITY_JID = '120363000000000000@g.us'
export const SUBGROUP_JID = '120363000000000001@g.us'

export function communityMetadata(overrides: Partial<WaGroupMetadata> = {}): WaGroupMetadata {
  return {
    jid: COMMUNITY_JID,
    subject: 'Community',
    restrict: false,
    announce: false,
    isParentGroup: true,
    isClosedCommunity: false,
    defaultSubgroup: false,
    generalSubgroup: false,
    hiddenSubgroup: false,
    allowNonAdminSubGroupCreation: true,
    membershipApprovalEnabled: true,
    noFrequentlyForwarded: false,
    support: false,
    suspended: false,
    incognito: false,
    allowAdminReports: false,
    autoAddDisabled: false,
    groupHistory: false,
    capi: false,
    groupSafetyCheck: false,
    participantLabelEnabled: false,
    limitSharingEnabled: false,
    participants: [
      { jid: '111@lid', type: 'superadmin', isAdmin: true, isSuperAdmin: true, phoneNumber: '5511999999999' },
    ],
    ...overrides,
  }
}

type FakeCommunityGroup = {
  [Method in
    | 'queryGroupMetadata'
    | 'queryAllGroups'
    | 'createCommunity'
    | 'deactivateCommunity'
    | 'fetchSubGroups'
    | 'queryLinkedGroupsParticipants'
    | 'fetchSubgroupSuggestions'
    | 'linkSubGroups'
    | 'unlinkSubGroups'
    | 'joinLinkedGroup'
    | 'transferCommunityOwnership']: Mock<WaGroupCoordinator[Method]>
}

/** Named fake: parent metadata, partial link failures, and deterministic community reads. */
export function fakeCommunityClient(): { group: FakeCommunityGroup; profile: ReturnType<typeof fakeCommunityProfile> } {
  const metadata = communityMetadata()
  const subGroup = {
    jid: SUBGROUP_JID,
    subject: 'Sub-group',
    defaultSubgroup: false,
    generalSubgroup: true,
    hiddenSubgroup: false,
    membershipApprovalEnabled: true,
    pendingMembershipRequests: 2,
  }
  const group = {
    queryGroupMetadata: vi.fn<WaGroupCoordinator['queryGroupMetadata']>(async (jid) => {
      if (jid === '999@g.us') throw new Error('group.metadata iq failed (404: item-not-found)')
      return jid === SUBGROUP_JID
        ? communityMetadata({ jid, isParentGroup: false, linkedParentJid: COMMUNITY_JID })
        : metadata
    }),
    queryAllGroups: vi.fn<WaGroupCoordinator['queryAllGroups']>(async () => [
      metadata,
      communityMetadata({ jid: SUBGROUP_JID, isParentGroup: false, linkedParentJid: COMMUNITY_JID }),
    ]),
    createCommunity: vi.fn<WaGroupCoordinator['createCommunity']>(async () => metadata),
    deactivateCommunity: vi.fn<WaGroupCoordinator['deactivateCommunity']>(async () => undefined),
    fetchSubGroups: vi.fn<WaGroupCoordinator['fetchSubGroups']>(async () => ({
      communityJid: COMMUNITY_JID,
      announcementGroup: { ...subGroup, defaultSubgroup: true, generalSubgroup: false },
      subGroups: [subGroup],
    })),
    queryLinkedGroupsParticipants: vi.fn<WaGroupCoordinator['queryLinkedGroupsParticipants']>(
      async () => metadata.participants,
    ),
    fetchSubgroupSuggestions: vi.fn<WaGroupCoordinator['fetchSubgroupSuggestions']>(async () => [
      {
        jid: SUBGROUP_JID,
        subject: null,
        description: null,
        creator: null,
        creationTime: null,
        participantCount: null,
        isExistingGroup: true,
        hiddenGroup: false,
      },
    ]),
    linkSubGroups: vi.fn<WaGroupCoordinator['linkSubGroups']>(async () => ({
      linkedJids: [SUBGROUP_JID],
      failed: [{ jid: '888@g.us', error: 403 }],
    })),
    unlinkSubGroups: vi.fn<WaGroupCoordinator['unlinkSubGroups']>(async () => ({
      unlinkedJids: [SUBGROUP_JID],
      failed: [{ jid: '888@g.us', error: 404 }],
    })),
    joinLinkedGroup: vi.fn<WaGroupCoordinator['joinLinkedGroup']>(async () => undefined),
    transferCommunityOwnership: vi.fn<WaGroupCoordinator['transferCommunityOwnership']>(async () => undefined),
  } satisfies Partial<WaGroupCoordinator>
  return { group, profile: fakeCommunityProfile() }
}

function fakeCommunityProfile() {
  const profile = {
    getLidsByPhoneNumbers: vi.fn(async (jids: string[]) =>
      jids.map((phoneJid) => ({ phoneJid, lidJid: '222@lid', exists: true, status: 'in' })),
    ),
  }
  return profile
}
