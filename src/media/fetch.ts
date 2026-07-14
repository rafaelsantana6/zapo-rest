import { randomBytes } from 'node:crypto'
import { createWriteStream } from 'node:fs'
import { mkdir, unlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import type { Env } from '~/config/env'
import { badRequest } from '~/lib/errors'
import { assertPublicUrl } from '~/lib/ssrf-guard'

/** Default hard cap for a single media payload (URL stream, base64, or upload), in bytes. */
export const DEFAULT_MAX_MEDIA_BYTES = 100 * 1024 * 1024
/** Abort a URL download that stalls past this window. */
const DOWNLOAD_TIMEOUT_MS = 30_000

type WebReadable = import('node:stream/web').ReadableStream

export type MediaSource = {
  mediaUrl?: string
  mediaBase64?: string
  mimetype?: string
  fileName?: string
  /** Local path from multipart upload (already on disk, within size cap). */
  uploadPath?: string
}

export type ResolvedMedia = {
  path: string
  mimetype?: string
  fileName?: string
  cleanup: () => Promise<void>
}

export type MediaSizeEnv = Pick<Env, 'MEDIA_TMP_DIR' | 'MEDIA_UPLOAD_MAX_BYTES'>

function maxBytes(env: Pick<Env, 'MEDIA_UPLOAD_MAX_BYTES'> | undefined): number {
  const n = env?.MEDIA_UPLOAD_MAX_BYTES
  return typeof n === 'number' && n > 0 ? n : DEFAULT_MAX_MEDIA_BYTES
}

export async function resolveMediaToFile(
  source: MediaSource,
  env: Pick<Env, 'MEDIA_TMP_DIR'> | MediaSizeEnv,
): Promise<ResolvedMedia> {
  const dir = env.MEDIA_TMP_DIR || tmpdir()
  await mkdir(dir, { recursive: true })
  const id = randomBytes(12).toString('hex')
  const limit = maxBytes(env as Pick<Env, 'MEDIA_UPLOAD_MAX_BYTES'>)

  if (source.uploadPath) {
    return {
      path: source.uploadPath,
      mimetype: source.mimetype,
      fileName: source.fileName,
      cleanup: () => removeQuietly(source.uploadPath as string),
    }
  }
  if (source.mediaUrl) return downloadUrlToFile(source.mediaUrl, source.mimetype, dir, id, limit, source.fileName)
  if (source.mediaBase64) {
    return decodeBase64ToFile(source.mediaBase64, source.mimetype, dir, id, limit, source.fileName)
  }
  throw badRequest('mediaUrl, mediaBase64, or multipart file is required')
}

/** Fetch a user-supplied URL with SSRF vetting, no redirects, a timeout, and a byte cap. */
async function downloadUrlToFile(
  mediaUrl: string,
  mimetype: string | undefined,
  dir: string,
  id: string,
  limit: number,
  fileName?: string,
): Promise<ResolvedMedia> {
  await assertPublicUrl(mediaUrl)
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), DOWNLOAD_TIMEOUT_MS)
  try {
    const res = await fetch(mediaUrl, { redirect: 'error', signal: controller.signal })
    if (!res.ok || !res.body) throw badRequest(`failed to download mediaUrl: HTTP ${res.status}`)
    assertContentLengthWithinLimit(res.headers.get('content-length'), limit)
    const contentType = mimetype ?? res.headers.get('content-type') ?? undefined
    const path = join(dir, `${id}${guessExt(contentType, fileName)}`)
    await streamToFileCapped(res.body as WebReadable, path, limit)
    return { path, mimetype: contentType, fileName, cleanup: () => removeQuietly(path) }
  } finally {
    clearTimeout(timeout)
  }
}

/** Decode inline base64, rejecting before allocation when it would exceed the cap. */
async function decodeBase64ToFile(
  mediaBase64: string,
  mimetype: string | undefined,
  dir: string,
  id: string,
  limit: number,
  fileName?: string,
): Promise<ResolvedMedia> {
  const raw = mediaBase64.includes(',') ? (mediaBase64.split(',')[1] ?? mediaBase64) : mediaBase64
  assertBase64WithinLimit(raw, limit)
  const path = join(dir, `${id}${guessExt(mimetype, fileName)}`)
  await writeFile(path, Buffer.from(raw, 'base64'))
  return { path, mimetype, fileName, cleanup: () => removeQuietly(path) }
}

/** Stream a multipart file part to a temp path with a hard byte cap. */
export async function saveUploadStreamToFile(
  stream: NodeJS.ReadableStream,
  opts: {
    env: Pick<Env, 'MEDIA_TMP_DIR'> | MediaSizeEnv
    mimetype?: string
    fileName?: string
    maxBytes?: number
  },
): Promise<ResolvedMedia> {
  const dir = opts.env.MEDIA_TMP_DIR || tmpdir()
  await mkdir(dir, { recursive: true })
  const id = randomBytes(12).toString('hex')
  const limit = opts.maxBytes ?? maxBytes(opts.env as Pick<Env, 'MEDIA_UPLOAD_MAX_BYTES'>)
  const path = join(dir, `${id}${guessExt(opts.mimetype, opts.fileName)}`)
  try {
    await pipeline(stream as Readable, byteCapTransform(limit), createWriteStream(path))
  } catch (err) {
    await removeQuietly(path)
    throw err
  }
  return {
    path,
    mimetype: opts.mimetype,
    fileName: opts.fileName,
    cleanup: () => removeQuietly(path),
  }
}

/** Reject early when the server already declares a body larger than the cap. */
function assertContentLengthWithinLimit(header: string | null, limit: number): void {
  if (!header) return
  const declared = Number.parseInt(header, 10)
  if (Number.isFinite(declared) && declared > limit) {
    throw badRequest(`mediaUrl too large: content-length ${declared} exceeds limit ${limit} bytes`)
  }
}

/** base64 decodes to ~3/4 of its length; reject before Buffer.from allocates. */
function assertBase64WithinLimit(raw: string, limit: number): void {
  const estimatedBytes = Math.floor((raw.length * 3) / 4)
  if (estimatedBytes > limit) {
    throw badRequest(`mediaBase64 too large: ~${estimatedBytes} bytes exceeds limit ${limit} bytes`)
  }
}

/** Stream body to disk, aborting and cleaning the partial file if it exceeds the cap. */
async function streamToFileCapped(body: WebReadable, path: string, limit: number): Promise<void> {
  try {
    await pipeline(Readable.fromWeb(body), byteCapTransform(limit), createWriteStream(path))
  } catch (err) {
    await removeQuietly(path)
    throw err
  }
}

/** Passthrough that fails the stream (badRequest) once cumulative bytes exceed the cap. */
function byteCapTransform(limit: number): Transform {
  let total = 0
  return new Transform({
    transform(chunk: Buffer, _enc, cb) {
      total += chunk.length
      if (total > limit) {
        cb(badRequest(`media too large: exceeded limit ${limit} bytes`))
        return
      }
      cb(null, chunk)
    },
  })
}

function removeQuietly(path: string): Promise<void> {
  return unlink(path).catch(() => undefined)
}

function guessExt(mimetype?: string, fileName?: string): string {
  if (fileName) {
    const dot = fileName.lastIndexOf('.')
    if (dot > 0 && dot < fileName.length - 1) {
      const ext = fileName.slice(dot).toLowerCase()
      if (/^\.[a-z0-9]{1,8}$/.test(ext)) return ext
    }
  }
  if (!mimetype) return '.bin'
  if (mimetype.includes('jpeg') || mimetype.includes('jpg')) return '.jpg'
  if (mimetype.includes('png')) return '.png'
  if (mimetype.includes('webp')) return '.webp'
  if (mimetype.includes('ogg')) return '.ogg'
  if (mimetype.includes('mpeg') || mimetype.includes('mp3')) return '.mp3'
  if (mimetype.includes('mp4')) return '.mp4'
  if (mimetype.includes('pdf')) return '.pdf'
  if (mimetype.includes('wav')) return '.wav'
  return '.bin'
}
