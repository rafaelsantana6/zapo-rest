/**
 * In-call interactions shared by REST and the VoIP control WS: raise hand and
 * emoji reactions (zapo voip 1.2). Both resolve the call id case-insensitively.
 */

import type { VoipWaClient } from '~/instances/wa-client'
import { resolveLiveCall } from '~/voip/call-serialize'

/**
 * Raise or lower the local hand and announce it to the peer.
 * Returns the resolved call id, or `null` when no live call matches.
 * @example await setCallHand(client, 'ABCDEF', true)
 */
export async function setCallHand(client: VoipWaClient, callId: string, raised: boolean): Promise<string | null> {
  const call = resolveLiveCall(client, callId)
  if (!call) return null
  await client.voip.setHandRaised(call.callId, raised)
  return call.callId
}

/**
 * Send an emoji reaction. `sent: false` means nothing went on the wire: the call
 * is not active or its app-data stream is not open yet. `null` = unknown call.
 * @example sendCallReaction(client, 'ABCDEF', '👍')
 */
export function sendCallReaction(
  client: VoipWaClient,
  callId: string,
  reaction: string,
): { callId: string; sent: boolean } | null {
  const call = resolveLiveCall(client, callId)
  if (!call) return null
  return { callId: call.callId, sent: client.voip.sendReaction(call.callId, reaction) }
}
