import { describe, expect, it } from 'vitest'
import {
  createRtpVideoClock,
  decodeVideoFrame,
  encodeVideoFrame,
  VIDEO_FRAME_HEADER_BYTES,
  VIDEO_FRAME_VERSION,
} from '~/voip/video-frame'

const ACCESS_UNIT = new Uint8Array([0, 0, 0, 1, 0x65, 0x88, 0x84])

describe('video frame codec', () => {
  it('round-trips the stream id of a group sender', () => {
    const buf = encodeVideoFrame({ keyFrame: false, streamId: 3, timestampUs: 1, data: ACCESS_UNIT })
    expect(decodeVideoFrame(buf)?.streamId).toBe(3)
  })

  it('round-trips key flag, timestamp and payload', () => {
    const buf = encodeVideoFrame({ keyFrame: true, timestampUs: 1_234_567, data: ACCESS_UNIT })
    expect(buf.byteLength).toBe(VIDEO_FRAME_HEADER_BYTES + ACCESS_UNIT.byteLength)
    expect(buf[0]).toBe(VIDEO_FRAME_VERSION)

    const frame = decodeVideoFrame(buf)
    expect(frame?.keyFrame).toBe(true)
    expect(frame?.timestampUs).toBe(1_234_567)
    expect(Array.from(frame?.data ?? [])).toEqual(Array.from(ACCESS_UNIT))
  })

  it('decodes delta frames from an offset view (Buffer pool slice)', () => {
    const encoded = encodeVideoFrame({ keyFrame: false, timestampUs: 33_333, data: ACCESS_UNIT })
    const pooled = new Uint8Array(encoded.byteLength + 5)
    pooled.set(encoded, 5)
    const frame = decodeVideoFrame(pooled.subarray(5))
    expect(frame?.keyFrame).toBe(false)
    expect(frame?.timestampUs).toBe(33_333)
  })

  it('rejects short frames, empty payloads and unknown versions', () => {
    expect(decodeVideoFrame(new Uint8Array(4))).toBeNull()
    expect(decodeVideoFrame(new Uint8Array(VIDEO_FRAME_HEADER_BYTES))).toBeNull()
    const wrongVersion = encodeVideoFrame({ keyFrame: false, timestampUs: 0, data: ACCESS_UNIT })
    wrongVersion[0] = 9
    expect(decodeVideoFrame(wrongVersion)).toBeNull()
  })

  it('clamps negative timestamps to 0', () => {
    const frame = decodeVideoFrame(encodeVideoFrame({ keyFrame: false, timestampUs: -5, data: ACCESS_UNIT }))
    expect(frame?.timestampUs).toBe(0)
  })
})

describe('createRtpVideoClock', () => {
  it('starts at 0 and converts 90 kHz ticks to microseconds', () => {
    const toUs = createRtpVideoClock()
    expect(toUs(1_000_000)).toBe(0)
    expect(toUs(1_003_000)).toBe(33_333)
    expect(toUs(1_090_000)).toBe(1_000_000)
  })

  it('stays monotonic across the 32-bit wrap', () => {
    const toUs = createRtpVideoClock()
    const start = 2 ** 32 - 3000
    expect(toUs(start)).toBe(0)
    expect(toUs(0)).toBe(33_333)
    expect(toUs(3000)).toBe(66_667)
  })

  it('maps a frame reordered across the wrap to its earlier time', () => {
    const toUs = createRtpVideoClock()
    toUs(2 ** 32 - 6000)
    toUs(1000) // wrapped
    expect(toUs(2 ** 32 - 3000)).toBe(33_333) // late frame from before the wrap
    expect(toUs(4000)).toBe(111_111)
  })
})
