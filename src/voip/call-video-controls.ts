/**
 * Video controls shared by REST and the VoIP control WS (zapo voip 1.4): audio → video
 * upgrade, the group camera, and screen share. Resolve the call id case-insensitively;
 * every helper returns `null` for an unknown call and lets upstream errors through.
 */

import { WA_SCREEN_SHARE_STATE, WA_VIDEO_STATE } from '@zapo-js/voip'
import type { VoipWaClient } from '~/instances/wa-client'
import { resolveLiveCall } from '~/voip/call-serialize'

/** Wire number → name, e.g. `11` → `upgrade_request_v2`. Unknown numbers pass through as `null`. */
function nameOf(table: Readonly<Record<string, number>>, value: number | null | undefined): string | null {
  if (value == null) return null
  const key = Object.keys(table).find((k) => table[k] === value)
  return key ? key.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase() : null
}

export const videoStateName = (state: number | null | undefined) => nameOf(WA_VIDEO_STATE, state)
export const screenShareStateName = (state: number | null | undefined) => nameOf(WA_SCREEN_SHARE_STATE, state)

/**
 * A 1:1 peer asking to turn on video (`UpgradeRequestV2`) — answer with accept/reject. A group
 * upgrade goes through the server and arrives as `call.video_upgraded`, with nothing to answer.
 */
export function isUpgradeRequest(state: number | null | undefined): boolean {
  return state === WA_VIDEO_STATE.UpgradeRequestV2
}

/**
 * Ask to turn an audio call into video. On 1:1 it waits for the peer (≤ ~5 s) and resolves
 * `accepted` | `rejected` | `rejected_by_timeout` | `error` | `timeout` | `cancelled`.
 */
export async function requestVideoUpgrade(
  client: VoipWaClient,
  callId: string,
): Promise<{ callId: string; result: string } | null> {
  const call = resolveLiveCall(client, callId)
  if (!call) return null
  return { callId: call.callId, result: await client.voip.requestVideoUpgrade(call.callId) }
}

export type UpgradeAnswer = 'accept' | 'reject' | 'cancel'

/** Answer the peer's upgrade request (`accept` / `reject`) or withdraw ours (`cancel`). */
export async function answerVideoUpgrade(
  client: VoipWaClient,
  callId: string,
  answer: UpgradeAnswer,
): Promise<string | null> {
  const call = resolveLiveCall(client, callId)
  if (!call) return null
  if (answer === 'accept') await client.voip.acceptVideoUpgrade(call.callId)
  else if (answer === 'reject') await client.voip.rejectVideoUpgrade(call.callId)
  else await client.voip.cancelVideoUpgrade(call.callId)
  return call.callId
}

/** Turn our camera on/off on a group call (1:1 uses the upgrade handshake; upstream throws). */
export async function setGroupVideo(client: VoipWaClient, callId: string, enabled: boolean): Promise<string | null> {
  const call = resolveLiveCall(client, callId)
  if (!call) return null
  await client.voip.setVideoEnabled(call.callId, enabled)
  return call.callId
}

/**
 * Start/stop a screen share. It replaces the camera on the same video stream: stop sending
 * camera frames before starting and resume after stopping. Needs a call already carrying video.
 */
export async function setScreenShare(client: VoipWaClient, callId: string, sharing: boolean): Promise<string | null> {
  const call = resolveLiveCall(client, callId)
  if (!call) return null
  await client.voip.setScreenShare(call.callId, sharing)
  return call.callId
}

type PeerVideoStateLike = { state: number }
type PeerScreenShareLike = { state: number | null; screenWidth: number | null; screenHeight: number | null }

/** `voip_call_peer_video_state` → webhook detail. */
export function serializeVideoState(change: PeerVideoStateLike | null | undefined) {
  const state = change?.state ?? null
  return { state, stateName: videoStateName(state), upgradeRequested: isUpgradeRequest(state) }
}

/** `voip_call_screen_share` → webhook detail. */
export function serializeScreenShare(share: PeerScreenShareLike | null | undefined) {
  const state = share?.state ?? null
  return {
    state,
    stateName: screenShareStateName(state),
    sharing: state === WA_SCREEN_SHARE_STATE.Started,
    screenWidth: share?.screenWidth ?? null,
    screenHeight: share?.screenHeight ?? null,
  }
}
