import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { buildTestApp, type TestApp } from '../helpers/test-app'

type JsonSchema = {
  type?: string
  properties?: Record<string, JsonSchema>
  required?: string[]
  enum?: string[]
  items?: JsonSchema
  example?: unknown
}

type JsonContent = { content: { 'application/json': { schema: JsonSchema } } }
type Operation = { requestBody: JsonContent & { required: boolean }; responses: Record<string, JsonContent> }

const modeSettings = [
  { setting: 'member-add-mode', field: 'memberAddMode', modes: ['admin_add', 'all_member_add'] },
  { setting: 'member-link-mode', field: 'memberLinkMode', modes: ['admin_link', 'all_member_link'] },
  { setting: 'history-share-mode', field: 'historyShareMode', modes: ['admin_share', 'all_member_share'] },
] as const

describe('OpenAPI: group member modes', () => {
  let ctx: TestApp
  let paths: Record<string, Record<string, Operation>>

  beforeAll(async () => {
    ctx = await buildTestApp()
    paths = (ctx.app.swagger() as unknown as { paths: typeof paths }).paths
  })
  afterAll(async () => {
    await ctx.app.close()
  })

  it.each(modeSettings)('documents required mode and a complete example for $setting', ({ setting, modes }) => {
    const operation = paths[`/v1/groups/{groupId}/settings/${setting}`]?.put
    if (!operation) throw new Error(`Missing PUT group setting ${setting} in OpenAPI`)
    expect(operation.requestBody.required).toBe(true)
    const body = operation.requestBody.content['application/json'].schema
    expect(body.required).toEqual(['mode'])
    expect(body.properties?.mode?.enum).toEqual(modes)
    expect(body.example).toEqual({ mode: modes[0] })
  })

  it.each(['/v1/groups/{groupId}', '/v1/groups'])('documents optional metadata modes at %s', (path) => {
    const response = paths[path]?.get?.responses['200']?.content['application/json'].schema
    const metadata = path.endsWith('{groupId}') ? response?.properties?.group : response?.properties?.groups?.items
    expect(metadata).toBeDefined()
    for (const { field, modes } of modeSettings) {
      expect(metadata?.properties?.[field]?.enum).toEqual(modes)
      expect(metadata?.required ?? []).not.toContain(field)
    }
  })
})
