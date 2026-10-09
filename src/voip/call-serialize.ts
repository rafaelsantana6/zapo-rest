/** Shared CallInfo → JSON for REST + VoIP control WS. */

import { bareUserJid, isLidJid, isPnJid, toPnJid } from '~/lib/jid-canon'

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

// biome-ignore lint/suspicious/noExplicitAny: CallInfo from @zapo-js/voip
export function serializeCallInfo(call: any, extras?: { mappedPn?: string | null }) {
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
    mediaType: (call.mediaType ?? null) as string | null,
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
    durationSecs: (call.stateData?.durationSecs ?? null) as number | null,
    endReason: (call.stateData?.endReason ?? null) as string | null,
  }
}

export type SerializedCall = ReturnType<typeof serializeCallInfo>

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
