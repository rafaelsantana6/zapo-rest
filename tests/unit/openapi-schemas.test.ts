import { describe, expect, it } from 'vitest'
import {
  CallInfoSchema,
  CheckContactsBodySchema,
  CreateInstanceBodySchema,
  ErrorBodySchema,
  EXAMPLES,
  HealthResponseSchema,
  InstanceListResponseSchema,
  InstanceResponseSchema,
  InstanceSchema,
  MeResponseSchema,
  MuteBodySchema,
  OkSchema,
  PairingCodeBodySchema,
  PresenceBodySchema,
  ProfilePictureResponseSchema,
  QrResponseSchema,
  ReadyResponseSchema,
  SendMediaBodySchema,
  SendMessageResponseSchema,
  SendTextBodySchema,
  StartCallBodySchema,
  StartCallResponseSchema,
} from '~/http/openapi-schemas'
import { toPublicWebhook } from '~/webhooks/types'

describe('OpenAPI Zod contracts — input validation', () => {
  it('CreateInstanceBodySchema accepts valid and rejects bad names', () => {
    expect(CreateInstanceBodySchema.parse(EXAMPLES.createInstance).name).toBe('sales-1')
    expect(() => CreateInstanceBodySchema.parse({ name: 'bad name!' })).toThrow()
    expect(() => CreateInstanceBodySchema.parse({ name: '' })).toThrow()
    expect(() => CreateInstanceBodySchema.parse({ name: 'ok', webhookUrl: 'not-a-url' })).toThrow()
  })

  it('SendTextBodySchema requires to + text', () => {
    expect(SendTextBodySchema.parse(EXAMPLES.textMessage).text).toContain('Olá')
    expect(() => SendTextBodySchema.parse({ to: '5511' })).toThrow()
    expect(() => SendTextBodySchema.parse({ text: 'hi' })).toThrow()
    expect(() => SendTextBodySchema.parse({ to: '', text: 'x' })).toThrow()
  })

  it('SendMediaBodySchema validates url shape when provided', () => {
    expect(SendMediaBodySchema.parse(EXAMPLES.imageMessage).mediaUrl).toMatch(/^https/)
    // z.string().url accepts many schemes; invalid absolute URLs still fail
    expect(() => SendMediaBodySchema.parse({ to: '5511', mediaUrl: 'not a url' })).toThrow()
  })

  it('CheckContactsBodySchema enforces batch bounds', () => {
    expect(CheckContactsBodySchema.parse(EXAMPLES.checkPhones).phones).toHaveLength(2)
    expect(() => CheckContactsBodySchema.parse({ phones: [] })).toThrow()
    expect(() => CheckContactsBodySchema.parse({ phones: Array.from({ length: 51 }, () => '1') })).toThrow()
  })

  it('PairingCodeBodySchema / Presence / Call bodies', () => {
    expect(PairingCodeBodySchema.parse({ phone: '5511999999999' }).phone).toBe('5511999999999')
    expect(() => PairingCodeBodySchema.parse({ phone: '123' })).toThrow()
    expect(PresenceBodySchema.parse({ type: 'available' }).type).toBe('available')
    expect(() => PresenceBodySchema.parse({ type: 'away' })).toThrow()
    expect(StartCallBodySchema.parse(EXAMPLES.startCall).to).toBe('5511888888888')
    expect(MuteBodySchema.parse({ muted: true }).muted).toBe(true)
  })
})

describe('OpenAPI Zod contracts — output shapes (integration safety)', () => {
  const sampleInstance = EXAMPLES.instance

  it('InstanceSchema / list / response match public shape', () => {
    expect(InstanceSchema.parse(sampleInstance).status).toBe('open')
    expect(InstanceResponseSchema.parse({ instance: sampleInstance }).instance.name).toBe('sales-1')
    expect(InstanceListResponseSchema.parse({ instances: [sampleInstance] }).instances).toHaveLength(1)
  })

  it('rejects instance payloads that drop required fields (breaking clients)', () => {
    const { name: _n, ...broken } = sampleInstance
    expect(() => InstanceSchema.parse(broken)).toThrow()
    expect(() => InstanceSchema.parse({ ...sampleInstance, status: 'flying' })).toThrow()
  })

  it('instance read shape includes apiKey, pushName, avatarUrl', () => {
    const parsed = InstanceSchema.parse(sampleInstance)
    expect(parsed.apiKey).toMatch(/^zr_/)
    expect(parsed.pushName).toBe('Loja Sales')
    expect(parsed.avatarUrl).toContain('profile-picture')
  })

  it('QrResponseSchema / Ok / Error envelopes', () => {
    expect(
      QrResponseSchema.parse({
        qr: '2@abc',
        expiresAt: '2026-07-11T12:00:00.000Z',
        status: 'qr',
      }).status,
    ).toBe('qr')
    expect(OkSchema.parse({ ok: true }).ok).toBe(true)
    expect(() => OkSchema.parse({ ok: false })).toThrow()
    expect(
      ErrorBodySchema.parse({
        error: { code: 'VALIDATION_ERROR', message: 'bad', details: { field: 'to' } },
      }).error.code,
    ).toBe('VALIDATION_ERROR')
  })

  it('SendMessageResponseSchema and MeResponseSchema', () => {
    expect(SendMessageResponseSchema.parse({ id: 'ABC', result: { ok: true } }).id).toBe('ABC')
    expect(MeResponseSchema.parse({ role: 'admin' }).role).toBe('admin')
    expect(MeResponseSchema.parse({ role: 'instance', instance: sampleInstance }).role).toBe('instance')
    expect(() => MeResponseSchema.parse({ role: 'guest' })).toThrow()
  })

  it('Health / Ready / Call response schemas', () => {
    expect(HealthResponseSchema.parse({ status: 'ok' }).status).toBe('ok')
    expect(ReadyResponseSchema.parse({ status: 'ready' }).status).toBe('ready')
    expect(ReadyResponseSchema.parse({ status: 'not_ready' }).status).toBe('not_ready')
    expect(StartCallResponseSchema.parse({ callId: 'c1', peerJid: 'x@s.whatsapp.net' }).callId).toBe('c1')
    expect(
      CallInfoSchema.parse({
        callId: 'c1',
        direction: 'outgoing',
        state: 'ringing',
        isActive: false,
      }).callId,
    ).toBe('c1')
  })

  it('ProfilePictureResponseSchema tolerates null picture + status', () => {
    expect(
      ProfilePictureResponseSchema.parse({
        picture: null,
        status: 'privacy',
        reason: 'not-authorized',
        revalidated: true,
        fromStorage: false,
      }).status,
    ).toBe('privacy')
  })

  it('toPublicWebhook output stays stable for consumers', () => {
    const pub = toPublicWebhook({
      id: 'wh1',
      instanceName: 'sales-1',
      url: 'https://example.com/hook',
      events: ['message'],
      hmacKey: 'secret-key',
      retriesPolicy: 'exponential',
      retriesDelaySeconds: 2,
      retriesAttempts: 5,
      customHeaders: [],
      enabled: true,
      createdAt: new Date('2026-07-11T00:00:00.000Z'),
      updatedAt: new Date('2026-07-11T00:00:00.000Z'),
    })
    expect(pub).toMatchObject({
      id: 'wh1',
      url: 'https://example.com/hook',
      events: ['message'],
      hmac: { configured: true },
      retries: { policy: 'exponential', delaySeconds: 2, attempts: 5 },
      enabled: true,
    })
    expect(JSON.stringify(pub)).not.toContain('secret-key')
    expect(pub.createdAt).toBe('2026-07-11T00:00:00.000Z')
    expect(
      toPublicWebhook({
        id: 'wh2',
        instanceName: 'sales-1',
        url: 'https://example.com/hook',
        events: [],
        hmacKey: null,
        retriesPolicy: 'constant',
        retriesDelaySeconds: 1,
        retriesAttempts: 1,
        customHeaders: [],
        enabled: true,
        createdAt: new Date('2026-07-11T00:00:00.000Z'),
        updatedAt: new Date('2026-07-11T00:00:00.000Z'),
      }).hmac,
    ).toBeNull()
  })
})
