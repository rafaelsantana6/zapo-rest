import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { buildTestApp, type TestApp } from '../helpers/test-app'

describe('OpenAPI: call media WebSocket docs', () => {
  let ctx: TestApp

  beforeAll(async () => {
    ctx = await buildTestApp()
    await ctx.app.ready()
  })

  afterAll(async () => {
    await ctx.app.close()
  })

  it('keeps the group-camera POST next to the injected video WebSocket GET', () => {
    const paths = (
      ctx.app as unknown as { swagger: () => { paths: Record<string, Record<string, unknown>> } }
    ).swagger().paths
    const video = paths['/v1/calls/{callId}/video'] ?? {}
    expect(Object.keys(video).sort()).toEqual(['get', 'post'])
    expect(paths['/v1/calls/{callId}/stream']).toHaveProperty('get')
  })
})
