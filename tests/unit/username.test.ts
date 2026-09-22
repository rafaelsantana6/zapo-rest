import { describe, expect, it } from 'vitest'
import { isUsernameRecipient } from '~/lib/username'

describe('isUsernameRecipient', () => {
  it('accepts @handle and a key suffix', () => {
    expect(isUsernameRecipient('@loja')).toBe(true)
    expect(isUsernameRecipient('  @loja:1234  ')).toBe(true)
  })

  it('rejects phones, JIDs, and reserved servers', () => {
    expect(isUsernameRecipient('5511999999999')).toBe(false)
    expect(isUsernameRecipient('5511999999999@s.whatsapp.net')).toBe(false)
    expect(isUsernameRecipient('120363@g.us')).toBe(false)
    expect(isUsernameRecipient('abc@lid')).toBe(false)
    expect(isUsernameRecipient('@lid')).toBe(false)
    expect(isUsernameRecipient('@g.us')).toBe(false)
    expect(isUsernameRecipient('@a b')).toBe(false)
  })
})
