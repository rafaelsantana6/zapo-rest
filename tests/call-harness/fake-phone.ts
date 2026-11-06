/**
 * The remote handset for call tests. Signals like a WhatsApp phone through FakeWaServer
 * (Signal-encrypted call key via a FakePeer, relay block pointing at FakeFnaRelay) and
 * streams media with the voip plugin's own SRTP / MLow / H.264 packing over UDP.
 */
import { randomBytes } from 'node:crypto'
import dgram from 'node:dgram'
import { toDeviceJid } from './fake-wa'
import type { FakeFnaRelay } from './fake-relay'
import {
  type H264DepacketizerLike,
  loadVoipInternals,
  type MLowCodecLike,
  type RtpSessionLike,
  type SrtpSessionLike,
} from './voip-internals'

// biome-ignore lint/suspicious/noExplicitAny: fake-server / BinaryNode dynamic surfaces
type Any = any

const PT_AUDIO = 120
const PT_VIDEO = 97
const PT_VIDEO_RTX = 103
// voip-media uses the relay key as the ICE pwd, which WebRTC requires to be 22–256 chars
const RELAY_KEY = 'harness-relay-key-0123456789'

export type PhoneVideoFrame = { timestamp: number; data: Uint8Array; keyFrame: boolean; receivedAt: number }
export type PhoneAudioChunk = { pcm: Float32Array; receivedAt: number }

export type FakePhoneOptions = {
  server: Any
  pipeline: Any
  relay: FakeFnaRelay
  /** Paired zapo device (participant list → deterministic SRTP key derivation on both legs). */
  zapoDeviceJid: string
  phoneJid?: string
}

export class FakePhone {
  readonly phoneJid: string
  /** Device the plugin treats as "accepted by" — drives its receive key + SSRC. */
  readonly phoneDeviceJid: string
  callId = ''
  private callKey: Uint8Array = new Uint8Array()
  private peer: Any = null
  private capturedEnc: Any = null
  private socket: dgram.Socket | null = null
  private srtp: SrtpSessionLike | null = null
  private audioRtp: RtpSessionLike | null = null
  private videoRtp: RtpSessionLike | null = null
  private codec: MLowCodecLike | null = null
  private depacketizer: H264DepacketizerLike | null = null
  private readonly audioListeners = new Set<(chunk: PhoneAudioChunk) => void>()
  private readonly videoListeners = new Set<(frame: PhoneVideoFrame) => void>()
  readonly counters = { rtpIn: 0, srtpErrors: 0, audioPacketsOut: 0, videoPacketsOut: 0 }

  constructor(private readonly opts: FakePhoneOptions) {
    this.phoneJid = opts.phoneJid ?? '5511888888888@s.whatsapp.net'
    // voip 1.4 keys a 1:1 peer by its primary device (:0), whatever device the offer came from
    this.phoneDeviceJid = this.phoneJid.replace('@', ':0@')
  }

  /** Encrypting FakePeer whose pushes we intercept (we only want the `<enc>` payload). */
  private async ensurePeer(): Promise<Any> {
    if (this.peer) return this.peer
    const { FakePeer } = await import('@zapo-js/fake-server')
    const { server, pipeline } = this.opts
    const session = server.sessionFor(pipeline)
    const deps = server.buildFakePeerDeps(pipeline, session)
    this.peer = await (FakePeer as Any).create(
      { jid: this.phoneJid, displayName: 'Harness Phone' },
      {
        ...deps,
        pushStanza: async (stanza: Any) => {
          this.capturedEnc = (stanza.content as Any[]).find((c) => c?.tag === 'enc')
        },
      },
    )
    session.registries.registerPeer(this.peer)
    return this.peer
  }

  private async encryptCallKey(): Promise<Any> {
    const peer = await this.ensurePeer()
    this.capturedEnc = null
    await peer.sendMessage({ call: { callKey: this.callKey } })
    if (!this.capturedEnc) throw new Error('FakePeer did not produce an <enc> for the call key')
    return this.capturedEnc
  }

  /** Ring the zapo client. Resolves with the call id once the offer is pushed. */
  async ring(opts: { video: boolean }): Promise<string> {
    this.callId = randomBytes(16).toString('hex').toUpperCase()
    this.callKey = new Uint8Array(randomBytes(32))
    const enc = await this.encryptCallKey()
    await this.openMedia(opts.video)

    const offer = {
      tag: 'call',
      attrs: {
        from: this.phoneJid,
        id: randomBytes(8).toString('hex').toUpperCase(),
        t: String(Math.floor(Date.now() / 1000)),
        platform: 'android',
        version: '2.24.1.1',
      },
      content: [
        {
          tag: 'offer',
          attrs: { 'call-id': this.callId, 'call-creator': this.phoneJid },
          content: [
            { tag: 'audio', attrs: { enc: 'opus', rate: '16000' } },
            ...(opts.video ? [{ tag: 'video', attrs: { enc: 'h.264', dec: 'H264' } }] : []),
            { tag: 'net', attrs: { medium: '3' } },
            enc,
            this.relayNode(),
          ],
        },
      ],
    }
    await this.opts.pipeline.sendStanza(offer)
    return this.callId
  }

  /**
   * What a real phone sends right after the call connects: its own mic state. voip 1.4 holds
   * our outbound video until this first `<mute_v2>` (+150 ms, capped at 2 s) so the peer's
   * video stream exists before the first packet — see zapo VoIP guide, "Your first frames are held".
   */
  async announceMicState(muted = false) {
    await this.opts.pipeline.sendStanza({
      tag: 'call',
      attrs: { from: this.phoneDeviceJid, id: randomBytes(8).toString('hex').toUpperCase() },
      content: [
        {
          tag: 'mute_v2',
          attrs: { 'call-id': this.callId, 'call-creator': this.phoneJid, 'mute-state': muted ? '1' : '0' },
        },
      ],
    })
  }

  private relayNode() {
    const port = this.opts.relay.port
    const address = new Uint8Array([127, 0, 0, 1, (port >> 8) & 0xff, port & 0xff])
    return {
      tag: 'relay',
      attrs: { uuid: 'call-harness', self_pid: '1', peer_pid: '2' },
      content: [
        { tag: 'participant', attrs: { jid: this.opts.zapoDeviceJid } },
        { tag: 'participant', attrs: { jid: this.phoneDeviceJid } },
        { tag: 'key', attrs: {}, content: RELAY_KEY },
        { tag: 'token', attrs: { id: '0' }, content: new Uint8Array(randomBytes(16)) },
        {
          tag: 'te2',
          attrs: { relay_id: '0', token_id: '0', protocol: '0', is_fna: '1', relay_name: 'harness' },
          content: address,
        },
      ],
    }
  }

  private async openMedia(video: boolean) {
    const voip = loadVoipInternals()
    const zapoDevice = toDeviceJid(this.opts.zapoDeviceJid)
    // Mirror of WaCallMediaSession.initSrtpKeys: send = our device, recv = the other leg
    this.srtp = new voip.SrtpSession(
      voip.derivePerJidSrtpKey(this.callKey, this.phoneDeviceJid),
      voip.derivePerJidSrtpKey(this.callKey, zapoDevice),
      voip.SRTP_AUTH_TAG_LEN,
      voip.SRTP_AUTH_TAG_LEN,
    )
    this.audioRtp = voip.RtpSession.whatsappOpus(voip.generateSecureSsrc(this.callId, this.phoneDeviceJid, 0))
    this.videoRtp = video
      ? new voip.RtpSession(voip.generateSecureSsrc(this.callId, this.phoneDeviceJid, 2), PT_VIDEO, 90_000, 3000)
      : null
    this.codec = await voip.MLowCodec.create()
    this.depacketizer = new voip.H264Depacketizer()

    const socket = dgram.createSocket('udp4')
    await new Promise<void>((resolve) => socket.bind(0, '127.0.0.1', resolve))
    this.opts.relay.setPhoneEndpoint({ address: '127.0.0.1', port: socket.address().port })
    socket.connect(this.opts.relay.port, '127.0.0.1')
    socket.on('message', (msg) => this.onPacket(new Uint8Array(msg)))
    this.socket = socket
  }

  /** Samples per MLow frame (16 kHz). Feed `sendAudio` exactly this many at real-time pace. */
  get audioFrameSize(): number {
    return this.codec?.getFrameSize() ?? 960
  }

  sendAudio(pcm: Float32Array) {
    if (!this.codec || !this.audioRtp || !this.srtp || !this.socket) return
    const packet = this.audioRtp.createPacket(this.codec.encode(pcm))
    this.socket.send(this.srtp.protect(packet))
    this.counters.audioPacketsOut += 1
  }

  /** One Annex-B access unit, packed the way WhatsApp phones do (whole AU → FU-A). */
  sendVideo(accessUnit: Uint8Array, timestampUs: number) {
    if (!this.videoRtp || !this.srtp || !this.socket) return
    const voip = loadVoipInternals()
    const payloads = voip.packetizeWhatsAppH264AccessUnit(accessUnit)
    const rtpTs = Math.floor((timestampUs * 90) / 1000) >>> 0
    payloads.forEach((payload, i) => {
      const packet = this.videoRtp?.createPacketAtTimestamp(payload, rtpTs, i === payloads.length - 1)
      if (!packet || !this.srtp) return
      this.socket?.send(this.srtp.protect(packet))
      this.counters.videoPacketsOut += 1
    })
  }

  onAudio(listener: (chunk: PhoneAudioChunk) => void): () => void {
    this.audioListeners.add(listener)
    return () => this.audioListeners.delete(listener)
  }

  onVideo(listener: (frame: PhoneVideoFrame) => void): () => void {
    this.videoListeners.add(listener)
    return () => this.videoListeners.delete(listener)
  }

  private onPacket(data: Uint8Array) {
    // RTP v2 only; RTCP (PT 200-204) and STUN are ignored like the plugin does
    if (data.length < 12 || (data[0] ?? 0) >> 6 !== 2) return
    const pt = (data[1] ?? 0) & 0x7f
    if ((data[1] ?? 0) >= 192 && (data[1] ?? 0) <= 223) return
    if (!this.srtp) return
    let packet: ReturnType<SrtpSessionLike['unprotect']>
    try {
      packet = this.srtp.unprotect(data)
    } catch {
      packet = null
    }
    if (!packet) {
      this.counters.srtpErrors += 1
      return
    }
    this.counters.rtpIn += 1
    const receivedAt = performance.now()
    if ((pt === PT_AUDIO || pt === 121) && this.codec) {
      this.codec.decodeSequenced(
        packet.header.sequenceNumber,
        packet.payload,
        (pcm) => {
          // Decoder storage is reused as soon as the callback returns.
          for (const l of this.audioListeners) l({ pcm: pcm.slice(), receivedAt })
        },
        packet.header.timestamp,
        pt === 121 ? 1 : 0,
      )
      return
    }
    if ((pt === PT_VIDEO || pt === PT_VIDEO_RTX) && this.depacketizer) {
      // RTX carries the original sequence number (OSN) in its first two bytes
      const rtx = pt === PT_VIDEO_RTX
      const payload = rtx ? packet.payload.subarray(2) : packet.payload
      const seq = rtx ? ((packet.payload[0] ?? 0) << 8) | (packet.payload[1] ?? 0) : packet.header.sequenceNumber
      for (const frame of this.depacketizer.push(payload, packet.header.timestamp, packet.header.marker, seq)) {
        for (const l of this.videoListeners) l({ ...frame, receivedAt })
      }
    }
  }

  async hangUp() {
    this.socket?.close()
    this.socket = null
    this.codec?.destroy()
    this.codec = null
  }
}
