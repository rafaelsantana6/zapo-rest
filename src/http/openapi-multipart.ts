/**
 * OpenAPI 3 post-process: media routes only declare Zod JSON bodies, so Scalar
 * defaults to JSON-only. Inject `multipart/form-data` with a binary `file` field
 * (and put multipart first) so the docs UI shows a file picker for Try It.
 *
 * Scalar looks for `type: string` + `format: binary` (OAS 3.0) and benefits from
 * `encoding.file.contentType` so the client builds a proper multipart body.
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
  encoding?: Record<string, unknown>
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
  path: RegExp
  methods: string[]
  fileDescription: string
  /** Accept header hints for the file part (helps Scalar file picker). */
  fileContentType: string
  /** Extra form fields that should be clearly marked as optional text. */
  preferFileOnly?: boolean
}> = [
  {
    path: /\/profile\/(image|picture)$/,
    methods: ['put'],
    fileDescription:
      'Profile picture file — use this for Try It. API also accepts field aliases `media` / `image`. Re-encoded to JPEG server-side.',
    fileContentType: 'image/jpeg, image/png, image/webp, image/*',
    preferFileOnly: true,
  },
  {
    path: /\/groups\/\{[^}]+}\/picture$/,
    methods: ['put'],
    fileDescription: 'Group picture file (`file` / `media` / `image`). Re-encoded to JPEG server-side.',
    fileContentType: 'image/jpeg, image/png, image/webp, image/*',
    preferFileOnly: true,
  },
  {
    path: /\/messages\/image$/,
    methods: ['post'],
    fileDescription: 'Image file (`file` / `media` / `image`). Also set form field `to` (and optional `caption`).',
    fileContentType: 'image/jpeg, image/png, image/webp, image/*',
  },
  {
    path: /\/messages\/video$/,
    methods: ['post'],
    fileDescription: 'Video file (`file` / `media` / `video`). Form fields: `to`, optional `caption`.',
    fileContentType: 'video/mp4, video/*, application/octet-stream',
  },
  {
    path: /\/messages\/audio$/,
    methods: ['post'],
    fileDescription: 'Audio / voice-note file (`file` / `media` / `audio`). Form fields: `to`, optional `ptt`.',
    fileContentType: 'audio/ogg, audio/mpeg, audio/mp4, audio/*, application/octet-stream',
  },
  {
    path: /\/messages\/document$/,
    methods: ['post'],
    fileDescription:
      'Document file (`file` / `media` / `document`). Form fields: `to`, optional `fileName`, `caption`.',
    fileContentType: 'application/pdf, application/octet-stream, */*',
  },
  {
    path: /\/messages\/sticker$/,
    methods: ['post'],
    fileDescription: 'Sticker file (`file` / `media` / `sticker`), typically image/webp.',
    fileContentType: 'image/webp, image/png, image/*',
  },
  {
    path: /\/status\/send$/,
    methods: ['post'],
    fileDescription:
      'Optional status media (`file` / `media`). Form fields: `recipients` (JSON array string), `type`, `caption`, `text`, …',
    fileContentType: 'image/jpeg, image/png, video/mp4, audio/*, application/octet-stream',
  },
  {
    path: /\/calls\/blast$/,
    methods: ['post'],
    fileDescription: 'WAV audio for blast (`file` / `audio` / `media`). Form field `to` required.',
    fileContentType: 'audio/wav, audio/x-wav, audio/*, application/octet-stream',
  },
]

function asOperation(value: unknown): Operation | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  return value as Operation
}

function unwrapJsonSchema(content: MediaContent | undefined): JsonSchema | null {
  if (!content?.schema || typeof content.schema !== 'object') return null
  const schema = content.schema as JsonSchema
  if (schema.properties) return schema
  if (Array.isArray(schema.allOf)) {
    for (const part of schema.allOf) {
      if (part && typeof part === 'object' && (part as JsonSchema).properties) {
        return part as JsonSchema
      }
    }
  }
  return schema
}

/** Clone JSON property schemas as plain form fields (drop JSON-only example objects). */
function formFieldProps(jsonSchema: JsonSchema | null): Record<string, unknown> {
  const properties: Record<string, unknown> = {}
  if (!jsonSchema?.properties) return properties
  for (const [key, value] of Object.entries(jsonSchema.properties)) {
    if (!value || typeof value !== 'object') {
      properties[key] = value
      continue
    }
    const v = { ...(value as Record<string, unknown>) }
    // Form fields are always strings in multipart; keep type when scalar/string
    if (v.type === 'boolean' || v.type === 'number' || v.type === 'integer') {
      // Scalar sends booleans/numbers as strings for form-data; keep type as string + description
      properties[key] = {
        type: 'string',
        description: `${String(v.description ?? key)} (form field; send as text, e.g. true/false or digits)`,
        ...(v.example !== undefined ? { example: String(v.example) } : {}),
      }
      continue
    }
    if (v.type === 'array') {
      properties[key] = {
        type: 'string',
        description: `${String(v.description ?? key)} (JSON array as a single form field string)`,
        example: v.example !== undefined ? JSON.stringify(v.example) : '[]',
      }
      continue
    }
    properties[key] = v
  }
  return properties
}

function buildMultipartContent(jsonSchema: JsonSchema | null, rule: (typeof MEDIA_ROUTE_RULES)[number]): MediaContent {
  const properties = formFieldProps(jsonSchema)
  // Prefer `file` first so Scalar lists the upload control at the top
  const ordered: Record<string, unknown> = {
    file: {
      type: 'string',
      format: 'binary',
      contentMediaType: 'application/octet-stream',
      description: rule.fileDescription,
    },
  }
  for (const [k, v] of Object.entries(properties)) {
    if (k === 'file') continue
    ordered[k] = v
  }

  const dropFromRequired = new Set(['mediaUrl', 'mediaBase64', 'audioUrl', 'mediaUrl'])
  const required = (jsonSchema?.required ?? []).filter((k) => !dropFromRequired.has(k))

  return {
    schema: {
      type: 'object',
      description:
        '**Prefer this content type in Scalar for file uploads.** ' +
        'Field `file` is the binary upload. Other properties are optional text form fields ' +
        '(or use `mediaUrl` / `mediaBase64` instead of `file`). ' +
        'Max size: env `MEDIA_UPLOAD_MAX_BYTES` (default 100 MiB).',
      properties: ordered,
      ...(required.length > 0 ? { required } : {}),
    },
    encoding: {
      file: {
        contentType: rule.fileContentType,
        style: 'form',
        explode: false,
      },
    },
  }
}

/**
 * Inject multipart/form-data (listed first) on all media POST/PUT operations so
 * Scalar Try It shows a file picker by default.
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
        const multipartContent = buildMultipartContent(jsonSchema, rule)

        // Multipart first → Scalar defaults to the file-upload body for Try It
        const content: Record<string, MediaContent> = {
          'multipart/form-data': multipartContent,
          'application/json': jsonContent,
        }
        // Preserve any other content types after json
        for (const [ct, val] of Object.entries(body.content)) {
          if (ct === 'application/json' || ct === 'multipart/form-data') continue
          content[ct] = val
        }

        item[method] = {
          ...op,
          requestBody: {
            ...body,
            required: body.required ?? true,
            description: [
              body.description,
              '**Scalar:** select content type `multipart/form-data` (default) and use the **file** picker. JSON (`mediaUrl` / `mediaBase64`) remains available.',
            ]
              .filter(Boolean)
              .join('\n\n'),
            content,
          },
        }
        touched = true
      }
    }

    if (touched) paths[pathKey] = item
  }

  return { ...document, paths }
}
