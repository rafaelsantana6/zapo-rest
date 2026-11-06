import type { WaGroupMetadata } from 'zapo-js'
import { serializeGroupMetadata as serializeMemberModes } from '~/groups/metadata'

/** Preserve upstream metadata, including community flags and linked parent JIDs. */
export function serializeGroupMetadata(group: WaGroupMetadata) {
  return { ...serializeMemberModes(group), participants: group.participants?.map((participant) => ({ ...participant })) ?? [] }
}

export function normalizeGroupJid(input: string): string {
  if (input.includes('@')) return input
  return `${input.replace(/\D/g, '')}@g.us`
}
