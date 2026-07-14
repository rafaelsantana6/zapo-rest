export type InstanceStatus = 'created' | 'connecting' | 'qr' | 'pairing' | 'open' | 'close' | 'logged_out'

export type InstanceConfig = {
  callRecordingEnabled?: boolean
  [key: string]: unknown
}

export type InstanceRecord = {
  name: string
  /** Plaintext instance API key (auth + list/get). */
  apiKey: string
  webhookUrl: string | null
  webhookEvents: string[]
  status: InstanceStatus
  meJid: string | null
  /** WhatsApp push name (display name) when known. */
  pushName: string | null
  pairPhone: string | null
  lastQr: string | null
  lastQrAt: Date | null
  config: InstanceConfig
  createdAt: Date
  updatedAt: Date
}

export type CreateInstanceInput = {
  name: string
  webhookUrl?: string | null
  webhookEvents?: string[]
  pairPhone?: string | null
}

/** Public instance JSON for list/get/create/connect responses. */
export type PublicInstance = {
  name: string
  /** Instance API key (plaintext) — same value used for auth. */
  apiKey: string
  webhookUrl: string | null
  webhookEvents: string[]
  status: InstanceStatus
  meJid: string | null
  /** WhatsApp display / push name when known. */
  pushName: string | null
  /** Profile picture URL (storage public URL or authenticated profile-picture path). */
  avatarUrl: string | null
  pairPhone: string | null
  lastQr: string | null
  lastQrAt: string | null
  callRecordingEnabled: boolean
  createdAt: string
  updatedAt: string
}

export function toPublicInstance(
  row: InstanceRecord,
  extras?: { avatarUrl?: string | null; pushName?: string | null; apiKey?: string },
): PublicInstance {
  const pushName = extras?.pushName !== undefined ? extras.pushName : (row.pushName ?? null)
  const apiKey = extras?.apiKey ?? row.apiKey
  if (!apiKey) {
    throw new Error(`instance "${row.name}" is missing apiKey — database integrity error`)
  }
  return {
    name: row.name,
    apiKey,
    webhookUrl: row.webhookUrl,
    webhookEvents: row.webhookEvents,
    status: row.status,
    meJid: row.meJid,
    pushName,
    avatarUrl: extras?.avatarUrl ?? null,
    pairPhone: row.pairPhone,
    lastQr: row.lastQr,
    lastQrAt: row.lastQrAt?.toISOString() ?? null,
    callRecordingEnabled: Boolean(row.config?.callRecordingEnabled),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}
