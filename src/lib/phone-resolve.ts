import type { WaClient } from 'zapo-js'
import { badRequest } from '~/lib/errors'
import type { CacheClient } from '~/redis/client'
import { cacheKey } from '~/redis/client'
import type { LidMapStore } from '~/store/lid-map'
import { bareUserJid, isLidJid } from './jid-canon'
import { createJid, digitsOnly, ensureDefaultCountryCode, phoneCheckVariants, toRecipientJid } from './phone'
import { isUsernameRecipient } from './username'

export type ResolvedNumber = {
  /** Original input as provided by the client */
  input: string
  /** Digits-only of the input */
  query: string
  /** Whether WhatsApp confirmed the number exists */
  exists: boolean
  /** Canonical phone JID to use for messaging (when exists, the WA-confirmed one) */
  jid: string
  /** LID when mapped by usync */
  lid: string | null
  /** Digits form that matched on WhatsApp (may differ due to 9th digit) */
  matchedNumber: string | null
  /** Local createJid without WA round-trip */
  localJid: string
  /** Variants that were checked */
  variantsChecked: string[]
  /** Hit Redis/memory cache */
  cached: boolean
}

type CachePayload = {
  exists: boolean
  jid: string
  lid: string | null
  matchedNumber: string | null
}

const CACHE_TTL_SEC = 86_400 // 24h

/**
 * Resolve one or many numbers against WhatsApp in a **single** usync batch
 * (`profile.getLidsByPhoneNumbers`), expanding BR/MX/AR digit variants so the
 * 9th-digit problem is transparent.
 *
 * zapo batches LID lookup natively — we do **not** spam one WA call per number.
 */
export async function resolveWhatsAppNumbers(
  client: WaClient,
  inputs: string[],
  opts?: { cache?: CacheClient; skipCache?: boolean; lidMap?: LidMapStore; instanceName?: string },
): Promise<ResolvedNumber[]> {
  const cache = opts?.cache
  const prepared = inputs.map((input) => {
    // Preserve @g.us / @lid / full JID as-is for non-phone inputs
    if (
      input.includes('@g.us') ||
      input.includes('@lid') ||
      input.includes('@broadcast') ||
      (input.includes('@s.whatsapp.net') && !/^\d/.test(input.trim()))
    ) {
      const localJid = toRecipientJid(input)
      return {
        input,
        query: digitsOnly(localJid.split('@')[0] ?? ''),
        localJid,
        variants: [] as string[],
        skipUsync: true as boolean,
      }
    }
    const raw = digitsOnly(input.includes('@') ? (input.split('@')[0]?.split(':')[0] ?? '') : input)
    // Always assume BR 55 when user omits country code; expand nono dígito variants
    const query = ensureDefaultCountryCode(raw)
    const localJid = createJid(raw.length >= 8 ? raw : input)
    const variants = phoneCheckVariants(raw.length >= 8 ? raw : input)
    return { input, query, localJid, variants, skipUsync: false as boolean }
  })

  const results: ResolvedNumber[] = []
  const needLookup: typeof prepared = []

  for (const p of prepared) {
    if (p.skipUsync || p.variants.length === 0) {
      results.push({
        input: p.input,
        query: p.query,
        exists: true,
        jid: p.localJid,
        lid: null,
        matchedNumber: p.query ?? null,
        localJid: p.localJid,
        variantsChecked: p.variants,
        cached: false,
      })
      continue
    }
    if (!opts?.skipCache && cache) {
      // Cache under normalized query (with 55) and raw digits
      const cacheKeys = [...new Set([p.query, ...p.variants])]
      let cachedHit: CachePayload | null = null
      for (const ck of cacheKeys) {
        const hit = await cache.get(cacheKey('onwa', ck))
        if (hit) {
          try {
            cachedHit = JSON.parse(hit) as CachePayload
            break
          } catch {
            /* */
          }
        }
      }
      if (cachedHit) {
        results.push({
          input: p.input,
          query: p.query,
          exists: cachedHit.exists,
          jid: cachedHit.jid,
          lid: cachedHit.lid,
          matchedNumber: cachedHit.matchedNumber,
          localJid: p.localJid,
          variantsChecked: p.variants,
          cached: true,
        })
        continue
      }
    }
    needLookup.push(p)
  }

  if (needLookup.length === 0) {
    return orderLike(inputs, results)
  }

  // Flatten all variants into one batch for getLidsByPhoneNumbers
  const allVariants = [...new Set(needLookup.flatMap((p) => p.variants))]
  const usync = allVariants.length > 0 ? await client.profile.getLidsByPhoneNumbers(allVariants) : []

  // Index by bare digits and by full jid user part
  const byDigits = new Map<string, (typeof usync)[number]>()
  for (const row of usync) {
    const digits = digitsOnly(row.phoneJid.split('@')[0] ?? '')
    if (digits) byDigits.set(digits, row)
    // also index raw phoneJid user
    const user = row.phoneJid.split('@')[0]?.split(':')[0]
    if (user) byDigits.set(user, row)
  }

  for (const p of needLookup) {
    let match: (typeof usync)[number] | undefined
    for (const v of p.variants) {
      const row = byDigits.get(v)
      if (row?.exists) {
        match = row
        break
      }
    }
    // fallback: any non-exists row for reporting
    if (!match) {
      for (const v of p.variants) {
        const row = byDigits.get(v)
        if (row) {
          match = row
          break
        }
      }
    }

    const exists = Boolean(match?.exists)
    const jid = exists && match ? bareUserJid(match.phoneJid) : p.localJid
    const lid = match?.lidJid ? bareUserJid(match.lidJid) : null
    const matchedNumber = exists && match ? digitsOnly(match.phoneJid.split('@')[0] ?? '') : null

    // Persist LID↔PN for conversation merge (LID↔PN map)
    if (opts?.lidMap && opts.instanceName && exists && lid && isLidJid(lid)) {
      await opts.lidMap.save(opts.instanceName, lid, jid)
    }

    const resolved: ResolvedNumber = {
      input: p.input,
      query: p.query,
      exists,
      jid,
      lid,
      matchedNumber,
      localJid: p.localJid,
      variantsChecked: p.variants,
      cached: false,
    }
    results.push(resolved)

    if (cache) {
      const payload: CachePayload = {
        exists,
        jid,
        lid,
        matchedNumber,
      }
      await cache.set(cacheKey('onwa', p.query), JSON.stringify(payload), CACHE_TTL_SEC)
      // also cache under matched form so reverse lookups hit
      if (matchedNumber && matchedNumber !== p.query) {
        await cache.set(cacheKey('onwa', matchedNumber), JSON.stringify(payload), CACHE_TTL_SEC)
      }
    }
  }

  return orderLike(inputs, results)
}

function orderLike(inputs: string[], results: ResolvedNumber[]): ResolvedNumber[] {
  const map = new Map(results.map((r) => [r.input, r]))
  // also match by digits if input was re-keyed
  const byQuery = new Map(results.map((r) => [r.query, r]))
  return inputs.map((input) => {
    const hit = map.get(input) ?? byQuery.get(digitsOnly(input))
    if (hit) return hit
    // should not happen
    const localJid = createJid(input)
    return {
      input,
      query: digitsOnly(input),
      exists: false,
      jid: localJid,
      lid: null,
      matchedNumber: null,
      localJid,
      variantsChecked: phoneCheckVariants(input),
      cached: false,
    }
  })
}

/**
 * `@handle` → LID from `client.profile.resolveUsername`.
 * `key-required` and `not-found` fail the send instead of inventing a JID.
 */
async function resolveUsernameJid(client: WaClient | null, input: string): Promise<string> {
  if (!client) {
    throw badRequest(`cannot resolve username "${input}" without a connected session`)
  }
  const lookup = await client.profile.resolveUsername({ username: input.trim() })
  if (lookup.status === 'found') return lookup.jid
  if (lookup.status === 'key-required') {
    throw badRequest(`username "${input}" needs a key — retry as @handle:1234`)
  }
  throw badRequest(`username "${input}" was not found`)
}

/**
 * Resolve a single recipient for outbound send: prefers WA-confirmed JID when
 * client is available; falls back to local createJid.
 */
export async function resolveRecipientJid(
  client: WaClient | null,
  input: string,
  cache?: CacheClient,
): Promise<string> {
  if (input.includes('@g.us') || input.includes('@lid') || input.includes('@broadcast')) {
    return toRecipientJid(input)
  }
  if (isUsernameRecipient(input)) {
    return resolveUsernameJid(client, input)
  }
  // Digits-only PN JID: still run through 55 + nono dígito + WA resolve
  if (!client) {
    return toRecipientJid(input)
  }
  const [resolved] = await resolveWhatsAppNumbers(client, [input], { cache })
  if (resolved?.exists) return resolved.jid
  return toRecipientJid(input)
}
