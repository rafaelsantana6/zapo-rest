import { AppError, serviceUnavailable } from '~/lib/errors'

/** Keep MEX failures distinct from local errors without interpreting GraphQL error codes. */
export async function runCommunityMexQuery<T>(query: () => Promise<T>): Promise<T> {
  try {
    return await query()
  } catch (error) {
    if (!(error instanceof Error)) throw error
    if (/^community\.\w+ requires a mex transport$/.test(error.message)) {
      throw serviceUnavailable('Community operation requires the upstream MEX transport')
    }
    // IQ envelopes already have a shared HTTP mapping (403 / 404 / 503 / 502).
    if (/^mex\/\w+ iq failed \(/.test(error.message)) throw error
    if (error.message.startsWith('mex/')) {
      throw new AppError('WhatsApp community query failed', 502, 'WA_MEX_FAILED')
    }
    throw error
  }
}
