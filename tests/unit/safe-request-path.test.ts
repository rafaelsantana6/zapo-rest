import { describe, expect, it } from 'vitest'
import { safeRequestPath } from '~/plugins/error-handler'

describe('safeRequestPath', () => {
  it('strips query string including apiKey', () => {
    expect(safeRequestPath('/v1/events?apiKey=super-secret&instance=a')).toBe('/v1/events')
  })

  it('returns path unchanged when no query', () => {
    expect(safeRequestPath('/v1/instance')).toBe('/v1/instance')
  })

  it('handles empty', () => {
    expect(safeRequestPath(undefined)).toBe('')
    expect(safeRequestPath('')).toBe('')
  })
})
