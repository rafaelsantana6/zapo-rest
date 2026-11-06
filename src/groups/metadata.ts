import type { WaGroupEvent, WaGroupMetadata } from 'zapo-js'
import {
  GroupMetadataSchema,
  GroupHistoryShareModeSchema,
  GroupMemberAddModeSchema,
  GroupMemberLinkModeSchema,
} from '~/http/openapi-schemas'

/** Preserve upstream metadata and expose the same member-mode names as REST settings. */
export function serializeGroupMetadata<
  T extends Pick<WaGroupMetadata, 'memberAddMode' | 'memberLinkMode' | 'memberShareGroupHistoryMode'>,
>(group: T) {
  return GroupMetadataSchema.parse({
    ...group,
    memberAddMode: GroupMemberAddModeSchema.safeParse(group.memberAddMode).data,
    memberLinkMode: GroupMemberLinkModeSchema.safeParse(group.memberLinkMode).data,
    historyShareMode: GroupHistoryShareModeSchema.safeParse(group.memberShareGroupHistoryMode).data,
  })
}

/** Keep the upstream action/mode envelope for existing group.update consumers. */
export function serializeGroupEvent(event: WaGroupEvent) {
  if (event.action !== 'member_add_mode') return event
  return { ...event, memberAddMode: GroupMemberAddModeSchema.safeParse(event.mode).data }
}
