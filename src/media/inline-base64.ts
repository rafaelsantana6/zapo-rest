export type InlineMedia = { base64: string; mimetype?: string }

/** Validate before Buffer.from, which silently ignores malformed base64 characters. */
export function parseInlineBase64(value: string): InlineMedia | null {
  let base64 = value.trim()
  let mimetype: string | undefined
  if (/^data:/i.test(base64)) {
    const uri = /^data:([a-z0-9.+-]+\/[a-z0-9.+-]+)?;base64,([\s\S]*)$/i.exec(base64)
    if (!uri) return null
    mimetype = uri[1]?.toLowerCase()
    base64 = uri[2] ?? ''
  }
  base64 = base64.replace(/\s/g, '')
  if (!base64 || base64.length % 4 === 1 || !/^[A-Za-z0-9+/]*={0,2}$/.test(base64)) return null
  if (base64.includes('=') && base64.length % 4 !== 0) return null
  return { base64, ...(mimetype ? { mimetype } : {}) }
}
