import { describe, expect, it } from 'vitest'
import { ChatMuteBodySchema } from '~/http/openapi-schemas'
import { chatMuteEnd, MUTE_FOREVER_MS } from '~/lib/chat-actions'

const now = Date.parse('2026-01-01T00:00:00Z')
describe('chat mute timer mapping', () => {
  it('maps ISO timezone offsets to epoch ms', () => {
    expect(chatMuteEnd({ muted: true, until: '2026-01-01T04:00:00+02:00' }, now)).toBe(now + 7200000)
  })
  it('maps duration relative to the supplied clock', () => {
    expect(chatMuteEnd({ muted: true, durationSeconds: 90 }, now)).toBe(now + 90000)
  })
  it('supplies the year-9999 forever sentinel', () => {
    expect(chatMuteEnd({ muted: true }, now)).toBe(MUTE_FOREVER_MS)
  })
  it('unmuting sends no end', () => {
    expect(chatMuteEnd({ muted: false }, now)).toBeUndefined()
  })
  it.each(['invalid', '2025-01-01T00:00:00Z', '2026-01-01T00:00:00Z'])(
    'rejects an invalid or nonfuture end: %s',
    (until) => {
      expect(() => chatMuteEnd({ muted: true, until }, now)).toThrow()
    },
  )
  it('rejects an overflowing duration', () => {
    expect(() => chatMuteEnd({ muted: true, durationSeconds: Number.MAX_SAFE_INTEGER }, now)).toThrow()
  })
  it('rejects ambiguous timers and a timer on unmute', () => {
    expect(
      ChatMuteBodySchema.safeParse({ muted: true, until: '2090-01-01T00:00:00Z', durationSeconds: 1 }).success,
    ).toBe(false)
    expect(ChatMuteBodySchema.safeParse({ muted: false, durationSeconds: 1 }).success).toBe(false)
  })
})
