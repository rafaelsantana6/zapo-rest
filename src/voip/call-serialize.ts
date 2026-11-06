/** Shared CallInfo → JSON for REST + VoIP control WS. */

import { bareUserJid, isLidJid, isPnJid, toPnJid } from '~/lib/jid-canon'
import { WA_VIDEO_STATE } from '@zapo-js/voip'
import { callMediaMode } from '~/voip/media-mode'
import { screenShareStateName, videoStateName } from '~/voip/call-video-controls'
import { serializeParticipant } from '~/voip/group-call'

/**
 * Coerce free-form phone / JID into a PN JID, or null if it's a LID / unusable.
 * WhatsApp often puts the real number in `callerPn` while `peerJid` is `@lid`.
 */
export function asPhoneJid(value: string | null | undefined): string | null {
  if (!value) return null
  const s = String(value).trim()
  if (!s) return null
  if (isLidJid(s)) return null
  if (isPnJid(s)) return toPnJid(s)
  // bare digits (with or without +)
  const digits = s.replace(/\D/g, '')
  if (digits.length >= 8) return `${digits}@s.whatsapp.net`
  return null
}

/**
 * Prefer a human phone number over WhatsApp's opaque LID for UI/history.
 * Order: callerPn → mapped PN (lid_map) → peerJid if already PN → raw peer (LID).
 */
export function pickDisplayPeerJid(opts: {
  peerJid?: string | null
  callerPn?: string | null
  mappedPn?: string | null
}): string | null {
  const fromCaller = asPhoneJid(opts.callerPn)
  if (fromCaller) return fromCaller
  const mapped = asPhoneJid(opts.mappedPn)
  if (mapped) return mapped
  const peer = opts.peerJid ? bareUserJid(opts.peerJid) : null
  if (peer && isPnJid(peer)) return toPnJid(peer)
  return peer
}

/**
 * `video` once the call carries video. Upstream keeps `mediaType` as negotiated on a 1:1 call that
 * upgraded mid-call, so also read the signs of live video: our camera announced (`videoOff: false`)
 * or the peer's camera on / upgrade accepted.
 */
// biome-ignore lint/suspicious/noExplicitAny: CallInfo from @zapo-js/voip
export function effectiveMediaType(call: any): string | null {
  if (call?.mediaType === 'video') return 'video'
  const peerState = call?.peerVideoState?.state
  if (call?.stateData?.videoOff === false) return 'video'
  if (peerState === WA_VIDEO_STATE.Enabled || peerState === WA_VIDEO_STATE.UpgradeAccept) return 'video'
  return (call?.mediaType ?? null) as string | null
}

// biome-ignore lint/suspicious/noExplicitAny: CallInfo from @zapo-js/voip
export function serializeCallInfo(call: any, extras?: { mappedPn?: string | null; mediaMode?: 'local' | 'remote' }) {
  const peerJidRaw = (call.peerJid ?? null) as string | null
  const callerPnRaw = call.callerPn != null && String(call.callerPn).trim() ? String(call.callerPn).trim() : null
  const displayPeerJid = pickDisplayPeerJid({
    peerJid: peerJidRaw,
    callerPn: callerPnRaw,
    mappedPn: extras?.mappedPn ?? null,
  })
  const peerLid = peerJidRaw && isLidJid(peerJidRaw) ? bareUserJid(peerJidRaw) : null

  return {
    callId: call.callId as string,
    mediaMode: extras?.mediaMode ?? callMediaMode(call),
    /**
     * Best JID for UI / history: phone (`@s.whatsapp.net`) when known.
     * Softphone and dashboards should show this.
     */
    peerJid: displayPeerJid,
    /** Original peer from WA signaling (often `@lid` in multi-device). */
    peerJidRaw,
    /** LID form when peer is (or was) a LID. */
    peerLid,
    /**
     * Phone number WhatsApp attached to the call (digits or JID).
     * Present on many inbound offers even when peerJid is LID.
     */
    callerPn: callerPnRaw,
    direction: (call.direction ?? null) as string | null,
    /** `audio` | `video` — video calls carry H.264 on `.../calls/:callId/video`. */
    /** `video` also after a 1:1 call upgraded mid-call (see `effectiveMediaType`). */
    mediaType: effectiveMediaType(call),
    createdAt: call.createdAt ?? null,
    state: (call.stateData?.state ?? call.state ?? null) as string | null,
    isActive: Boolean(call.isActive),
    isRinging: Boolean(call.isRinging),
    isEnded: Boolean(call.isEnded),
    canAccept: Boolean(call.canAccept),
    acceptBlocked: Boolean(call.isAcceptBlocked ?? call.stateData?.acceptBlocked),
    audioMuted: call.stateData?.audioMuted as boolean | undefined,
    /** Mic state the peer last announced; `null` until it announces one. */
    peerAudioMuted: (call.stateData?.peerAudioMuted ?? null) as boolean | null,
    handRaised: Boolean(call.stateData?.handRaised),
    /** Device JIDs of remote participants with a raised hand. */
    raisedHands: call.raisedHands instanceof Set ? [...(call.raisedHands as Set<string>)] : [],
    /** Peer camera off (video calls). Always `true` on audio-only calls. */
    videoOff: call.stateData?.videoOff as boolean | undefined,
    /** Local screen share in progress. */
    screenSharing: Boolean(call.stateData?.screenSharing),
    /** Last `<video>` state the 1:1 peer announced (e.g. `enabled`, `upgrade_request_v2`); null until one. */
    peerVideoState: videoStateName(call.peerVideoState?.state),
    /** 1:1 peer is sharing its screen (it replaces the peer's camera on the same stream). */
    peerScreenSharing: screenShareStateName(call.peerScreenShare?.state) === 'started',
    /** Per remote device (1:1 and group): mic, camera, screen share, media arriving. */
    participantMedia:
      call.participantMedia instanceof Map
        ? [...(call.participantMedia as Map<string, ParticipantMediaLike>).values()].map(serializeParticipantMedia)
        : [],
    isGroup: Boolean(call.groupJid),
    groupJid: (call.groupJid ?? null) as string | null,
    /** Group roster (voip 1.4); empty on 1:1 calls. */
    participants: Array.isArray(call.groupComposition?.participants)
      ? (call.groupComposition.participants as { jid: string }[]).map(serializeParticipant)
      : [],
    durationSecs: (call.stateData?.durationSecs ?? null) as number | null,
    endReason: (call.stateData?.endReason ?? null) as string | null,
  }
}

export type SerializedCall = ReturnType<typeof serializeCallInfo>

type ParticipantMediaLike = {
  deviceJid: string
  audioMuted?: boolean
  video?: { state: number }
  screenShare?: { state: number | null }
  receiving?: boolean
}

function serializeParticipantMedia(m: ParticipantMediaLike) {
  return {
    deviceJid: m.deviceJid,
    audioMuted: m.audioMuted ?? null,
    videoState: videoStateName(m.video?.state),
    screenSharing: screenShareStateName(m.screenShare?.state) === 'started',
    receiving: m.receiving ?? null,
  }
}

/** Match callId case-insensitively (WA hex IDs sometimes change casing in UIs). */
// biome-ignore lint/suspicious/noExplicitAny: voip client
export function resolveLiveCall(client: any, callId: string): any | null {
  const direct = client.voip.getCall(callId)
  if (direct) return direct
  const all: unknown[] = client.voip.getCalls() ?? []
  const lower = callId.toLowerCase()
  for (const c of all) {
    // biome-ignore lint/suspicious/noExplicitAny: call info
    const info = c as any
    if (typeof info?.callId === 'string' && info.callId.toLowerCase() === lower) {
      return info
    }
  }
  return null
}
