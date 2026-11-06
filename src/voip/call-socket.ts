import { clientMediaMode } from '~/voip/media-mode'
/** Shared auth + call lookup for the per-call media WebSockets (PCM stream, H.264 video). */

import type { WebSocket } from 'ws'
import { type AuthDeps, resolveActor } from '~/auth/plugin'
import { canAccessInstance } from '~/auth/types'
import type { Env } from '~/config/env'
import type { InstanceManager } from '~/instances/manager'
import type { InstanceRepo } from '~/instances/repo'
import { asVoipClient, type VoipWaClient } from '~/instances/wa-client'

export type CallSocketOpts = {
  socket: WebSocket
  manager: InstanceManager
  env: Env
  instanceName: string
  callId: string
  apiKey: string
  /** Required for instance-key auth (lookup by plaintext api_key). */
  instanceRepo: InstanceRepo
}

export type OpenedCallSocket = {
  client: VoipWaClient
  /** Call id as the plugin knows it (UI may send a different casing). */
  callId: string
  // biome-ignore lint/suspicious/noExplicitAny: CallInfo from @zapo-js/voip
  call: any
}

/**
 * Authorize like the rest of /v1 and resolve the live call, closing the socket with a
 * 44xx/45xx code on failure. Returns null when the socket was closed.
 *
 * @example
 * const opened = await openCallSocket(opts)
 * if (!opened) return
 */
export async function openCallSocket(opts: CallSocketOpts): Promise<OpenedCallSocket | null> {
  const { socket, manager, env, instanceName, callId, apiKey, instanceRepo } = opts

  // NEVER compare the query key to instance.apiKey from GET (that field is masked "***").
  const authDeps: AuthDeps = { env, instanceRepo }
  const actor = await resolveActor(authDeps, apiKey)
  if (!actor || !canAccessInstance(actor, instanceName)) {
    socket.close(4403, 'forbidden')
    return null
  }
  // Client may have hung up during the auth lookup — its 'close' already fired, so any
  // listener attached from here on would never be removed.
  if (socket.readyState !== socket.OPEN) return null

  let client: VoipWaClient
  try {
    client = asVoipClient(manager.getClient(instanceName))
  } catch {
    socket.close(4503, 'instance not connected')
    return null
  }

  if (clientMediaMode(client) === 'remote') {
    socket.close(4409, 'PCM/video streams unavailable in remote media mode; use /v1/voip media host')
    return null
  }

  const resolvedId = resolveCallId(client, callId)
  const call = resolvedId ? client.voip.getCall(resolvedId) : null
  if (!resolvedId || !call) {
    socket.close(4404, 'call not found')
    return null
  }
  return { client, callId: resolvedId, call }
}

/** Case-insensitive callId match — UI may uppercase hex ids. */
function resolveCallId(client: VoipWaClient, callId: string): string | null {
  if (client.voip.getCall(callId)) return callId
  const all = client.voip.getCalls() as { callId?: string }[]
  const hit = all.find((c) => c.callId?.toLowerCase() === callId.toLowerCase())
  return hit?.callId ?? null
}

/** Normalize a `ws` message payload to a Buffer; null for text frames. */
export function binaryMessage(data: unknown, isBinary: boolean | undefined): Buffer | null {
  if (typeof data === 'string') return null
  // Be defensive: some stacks omit isBinary or deliver Buffer for binary
  if (Buffer.isBuffer(data)) return data
  if (data instanceof ArrayBuffer) return Buffer.from(data)
  if (ArrayBuffer.isView(data)) return Buffer.from(data.buffer, data.byteOffset, data.byteLength)
  if (Array.isArray(data) && isBinary !== false) return Buffer.concat(data as Buffer[])
  return null
}
