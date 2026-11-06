import type { EventEmitter } from 'node:events'
import type { WebSocket } from 'ws'

/** Opt-in /stream framing: u8 version=1, u8 reserved=0, u16 BE stream id, then f32le PCM. */
export const PARTICIPANT_AUDIO_HEADER_BYTES = 4

/** Stream 0 is the mix; ids 1..65535 identify participant devices and are never reused. */
export function encodeParticipantAudio(streamId: number, pcm: Float32Array): Buffer {
  const frame = Buffer.allocUnsafe(PARTICIPANT_AUDIO_HEADER_BYTES + pcm.byteLength)
  frame[0] = 1
  frame[1] = 0
  frame.writeUInt16BE(streamId, 2)
  for (let i = 0; i < pcm.length; i++) frame.writeFloatLE(pcm[i] ?? 0, PARTICIPANT_AUDIO_HEADER_BYTES + i * 4)
  return frame
}

type AudioPayload = { call: { callId: string }; participantJid: string; pcm: Float32Array }
type CompositionPayload = {
  call: { callId: string }
  diff: {
    removed: readonly { jid: string }[]
    switched: readonly { previousDeviceJid: string }[]
    devicesRemoved: readonly { deviceJid: string }[]
  }
}
const accountOf = (jid: string) => jid.replace(/:\d+@/, '@')

/** Subscribe directly to media events: PCM must never enter SSE, webhook outbox or logs. */
export function attachParticipantAudio(events: EventEmitter, socket: WebSocket, callId: string): () => void {
  const streams = new Map<string, number>()
  let nextId = 1
  const sameCall = (id: string) => id.toLowerCase() === callId.toLowerCase()
  const send = (payload: object) => socket.send(JSON.stringify(payload))
  const onAudio = ({ call, participantJid, pcm }: AudioPayload) => {
    if (!sameCall(call.callId) || socket.readyState !== socket.OPEN || socket.bufferedAmount > 256 * 1024) return
    let streamId = streams.get(participantJid)
    if (streamId === undefined) {
      if (streams.size >= 64 || nextId > 65535) return
      streamId = nextId++
      streams.set(participantJid, streamId)
      send({ op: 'stream', callId, streamId, participantJid })
    }
    socket.send(encodeParticipantAudio(streamId, pcm))
  }
  const onChanged = ({ call, diff }: CompositionPayload) => {
    if (!sameCall(call.callId) || socket.readyState !== socket.OPEN) return
    const accounts = new Set(diff.removed.map(({ jid }) => accountOf(jid)))
    const devices = new Set([
      ...diff.switched.map(({ previousDeviceJid }) => previousDeviceJid),
      ...diff.devicesRemoved.map(({ deviceJid }) => deviceJid),
    ])
    for (const [jid, streamId] of streams) {
      if (!accounts.has(accountOf(jid)) && !devices.has(jid)) continue
      streams.delete(jid)
      send({ op: 'stream_end', callId, streamId })
    }
  }
  events.on('voip_call_participant_audio', onAudio)
  events.on('voip_call_participants_changed', onChanged)
  return () => {
    events.off('voip_call_participant_audio', onAudio)
    events.off('voip_call_participants_changed', onChanged)
    streams.clear()
  }
}
