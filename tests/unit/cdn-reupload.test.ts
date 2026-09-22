import { describe, expect, it, vi } from 'vitest'
import {
  createMediaDownloadState,
  downloadMediaBytes,
  isExpiredCdnError,
  type MediaDownloadClient,
  type MediaDownloadState,
  patchMediaDirectPath,
} from '~/media/cdn-reupload'

const expired = new Error('download failed with status 404 for https://mmg.whatsapp.net/old')

function client(partial: {
  downloadBytes: MediaDownloadClient['message']['downloadBytes']
  requestMediaReupload?: MediaDownloadClient['message']['requestMediaReupload']
}): MediaDownloadClient {
  return { message: partial }
}

describe('isExpiredCdnError', () => {
  it('matches zapo CDN 404 and 410, including a status field', () => {
    expect(isExpiredCdnError(expired)).toBe(true)
    expect(isExpiredCdnError(new Error('download failed with status 410 for https://mmg.whatsapp.net/old'))).toBe(true)
    expect(isExpiredCdnError({ status: 404 })).toBe(true)
    expect(isExpiredCdnError({ statusCode: '410' })).toBe(true)
  })

  it('ignores transient and near-miss statuses', () => {
    expect(isExpiredCdnError(new Error('cdn down'))).toBe(false)
    expect(isExpiredCdnError(new Error('download failed with status 500 for https://mmg.whatsapp.net/old'))).toBe(false)
    expect(isExpiredCdnError(new Error('download failed with status 4040 for https://mmg.whatsapp.net/old'))).toBe(
      false,
    )
    expect(isExpiredCdnError(new Error('media reupload not_found'))).toBe(false)
  })
})

describe('patchMediaDirectPath', () => {
  it('replaces directPath on the media node without mutating the input', () => {
    const source = { imageMessage: { directPath: '/old', mimetype: 'image/jpeg' } }
    const patched = patchMediaDirectPath(source, '/fresh') as typeof source
    expect(patched.imageMessage.directPath).toBe('/fresh')
    expect(patched.imageMessage.mimetype).toBe('image/jpeg')
    expect(source.imageMessage.directPath).toBe('/old')
    expect(patched).not.toBe(source)
  })

  it('patches media nested in bot-forwarded and document-with-caption envelopes', () => {
    const forwarded = {
      botForwardedMessage: { message: { videoMessage: { directPath: '/old', caption: 'clip' } } },
    }
    const patched = patchMediaDirectPath(forwarded, '/fresh') as {
      botForwardedMessage: { message: { videoMessage: { directPath: string; caption: string } } }
    }
    expect(patched.botForwardedMessage.message.videoMessage).toMatchObject({ directPath: '/fresh', caption: 'clip' })
    expect(forwarded.botForwardedMessage.message.videoMessage.directPath).toBe('/old')

    const doc = {
      documentWithCaptionMessage: { message: { documentMessage: { directPath: '/doc', fileName: 'a.pdf' } } },
    }
    const patchedDoc = patchMediaDirectPath(doc, '/doc2') as typeof doc
    expect(patchedDoc.documentWithCaptionMessage.message.documentMessage.directPath).toBe('/doc2')
  })

  it('returns the same reference when there is no media node', () => {
    const source = { conversation: 'hi' }
    expect(patchMediaDirectPath(source, '/fresh')).toBe(source)
  })
})

describe('createMediaDownloadState', () => {
  it('revives JSONB bytes and keeps the key for reupload', () => {
    const mediaKey = Buffer.from(new Uint8Array(32).fill(7)).toString('base64')
    const state = createMediaDownloadState({
      key: { id: 'm1', remoteJid: '5511888888888@s.whatsapp.net', fromMe: false },
      message: { imageMessage: { directPath: '/old', mediaKey: { _type: 'bytes', base64: mediaKey } } },
    })
    const image = (state.proto as { imageMessage: { mediaKey: Uint8Array; directPath: string } }).imageMessage
    expect(image.mediaKey).toBeInstanceOf(Uint8Array)
    expect(image.mediaKey[0]).toBe(7)
    expect(state.reuploadEvent?.key.id).toBe('m1')
    expect(state.reuploadEvent?.message).toBe(state.proto)
    expect(state.askedReupload).toBe(false)
  })

  it('downloads a proto-only payload and skips reupload without a key', () => {
    const state = createMediaDownloadState({ imageMessage: { directPath: '/old' } })
    expect(state.reuploadEvent).toBeNull()
    expect((state.proto as { imageMessage: { directPath: string } }).imageMessage.directPath).toBe('/old')
  })
})

describe('downloadMediaBytes', () => {
  const event = {
    key: { id: 'IMG', remoteJid: '5511888888888@s.whatsapp.net', fromMe: false },
    message: { imageMessage: { directPath: '/old', mimetype: 'image/jpeg' } },
  }

  it('returns the first download when the CDN is healthy', async () => {
    const downloadBytes = vi.fn(async () => new Uint8Array([1]))
    const requestMediaReupload = vi.fn()
    const state = createMediaDownloadState(event)
    const bytes = await downloadMediaBytes(client({ downloadBytes, requestMediaReupload }), state)
    expect(bytes).toEqual(new Uint8Array([1]))
    expect(requestMediaReupload).not.toHaveBeenCalled()
  })

  it('does not reupload a transient CDN error', async () => {
    const downloadBytes = vi.fn(async () => {
      throw new Error('cdn down')
    })
    const requestMediaReupload = vi.fn()
    await expect(
      downloadMediaBytes(client({ downloadBytes, requestMediaReupload }), createMediaDownloadState(event)),
    ).rejects.toThrow('cdn down')
    expect(requestMediaReupload).not.toHaveBeenCalled()
  })

  it('asks once for a fresh directPath and downloads that', async () => {
    const seen: string[] = []
    const downloadBytes = vi.fn(async (source: unknown) => {
      const path = (source as { imageMessage: { directPath: string } }).imageMessage.directPath
      seen.push(path)
      if (path === '/old') throw expired
      return new Uint8Array([9])
    })
    const requestMediaReupload = vi.fn(async (source: unknown) => {
      const keyed = source as { key: { id: string }; message: { imageMessage: { directPath: string } } }
      expect(keyed.key.id).toBe('IMG')
      expect(keyed.message.imageMessage.directPath).toBe('/old')
      return { result: 'success', directPath: '/fresh' }
    })
    const state = createMediaDownloadState(event)
    const bytes = await downloadMediaBytes(client({ downloadBytes, requestMediaReupload }), state)
    expect(bytes).toEqual(new Uint8Array([9]))
    expect(seen).toEqual(['/old', '/fresh'])
    expect(requestMediaReupload).toHaveBeenCalledTimes(1)
    expect(state.askedReupload).toBe(true)
    expect((state.proto as { imageMessage: { directPath: string } }).imageMessage.directPath).toBe('/fresh')
  })

  it('does not ask again after the refreshed path also 404s', async () => {
    const downloadBytes = vi.fn(async () => {
      throw expired
    })
    const requestMediaReupload = vi.fn(async () => ({ result: 'success', directPath: '/fresh' }))
    const state = createMediaDownloadState(event)
    const media = client({ downloadBytes, requestMediaReupload })
    await expect(downloadMediaBytes(media, state)).rejects.toThrow(/status 404/)
    await expect(downloadMediaBytes(media, state)).rejects.toThrow(/status 404/)
    expect(requestMediaReupload).toHaveBeenCalledTimes(1)
    expect(downloadBytes).toHaveBeenCalledTimes(3)
  })

  it('stops when the sender no longer has the file', async () => {
    const downloadBytes = vi.fn(async () => {
      throw new Error('download failed with status 410 for https://mmg.whatsapp.net/old')
    })
    const requestMediaReupload = vi.fn(async () => ({ result: 'not_found' }))
    await expect(
      downloadMediaBytes(client({ downloadBytes, requestMediaReupload }), createMediaDownloadState(event)),
    ).rejects.toThrow('media reupload not_found')
    expect(downloadBytes).toHaveBeenCalledTimes(1)
    expect(requestMediaReupload).toHaveBeenCalledTimes(1)
  })

  it('keeps the CDN error when reupload cannot run', async () => {
    const downloadBytes = vi.fn(async () => {
      throw expired
    })
    const requestMediaReupload = vi.fn(async () => {
      throw new Error('requestMediaReupload is not supported on newsletter messages')
    })
    const state = createMediaDownloadState(event)
    await expect(downloadMediaBytes(client({ downloadBytes, requestMediaReupload }), state)).rejects.toBe(expired)
    expect(state.askedReupload).toBe(true)
    expect(downloadBytes).toHaveBeenCalledTimes(1)
  })

  it('rethrows 404 when the client has no reupload method', async () => {
    const downloadBytes = vi.fn(async () => {
      throw expired
    })
    await expect(downloadMediaBytes(client({ downloadBytes }), createMediaDownloadState(event))).rejects.toBe(expired)
  })

  it('retries the patched proto after a transient failure on the fresh path', async () => {
    let calls = 0
    const downloadBytes = vi.fn(async (source: unknown) => {
      calls += 1
      const path = (source as { imageMessage: { directPath: string } }).imageMessage.directPath
      if (calls === 1) throw expired
      if (calls === 2) {
        expect(path).toBe('/fresh')
        throw new Error('cdn down')
      }
      expect(path).toBe('/fresh')
      return new Uint8Array([4])
    })
    const requestMediaReupload = vi.fn(async () => ({ result: 'success', directPath: '/fresh' }))
    const state: MediaDownloadState = createMediaDownloadState(event)
    const media = client({ downloadBytes, requestMediaReupload })
    await expect(downloadMediaBytes(media, state)).rejects.toThrow('cdn down')
    const bytes = await downloadMediaBytes(media, state)
    expect(bytes).toEqual(new Uint8Array([4]))
    expect(requestMediaReupload).toHaveBeenCalledTimes(1)
  })
})
