import { randomBytes, timingSafeEqual } from 'node:crypto'

const KEY_BYTES = 24

/** Generate a URL-safe instance API key (e.g. `zr_...`). */
export function generateApiKey(prefix = 'zr'): string {
  return `${prefix}_${randomBytes(KEY_BYTES).toString('base64url')}`
}

/** Constant-time string equality (pads to same length first). */
export function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a)
  const bufB = Buffer.from(b)
  if (bufA.length !== bufB.length) {
    // Still run a compare to reduce timing leaks on length
    const pad = Buffer.alloc(bufA.length)
    timingSafeEqual(bufA, pad)
    return false
  }
  return timingSafeEqual(bufA, bufB)
}
