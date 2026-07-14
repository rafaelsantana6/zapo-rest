/**
 * OpenAPI 3 post-process: media routes only declare Zod JSON bodies, so Scalar
 * would show JSON-only. Inject `multipart/form-data` with a binary `file` field
 * so the docs UI exposes upload for the same endpoints that accept multipart.
 */

type JsonSchema = {
  type?: string
  properties?: Record<string, unknown>
  required?: string[]
  description?: string
  [k: string]: unknown
}

type MediaContent = {
  schema?: JsonSchema | { allOf?: unknown[]; oneOf?: unknown[]; $ref?: string; [k: string]: unknown }
  [k: string]: unknown
}

type RequestBody = {
  required?: boolean
  description?: string
  content?: Record<string, MediaContent>
}

type Operation = {
  summary?: string
  description?: string
  requestBody?: RequestBody
  [k: string]: unknown
}

type PathItem = Record<string, Operation | unknown>

const MEDIA_ROUTE_RULES: Array<{
  /** Match OpenAPI path template */
  path: RegExp
  methods: string[]
  /** Description for the binary file field */
  fileDescription: string
}> = [
  {
    path: /\/profile\/(image|picture)$/,
    methods: ['put'],
    fileDescription: 'JPEG profile picture file. Field name `file` (aliases accepted by the API: `media`, `image`).',
  },
  {
    path: /\/groups\/\{[^}]+}\/picture$/,
    methods: ['put'],
    fileDescription: 'JPEG group picture file (`file` / `media` / `image`).',
  },
  {
    path: /\/messages\/image$/,
    methods: ['post'],
    fileDescription: 'Image file (`file` / `media` / `image`). Also send form fields: `to`, `caption`, `viewOnce`, …',
  },
  {
    path: /\/messages\/video$/,
    methods: ['post'],
    fileDescription: 'Video file (`file` / `media` / `video`). Form fields: `to`, `caption`, …',
  },
  {
    path: /\/messages\/audio$/,
    methods: ['post'],
    fileDescription: 'Audio / voice-note file (`file` / `media` / `audio`). Form fields: `to`, `ptt`, …',
  },
  {
    path: /\/messages\/document$/,
    methods: ['post'],
    fileDescription: 'Document file (`file` / `media` / `document`). Form fields: `to`, `fileName`, `caption`, …',
  },
  {
    path: /\/messages\/sticker$/,
    methods: ['post'],
    fileDescription: 'Sticker file (`file` / `media` / `sticker`), typically image/webp.',
  },
  {
    path: /\/status\/send$/,
    methods: ['post'],
    fileDescription:
      'Optional status media (`file` / `media`). Form fields: `recipients` (JSON array string), `type`, `caption`, `text`, …',
  },
  {
    path: /\/calls\/blast$/,
    methods: ['post'],
    fileDescription:
      'WAV audio for blast (`file` / `audio` / `media`). Form fields: `to`, timeouts, `recordResponse`, …',
  },
]

function asOperation(value: unknown): Operation | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  return value as Operation
}

function unwrapJsonSchema(content: MediaContent | undefined): JsonSchema | null {
  if (!content?.schema || typeof content.schema !== 'object') return null
  const schema = content.schema as JsonSchema
  // Prefer concrete object with properties
  if (schema.properties) return schema
  // allOf with one object schema
  if (Array.isArray(schema.allOf)) {
    for (const part of schema.allOf) {
      if (part && typeof part === 'object' && (part as JsonSchema).properties) {
        return part as JsonSchema
      }
    }
  }
  return schema
}

function buildMultipartSchema(jsonSchema: JsonSchema | null, fileDescription: string): JsonSchema {
  const properties: Record<string, unknown> = {}
  if (jsonSchema?.properties) {
    for (const [key, value] of Object.entries(jsonSchema.properties)) {
      properties[key] = value
    }
  }
  properties.file = {
    type: 'string',
    format: 'binary',
    description: fileDescription,
  }
  // Keep JSON-required fields except mediaUrl/mediaBase64/audioUrl (file replaces them)
  const required = (jsonSchema?.required ?? []).filter(
    (k) => k !== 'mediaUrl' && k !== 'mediaBase64' && k !== 'audioUrl' && k !== 'mediaUrl',
  )
  return {
    type: 'object',
    description:
      'Multipart form: upload `file` **or** send `mediaUrl` / `mediaBase64` as text fields. ' +
      'Max size: env `MEDIA_UPLOAD_MAX_BYTES` (default 100 MiB).',
    properties,
    ...(required.length > 0 ? { required } : {}),
  }
}

/**
 * Mutates/clones the OpenAPI document so media POST/PUT operations advertise
 * both `application/json` and `multipart/form-data` (with binary `file`).
 */
export function injectMultipartMediaBodies(document: Record<string, unknown>): Record<string, unknown> {
  const pathsIn = (document.paths ?? {}) as Record<string, PathItem>
  const paths: Record<string, PathItem> = { ...pathsIn }

  for (const [pathKey, pathItem] of Object.entries(paths)) {
    if (!pathItem || typeof pathItem !== 'object') continue
    const item = { ...pathItem } as PathItem
    let touched = false

    for (const rule of MEDIA_ROUTE_RULES) {
      if (!rule.path.test(pathKey)) continue
      for (const method of rule.methods) {
        const op = asOperation(item[method])
        if (!op) continue
        const body = op.requestBody
        if (!body?.content?.['application/json']) continue

        const jsonContent = body.content['application/json']
        const jsonSchema = unwrapJsonSchema(jsonContent)
        const multipartSchema = buildMultipartSchema(jsonSchema, rule.fileDescription)

        item[method] = {
          ...op,
          requestBody: {
            ...body,
            required: body.required ?? true,
            description:
              (body.description ? `${body.description}\n\n` : '') +
              'Also accepts **`multipart/form-data`** with field `file` (see content type below).',
            content: {
              ...body.content,
              'application/json': jsonContent,
              'multipart/form-data': {
                schema: multipartSchema,
              },
            },
          },
        }
        touched = true
      }
    }

    if (touched) paths[pathKey] = item
  }

  return { ...document, paths }
}
