import { describe, expect, it } from 'vitest'
import { isAnsweredCallState } from '~/voip/recording-manager'

describe('isAnsweredCallState', () => {
  it('is false while ringing / initiating', () => {
    expect(isAnsweredCallState('ringing')).toBe(false)
    expect(isAnsweredCallState('incoming_ringing')).toBe(false)
    expect(isAnsweredCallState('initiating')).toBe(false)
    expect(isAnsweredCallState(null)).toBe(false)
    expect(isAnsweredCallState(undefined)).toBe(false)
    expect(isAnsweredCallState('ended')).toBe(false)
  })

  it('is true after answer / media path', () => {
    expect(isAnsweredCallState('connecting')).toBe(true)
    expect(isAnsweredCallState('active')).toBe(true)
    expect(isAnsweredCallState('on_hold')).toBe(true)
    expect(isAnsweredCallState('on-hold')).toBe(true)
    expect(isAnsweredCallState('On_Hold')).toBe(true)
  })
})
