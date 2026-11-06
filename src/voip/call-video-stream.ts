import { getLogger } from '~/lib/logger'
import { binaryMessage, type CallSocketOpts, openCallSocket } from '~/voip/call-socket'
import { effectiveMediaType } from '~/voip/call-serialize'
import { createRtpVideoClock, decodeVideoFrame, encodeVideoFrame, VIDEO_FRAME_HEADER_BYTES } from '~/voip/video-frame'

/**
 * Past this many unsent bytes on the socket we drop frames until the next key frame —
 * a slow viewer must never grow server memory or replay stale video.
 */
export const VIDEO_MAX_BUFFERED_BYTES = 4 * 1024 * 1024
/** Upper bound for one client access unit (a 1080p IDR is well under this). */
export const VIDEO_MAX_FRAME_BYTES = 2 * 1024 * 1024
/** Live streams per socket. A group call has at most 31 other people; more than this is a bug. */
const MAX_STREAMS = 64
const STATS_INTERVAL_MS = 10_000

/** Per-socket counters — tell apart "phone sends nothing" / "we drop" / "browser never decodes". */
type VideoStreamStats = {
  peerRtpPackets: number
  peerFrames: number
  peerKeyFrames: number
  framesToClient: number
  framesDropped: number
  clientFrames: number
  clientFramesAccepted: number
  clientPacketsSent: number
}

type InboundVideo = {
  // biome-ignore lint/suspicious/noExplicitAny: CallInfo from @zapo-js/voip
  call: any
  frame: { ssrc?: number; timestamp: number; keyFrame: boolean; data: Uint8Array }
  participantJid?: string
}

/** One remote sender: its own RTP clock and its own wait-for-key-frame gate. */
type RemoteStream = {
  id: number
  participantJid: string | null
  toUs: (rtp: number) => number
  awaitingKeyFrame: boolean
}

/** `111:2@lid` → `111`: participants_changed names accounts, video names devices. */
const accountOf = (jid: string) => jid.split('@')[0]?.split(':')[0] ?? jid

type CompositionDiffLike = {
  removed?: readonly { jid: string }[]
  switched?: readonly { previousDeviceJid: string }[]
  devicesRemoved?: readonly { deviceJid: string }[]
}

/**
 * Bridge WebSocket binary H.264 (Annex-B, framing in `video-frame.ts`) ↔
 * `client.voip.feedLiveVideo` / `voip_call_inbound_video`. Audio stays on `.../stream`,
 * so closing this socket never ends the call.
 *
 * Opens on audio calls too: they can turn into video mid-call (upgrade on 1:1,
 * `setVideoEnabled` on a group). Frames flow once the call carries video.
 */
export async function attachCallVideoStream(opts: CallSocketOpts): Promise<void> {
  const log = getLogger({ component: 'call-video-stream', instance: opts.instanceName, callId: opts.callId })
  const { socket } = opts

  const opened = await openCallSocket(opts)
  if (!opened) return
  const { client, callId, call } = opened

  socket.send(
    JSON.stringify({
      op: 'ready',
      callId,
      codec: 'h264',
      format: 'annexb',
      headerBytes: VIDEO_FRAME_HEADER_BYTES,
      mediaType: effectiveMediaType(call),
      state: call.stateData?.state,
      videoOff: Boolean(call.stateData?.videoOff),
    }),
  )

  const sendJson = (payload: Record<string, unknown>) => {
    if (socket.readyState !== socket.OPEN) return
    try {
      socket.send(JSON.stringify(payload))
    } catch {
      /* closed mid-send */
    }
  }

  const sameCall = (id: string | undefined) => Boolean(id && id.toLowerCase() === callId.toLowerCase())
  // Keyed by SSRC: frames of two senders must never reach the same decoder.
  // Ids are never reused, so a client cannot mistake a new sender for one that left.
  const streams = new Map<number, RemoteStream>()
  let nextStreamId = 0
  const endStream = (ssrc: number) => {
    const stream = streams.get(ssrc)
    if (!stream) return
    streams.delete(ssrc)
    sendJson({ op: 'stream_end', callId, streamId: stream.id })
  }
  const streamFor = (ssrc: number, participantJid: string | null): RemoteStream | null => {
    const known = streams.get(ssrc)
    if (known) return known
    // A 1:1 call has one sender: a new SSRC (camera switch, re-key) replaces the old stream
    if (!call.groupJid) for (const old of [...streams.keys()]) endStream(old)
    if (streams.size >= MAX_STREAMS) return null
    const created: RemoteStream = {
      id: nextStreamId++,
      participantJid,
      toUs: createRtpVideoClock(),
      awaitingKeyFrame: true,
    }
    streams.set(ssrc, created)
    sendJson({ op: 'stream', callId, streamId: created.id, ssrc, participantJid })
    return created
  }
  /** Drop the streams of whoever left the group call or moved off a device. */
  const onParticipantsChanged = ({ call: c, diff }: { call: { callId?: string }; diff?: CompositionDiffLike }) => {
    if (!sameCall(c?.callId) || !diff) return
    const goneAccounts = new Set((diff.removed ?? []).map((r) => accountOf(r.jid)))
    const goneDevices = new Set([
      ...(diff.switched ?? []).map((s) => s.previousDeviceJid),
      ...(diff.devicesRemoved ?? []).map((d) => d.deviceJid),
    ])
    for (const [ssrc, stream] of [...streams]) {
      const jid = stream.participantJid
      if (jid && (goneDevices.has(jid) || goneAccounts.has(accountOf(jid)))) endStream(ssrc)
    }
  }

  const stats: VideoStreamStats = {
    peerRtpPackets: 0,
    peerFrames: 0,
    peerKeyFrames: 0,
    framesToClient: 0,
    framesDropped: 0,
    clientFrames: 0,
    clientFramesAccepted: 0,
    clientPacketsSent: 0,
  }
  const statsTimer = setInterval(
    () => log.info({ ...stats, streams: streams.size }, 'call video stream stats'),
    STATS_INTERVAL_MS,
  )

  // biome-ignore lint/suspicious/noExplicitAny: plugin event
  const onInboundRtp = ({ call: c }: { call: any }) => {
    if (sameCall(c?.callId)) stats.peerRtpPackets += 1
  }

  const onInboundVideo = ({ call: c, frame, participantJid }: InboundVideo) => {
    if (!sameCall(c?.callId) || socket.readyState !== socket.OPEN) return
    const stream = streamFor(frame.ssrc ?? 0, participantJid ?? null)
    if (!stream) return
    const { keyFrame } = frame
    stats.peerFrames += 1
    if (keyFrame) stats.peerKeyFrames += 1
    // Over the cap even key frames wait — a stalled viewer must not queue an IDR every few seconds
    if (socket.bufferedAmount > VIDEO_MAX_BUFFERED_BYTES) {
      for (const s of streams.values()) s.awaitingKeyFrame = true
      stats.framesDropped += 1
      return
    }
    if (stream.awaitingKeyFrame && !keyFrame) {
      stats.framesDropped += 1
      return
    }
    stream.awaitingKeyFrame = false
    stats.framesToClient += 1
    socket.send(
      encodeVideoFrame({ keyFrame, streamId: stream.id, timestampUs: stream.toUs(frame.timestamp), data: frame.data }),
    )
  }

  // biome-ignore lint/suspicious/noExplicitAny: plugin event
  const onState = (c: any) => {
    if (!sameCall(c?.callId)) return
    sendJson({
      op: 'state',
      callId,
      state: c?.stateData?.state,
      isActive: Boolean(c?.isActive),
      mediaType: effectiveMediaType(c),
      videoOff: Boolean(c?.stateData?.videoOff),
    })
  }

  // biome-ignore lint/suspicious/noExplicitAny: plugin event
  const onEnded = (c: any) => {
    if (!sameCall(c?.callId) || socket.readyState !== socket.OPEN) return
    sendJson({ op: 'ended', callId })
    socket.close(1000, 'call ended')
  }

  // biome-ignore lint/suspicious/noExplicitAny: plugin event map
  const events = client as any
  events.on('voip_call_inbound_video', onInboundVideo)
  events.on('voip_call_inbound_video_rtp', onInboundRtp)
  events.on('voip_call_state', onState)
  events.on('voip_call_ended', onEnded)
  events.on('voip_call_participants_changed', onParticipantsChanged)

  let rejectedFrames = 0
  socket.on('message', (data, isBinary) => {
    const buf = binaryMessage(data, isBinary)
    const frame = buf && buf.byteLength <= VIDEO_MAX_FRAME_BYTES ? decodeVideoFrame(buf) : null
    if (!frame) {
      // Text control frames land here too — only count real binary garbage
      if (buf && isBinary !== false && rejectedFrames++ === 0) {
        log.warn({ bytes: buf.byteLength }, 'video frame rejected (bad header or too large)')
      }
      return
    }
    // 0 until video is live on the call, and while the plugin holds our first frames
    // for the peer's video stream to exist (see zapo VoIP guide, "Your first frames are held")
    stats.clientFrames += 1
    const packets = client.voip.feedLiveVideo(callId, frame.data, frame.timestampUs)
    if (packets > 0) stats.clientFramesAccepted += 1
    stats.clientPacketsSent += packets
  })

  socket.on('close', () => {
    clearInterval(statsTimer)
    events.off?.('voip_call_inbound_video', onInboundVideo)
    events.off?.('voip_call_inbound_video_rtp', onInboundRtp)
    events.off?.('voip_call_state', onState)
    events.off?.('voip_call_ended', onEnded)
    events.off?.('voip_call_participants_changed', onParticipantsChanged)
    log.info({ rejectedFrames, ...stats, streams: streams.size }, 'call video stream closed')
  })

  socket.on('error', (err) => {
    log.warn({ err }, 'call video stream socket error')
  })
}
