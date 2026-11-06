import { z } from 'zod'
import { SendMediaBodySchema } from './openapi-schemas'

export const NewsletterJidSchema = z
  .string()
  .regex(/^\d+@newsletter$/)
  .meta({
    description: 'Full WhatsApp channel JID',
    example: '1234567890@newsletter',
  })
export const NewsletterParams = z.object({ jid: NewsletterJidSchema })
export const NewsletterMessageParams = NewsletterParams.extend({ messageId: z.string().min(1) })
export const NewsletterServerMessageParams = NewsletterParams.extend({
  messageId: z
    .string()
    .regex(/^[1-9]\d*$/)
    .refine((id) => Number.isSafeInteger(Number(id)))
    .meta({
      description: 'Positive server message id from channel history; not the publishing stanza id',
      example: '42',
    }),
})
const PictureSchema = z.object({
  url: z.string().optional(),
  directPath: z.string().optional(),
  id: z.string().optional(),
})
export const NewsletterMetadataSchema = z
  .object({
    jid: NewsletterJidSchema,
    state: z.string(),
    creationTime: z.number().optional(),
    name: z.string().optional(),
    nameUpdateTime: z.number().optional(),
    description: z.string().optional(),
    descriptionUpdateTime: z.number().optional(),
    picture: PictureSchema.optional(),
    preview: PictureSchema.optional(),
    invite: z.string().optional(),
    handle: z.string().optional(),
    subscribersCount: z.number().optional(),
    verification: z.string().optional(),
    viewerRole: z.string().optional(),
    mutedAdmin: z.boolean().optional(),
    mutedFollower: z.boolean().optional(),
  })
  .meta({ description: 'Channel metadata; timestamps are Unix seconds. Only public fields are returned.' })
export const NewsletterListSchema = z.object({ newsletters: z.array(NewsletterMetadataSchema) })
export const NewsletterDirectorySchema = z.object({
  results: z.array(NewsletterMetadataSchema),
  pageInfo: z
    .object({
      hasNextPage: z.boolean().optional(),
      hasPreviousPage: z.boolean().optional(),
      startCursor: z.string().optional(),
      endCursor: z.string().optional(),
    })
    .optional(),
})
export const NewsletterAdminProfileSchema = z.object({
  id: z.string().optional(),
  name: z.string().optional(),
  pictureId: z.string().optional(),
  pictureDirectPath: z.string().optional(),
})
export const NewsletterAdminSchema = z.object({
  adminCount: z.number().optional(),
  adminProfile: NewsletterAdminProfileSchema.nullable(),
  capabilities: z.array(z.string()),
})
export const NewsletterFollowersSchema = z.object({
  followers: z.array(
    z.object({
      id: z.string(),
      displayName: z.string().optional(),
      role: z.string().optional(),
      phoneJid: z.string().optional(),
      username: z.string().optional(),
      followTime: z.number().optional(),
      adminProfile: NewsletterAdminProfileSchema.nullable(),
    }),
  ),
})
export const NewsletterCreateSchema = z.object({
  name: z.string().trim().min(1),
  description: z.string().optional(),
  picture: z.base64().min(4).optional().meta({ description: 'Small JPEG encoded as base64 (inline upstream upload)' }),
})
export const NewsletterUpdateSchema = NewsletterCreateSchema.partial()
  .extend({
    picture: NewsletterCreateSchema.shape.picture.nullable(),
    reactionCodesSetting: z.string().min(1).optional(),
  })
  .refine((body) => Object.values(body).some((value) => value !== undefined), 'Provide at least one editable field')
export const NewsletterPublishSchema = z
  .discriminatedUnion('type', [
    z.object({ type: z.literal('text'), text: z.string().min(1) }),
    SendMediaBodySchema.omit({ to: true, viewOnce: true }).extend({
      type: z.enum(['image', 'video', 'audio', 'document']),
    }),
  ])
  .meta({ description: 'Text or media; media accepts the same URL/base64/multipart fields as /messages.' })
export const NewsletterPublishResultSchema = z.object({
  id: z.string(),
  attempts: z.number().int(),
  ack: z.object({
    timestamp: z.string().optional(),
    refreshLid: z.boolean(),
    count: z.number().optional(),
    error: z.number().optional(),
  }),
})
export const NewsletterStanzaSchema = z.object({ stanzaId: z.string() })
export const NewsletterInviteSchema = z.object({
  inviteId: z.string().optional(),
  expirationTime: z.number().optional(),
})
export const NewsletterUserSchema = z.object({ user: z.string().min(1) })
export const NewsletterCountSchema = z.coerce.number().int().min(1).max(100).default(50)
export const NewsletterRangeSchema = z.object({
  count: NewsletterCountSchema,
  before: z.coerce.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).optional(),
  after: z.coerce.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).optional(),
})
export const NewsletterVoteSchema = z
  .object({
    options: z
      .array(z.base64().refine((hash) => Buffer.from(hash, 'base64').length === 32, 'Expected a 32-byte option hash'))
      .min(1)
      .max(12),
  })
  .meta({ description: 'Base64 option hashes from the poll, not labels or option indexes' })

// Upstream read methods return BinaryNode, not decoded message pages. Preserve bytes without inventing a protocol parser.
export const NewsletterNodeSchema = z
  .object({
    name: z.string(),
    attributes: z.record(z.string(), z.string()),
    text: z.string().optional(),
    bytesBase64: z.string().optional(),
    get children(): z.ZodOptional<z.ZodArray<typeof NewsletterNodeSchema>> {
      return z.array(NewsletterNodeSchema).optional()
    },
  })
  .meta({
    id: 'NewsletterReadEnvelope',
    description: 'Upstream read envelope. Binary content is base64; this is not a decoded message projection.',
  })
const NewsletterContentSchema = z.object({
  type: z.string(),
  text: z.string().nullable(),
  caption: z.string().nullable(),
  mimetype: z.string().nullable(),
  fileName: z.string().nullable(),
})
export const NewsletterUpdateEventSchema = z.object({
  jid: NewsletterJidSchema,
  action: z.string(),
  subType: z.string().optional(),
  stanzaId: z.string().optional(),
  offline: z.boolean().optional(),
  details: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])).optional(),
})
export const NewsletterMessageUpdateEventSchema = z.object({
  jid: NewsletterJidSchema,
  stanzaId: z.string().optional(),
  timestampSeconds: z.number().optional(),
  serverId: z.number().optional(),
  offline: z.boolean().optional(),
  update: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('revoke') }),
    z.object({ kind: z.literal('edit'), content: NewsletterContentSchema }),
    z.object({
      kind: z.literal('reaction'),
      isSender: z.boolean(),
      revoked: z.boolean(),
      reactions: z.array(z.object({ code: z.string().optional(), count: z.number().optional() })),
    }),
    z.object({
      kind: z.literal('poll_vote'),
      isSender: z.boolean(),
      votes: z.array(z.object({ optionHash: z.string(), count: z.number().optional() })),
    }),
    z.object({
      kind: z.literal('counters'),
      views: z.number().optional(),
      forwards: z.number().optional(),
      responses: z.number().optional(),
    }),
  ]),
})
