import * as voip from '@zapo-js/voip'
import { createMediaProcessor } from '@zapo-js/media-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createNoopLogger, createStore } from 'zapo-js'
import { createWaClient } from '~/instances/client-factory'
import { clientMediaMode } from '~/voip/media-mode'
import { makeEnv } from '../helpers/fixtures'

vi.mock('@zapo-js/voip', async (importOriginal) => {
  const original = await importOriginal<typeof import('@zapo-js/voip')>()
  return { ...original, voipPlugin: vi.fn(original.voipPlugin) }
})
afterEach(() => vi.clearAllMocks())

describe('media plugin configuration', () => {
  it.each(['local', 'remote'] as const)('keeps %s mode fixed for the client lifetime', (mode) => {
    const client = createWaClient(
      { store: createStore({}), mediaProcessor: createMediaProcessor(), logger: createNoopLogger() },
      'media-mode-test',
      makeEnv({ VOIP_MEDIA_MODE: mode, VOIP_MLOW_RED: true, VOIP_PARTICIPANT_AUDIO: true }),
    )
    expect(clientMediaMode(client)).toBe(mode)
    expect(voip.voipPlugin).toHaveBeenCalledWith({
      maxConcurrentCalls: 5,
      media: { mode },
      mlowRed: mode === 'local',
      participantAudio: mode === 'local',
    })
  })
})
