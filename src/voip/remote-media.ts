import type { EventEmitter } from 'node:events'
import type { WebSocket } from 'ws'
import type { VoipWaClient } from '~/instances/wa-client'
import { decodeCallMediaEvent, encodeCallMediaMessage, type CallMediaMessage } from '~/voip/media-wire'
import { resolveLiveCall } from '~/voip/call-serialize'

type PrivatePlan = { message: CallMediaMessage }

/** Private instance-scoped transport. No logger, bus, persistence, or webhook dependency. */
export function attachRemoteMedia(client: VoipWaClient, socket: WebSocket) {
  const events = client as unknown as EventEmitter
  const sendPlan = (message: CallMediaMessage) => {
    if (socket.readyState !== socket.OPEN) return
    if (socket.bufferedAmount > 1024 * 1024) {
      socket.close(1013, 'Media host too slow; reconnect for a snapshot')
      return
    }
    socket.send(JSON.stringify({ op: 'call:media', callId: message.callId, message: encodeCallMediaMessage(message) }))
  }
  const snapshot = (callId: string) => {
    const message = client.voip.media?.snapshot(callId)
    if (message) sendPlan(message)
  }
  const onPlan = ({ message }: PrivatePlan) => sendPlan(message)
  events.on('voip_call_media', onPlan)
  return {
    snapshotAll() {
      for (const call of client.voip.getCalls() as { callId: string }[]) snapshot(call.callId)
    },
    receive(callId: string, encoded: string) {
      const call = resolveLiveCall(client, callId)
      if (!call || call.isEnded) throw new Error('Unknown live call')
      const message = decodeCallMediaEvent(encoded)
      if (message.v !== 1 || message.callId !== call.callId || message.callId !== callId)
        throw new Error('Call mismatch')
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
    },
    close() {
      events.off('voip_call_media', onPlan)
    },
  }
}
