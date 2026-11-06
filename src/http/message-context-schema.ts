import { z } from 'zod'

/** Only disappearing-message settings are exposed; protocol metadata stays internal. */
export const MessageContextSchema = z
  .strictObject({
    expirationSeconds: z.number().int().min(0).max(2_147_483_647).optional(),
    ephemeralSettingTimestamp: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).optional(),
  })
  .meta({
    description:
      'Safe contextInfo, forwarded as send options so explicit TTL overrides chat settings; expiration in seconds and ephemeral setting time in Unix seconds.',
    example: { expirationSeconds: 86400 },
  })
