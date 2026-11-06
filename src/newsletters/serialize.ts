import type {
  BinaryNode,
  WaClient,
  WaIncomingNewsletterEvent,
  WaIncomingNewsletterMessageUpdateEvent,
  WaMessagePublishResult,
} from 'zapo-js'
import { decodeIncomingMessage } from '~/events/decode-message'
import {
  NewsletterAdminSchema,
  NewsletterDirectorySchema,
  NewsletterFollowersSchema,
  NewsletterMetadataSchema,
  NewsletterMessageUpdateEventSchema,
  type NewsletterNodeSchema,
  NewsletterPublishResultSchema,
  NewsletterUpdateEventSchema,
} from '~/http/newsletter-schemas'
import { notFound } from '~/lib/errors'

type Newsletter = WaClient['newsletter']

export function serializeNewsletter(metadata: Awaited<ReturnType<Newsletter['fetch']>>) {
  if (!metadata.jid || metadata.state === 'NON_EXISTING') throw notFound('Channel not found on WhatsApp')
  return NewsletterMetadataSchema.parse(metadata)
}

export function serializeDirectory(directory: Awaited<ReturnType<Newsletter['searchDirectory']>>) {
  return NewsletterDirectorySchema.parse({
    results: directory.results.map(serializeNewsletter),
    pageInfo: directory.pageInfo,
  })
}

export function serializeFollowers(page: Awaited<ReturnType<Newsletter['fetchFollowers']>>) {
  return NewsletterFollowersSchema.parse(page)
}

export function serializeAdmin(
  info: Awaited<ReturnType<Newsletter['fetchAdminInfo']>>,
  capabilities: ReadonlySet<string>,
) {
  return NewsletterAdminSchema.parse({ ...info, capabilities: [...capabilities].sort() })
}

export function serializePublish(result: WaMessagePublishResult) {
  return NewsletterPublishResultSchema.parse({
    id: result.id,
    attempts: result.attempts,
    ack: {
      timestamp: result.ack.t,
      refreshLid: result.ack.refreshLid,
      count: result.ack.count,
      error: result.ack.error,
    },
  })
}

/** Encode a transport envelope without interpreting newsletter stanzas. */
export function serializeNewsletterNode(node: BinaryNode): import('zod').infer<typeof NewsletterNodeSchema> {
  return {
    name: node.tag,
    attributes: { ...node.attrs },
    ...(Array.isArray(node.content) ? { children: node.content.map(serializeNewsletterNode) } : {}),
    ...(node.content instanceof Uint8Array ? { bytesBase64: Buffer.from(node.content).toString('base64') } : {}),
    ...(typeof node.content === 'string' ? { text: node.content } : {}),
  }
}

export function serializeNewsletterEvent(event: WaIncomingNewsletterEvent) {
  // Unknown nested bags may carry protobuf / transport internals; keep only scalar details.
  const details: Record<string, string | number | boolean | null> = {}
  for (const [key, value] of Object.entries(event.details ?? {})) {
    if (value === null || typeof value === 'string' || typeof value === 'boolean') details[key] = value
    if (typeof value === 'number' && Number.isFinite(value)) details[key] = value
    if (typeof value === 'bigint') details[key] = value.toString()
  }
  return NewsletterUpdateEventSchema.parse({
    jid: event.newsletterJid,
    action: event.action,
    subType: event.subType,
    stanzaId: event.stanzaId,
    offline: event.offline,
    details,
  })
}

export function serializeNewsletterMessageUpdate(event: WaIncomingNewsletterMessageUpdateEvent) {
  const { update } = event
  let publicUpdate: unknown = update
  if (update.kind === 'edit') {
    const decoded = decodeIncomingMessage({
      key: { remoteJid: event.chatJid, id: event.stanzaId ?? 'edit' },
      message: update.message,
    })
    publicUpdate = {
      kind: 'edit',
      content: {
        type: decoded?.type ?? 'unknown',
        text: decoded?.body ?? null,
        caption: decoded?.caption ?? null,
        mimetype: decoded?.mediaMime ?? null,
        fileName: decoded?.mediaFilename ?? null,
      },
    }
  }
  if (update.kind === 'poll_vote') {
    publicUpdate = {
      kind: 'poll_vote',
      isSender: update.isSender,
      votes: update.votes.map((vote) => ({
        optionHash: Buffer.from(vote.optionHash).toString('base64'),
        count: vote.count,
      })),
    }
  }
  return NewsletterMessageUpdateEventSchema.parse({
    jid: event.chatJid,
    stanzaId: event.stanzaId,
    timestampSeconds: event.timestampSeconds,
    serverId: event.parentMessageServerId,
    offline: event.offline,
    update: publicUpdate,
  })
}
