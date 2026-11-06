import { describe, expect, it, vi } from 'vitest'
import { EventProcessor } from '~/events/processor'
import { makeEnv } from '../helpers/fixtures'
import { nativeFormResponseFixture } from '../helpers/interactive-fixtures'
import { MemoryInstanceRepo } from '../helpers/memory-repo'
import {
  MemoryChatStore,
  MemoryContactStore,
  MemoryIdempotencyStore,
  MemoryMessageStore,
  MemoryMediaStorage,
} from '../helpers/memory-stores'

function fakeInteractiveProcessor() {
  const repo = new MemoryInstanceRepo()
  repo.seed({ name: 'interactive', apiKey: 'zr_interactive' })
  const messages = new MemoryMessageStore()
  const webhooks = { emit: vi.fn(async (_row: unknown, _event: string, _payload: unknown) => undefined) }
  const processor = new EventProcessor({
    env: makeEnv({ MEDIA_AUTO_DOWNLOAD: false }),
    instanceRepo: repo as never,
    messages: messages as never,
    chats: new MemoryChatStore() as never,
    contacts: new MemoryContactStore() as never,
    idempotency: new MemoryIdempotencyStore() as never,
    webhooks: webhooks as never,
    mediaStorage: new MemoryMediaStorage(),
  })
  return { processor, messages, webhooks }
}
describe('interactive message webhooks/SSE payload', () => {
  it('projects a form and exposes structured fields/token through existing event names', async () => {
    const { processor, messages, webhooks } = fakeInteractiveProcessor()
    const event = {
      key: { id: 'FORM-REPLY', remoteJid: '5511999999999@s.whatsapp.net' },
      message: nativeFormResponseFixture(),
    }
    await processor.onMessage('interactive', event)
    expect(await messages.get('interactive', 'FORM-REPLY')).toMatchObject({
      type: 'native_form_response',
      body: expect.stringContaining('Name: Test customer'),
    })
    for (const name of ['message', 'message.any', 'message.inbound'])
      expect(webhooks.emit).toHaveBeenCalledWith(
        expect.anything(),
        name,
        expect.objectContaining({
          type: 'native_form_response',
          interactive: expect.objectContaining({
            flowId: 'flow-1',
            flowToken: 'token-1',
            answers: { customer: 'Test customer', document: 'test-doc', choices: ['a', 'b'], optIn: false },
          }),
        }),
      )
    await processor.onMessage('interactive', event)
    expect(webhooks.emit).toHaveBeenCalledTimes(3)
  })
  it('keeps selected IDs and display text in message webhook payloads', async () => {
    const { processor, webhooks } = fakeInteractiveProcessor()
    await processor.onMessage('interactive', {
      key: { id: 'BUTTON-REPLY', remoteJid: '120363@g.us', participant: '5511999999999@s.whatsapp.net' },
      message: { buttonsResponseMessage: { selectedButtonId: 'buy', selectedDisplayText: 'Buy' } },
    })
    expect(webhooks.emit).toHaveBeenCalledWith(
      expect.anything(),
      'message.inbound',
      expect.objectContaining({
        type: 'buttons_response',
        body: 'buy · Buy',
        interactive: { selectedId: 'buy', displayText: 'Buy' },
      }),
    )
  })
})
