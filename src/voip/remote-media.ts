import type { EventEmitter } from 'node:events'
import type { WebSocket } from 'ws'
import type { VoipWaClient } from '~/instances/wa-client'
import { decodeCallMediaEvent, encodeCallMediaMessage, type CallMediaMessage } from '~/voip/media-wire'
import { resolveLiveCall } from '~/voip/call-serialize'

type PrivatePlan = { message: CallMediaMessage }

/** Private instance-scoped transport. No logger, bus, persistence, or webhook dependency. */
export function attachRemoteMedia(client: VoipWaClient, socket: WebSocket, authorize: () => Promise<boolean>) {
  let closed = false
  let sending: Promise<void> = Promise.resolve()
  let receiving: Promise<void> = Promise.resolve()
  let queuedBytes = 0
  let queuedEvents = 0
  const ensureAuthorized = async () => {
    if (closed || socket.readyState !== socket.OPEN) return false
    const allowed = await authorize()
    // Closing/replacing a binding during the lookup must not affect its successor.
    if (closed || socket.readyState !== socket.OPEN) return false
    if (allowed) return true
    closed = true
    socket.close(4403, 'Instance authorization revoked')
    return false
  }
  const events = client as unknown as EventEmitter
  const sendPlan = (message: CallMediaMessage) => {
    if (closed || socket.readyState !== socket.OPEN) return
    const encoded = encodeCallMediaMessage(message)
    const bytes = Buffer.byteLength(encoded)
    if (queuedBytes + bytes + socket.bufferedAmount > 1024 * 1024) {
      closed = true
      socket.close(1013, 'Media host too slow; reconnect for a snapshot')
      return
    }
    queuedBytes += bytes
    sending = sending
      .then(async () => {
        if (await ensureAuthorized())
          socket.send(JSON.stringify({ op: 'call:media', callId: message.callId, message: encoded }))
      })
      .catch(() => {
        if (closed) return
        closed = true
        socket.close(4403, 'Instance authorization unavailable')
      })
      .finally(() => {
        queuedBytes -= bytes
      })
  }
  const snapshot = (callId: string) => {
    const message = client.voip.media?.snapshot(callId)
    if (message) sendPlan(message)
  }
  const onPlan = ({ message }: PrivatePlan) => sendPlan(message)
  events.on('voip_call_media', onPlan)
  const receiveEvent = (callId: string, encoded: string) => {
    const call = resolveLiveCall(client, callId)
    if (!call || call.isEnded) throw new Error('Unknown live call')
    const message = decodeCallMediaEvent(encoded)
    if (message.v !== 1 || message.callId !== call.callId || message.callId !== callId) throw new Error('Call mismatch')
    // Decode with upstream, then constrain the event shape before handing it to signaling.
    const event = message.event
    if (!event || typeof event !== 'object') throw new Error('Invalid host event')
    switch (event.type) {
      case 'host':
        if (
          !Array.isArray(event.features) ||
          event.features.length > 32 ||
          !event.features.every((f) => typeof f === 'string' && f.length < 128)
        )
          throw new Error('Invalid features')
        break
      case 'resync':
        snapshot(call.callId)
        return
      case 'active':
        break
      case 'relay_lost':
        if (typeof event.reason !== 'string') throw new Error('Invalid relay loss')
        break
      case 'relay_answered':
        if (
          typeof event.name !== 'string' ||
          (event.rttMs !== undefined && (!Number.isFinite(event.rttMs) || event.rttMs < 0))
        )
          throw new Error('Invalid relay answer')
        break
      case 'reaction':
        if (
          typeof event.reaction?.reaction !== 'string' ||
          event.reaction.reaction.length > 32 ||
          typeof event.reaction.transactionId !== 'bigint'
        )
          throw new Error('Invalid reaction')
        break
      case 'sender_media':
        if (typeof event.senderId !== 'string' || typeof event.receiving !== 'boolean')
          throw new Error('Invalid sender')
        break
      default:
        throw new Error('Unknown host event')
    }
    client.voip.media.handleEvent(message)
  }
  return {
    snapshotAll() {
      for (const call of client.voip.getCalls() as { callId: string }[]) snapshot(call.callId)
    },
    receive(callId: string, encoded: string): Promise<void> {
      if (closed) return Promise.reject(new Error('Media binding closed'))
      if (queuedEvents >= 32) {
        closed = true
        socket.close(1013, 'Media host events too fast')
        return Promise.reject(new Error('Media host unavailable'))
      }
      queuedEvents++
      const next = receiving
        .then(async () => {
          if (!(await ensureAuthorized())) throw new Error('Unauthorized media host')
          receiveEvent(callId, encoded)
        })
        .finally(() => {
          queuedEvents--
        })
      receiving = next.catch(() => undefined)
      return next
    },
    close() {
      closed = true
      events.off('voip_call_media', onPlan)
    },
  }
}
