/**
 * Regenerate docs-site/src/content/endpoints.generated.ts from the root openapi.json.
 *
 * Usage:
 *   pnpm openapi:export && pnpm docs:endpoints
 *
 * Writes plain JSON-shaped TS; `pnpm format:fix` brings it to house style.
 */
import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

type Operation = {
  summary?: string
  description?: string
  tags?: string[]
  security?: unknown[]
  parameters?: { name: string }[]
  requestBody?: { content?: Record<string, { schema?: { example?: unknown }; example?: unknown }> }
  responses?: Record<string, unknown>
}

const METHODS = ['get', 'post', 'put', 'patch', 'delete'] as const

/** `/v1/calls/{callId}/hand` → `_v1_calls_callId_hand` (ids stay stable across regenerations). */
function endpointId(method: string, path: string): string {
  return `${method}-${path.replace(/[{}]/g, '').replace(/\//g, '_')}`
}

function bodyExample(op: Operation): unknown {
  const json = op.requestBody?.content?.['application/json']
  return json?.example ?? json?.schema?.example ?? null
}

async function main() {
  const root = resolve(import.meta.dirname, '..')
  const spec = JSON.parse(await readFile(resolve(root, 'openapi.json'), 'utf8')) as {
    paths: Record<string, Partial<Record<(typeof METHODS)[number], Operation>>>
  }
  const endpoints = Object.entries(spec.paths).flatMap(([path, item]) =>
    METHODS.flatMap((method) => {
      const op = item[method]
      if (!op) return []
      return [
        {
          id: endpointId(method, path),
          method: method.toUpperCase(),
          path,
          summary: op.summary ?? '',
          description: op.description ?? '',
          tags: op.tags ?? [],
          security: Boolean(op.security?.length),
          params: (op.parameters ?? []).map((p) => p.name),
          bodyExample: bodyExample(op),
          responses: Object.keys(op.responses ?? {}),
        },
      ]
    }),
  )
  const header = `/** Auto-generated from openapi.json — do not hand-edit endpoint list structure. */
export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'

export type EndpointDoc = {
  id: string
  method: HttpMethod
  path: string
  summary: string
  description: string
  tags: string[]
  security: boolean
  bodyExample?: unknown
  responseExample?: unknown
  notes?: string[]
  params?: string[]
  responses?: string[]
}

`
  const out = `${header}export const ENDPOINTS: EndpointDoc[] = ${JSON.stringify(endpoints, null, 2)}\n`
  await writeFile(resolve(root, 'docs-site/src/content/endpoints.generated.ts'), out)
  console.log(`Wrote ${endpoints.length} endpoints`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
