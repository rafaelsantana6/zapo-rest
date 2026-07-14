import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import sharp from 'sharp'
import { afterEach, describe, expect, it } from 'vitest'
import { buildApp } from '~/app'
import { InstanceManager } from '~/instances/manager'
import { WebhookDispatcher } from '~/webhooks/dispatcher'
import { makeEnv } from '../helpers/fixtures'
import { MemoryInstanceRepo } from '../helpers/memory-repo'

async function sampleJpeg(width = 32, height = 32): Promise<Buffer> {
  return sharp({
    create: { width, height, channels: 3, background: { r: 10, g: 20, b: 30 } },
  })
    .jpeg()
    .toBuffer()
}

/** Minimal multipart/form-data body for light-my-request inject. */
function multipartBody(
  fields: Record<string, string>,
  file?: { field: string; filename: string; contentType: string; data: Buffer },
): { payload: Buffer; contentType: string } {
  const boundary = '----zapoTestBoundary7MA4YWxk'
  const chunks: Buffer[] = []
  for (const [name, value] of Object.entries(fields)) {
    chunks.push(
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`, 'utf8'),
    )
  }
  if (file) {
    chunks.push(
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="${file.field}"; filename="${file.filename}"\r\n` +
          `Content-Type: ${file.contentType}\r\n\r\n`,
        'utf8',
      ),
    )
    chunks.push(file.data)
    chunks.push(Buffer.from('\r\n', 'utf8'))
  }
  chunks.push(Buffer.from(`--${boundary}--\r\n`, 'utf8'))
  return {
    payload: Buffer.concat(chunks),
    contentType: `multipart/form-data; boundary=${boundary}`,
  }
}

describe('multipart media upload', () => {
  let app: Awaited<ReturnType<typeof buildApp>> | null = null

  afterEach(async () => {
    if (app) await app.close()
    app = null
  })

  async function boot() {
    const dir = await mkdtemp(join(tmpdir(), 'zapo-mp-'))
    const env = makeEnv({
      MEDIA_TMP_DIR: dir,
      MEDIA_UPLOAD_MAX_BYTES: 1024 * 64, // 64 KiB for tests
      MEDIA_LOCAL_DIR: join(dir, 'objects'),
    })
    const repo = new MemoryInstanceRepo()
    const pool = { query: async () => ({ rows: [], rowCount: 0 }) } as never
    const manager = new InstanceManager({
      env,
      pool,
      // @ts-expect-error memory repo
      repo,
      webhooks: new WebhookDispatcher(env),
      dryRun: true,
    })
    await manager.init()
    const created = await manager.create({ name: 'mp-1' })
    await repo.updateStatus('mp-1', { status: 'open', meJid: '5511999888777@s.whatsapp.net' })

    const mockClient = {
      getCredentials: () => ({ meJid: '5511999888777@s.whatsapp.net', meDisplayName: 'T' }),
      profile: {
        setProfilePicture: async (bytes: Buffer) => {
          if (!Buffer.isBuffer(bytes) || bytes.length === 0) throw new Error('empty')
          return 'pic-upload-1'
        },
        getStatus: async () => ({ status: null }),
        getProfilePicture: async () => null,
        setPushName: async () => undefined,
        deleteProfilePicture: async () => undefined,
        getLidsByPhoneNumbers: async (phones: string[]) =>
          phones.map((p) => ({
            input: p,
            phoneJid: `${String(p).replace(/\D/g, '')}@s.whatsapp.net`,
            lidJid: null,
            exists: true,
          })),
      },
      message: {
        send: async () => ({ id: 'MSG1' }),
      },
    }
    // @ts-expect-error test mock
    manager.requireRegisteredClient = () => mockClient
    // @ts-expect-error test mock
    manager.tryGetClient = () => mockClient

    app = await buildApp({ env, pool, instanceRepo: repo as never, manager })
    return { app, apiKey: created.apiKey as string }
  }

  it('PUT /profile/image accepts multipart file upload', async () => {
    const { app: server, apiKey } = await boot()
    const jpeg = await sampleJpeg()
    const { payload, contentType } = multipartBody(
      {},
      { field: 'file', filename: 'avatar.jpg', contentType: 'image/jpeg', data: jpeg },
    )

    const res = await server.inject({
      method: 'PUT',
      url: '/v1/profile/image',
      headers: {
        'x-api-key': apiKey,
        'content-type': contentType,
      },
      payload,
    })
    expect(res.statusCode).toBe(200)
    const body = res.json() as { ok: boolean; pictureId?: string }
    expect(body.ok).toBe(true)
    expect(body.pictureId).toBe('pic-upload-1')
  })

  it('POST /messages/image accepts multipart file + fields', async () => {
    const { app: server, apiKey } = await boot()
    const jpeg = await sampleJpeg(48, 48)
    const { payload, contentType } = multipartBody(
      { to: '5511888777666', caption: 'oi' },
      { field: 'file', filename: 'p.jpg', contentType: 'image/jpeg', data: jpeg },
    )

    const res = await server.inject({
      method: 'POST',
      url: '/v1/messages/image',
      headers: {
        'x-api-key': apiKey,
        'content-type': contentType,
      },
      payload,
    })
    expect(res.statusCode).toBe(200)
    const body = res.json() as { id: string }
    expect(body.id).toBe('MSG1')
  })

  it('rejects multipart over MEDIA_UPLOAD_MAX_BYTES', async () => {
    const { app: server, apiKey } = await boot()
    const big = Buffer.alloc(70 * 1024, 1) // 70 KiB > 64 KiB limit
    const { payload, contentType } = multipartBody(
      {},
      { field: 'file', filename: 'big.bin', contentType: 'application/octet-stream', data: big },
    )

    const res = await server.inject({
      method: 'PUT',
      url: '/v1/profile/image',
      headers: {
        'x-api-key': apiKey,
        'content-type': contentType,
      },
      payload,
    })
    expect(res.statusCode).toBe(400)
    const body = res.json() as { error?: { message?: string } }
    expect(body.error?.message ?? '').toMatch(/too large|limit/i)
  })

  it('still accepts JSON mediaBase64 for profile image', async () => {
    const { app: server, apiKey } = await boot()
    const jpegB64 = (await sampleJpeg()).toString('base64')
    const res = await server.inject({
      method: 'PUT',
      url: '/v1/profile/image',
      headers: { 'x-api-key': apiKey, 'content-type': 'application/json' },
      payload: { mediaBase64: jpegB64, mimetype: 'image/jpeg' },
    })
    expect(res.statusCode).toBe(200)
  })

  it('accepts PNG multipart and re-encodes to JPEG for WA', async () => {
    const { app: server, apiKey } = await boot()
    const png = await sharp({
      create: { width: 80, height: 80, channels: 3, background: { r: 200, g: 10, b: 10 } },
    })
      .png()
      .toBuffer()
    const { payload, contentType } = multipartBody(
      {},
      { field: 'file', filename: 'avatar.png', contentType: 'image/png', data: png },
    )
    const res = await server.inject({
      method: 'PUT',
      url: '/v1/profile/image',
      headers: { 'x-api-key': apiKey, 'content-type': contentType },
      payload,
    })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({ ok: true, pictureId: 'pic-upload-1' })
  })
})
