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
  it('infers instance from API key', () => {
    expect(resolveInstanceName(req({ role: 'instance', instanceName: 'sales-1' }))).toBe('sales-1')
  })

  it('ignores legacy name path args — always key-bound instance', () => {
    expect(resolveInstanceName(req({ role: 'instance', instanceName: 'sales-1' }), 'other')).toBe('sales-1')
  })

  it('forbids admin on instance methods (403)', () => {
    try {
      resolveInstanceName(req({ role: 'admin' }))
      expect.unreachable('should throw')
    } catch (e) {
      expect(e).toBeInstanceOf(AppError)
      expect((e as AppError).statusCode).toBe(403)
      expect((e as AppError).message).toMatch(/Admin API key cannot call instance/i)
    }
  })
})

describe('scoped path helpers', () => {
  it('scopedInstancePaths is short form only', () => {
    expect(scopedInstancePaths('/messages/text')).toBe('/v1/messages/text')
  })

  it('scopedSelfPaths uses singular /v1/instance', () => {
    expect(scopedSelfPaths()).toBe('/v1/instance')
    expect(scopedSelfPaths('/connect')).toBe('/v1/instance/connect')
  })
})
