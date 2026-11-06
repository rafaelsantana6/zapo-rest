/**
 * Binary framing for the H.264 video WebSocket (`.../calls/:callId/video`).
 *
 * Every binary frame, both directions = 12-byte header + one Annex-B access unit:
 *
 * | offset | size | field                                      |
 * | ------ | ---- | ------------------------------------------ |
 * | 0      | 1    | version (`1`)                              |
 * | 1      | 1    | flags — bit 0 = key frame (IDR)            |
 * | 2      | 2    | stream id, uint16 big-endian (see below)   |
 * | 4      | 8    | timestamp, microseconds, uint64 big-endian |
 *
 * Stream id: server → client, one per remote sender (a group call has several), announced
 * by a JSON `{ op: "stream", streamId, ssrc, participantJid }` before its first frame.
 * Feed each stream id to its own decoder. Client → server sends `0`.
 *
 * A fixed header keeps the payload untouched (no base64 / JSON) and lets browsers feed
 * WebCodecs `EncodedVideoChunk` directly.
 */

export const VIDEO_FRAME_VERSION = 1
export const VIDEO_FRAME_HEADER_BYTES = 12
const FLAG_KEY_FRAME = 0x01

export type VideoFrame = {
  keyFrame: boolean
  /** Remote sender (server → client); `0` from the client and on 1:1 calls. */
  streamId?: number
  timestampUs: number
  /** Annex-B access unit (view into the source buffer — copy if you keep it). */
  data: Uint8Array
}

/** @example ws.send(encodeVideoFrame({ keyFrame: true, timestampUs: 0, data: au })) */
export function encodeVideoFrame(frame: VideoFrame): Buffer {
  const out = Buffer.allocUnsafe(VIDEO_FRAME_HEADER_BYTES + frame.data.byteLength)
  out[0] = VIDEO_FRAME_VERSION
  out[1] = frame.keyFrame ? FLAG_KEY_FRAME : 0
  out.writeUInt16BE((frame.streamId ?? 0) & 0xffff, 2)
  out.writeBigUInt64BE(BigInt(Math.max(0, Math.floor(frame.timestampUs))), 4)
  out.set(frame.data, VIDEO_FRAME_HEADER_BYTES)
  return out
}

/** Parse a client frame; null when the header is short, the version unknown, or the payload empty. */
export function decodeVideoFrame(buf: Uint8Array): VideoFrame | null {
  if (buf.byteLength <= VIDEO_FRAME_HEADER_BYTES) return null
  if (buf[0] !== VIDEO_FRAME_VERSION) return null
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength)
  return {
    keyFrame: ((buf[1] ?? 0) & FLAG_KEY_FRAME) !== 0,
    streamId: view.getUint16(2),
    timestampUs: Number(view.getBigUint64(4)),
    data: buf.subarray(VIDEO_FRAME_HEADER_BYTES),
  }
}

const RTP_CLOCK_HZ = 90_000
const RTP_WRAP = 2 ** 32

/**
 * Map 32-bit RTP video timestamps (90 kHz, random start, wraps every ~13 h) to a
 * monotonic microsecond clock starting at 0 for the first frame.
 *
 * @example
 * const toUs = createRtpVideoClock()
 * toUs(frame.timestamp) // 0, 33333, 66667, …
 */
export function createRtpVideoClock(): (rtpTimestamp: number) => number {
  let base: number | null = null
  let lastExtended = 0
  return (rtpTimestamp) => {
    const ts = rtpTimestamp >>> 0
    if (base === null) {
      base = ts
      lastExtended = ts
      return 0
    }
    // Pick the unwrap (previous / same / next 2^32 cycle) closest to the last frame —
    // handles forward wraps and slightly reordered frames alike.
    const cycle = Math.floor(lastExtended / RTP_WRAP) * RTP_WRAP
    const candidates = [cycle - RTP_WRAP + ts, cycle + ts, cycle + RTP_WRAP + ts]
    let extended = cycle + ts
    for (const c of candidates) {
      if (Math.abs(c - lastExtended) < Math.abs(extended - lastExtended)) extended = c
    }
    if (extended > lastExtended) lastExtended = extended
    return Math.max(0, Math.round(((extended - base) * 1_000_000) / RTP_CLOCK_HZ))
  }
}
