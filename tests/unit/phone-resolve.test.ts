import { describe, expect, it, vi } from 'vitest'
import type { WaClient } from 'zapo-js'
import { resolveRecipientJid, resolveWhatsAppNumbers } from '~/lib/phone-resolve'

type MockClient = {
  profile: {
    getLidsByPhoneNumbers: ReturnType<typeof vi.fn>
  }
}

function mockClient(rows?: Array<{ phoneJid: string; lidJid: string | null; exists: boolean }>): MockClient {
  return {
    profile: {
      getLidsByPhoneNumbers: vi.fn(async (phones: string[]) => {
        if (rows) return rows
        return phones.map((p) => ({
          phoneJid: `${p}@s.whatsapp.net`,
          lidJid: null,
          exists: true,
        }))
      }),
    },
  }
}

function asWa(client: MockClient): WaClient {
  return client as unknown as WaClient
}

describe('resolveRecipientJid username', () => {
  it('addresses @handle with the LID zapo returns', async () => {
    const resolveUsername = vi.fn(async () => ({
      status: 'found' as const,
      jid: 'abc@lid',
      username: 'loja',
      isBusiness: false,
      pnJid: '5511999999999@s.whatsapp.net',
    }))
    const client = { profile: { resolveUsername, getLidsByPhoneNumbers: vi.fn() } }
    const jid = await resolveRecipientJid(client as unknown as WaClient, '@loja')
    expect(jid).toBe('abc@lid')
    expect(resolveUsername).toHaveBeenCalledWith({ username: '@loja' })
    expect(client.profile.getLidsByPhoneNumbers).not.toHaveBeenCalled()
  })

  it('refuses a missing handle and a key-required handle', async () => {
    const client = {
      profile: {
        resolveUsername: vi.fn(async () => ({ status: 'not-found' as const })),
      },
    }
    await expect(resolveRecipientJid(client as unknown as WaClient, '@missing')).rejects.toThrow(/not found/)

    client.profile.resolveUsername.mockResolvedValueOnce({
      status: 'key-required',
      username: 'loja',
    } as never)
    await expect(resolveRecipientJid(client as unknown as WaClient, '@loja')).rejects.toThrow(/needs a key/)
  })

  it('does not invent a JID when the session is disconnected', async () => {
    await expect(resolveRecipientJid(null, '@loja')).rejects.toThrow(/connected session/)
  })
})

describe('resolveWhatsAppNumbers', () => {
  it('skips usync for group / lid JIDs', async () => {
    const client = mockClient()
    const [g] = await resolveWhatsAppNumbers(asWa(client), ['120363@g.us'])
    expect(g?.exists).toBe(true)
    expect(g?.jid).toContain('@g.us')
    expect(client.profile.getLidsByPhoneNumbers).not.toHaveBeenCalled()
  })

  it('batches phone variants into one getLidsByPhoneNumbers call', async () => {
    const client = mockClient([
      {
        phoneJid: '5511999999999@s.whatsapp.net',
        lidJid: '999@lid',
        exists: true,
      },
    ])
    const out = await resolveWhatsAppNumbers(asWa(client), ['11999999999', '5511888888888'])
    expect(client.profile.getLidsByPhoneNumbers).toHaveBeenCalledTimes(1)
    expect(out).toHaveLength(2)
    expect(out[0]?.exists || out[1]?.exists).toBe(true)
  })

  it('marks non-existing numbers when usync says exists=false', async () => {
    const client = mockClient([
      {
        phoneJid: '5511000000000@s.whatsapp.net',
        lidJid: null,
        exists: false,
      },
    ])
    const [r] = await resolveWhatsAppNumbers(asWa(client), ['5511000000000'])
    expect(r?.exists).toBe(false)
    expect(r?.jid).toContain('@s.whatsapp.net')
  })

  it('uses cache when provided', async () => {
    const store = new Map<string, string>()
    const cache = {
      get: async (k: string) => store.get(k) ?? null,
      set: async (k: string, v: string) => {
        store.set(k, v)
      },
      del: async () => undefined,
    } as never
    const client = mockClient()
    await resolveWhatsAppNumbers(asWa(client), ['5511999999999'], { cache })
    expect(client.profile.getLidsByPhoneNumbers).toHaveBeenCalledTimes(1)
    client.profile.getLidsByPhoneNumbers.mockClear()
    const [cached] = await resolveWhatsAppNumbers(asWa(client), ['5511999999999'], { cache })
    expect(cached?.cached).toBe(true)
    expect(client.profile.getLidsByPhoneNumbers).not.toHaveBeenCalled()
  })
})

describe('resolveRecipientJid', () => {
  it('returns group jid as-is without client', async () => {
    const jid = await resolveRecipientJid(null, '120363@g.us')
    expect(jid).toContain('@g.us')
  })

  it('falls back to local jid without client', async () => {
    const jid = await resolveRecipientJid(null, '5511999999999')
    expect(jid).toBe('5511999999999@s.whatsapp.net')
  })

  it('prefers WA-confirmed jid when client present', async () => {
    const client = mockClient([
      {
        phoneJid: '5511988888888@s.whatsapp.net',
        lidJid: null,
        exists: true,
      },
    ])
    const jid = await resolveRecipientJid(asWa(client), '11988888888')
    expect(jid).toContain('@s.whatsapp.net')
  })
})
