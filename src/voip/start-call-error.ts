/**
 * @zapo-js/voip throws this when usync finds no devices for the callee — in practice the
 * number has no WhatsApp account (or it's a typo). Surface it as "not on WhatsApp" instead of
 * the raw Signal wording.
 *
 * @example
 * if (isNotOnWhatsAppError(err)) throw notFound(`${to} is not on WhatsApp`)
 */
export function isNotOnWhatsAppError(err: unknown): boolean {
  return err instanceof Error && /no device sessions to encrypt the call offer/i.test(err.message)
}
