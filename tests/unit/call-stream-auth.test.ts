/**
 * attachCallStream auth / lifecycle without real WebRTC — mock socket + manager.
 */
import { describe, expect, it, vi } from 'vitest'
import { hashApiKey } from '~/lib/crypto-keys'
import { makeEnv } from '../helpers/fixtures'

// Minimal WS stub
function mockSocket() {
  const sent: unknown[] = []
  const closes: { code?: number; reason?: string }[] = []
  const handlers = new Map<string, (...args: unknown[]) => void>()
  return {
    sent,
    closes,
    send: (data: string | Buffer) => sent.push(data),
    close: (code?: number, reason?: string) => closes.push({ code, reason }),
    on: (ev: string, fn: (...args: unknown[]) => void) => {
      handlers.set(ev, fn)
      return undefined
    },
    // test helpers
    emit(ev: string, ...args: unknown[]) {
      handlers.get(ev)?.(...args)
    },
  }
}

const PLAIN_INSTANCE_KEY = 'zr_instance_key_min16chars'
const env = makeEnv()

function repoForKey(instanceName: string, plaintextKey: string) {
  const digest = hashApiKey(plaintextKey)
  return {
    getByApiKey: vi.fn(async (key: string) => {
      if (hashApiKey(key) === digest) {
        // apiKey field is always masked on reads — auth must NOT compare against it
        return { name: instanceName, apiKey: '***' }
      }
      return null
    }),
  }
}

describe('attachCallStream authorization', () => {
  it('closes 4403 when instance key is unknown (hash miss)', async () => {
    const { attachCallStream } = await import('~/voip/call-stream')
    const socket = mockSocket()
    const manager = {
      get: vi.fn(),
      getClient: vi.fn(),
    }
    await attachCallStream({
      // @ts-expect-error mock socket
      socket,
      // @ts-expect-error mock manager
      manager,
      env,
      instanceName: 'sales-1',
      callId: 'c1',
      apiKey: 'zr_wrong_key_value!!',
      // @ts-expect-error mock repo
      instanceRepo: repoForKey('sales-1', PLAIN_INSTANCE_KEY),
    })
    expect(socket.closes[0]?.code).toBe(4403)
    expect(manager.getClient).not.toHaveBeenCalled()
  })

  it('closes 4403 when key is valid for another instance only', async () => {
    const { attachCallStream } = await import('~/voip/call-stream')
    const socket = mockSocket()
    const manager = {
      getClient: vi.fn(),
    }
    await attachCallStream({
      // @ts-expect-error mock
      socket,
      // @ts-expect-error mock
      manager,
      env,
      instanceName: 'sales-1',
      callId: 'c1',
      apiKey: PLAIN_INSTANCE_KEY,
      // Key maps to a different instance name
      // @ts-expect-error mock
      instanceRepo: repoForKey('other-inst', PLAIN_INSTANCE_KEY),
    })
    expect(socket.closes[0]?.code).toBe(4403)
    expect(manager.getClient).not.toHaveBeenCalled()
  })

  it('accepts instance key even when record.apiKey is masked ***', async () => {
    const { attachCallStream } = await import('~/voip/call-stream')
    const socket = mockSocket()
    const voip = {
      getCall: vi.fn(() => null),
      getCalls: vi.fn(() => []),
      setExternalAudioMode: vi.fn(),
    }
    const manager = {
      getClient: vi.fn(() => ({ voip })),
    }
    await attachCallStream({
      // @ts-expect-error mock
      socket,
      // @ts-expect-error mock
      manager,
      env,
      instanceName: 'sales-1',
      callId: 'nope',
      apiKey: PLAIN_INSTANCE_KEY,
      // @ts-expect-error mock
      instanceRepo: repoForKey('sales-1', PLAIN_INSTANCE_KEY),
    })
    // Auth passed — call not found (not 4403)
    expect(socket.closes[0]?.code).toBe(4404)
    expect(manager.getClient).toHaveBeenCalled()
  })

  it('closes 4503 when instance not connected (admin key)', async () => {
    const { attachCallStream } = await import('~/voip/call-stream')
    const socket = mockSocket()
    const manager = {
      getClient: vi.fn(() => {
        throw new Error('not connected')
      }),
    }
    await attachCallStream({
      // @ts-expect-error mock
      socket,
      // @ts-expect-error mock
      manager,
      env,
      instanceName: 'sales-1',
      callId: 'c1',
      apiKey: 'test-admin-api-key-min-16',
      // @ts-expect-error unused for admin
      instanceRepo: { getByApiKey: vi.fn(async () => null) },
    })
    expect(socket.closes[0]?.code).toBe(4503)
  })

  it('closes 4404 when call not found; admin key ok', async () => {
    const { attachCallStream } = await import('~/voip/call-stream')
    const socket = mockSocket()
    const voip = {
      getCall: vi.fn(() => null),
      getCalls: vi.fn(() => []),
      setExternalAudioMode: vi.fn(),
    }
    const manager = {
      getClient: vi.fn(() => ({ voip })),
    }
    await attachCallStream({
      // @ts-expect-error mock
      socket,
      // @ts-expect-error mock
      manager,
      env,
      instanceName: 'sales-1',
      callId: 'nope',
      apiKey: 'test-admin-api-key-min-16',
      // @ts-expect-error mock
      instanceRepo: { getByApiKey: vi.fn(async () => null) },
    })
    expect(socket.closes[0]?.code).toBe(4404)
  })

  it('sends ready frame when call exists', async () => {
    const { attachCallStream } = await import('~/voip/call-stream')
    const socket = mockSocket()
    const voip = {
      getCall: vi.fn((id: string) => (id === 'Call1' ? { callId: 'Call1', stateData: { state: 'active' } } : null)),
      getCalls: vi.fn(() => [{ callId: 'Call1' }]),
      setExternalAudioMode: vi.fn(),
      getFeedWatermarksMs: vi.fn(() => ({ pauseMs: 200, resumeMs: 50 })),
      getLiveBufferMs: vi.fn(() => 0),
      feedLiveAudio: vi.fn(() => 0),
      endCall: vi.fn(async () => undefined),
    }
    const manager = {
      getClient: vi.fn(() => ({
        voip,
        on: vi.fn(),
        off: vi.fn(),
      })),
    }
    await attachCallStream({
      // @ts-expect-error mock
      socket,
      // @ts-expect-error mock
      manager,
      env,
      instanceName: 'sales-1',
      callId: 'call1', // case-insensitive resolve
      apiKey: 'test-admin-api-key-min-16',
      // @ts-expect-error mock
      instanceRepo: { getByApiKey: vi.fn(async () => null) },
    })
    expect(voip.setExternalAudioMode).toHaveBeenCalledWith('Call1', true)
    const ready = JSON.parse(String(socket.sent[0]))
    expect(ready).toMatchObject({
      op: 'ready',
      sampleRate: 16_000,
      channels: 1,
      format: 'f32le',
      callId: 'Call1',
    })
  })
})
