import { conflict } from '~/lib/errors'

export type VoipMediaMode = 'local' | 'remote'
const clientModes = new WeakMap<object, VoipMediaMode>()
const callModes = new WeakMap<object, VoipMediaMode>()

/** Plugin options are fixed for the lifetime of this client. */
export function setClientMediaMode(client: object, mode: VoipMediaMode): void {
  clientModes.set(client, mode)
}
export function clientMediaMode(client: object): VoipMediaMode {
  return clientModes.get(client) ?? 'local'
}
export function setCallMediaMode(call: object, mode: VoipMediaMode): void {
  callModes.set(call, mode)
}
export function callMediaMode(call: object): VoipMediaMode {
  return callModes.get(call) ?? 'local'
}
export function requireLocalMedia(client: object, operation: string): void {
  if (clientMediaMode(client) === 'remote')
    throw conflict(`${operation} is unavailable in remote media mode; media runs on the host`)
}
