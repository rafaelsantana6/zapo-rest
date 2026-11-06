import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { createNoopLogger, type WaSendMessageContent } from 'zapo-js'
import type {
  buildMediaMessageContent as BuildMediaMessageContent,
  WaBuildMessageContext,
  WaMediaMessageOptions,
} from '../../node_modules/zapo-js/dist/client/messaging/messages'
import type { WaMessageDispatchCoordinator as DispatchCoordinator } from '../../node_modules/zapo-js/dist/client/coordinators/WaMessageDispatchCoordinator'

// Only tests load internals: exercise the installed builder and dispatcher without network access.
const require = createRequire(import.meta.url)
const dist = dirname(require.resolve('zapo-js'))
export const buildMediaMessageContent: typeof BuildMediaMessageContent = (
  require(
    join(dist, 'client/messaging/messages.js'),
  ) as typeof import('../../node_modules/zapo-js/dist/client/messaging/messages')
).buildMediaMessageContent
export const { WaMessageDispatchCoordinator } = require(
  join(dist, 'client/coordinators/WaMessageDispatchCoordinator.js'),
) as {
  WaMessageDispatchCoordinator: typeof DispatchCoordinator
}

export class FakeMediaTransfer {
  uploads: { contentType?: string; size: number }[] = []
  async uploadStream(input: { body: Uint8Array | AsyncIterable<Uint8Array>; contentType?: string }) {
    let size = 0
    if (input.body instanceof Uint8Array) size = input.body.byteLength
    else for await (const chunk of input.body) size += chunk.byteLength
    this.uploads.push({ contentType: input.contentType, size })
    return { status: 200 }
  }
  async readResponseBytes() {
    return new TextEncoder().encode(JSON.stringify({ url: 'https://media.example.com/upload', direct_path: '/upload' }))
  }
}

export function fakeMediaOptions(mediaTransfer = new FakeMediaTransfer()): WaMediaMessageOptions {
  return {
    logger: createNoopLogger(),
    mediaTransfer,
    queryWithContext: async () => {
      throw new Error('unexpected media connection query')
    },
    getMediaConnCache: () => ({
      auth: 'fake-auth',
      expiresAtMs: Date.now() + 60000,
      hosts: [{ hostname: 'media.example.com', isFallback: false }],
    }),
    setMediaConnCache: () => undefined,
    serverClock: { nowMs: () => Date.now(), nowSeconds: () => Math.floor(Date.now() / 1000) },
  } as unknown as WaMediaMessageOptions
}

export function fakeDispatchOptions(
  emitMessageSend: ConstructorParameters<typeof DispatchCoordinator>[0]['emitMessageSend'],
  stopBeforeEncryption: Error,
): ConstructorParameters<typeof DispatchCoordinator>[0] {
  return {
    logger: createNoopLogger(),
    emitMessageSend,
    buildMessageContent: (content: WaSendMessageContent, ctx?: WaBuildMessageContext) =>
      buildMediaMessageContent(fakeMediaOptions(), content, ctx),
    serverClock: { nowMs: () => Date.now(), nowSeconds: () => Math.floor(Date.now() / 1000) },
    getCurrentCredentials: () => ({ meJid: '5511888888888@s.whatsapp.net', meLid: '888888888@lid' }),
    groupMetadataCache: { resolveEphemeralSettings: async () => ({ expirationSeconds: 604800 }) },
    chatMetadataStore: {
      getChatMetadata: async () => ({ ephemeralExpiration: 604800, ephemeralSettingTimestamp: 1700000000 }),
    },
    signalStore: {
      getRegistrationInfo: async () => {
        throw stopBeforeEncryption
      },
    },
    messageSecretStore: { set: async () => undefined },
  } as unknown as ConstructorParameters<typeof DispatchCoordinator>[0]
}
