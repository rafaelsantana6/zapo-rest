import type { WaVoipMediaApi } from '@zapo-js/voip'
import type { WaClient } from 'zapo-js'

/** Minimal voip surface used by the API (plugin-installed). */
export type VoipSurface = {
  media: WaVoipMediaApi
  /** `isVideo` negotiates H.264 alongside audio (feed with `feedLiveVideo`). */
  startCall: (
    opts:
      | { peerJid: string; isVideo?: boolean }
      | {
          groupJid: string
          participants: readonly { jid: string; devices?: readonly string[] }[]
          isVideo?: boolean
        },
  ) => Promise<string>
  loadAudio: (callId: string, audioPath: string) => Promise<void>
  acceptCall: (callId: string) => Promise<void>
  rejectCall: (callId: string, reason?: string) => Promise<void>
  endCall: (callId: string, reason?: string) => Promise<void>
  setMute: (callId: string, muted: boolean) => void
  setHandRaised: (callId: string, raised: boolean) => Promise<void>
  sendReaction: (callId: string, reaction: string) => boolean
  leaveCall: (callId: string) => Promise<void>
  joinCall: (callId: string) => Promise<void>
  requestParticipantMute: (callId: string, participantJid: string) => Promise<void>
  setExternalAudioMode: (callId: string, enabled: boolean) => void
  feedLiveAudio: (callId: string, data: Float32Array) => number
  /** One H.264 Annex-B access unit; returns RTP packets sent (0 = video media not active). */
  feedLiveVideo: (callId: string, data: Uint8Array, timestampUs: number) => number
  /** 1:1: handshake with the peer; group: asks the server to make the call video. */
  requestVideoUpgrade: (callId: string) => Promise<string>
  acceptVideoUpgrade: (callId: string) => Promise<void>
  rejectVideoUpgrade: (callId: string) => Promise<void>
  cancelVideoUpgrade: (callId: string) => Promise<void>
  /** Group calls only; throws on a 1:1 call. */
  setVideoEnabled: (callId: string, enabled: boolean) => Promise<void>
  setScreenShare: (callId: string, sharing: boolean) => Promise<void>
  getLiveBufferMs: (callId: string) => number
  getFeedWatermarksMs: () => { pauseMs: number; resumeMs: number }
  getCall: (callId: string) => unknown
  getCalls: () => readonly unknown[]
}

/** WaClient with voip plugin installed */
export type VoipWaClient = WaClient & {
  voip: VoipSurface
}

export function asVoipClient(client: WaClient): VoipWaClient {
  return client as VoipWaClient
}
