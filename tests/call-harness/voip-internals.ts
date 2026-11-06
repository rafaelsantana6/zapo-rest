/**
 * Typed handles on @zapo-js/voip and @zapo-js/voip-media internals the call harness reuses so the fake phone speaks
 * exactly the plugin's wire format (SRTP, MLow, WhatsApp H.264 packing, SSRC/key derivation).
 * Not in the package `exports`, so they are loaded by file path.
 */
import { createRequire } from 'node:module'
import path from 'node:path'

export type SrtpKeying = { masterKey: Uint8Array; masterSalt: Uint8Array }

export type RtpHeaderLike = {
  payloadType: number
  sequenceNumber: number
  timestamp: number
  ssrc: number
  marker: boolean
  extension: boolean
  extensionProfile: number
  extensionData: Uint8Array
}

export type RtpPacketLike = { header: RtpHeaderLike; payload: Uint8Array }

export type RtpSessionLike = {
  getSsrc(): number
  createPacket(payload: Uint8Array, marker?: boolean): RtpPacketLike
  createPacketAtTimestamp(payload: Uint8Array, timestamp: number, marker?: boolean): RtpPacketLike
}

export type SrtpSessionLike = {
  protect(packet: RtpPacketLike): Uint8Array
  /** `null` when authentication fails (voip-media 0.3 no longer throws). */
  unprotect(data: Uint8Array): RtpPacketLike | null
}

export type MLowCodecLike = {
  encode(pcm: Float32Array): Uint8Array
  decode(frame: Uint8Array | null): Float32Array
  decodeSequenced(
    seq: number,
    packet: Uint8Array,
    onFrame: (pcm: Float32Array) => void,
    timestamp?: number,
    stream?: 0 | 1,
  ): string
  getFrameSize(): number
  destroy(): void
}

export type H264DepacketizerLike = {
  push(
    payload: Uint8Array,
    timestamp: number,
    marker: boolean,
    /** voip-media 0.3: an FU-A continuation is only accepted right after its previous fragment. */
    sequenceNumber: number,
  ): readonly { timestamp: number; data: Uint8Array; keyFrame: boolean }[]
}

export type VoipInternals = {
  derivePerJidSrtpKey(callKey: Uint8Array, deviceJid: string): SrtpKeying
  generateSecureSsrc(callId: string, jid: string, slot?: number): number
  RtpSession: {
    new (ssrc: number, payloadType: number, sampleRate: number, samplesPerPacket: number): RtpSessionLike
    whatsappOpus(ssrc: number): RtpSessionLike
  }
  SrtpSession: new (send: SrtpKeying, recv: SrtpKeying, sendAuthLen?: number, recvAuthLen?: number) => SrtpSessionLike
  MLowCodec: { create(): Promise<MLowCodecLike> }
  H264Depacketizer: new () => H264DepacketizerLike
  packetizeWhatsAppH264AccessUnit(au: Uint8Array, maxPayload?: number): Uint8Array[]
  SRTP_AUTH_TAG_LEN: number
}

let cached: VoipInternals | null = null

export function loadVoipInternals(): VoipInternals {
  if (cached) return cached
  const require = createRequire(import.meta.url)
  // voip 1.2+ moved media to @zapo-js/voip-media; signaling crypto stays in @zapo-js/voip
  const voipDist = path.dirname(require.resolve('@zapo-js/voip'))
  const mediaDist = path.dirname(require.resolve('@zapo-js/voip-media', { paths: [voipDist] }))
  const fromVoip = (rel: string) => require(path.join(voipDist, rel))
  const fromMedia = (rel: string) => require(path.join(mediaDist, rel))
  const encryption = fromVoip('crypto/encryption.js')
  const ssrc = fromVoip('crypto/ssrc.js')
  const rtp = fromMedia('media/rtp.js')
  const srtp = fromMedia('crypto/srtp.js')
  const mlow = fromMedia('media/mlow-codec.js')
  const h264 = fromMedia('media/h264.js')
  const types = fromMedia('types.js')
  const { nodeCrypto } = fromMedia('node/crypto.js')
  cached = {
    derivePerJidSrtpKey: encryption.derivePerJidSrtpKey,
    generateSecureSsrc: ssrc.generateSecureSsrc,
    // voip-media 0.3 dropped the self-clocked createPacket; the harness sends one 60 ms MLow
    // frame (960 samples at 16 kHz) per call, so advance the timestamp by that much each time.
    RtpSession: harnessRtpSession(rtp.RtpSession),
    // voip-media 0.3 takes the crypto provider first; keep the harness's old call shape
    SrtpSession: function HarnessSrtpSession(send: SrtpKeying, recv: SrtpKeying, sendAuth?: number, recvAuth?: number) {
      return new srtp.SrtpSession(nodeCrypto, send, recv, sendAuth, recvAuth)
    } as unknown as VoipInternals['SrtpSession'],
    MLowCodec: mlow.MLowCodec,
    H264Depacketizer: h264.H264Depacketizer,
    // voip-media 0.3: packetizeH264Frame packs key frames the WhatsApp way (one FU-A typed SPS)
    packetizeWhatsAppH264AccessUnit: (au: Uint8Array, maxPayload?: number) =>
      h264.packetizeH264Frame(au, maxPayload).payloads,
    SRTP_AUTH_TAG_LEN: types.SRTP_AUTH_TAG_LEN,
  }
  return cached
}

const AUDIO_SAMPLES_PER_PACKET = 960

/** Old voip 1.1 RtpSession surface (self-clocked audio) on top of voip-media 0.3's. */
// biome-ignore lint/suspicious/noExplicitAny: upstream class loaded by path
function harnessRtpSession(Upstream: any): VoipInternals['RtpSession'] {
  // biome-ignore lint/suspicious/noExplicitAny: upstream instance
  const wrap = (inner: any) => {
    let ts = Math.floor(Math.random() * 2 ** 31)
    return {
      getSsrc: () => inner.getSsrc(),
      createPacketAtTimestamp: (payload: Uint8Array, timestamp: number, marker?: boolean) =>
        inner.createPacketAtTimestamp(payload, timestamp, marker),
      createPacket: (payload: Uint8Array, marker?: boolean) => {
        const packet = inner.createPacketAtTimestamp(payload, ts, marker)
        ts = (ts + AUDIO_SAMPLES_PER_PACKET) >>> 0
        return packet
      },
    }
  }
  const ctor = function HarnessRtpSession(ssrc: number, payloadType: number) {
    return wrap(new Upstream(ssrc, payloadType))
  } as unknown as VoipInternals['RtpSession']
  // biome-ignore lint/suspicious/noExplicitAny: static factory
  ;(ctor as any).whatsappOpus = (ssrc: number) => wrap(Upstream.whatsappOpus(ssrc))
  return ctor
}
