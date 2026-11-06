import type { WaGroupEvent, WaMembershipRequest } from 'zapo-js'
import type { z } from 'zod'
import type { GroupMembershipRequestSchema } from '~/http/openapi-schemas'
import { conflict, forbidden, notFound, serviceUnavailable } from '~/lib/errors'
import { parseWaIqError } from '~/lib/wa-iq-error'

/** Serialize upstream epoch seconds and requester metadata for the REST contract. */
export function serializeMembershipRequest(request: WaMembershipRequest): z.infer<typeof GroupMembershipRequestSchema> {
  return {
    jid: request.jid,
    phoneNumber: request.requestorPhone,
    requestedAt: new Date(request.requestTime * 1000).toISOString(),
    method: request.requestMethod,
    requestor: request.requestor,
    requestorUsername: request.requestorUsername,
    parentGroupJid: request.parentGroupJid,
  }
}

/** Keep the existing group payload and add explicit membership request identities. */
export function serializeMembershipGroupEvent(event: WaGroupEvent) {
  if (event.action === 'membership_approval_request') {
    return { ...event, type: event.action, requesterJid: event.authorJid }
  }
  if (event.action === 'created_membership_requests') {
    return { ...event, type: event.action, requests: event.membershipRequests ?? [] }
  }
  if (event.action === 'revoked_membership_requests') {
    return { ...event, type: event.action, requests: event.participants ?? [] }
  }
  return event
}

/** Preserve WhatsApp's message while mapping known IQ failures to HTTP errors. */
export function throwMembershipError(error: unknown): never {
  if (!(error instanceof Error)) throw error
  const message = error.message
  const iq = parseWaIqError(error)
  if (/\(409:/.test(message) || /(?:membership[_ -]?)?approval[_ -]mode.*(?:off|disabled|not enabled)/i.test(message)) {
    throw conflict(message)
  }
  if (iq?.kind === 'privacy' || /not[- ](?:an?[- ])?admin/i.test(message)) throw forbidden(message)
  if (iq?.kind === 'not_found') throw notFound(message)
  if (iq?.kind === 'unavailable') throw serviceUnavailable(message)
  throw error
}
