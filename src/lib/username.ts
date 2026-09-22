/**
 * `@handle` addressing. A leading `@` that is not a JID (`@g.us`, `@lid`, …).
 * zapo accepts the same shape, including a `:1234` key suffix.
 */
const RESERVED_HANDLES = new Set(['g.us', 's.whatsapp.net', 'c.us', 'lid', 'broadcast', 'newsletter'])

export function isUsernameRecipient(input: string): boolean {
  const value = input.trim()
  if (!value.startsWith('@') || value.includes(' ') || value.slice(1).includes('@')) return false
  const handle = value.slice(1).split(':')[0]?.toLowerCase()
  if (!handle || RESERVED_HANDLES.has(handle)) return false
  return true
}
