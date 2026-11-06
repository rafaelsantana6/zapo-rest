import { EventEmitter } from 'node:events'
import { describe, expect, it, vi } from 'vitest'
import type { WebSocket } from 'ws'
import type { InstanceManager } from '~/instances/manager'
import type { InstanceRepo } from '~/instances/repo'
import { attachCallStream } from '~/voip/call-stream'
import { encodeParticipantAudio } from '~/voip/participant-audio'
import { makeEnv } from '../helpers/fixtures'

class FakeAudioSocket extends EventEmitter {
  OPEN = 1
  readyState = 1
  bufferedAmount = 0
  sent: (string | Buffer)[] = []
  send(payload: string | Buffer) {
    this.sent.push(payload)
  }
  close = vi.fn()
}
function fakeParticipantClient() {
  return Object.assign(new EventEmitter(), {
    voip: {
      getCall: () => ({ callId: 'CALL1', stateData: { state: 'active' } }),
      setExternalAudioMode: vi.fn(),
      getFeedWatermarksMs: () => ({ pauseMs: 500, resumeMs: 100 }),
    },
  })
}
async function openStream(participants = false, enabled = true) {
  const socket = new FakeAudioSocket()
  const client = fakeParticipantClient()
  await attachCallStream({
    socket: socket as unknown as WebSocket,
    manager: { getClient: () => client } as unknown as InstanceManager,
    instanceRepo: { getByApiKey: async () => ({ name: 'sales' }) } as unknown as InstanceRepo,
    env: makeEnv({ VOIP_PARTICIPANT_AUDIO: enabled }),
    instanceName: 'sales',
    callId: 'CALL1',
    apiKey: 'instance-key',
    participants,
  })
  return { socket, client }
}
const call = { callId: 'CALL1' }

describe('opt-in participant PCM', () => {
  it('keeps default mixed PCM bytes and never subscribes to participant audio', async () => {
    const { socket, client } = await openStream()
    const pcm = new Float32Array([0.25, -0.5])
    client.emit('voip_call_inbound_audio', { call, pcm })
    expect(socket.sent[1]).toEqual(Buffer.from(pcm.buffer))
    expect(client.listenerCount('voip_call_participant_audio')).toBe(0)
    expect(JSON.parse(String(socket.sent[0]))).not.toHaveProperty('headerBytes')
    socket.emit('close')
  })
  it('announces participant ids, frames the mix as id 0 and copies reusable PCM', async () => {
    const { socket, client } = await openStream(true)
    const pcm = new Float32Array([0.25, -0.5])
    client.emit('voip_call_participant_audio', { call, participantJid: '111:2@lid', pcm })
    expect(JSON.parse(String(socket.sent[1]))).toMatchObject({ op: 'stream', streamId: 1, participantJid: '111:2@lid' })
    const expected = encodeParticipantAudio(1, pcm)
    client.emit('voip_call_inbound_audio', { call, pcm })
    expect(socket.sent[3]).toEqual(encodeParticipantAudio(0, pcm))
    pcm.fill(0)
    expect(socket.sent[2]).toEqual(expected)
    socket.emit('close')
    expect(client.listenerCount('voip_call_participant_audio')).toBe(0)
  })
  it('retires removed devices and never reuses ids; ignores other calls', async () => {
    const { socket, client } = await openStream(true)
    const payload = { call, participantJid: '111:2@lid', pcm: new Float32Array([1]) }
    client.emit('voip_call_participant_audio', { ...payload, call: { callId: 'OTHER' } })
    expect(socket.sent).toHaveLength(1)
    client.emit('voip_call_participant_audio', payload)
    client.emit('voip_call_participants_changed', {
      call,
      diff: { removed: [{ jid: '111@lid' }], switched: [], devicesRemoved: [] },
    })
    expect(JSON.parse(String(socket.sent[3]))).toMatchObject({ op: 'stream_end', streamId: 1 })
    client.emit('voip_call_participant_audio', payload)
    expect(JSON.parse(String(socket.sent[4]))).toMatchObject({ streamId: 2 })
    socket.emit('close')
  })
  it('rejects the opt-in when frame copying is disabled', async () => {
    const { socket, client } = await openStream(true, false)
    expect(socket.close).toHaveBeenCalledWith(4409, expect.stringContaining('VOIP_PARTICIPANT_AUDIO'))
    expect(client.voip.setExternalAudioMode).not.toHaveBeenCalled()
  })
})
