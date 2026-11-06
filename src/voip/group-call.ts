/**
 * Group-call operations shared by REST and the VoIP control WS (zapo voip 1.4):
 * place a group call, leave / join one, ask a participant to mute.
 */

import type { VoipWaClient } from '~/instances/wa-client'
import { isLidJid } from '~/lib/jid-canon'
import { resolveWhatsAppNumbers } from '~/lib/phone-resolve'
import type { CacheClient } from '~/redis/client'
import { resolveLiveCall } from '~/voip/call-serialize'

/** Upstream caps a group call at 32 people, ourselves included. */
export const MAX_GROUP_CALL_PARTICIPANTS = 31

/**
 * Turn phones / PN JIDs / LIDs into the LIDs a group offer must name.
 * Returns the inputs that have no LID in `missing` instead of throwing.
 * @example await resolveParticipantLids(client, ['5511999999999', '123@lid'])
 */
export async function resolveParticipantLids(
  client: VoipWaClient,
  inputs: readonly string[],
  cache?: CacheClient,
): Promise<{ lids: string[]; missing: string[] }> {
  const direct = inputs.filter((i) => isLidJid(i))
  const lookup = inputs.filter((i) => !isLidJid(i))
  const resolved = lookup.length ? await resolveWhatsAppNumbers(client, lookup, { cache }) : []
  const missing = resolved.filter((r) => !r.exists || !r.lid).map((r) => r.input)
  const lids = [...direct, ...resolved.flatMap((r) => (r.exists && r.lid ? [r.lid] : []))]
  return { lids: [...new Set(lids)], missing }
}

/**
 * Place a group call ringing `participantLids` on `groupJid`.
 * @example await startGroupCall(client, '1203...@g.us', ['123@lid'])
 */
export async function startGroupCall(
  client: VoipWaClient,
  groupJid: string,
  participantLids: readonly string[],
  opts: { isVideo?: boolean } = {},
): Promise<string> {
  return client.voip.startCall({
    groupJid,
    participants: participantLids.map((jid) => ({ jid })),
    isVideo: opts.isVideo === true,
  })
}

/**
 * Leave a live group call; the others stay on it. `null` = unknown call.
 * Throws when the call is not a group call (only `end` applies there).
 */
export async function leaveGroupCall(client: VoipWaClient, callId: string): Promise<string | null> {
  const call = resolveLiveCall(client, callId)
  if (!call) return null
  await client.voip.leaveCall(call.callId)
  return call.callId
}

/**
 * Join a group call going on without this side (after a ring we missed or left).
 * Throws when no such call is remembered, we are already on it, or the join fails.
 */
export async function joinGroupCall(client: VoipWaClient, callId: string): Promise<string> {
  const live = resolveLiveCall(client, callId)
  const id = live?.callId ?? callId
  await client.voip.joinCall(id)
  return id
}

/** Ask one participant to mute. Nothing is forced: the peer decides. `null` = unknown call. */
export async function requestParticipantMute(
  client: VoipWaClient,
  callId: string,
  participantJid: string,
): Promise<string | null> {
  const call = resolveLiveCall(client, callId)
  if (!call) return null
  await client.voip.requestParticipantMute(call.callId, participantJid)
  return call.callId
}

type GroupParticipantLike = { jid: string; devices?: readonly string[]; state?: string; nacked?: boolean }

/** Roster entry as exposed on the call snapshot and webhooks. */
export function serializeParticipant(p: GroupParticipantLike) {
  return { jid: p.jid, devices: [...(p.devices ?? [])], state: p.state ?? null }
}

type CompositionDiffLike = {
  added?: readonly GroupParticipantLike[]
  removed?: readonly { jid: string; cause: string }[]
  switched?: readonly { jid: string; previousDeviceJid: string; deviceJid: string }[]
  devicesAdded?: readonly { jid: string; deviceJid: string }[]
  devicesRemoved?: readonly { jid: string; deviceJid: string }[]
}

/** `voip_call_participants_changed` diff → webhook detail (no key / rekey internals). */
export function serializeCompositionDiff(diff: CompositionDiffLike | null | undefined) {
  return {
    added: (diff?.added ?? []).map(serializeParticipant),
    removed: (diff?.removed ?? []).map((r) => ({ jid: r.jid, cause: r.cause })),
    switched: (diff?.switched ?? []).map((s) => ({
      jid: s.jid,
      previousDeviceJid: s.previousDeviceJid,
      deviceJid: s.deviceJid,
    })),
    devicesAdded: (diff?.devicesAdded ?? []).map((d) => ({ jid: d.jid, deviceJid: d.deviceJid })),
    devicesRemoved: (diff?.devicesRemoved ?? []).map((d) => ({ jid: d.jid, deviceJid: d.deviceJid })),
  }
}
