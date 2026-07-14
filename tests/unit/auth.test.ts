import type { FastifyRequest } from 'fastify'
import { describe, expect, it } from 'vitest'
import { resolveInstanceName, scopedInstancePaths, scopedSelfPaths } from '~/auth/plugin'
import { type Actor, canAccessInstance, isAdmin } from '~/auth/types'
import { AppError } from '~/lib/errors'

function req(actor: Actor): FastifyRequest {
  return { actor } as FastifyRequest
}

describe('auth types', () => {
  it('isAdmin', () => {
    expect(isAdmin({ role: 'admin' })).toBe(true)
    expect(isAdmin({ role: 'instance', instanceName: 'a' })).toBe(false)
  })

  it('canAccessInstance', () => {
    const admin: Actor = { role: 'admin' }
    const inst: Actor = { role: 'instance', instanceName: 'sales' }
    expect(canAccessInstance(admin, 'any')).toBe(true)
    expect(canAccessInstance(inst, 'sales')).toBe(true)
    expect(canAccessInstance(inst, 'other')).toBe(false)
  })
})

describe('resolveInstanceName', () => {
  it('uses path name when present (admin)', () => {
    expect(resolveInstanceName(req({ role: 'admin' }), 'sales-1')).toBe('sales-1')
  })

  it('uses path name when present (instance key, own name)', () => {
    expect(resolveInstanceName(req({ role: 'instance', instanceName: 'sales-1' }), 'sales-1')).toBe('sales-1')
  })

  it('forbids instance key for another instance name', () => {
    expect(() => resolveInstanceName(req({ role: 'instance', instanceName: 'sales-1' }), 'other')).toThrow(AppError)
    try {
      resolveInstanceName(req({ role: 'instance', instanceName: 'sales-1' }), 'other')
    } catch (e) {
      expect(e).toBeInstanceOf(AppError)
      expect((e as AppError).statusCode).toBe(403)
    }
  })

  it('infers instance from API key when name omitted', () => {
    expect(resolveInstanceName(req({ role: 'instance', instanceName: 'sales-1' }))).toBe('sales-1')
    expect(resolveInstanceName(req({ role: 'instance', instanceName: 'sales-1' }), undefined)).toBe('sales-1')
  })

  it('requires name for admin when omitted (400)', () => {
    try {
      resolveInstanceName(req({ role: 'admin' }))
      expect.unreachable('should throw')
    } catch (e) {
      expect(e).toBeInstanceOf(AppError)
      expect((e as AppError).statusCode).toBe(400)
      expect((e as AppError).message).toMatch(/admin API key/i)
    }
  })
})

describe('scoped path helpers', () => {
  it('scopedInstancePaths returns named + short form (array at runtime)', () => {
    const paths = scopedInstancePaths('/messages/text') as unknown as string[]
    expect(paths).toEqual(['/v1/instances/:name/messages/text', '/v1/messages/text'])
  })

  it('scopedSelfPaths uses singular /v1/instance short form', () => {
    expect(scopedSelfPaths() as unknown as string[]).toEqual(['/v1/instances/:name', '/v1/instance'])
    expect(scopedSelfPaths('/connect') as unknown as string[]).toEqual([
      '/v1/instances/:name/connect',
      '/v1/instance/connect',
    ])
  })
})
