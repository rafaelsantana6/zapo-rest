import type { Env } from '~/config/env'
import type { InstanceRecord } from '~/instances/types'

export function makeEnv(overrides: Partial<Env> = {}): Env {
  return {
    NODE_ENV: 'test',
    HOST: '127.0.0.1',
    PORT: 3099,
    LOG_LEVEL: 'fatal',
    ADMIN_API_KEY: 'test-admin-api-key-min-16',
    DATABASE_URL: 'postgresql://zapo:zapo@127.0.0.1:5432/zapo_test',
    AUTO_CONNECT_ON_BOOT: false,
    RECONNECT_MAX_ATTEMPTS: 3,
    WEBHOOK_TIMEOUT_MS: 1000,
    VOIP_MAX_CONCURRENT_CALLS: 5,
    VOIP_END_CALL_ON_WS_CLOSE: false,
    WAM_ENABLED: false,
    MEDIA_TMP_DIR: '/tmp/zapo-rest-test-media',
    HISTORY_SYNC_ENABLED: false,
    HISTORY_REQUIRE_FULL_SYNC: false,
    MEDIA_AUTO_DOWNLOAD: false,
    PROFILE_PICTURE_CACHE_TTL_SECONDS: 86_400,
    AVATAR_FETCH_TYPES: 'both',
    MEDIA_UPLOAD_MAX_BYTES: 100 * 1024 * 1024,
    MEDIA_STORAGE: 'local',
    MEDIA_LOCAL_DIR: '/tmp/zapo-rest-test-media/objects',
    S3_REGION: 'us-east-1',
    S3_FORCE_PATH_STYLE: true,
    WEBHOOK_WORKER_INTERVAL_MS: 60_000,
    WEBHOOK_DEFAULT_ATTEMPTS: 5,
    MEDIA_REDIRECT_DOWNLOADS: true,
    MEDIA_PRESIGN_TTL_SECONDS: 3600,
    RATE_LIMIT_ENABLED: false,
    RATE_LIMIT_MAX: 300,
    RATE_LIMIT_TIME_WINDOW_MS: 60_000,
    TRUST_PROXY: false,
    TRUST_PROXY_HOPS: 1,
    SSE_MAX_CONNECTIONS: 200,
    SSE_MAX_CONNECTIONS_PER_ACTOR: 10,
    HISTORY_IMPORT_DEBOUNCE_MS: 0,
    MEDIA_DOWNLOAD_CONCURRENCY: 4,
    CALL_RECORDING_MAX_SECONDS: 7200,
    STT_ENABLED: false,
    STT_TEMPERATURE: 0.5,
    ...overrides,
  } as Env
}

export function makeInstance(overrides: Partial<InstanceRecord> = {}): InstanceRecord {
  const now = new Date()
  return {
    name: 'sales-1',
    apiKey: 'zr_test_sales_1',
    webhookUrl: null,
    webhookEvents: [],
    status: 'open',
    meJid: '5511999999999:1@s.whatsapp.net',
    pushName: null,
    pairPhone: null,
    lastQr: null,
    lastQrAt: null,
    config: {},
    createdAt: now,
    updatedAt: now,
    ...overrides,
  }
}

/** Minimal zapo-shaped inbound text message event. */
export function textMessageEvent(opts?: {
  id?: string
  remoteJid?: string
  remoteJidAlt?: string
  fromMe?: boolean
  text?: string
  pushName?: string
  timestampSeconds?: number
}) {
  return {
    key: {
      id: opts?.id ?? 'MSG001',
      remoteJid: opts?.remoteJid ?? '5511888888888@s.whatsapp.net',
      remoteJidAlt: opts?.remoteJidAlt,
      fromMe: opts?.fromMe ?? false,
    },
    message: {
      conversation: opts?.text ?? 'hello from tests',
    },
    pushName: opts?.pushName ?? 'Cliente',
    timestampSeconds: opts?.timestampSeconds ?? 1_700_000_000,
  }
}

export function imageMessageEvent(opts?: { id?: string; url?: string }) {
  return {
    key: {
      id: opts?.id ?? 'IMG001',
      remoteJid: '5511888888888@s.whatsapp.net',
      fromMe: false,
    },
    message: {
      imageMessage: {
        mimetype: 'image/jpeg',
        url: opts?.url ?? 'https://mmg.whatsapp.net/v/t62.7118-24/fake.jpg',
        caption: 'foto',
      },
    },
    pushName: 'Cliente',
    timestampSeconds: 1_700_000_100,
  }
}

export function receiptEvent(opts?: { messageIds?: string[]; status?: string | number; id?: string }) {
  return {
    messageIds: opts?.messageIds ?? (opts?.id ? [opts.id] : ['MSG001']),
    status: opts?.status ?? 'delivered',
  }
}

export function revokeProtocolEvent(messageId: string) {
  return {
    key: { id: 'PROTO1', remoteJid: '5511888888888@s.whatsapp.net', fromMe: true },
    message: {
      protocolMessage: {
        type: 'REVOKE',
        key: { id: messageId },
      },
    },
  }
}

export function editProtocolEvent(messageId: string, text: string) {
  return {
    key: { id: 'PROTO2', remoteJid: '5511888888888@s.whatsapp.net', fromMe: true },
    message: {
      protocolMessage: {
        type: 'MESSAGE_EDIT',
        key: { id: messageId },
        editedMessage: { conversation: text },
      },
    },
  }
}
