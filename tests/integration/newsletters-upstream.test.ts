import { mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import sharp from 'sharp'
import type { InjectOptions } from 'fastify'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { NEWSLETTER_JID } from '../helpers/fake-newsletter'
import { buildTestApp, createInstance, type TestApp } from '../helpers/test-app'
import { upstreamNewsletterClient } from '../helpers/upstream-newsletter'

describe('newsletter routes against the real upstream coordinator', () => {
  let ctx: TestApp
  let apiKey: string
  let mediaDir: string
  let png: Buffer
  const wa = upstreamNewsletterClient()
  const channel = `/v1/newsletters/${NEWSLETTER_JID}`
  const request = (method: InjectOptions['method'], url: string, payload?: InjectOptions['payload']) =>
    ctx.app.inject({ method, url, payload, headers: { 'x-api-key': apiKey } })

  beforeAll(async () => {
    ctx = await buildTestApp()
    apiKey = (await createInstance(ctx.app, 'real-newsletters')).apiKey
    vi.spyOn(ctx.manager, 'requireRegisteredClient').mockReturnValue(wa as never)
    mediaDir = await mkdtemp(join(tmpdir(), 'newsletter-upstream-'))
    ctx.env.MEDIA_TMP_DIR = mediaDir
    png = await sharp({ create: { width: 2, height: 2, channels: 3, background: 'red' } })
      .png()
      .toBuffer()
  })
  beforeEach(() => vi.clearAllMocks())
  afterEach(async () => {
    expect(await readdir(mediaDir)).toEqual([])
  })
  afterAll(async () => {
    await ctx.app.close()
    await rm(mediaDir, { recursive: true, force: true })
  })

  it.each(['', '?since=1700000000', '?before=42&after=20'])(
    'rejects unsupported update range %s before upstream I/O',
    async (query) => {
      expect((await request('GET', `${channel}/updates${query}`)).statusCode).toBe(400)
      expect(wa.queryWithContext).not.toHaveBeenCalled()
    },
  )
  it.each(['before', 'after'])('passes a single %s cursor and since to the real update builder', async (bound) => {
    const res = await request('GET', `${channel}/updates?${bound}=42&since=100&count=5`)
    expect(res.statusCode).toBe(200)
    expect(wa.queryWithContext).toHaveBeenCalledWith(
      'newsletter.fetch_message_updates',
      expect.objectContaining({
        content: [{ tag: 'message_updates', attrs: { count: '5', since: '100', [bound]: '42' } }],
      }),
    )
  })
  it('rejects ambiguous message cursors but permits an unbounded initial page', async () => {
    expect((await request('GET', `${channel}/messages?before=42&after=20`)).statusCode).toBe(400)
    expect(wa.queryWithContext).not.toHaveBeenCalled()
    expect((await request('GET', `${channel}/messages`)).statusCode).toBe(200)
    expect(wa.queryWithContext).toHaveBeenCalledWith('newsletter.fetch_messages', expect.anything())
  })
  it.each(['before', 'after'])('passes a single %s cursor to the real message page builder', async (bound) => {
    expect((await request('GET', `${channel}/messages?${bound}=42&count=5`)).statusCode).toBe(200)
    expect(wa.queryWithContext).toHaveBeenCalledWith(
      'newsletter.fetch_messages',
      expect.objectContaining({
        content: [{ tag: 'messages', attrs: { type: 'jid', jid: NEWSLETTER_JID, count: '5', [bound]: '42' } }],
      }),
    )
  })
  it.each([channel, '/v1/newsletters/by-invite/missing'])(
    'maps the real missing metadata envelope at %s to 404',
    async (url) => {
      const res = await request('GET', url)
      expect(res.statusCode).toBe(404)
      expect(wa.query).toHaveBeenCalledTimes(1)
    },
  )
  it.each([channel, '/v1/newsletters/by-invite/missing'])(
    'preserves unrelated upstream lookup failures at %s',
    async (url) => {
      wa.query.mockRejectedValueOnce(new Error('transport disconnected'))
      expect((await request('GET', url)).statusCode).toBe(500)
    },
  )
  it.each([
    ['POST', false, undefined],
    ['POST', true, undefined],
    ['PATCH', false, undefined],
    ['PATCH', true, undefined],
    ['POST', false, 'image/png'],
    ['PATCH', false, 'image/png'],
  ] as const)('publishes/edits real media %s dataURL=%s mimetype=%s', async (method, dataUrl, mimetype) => {
    const mediaBase64 = `${dataUrl ? 'data:image/png;base64,' : ''}${png.toString('base64')}`
    const res = await request(method, `${channel}/messages${method === 'PATCH' ? '/CHANNEL01' : ''}`, {
      type: 'image',
      mediaBase64,
      mimetype,
    })
    expect(res.statusCode).toBe(200)
    expect(wa.upload).toHaveBeenCalledWith(expect.objectContaining({ contentType: 'image/png' }))
    expect(wa.publish).toHaveBeenCalledTimes(1)
  })
  it.each(['POST', 'PATCH'] as const)('returns an actionable 400 and cleans unknown media on %s', async (method) => {
    const res = await request(method, `${channel}/messages${method === 'PATCH' ? '/CHANNEL01' : ''}`, {
      type: 'image',
      mediaBase64: Buffer.from('unknown format').toString('base64'),
    })
    expect(res.statusCode).toBe(400)
    expect(res.json().error.message).toContain('mimetype')
    expect(wa.upload).not.toHaveBeenCalled()
  })
  it('keeps explicitly typed documents usable when magic-byte detection cannot identify them', async () => {
    expect(
      (
        await request('POST', `${channel}/messages`, {
          type: 'document',
          mediaBase64: Buffer.from('a text document').toString('base64'),
          mimetype: 'text/plain',
        })
      ).statusCode,
    ).toBe(200)
    expect(wa.upload).toHaveBeenCalledWith(expect.objectContaining({ contentType: 'text/plain' }))
  })
  it('cleans resolved media when the real publish path fails after upload', async () => {
    wa.publish.mockRejectedValueOnce(new Error('publish failed'))
    expect(
      (await request('POST', `${channel}/messages`, { type: 'image', mediaBase64: png.toString('base64') })).statusCode,
    ).toBe(500)
    expect(wa.upload).toHaveBeenCalledTimes(1)
  })
})
