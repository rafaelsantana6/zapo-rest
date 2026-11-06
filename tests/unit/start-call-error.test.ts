import { describe, expect, it } from 'vitest'
import { isNotOnWhatsAppError } from '~/voip/start-call-error'

describe('isNotOnWhatsAppError', () => {
  it('matches the voip plugin error for numbers without devices', () => {
    const err = new Error('no device sessions to encrypt the call offer for 556851159096@s.whatsapp.net')
    expect(isNotOnWhatsAppError(err)).toBe(true)
  })

  it('ignores other failures', () => {
    expect(isNotOnWhatsAppError(new Error('max concurrent calls reached (1)'))).toBe(false)
    expect(isNotOnWhatsAppError('no device sessions to encrypt the call offer')).toBe(false)
  })
})
