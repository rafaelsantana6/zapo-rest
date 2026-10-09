import type { WaClient } from 'zapo-js'

/** Minimal voip surface used by the API (plugin-installed). */
export type VoipSurface = {
  startCall: (opts: { peerJid: string }) => Promise<string>
  acceptCall: (callId: string) => Promise<void>
  rejectCall: (callId: string, reason?: string) => Promise<void>
  endCall: (callId: string, reason?: string) => Promise<void>
  setMute: (callId: string, muted: boolean) => void
  setHandRaised: (callId: string, raised: boolean) => Promise<void>
  sendReaction: (callId: string, reaction: string) => boolean
  setExternalAudioMode: (callId: string, enabled: boolean) => void
  feedLiveAudio: (callId: string, data: Float32Array) => number
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
