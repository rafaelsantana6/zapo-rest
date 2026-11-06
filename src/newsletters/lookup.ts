import type { WaClient } from 'zapo-js'
import { notFound } from '~/lib/errors'
import { serializeNewsletter } from './serialize'

/** Normalize the SDK's absent metadata envelope without hiding transport or permission failures. */
export async function lookupNewsletter(fetchMetadata: () => ReturnType<WaClient['newsletter']['fetch']>) {
  try {
    return serializeNewsletter(await fetchMetadata())
  } catch (err) {
    if (err instanceof Error && err.message === 'newsletter fetch returned no envelope') {
      throw notFound('Channel not found on WhatsApp')
    }
    throw err
  }
}
