import { createRequire } from 'node:module'
import type { WaVoipMediaApi } from '@zapo-js/voip'

export type CallMediaMessage = NonNullable<ReturnType<WaVoipMediaApi['snapshot']>>
export type CallMediaEvent = Parameters<WaVoipMediaApi['handleEvent']>[0]

// Resolve the plugin's own transitive dependency: both ends must use its real wire codec.
// No new server dependency or private protocol implementation is needed.
const require = createRequire(import.meta.url)
const pluginRequire = createRequire(require.resolve('@zapo-js/voip'))
const codecs = pluginRequire('@zapo-js/voip-media') as {
  encodeCallMediaMessage(message: CallMediaMessage): string
  decodeCallMediaMessage(message: string): CallMediaMessage
  encodeCallMediaEvent(event: CallMediaEvent): string
  decodeCallMediaEvent(event: string): CallMediaEvent
}
export const { encodeCallMediaMessage, decodeCallMediaMessage, encodeCallMediaEvent, decodeCallMediaEvent } = codecs
