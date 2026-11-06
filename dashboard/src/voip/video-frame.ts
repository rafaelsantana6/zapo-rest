/**
 * Browser side of the video WS framing (server: `src/voip/video-frame.ts`).
 * 12-byte header: u8 version=1 · u8 flags (bit0 key frame) · u16 BE stream id · u64 BE timestamp µs,
 * followed by one H.264 Annex-B access unit. Stream id = one remote sender (several on a group
 * call); feed each to its own decoder. We send 0.
 */

export const VIDEO_FRAME_HEADER_BYTES = 12
const VIDEO_FRAME_VERSION = 1

export type WireVideoFrame = { keyFrame: boolean; streamId: number; timestampUs: number; data: Uint8Array }

export function encodeWireFrame(keyFrame: boolean, timestampUs: number, data: Uint8Array): ArrayBuffer {
  const out = new ArrayBuffer(VIDEO_FRAME_HEADER_BYTES + data.byteLength)
  const view = new DataView(out)
  view.setUint8(0, VIDEO_FRAME_VERSION)
  view.setUint8(1, keyFrame ? 1 : 0)
  view.setBigUint64(4, BigInt(Math.max(0, Math.floor(timestampUs))))
  new Uint8Array(out, VIDEO_FRAME_HEADER_BYTES).set(data)
  return out
}

export function decodeWireFrame(buf: ArrayBuffer): WireVideoFrame | null {
  if (buf.byteLength <= VIDEO_FRAME_HEADER_BYTES) return null
  const view = new DataView(buf)
  if (view.getUint8(0) !== VIDEO_FRAME_VERSION) return null
  return {
    keyFrame: (view.getUint8(1) & 1) !== 0 || hasEntryNal(new Uint8Array(buf, VIDEO_FRAME_HEADER_BYTES)),
    streamId: view.getUint16(2),
    timestampUs: Number(view.getBigUint64(4)),
    data: new Uint8Array(buf, VIDEO_FRAME_HEADER_BYTES),
  }
}

/**
 * WebCodecs codec string from the SPS inside an Annex-B key frame (`avc1.PPCCLL`),
 * so the decoder matches whatever profile the phone encodes with.
 */
export function avcCodecFromAnnexB(data: Uint8Array): string | null {
  for (let i = 0; i + 6 < data.length; i++) {
    const startCode3 = data[i] === 0 && data[i + 1] === 0 && data[i + 2] === 1
    if (!startCode3) continue
    const nalType = (data[i + 3] ?? 0) & 0x1f
    if (nalType !== 7) continue
    const hex = [data[i + 4], data[i + 5], data[i + 6]].map((b) => (b ?? 0).toString(16).padStart(2, '0')).join('')
    return `avc1.${hex.toUpperCase()}`
  }
  return null
}

/** IDR (5) or SPS (7) present — decoder can start here even if the sender forgot the flag. */
function hasEntryNal(data: Uint8Array): boolean {
  for (let i = 0; i + 3 < data.length; i++) {
    if (data[i] !== 0 || data[i + 1] !== 0 || data[i + 2] !== 1) continue
    const nalType = (data[i + 3] ?? 0) & 0x1f
    if (nalType === 5 || nalType === 7) return true
  }
  return false
}
