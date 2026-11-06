import { EventEmitter } from 'node:events'
import { describe, expect, it, vi } from 'vitest'
import type { WebSocket } from 'ws'
import type { VoipWaClient } from '~/instances/wa-client'
import { encodeCallMediaEvent } from '~/voip/media-wire'
import { attachRemoteMedia } from '~/voip/remote-media'

class FakePrivateSocket {
  OPEN = 1
  readyState = 1
  bufferedAmount = 0
  send = vi.fn()
  close = vi.fn()
}
function pendingAuthorization() {
  let finish: ((allowed: boolean) => void) | undefined
  let reject: ((error: Error) => void) | undefined
  const result = new Promise<boolean>((resolve, fail) => {
    finish = resolve
    reject = fail
  })
  return {
    check: vi.fn(() => result),
    resolve: () => finish?.(true),
    reject: () => reject?.(new Error('Lookup failed')),
  }
}
function privateBinding() {
  const authorize = pendingAuthorization()
  const socket = new FakePrivateSocket()
  const client = Object.assign(new EventEmitter(), {
    voip: {
      getCall: (id: string) => (id === 'C1' ? { callId: 'C1' } : null),
      getCalls: () => [],
      media: { handleEvent: vi.fn() },
    },
  })
  const binding = attachRemoteMedia(client as unknown as VoipWaClient, socket as unknown as WebSocket, authorize.check)
  return { binding, socket, client, authorize }
}
const finishTasks = () => new Promise<void>((resolve) => setImmediate(resolve))

describe('authorization lookup and binding ownership', () => {
  it.each(['allowed', 'failed'])(
    'drops queued plans when binding closes during a lookup that later %s',
    async (result) => {
      const { binding, socket, client, authorize } = privateBinding()
      client.emit('voip_call_media', { message: { v: 1, callId: 'C1', seq: 0, full: true, plan: { muted: false } } })
      await vi.waitFor(() => expect(authorize.check).toHaveBeenCalled())
      binding.close()
      if (result === 'allowed') authorize.resolve()
      else authorize.reject()
      await finishTasks()
      expect(socket.send).not.toHaveBeenCalled()
      expect(socket.close).not.toHaveBeenCalled()
    },
  )
  it('does not apply a host event after the authorizing binding was replaced', async () => {
    const { binding, socket, client, authorize } = privateBinding()
    const received = binding
      .receive('C1', encodeCallMediaEvent({ v: 1, callId: 'C1', event: { type: 'active' } }))
      .catch((error: unknown) => error)
    await vi.waitFor(() => expect(authorize.check).toHaveBeenCalled())
    binding.close()
    authorize.resolve()
    expect(await received).toBeInstanceOf(Error)
    expect(client.voip.media.handleEvent).not.toHaveBeenCalled()
    expect(socket.close).not.toHaveBeenCalled()
  })
})
