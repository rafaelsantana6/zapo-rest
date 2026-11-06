import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { Readable } from 'node:stream'
import { vi } from 'vitest'
import {
  createNoopLogger,
  type BinaryNode,
  type Logger,
  type WaClient,
  type WaMediaConn,
  WaMediaTransferClient,
} from 'zapo-js'
import { newsletterPublishResult } from './fake-newsletter'

type CoordinatorDeps = {
  logger: Logger
  mexSocket: { query: (node: BinaryNode) => Promise<BinaryNode> }
  queryWithContext: (context: string, node: BinaryNode) => Promise<BinaryNode>
  sendNode: (node: BinaryNode) => Promise<void>
  generateStanzaId: () => Promise<string>
  publishMessageNode: (node: BinaryNode) => Promise<typeof newsletterPublishResult>
  mediaTransfer: WaMediaTransferClient
  getMediaConn: () => Promise<WaMediaConn>
}

// Test-only access: production continues to use the public client.newsletter surface.
// Loading the installed coordinator keeps builders, MEX parsing and media requirements real.
const require = createRequire(import.meta.url)
const { createNewsletterCoordinator } = require(
  join(dirname(require.resolve('zapo-js')), 'client/coordinators/WaNewsletterCoordinator.js'),
) as {
  createNewsletterCoordinator: (deps: CoordinatorDeps) => WaClient['newsletter']
}

class FakeNewsletterMediaTransfer extends WaMediaTransferClient {
  override async uploadStream(request: Parameters<WaMediaTransferClient['uploadStream']>[0]) {
    if (request.body instanceof Readable) {
      for await (const _chunk of request.body) {
        /* Consume the actual upstream file stream without a network. */
      }
    }
    return {
      url: request.url ?? '',
      status: 200,
      ok: true,
      headers: {},
      body: Readable.from([
        JSON.stringify({ url: 'https://cdn.example.com/image', direct_path: '/image', handle: 'handle' }),
      ]),
    }
  }
}

/** Real SDK coordinator; only WhatsApp queries, uploads and publish acknowledgments are faked. */
export function upstreamNewsletterClient() {
  async function fakeMexQuery(_node: BinaryNode): Promise<BinaryNode> {
    return {
      tag: 'iq',
      attrs: { type: 'result' },
      content: [
        { tag: 'result', attrs: { format: 'json' }, content: JSON.stringify({ data: { xwa2_newsletter: null } }) },
      ],
    }
  }
  async function fakeQueryWithContext(_context: string, _node: BinaryNode): Promise<BinaryNode> {
    return { tag: 'iq', attrs: { type: 'result' } }
  }
  async function fakePublish(_node: BinaryNode) {
    return newsletterPublishResult
  }
  async function fakeSendNode(_node: BinaryNode) {}
  const query = vi.fn(fakeMexQuery)
  const queryWithContext = vi.fn(fakeQueryWithContext)
  const publish = vi.fn(fakePublish)
  const mediaTransfer = new FakeNewsletterMediaTransfer()
  const upload = vi.spyOn(mediaTransfer, 'uploadStream')
  const newsletter = createNewsletterCoordinator({
    logger: createNoopLogger(),
    mexSocket: { query },
    queryWithContext,
    publishMessageNode: publish,
    sendNode: fakeSendNode,
    generateStanzaId: async () => 'CHANNEL01',
    mediaTransfer,
    getMediaConn: async () => ({
      auth: 'fake',
      expiresAtMs: Date.now() + 60_000,
      hosts: [{ hostname: 'cdn.example.com', isFallback: false }],
    }),
  })
  return { newsletter, query, queryWithContext, publish, upload }
}
