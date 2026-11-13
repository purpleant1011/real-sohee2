import { z } from 'zod'

const uuid = z.string().uuid()
const fingerprint = z.string().regex(/^[a-f0-9]{64}$/u)
const common = z.object({
  kind: z.literal('interaction_draft'), workspaceId: uuid, targetId: uuid, draftId: uuid,
  draftText: z.string().min(1).max(2200), fingerprint,
  customerLabel: z.string().min(1).max(300), preparedAt: z.string().datetime({ offset: true }),
  reused: z.boolean(), requiresUserApproval: z.literal(true),
})
export const interactionDraftSchema = z.discriminatedUnion('targetKind', [
  common.extend({ targetKind: z.literal('comment'), channel: z.enum(['instagram', 'threads']), sourceRef: fingerprint }),
  common.extend({ targetKind: z.literal('dm'), channel: z.literal('instagram'), sourceRef: uuid }),
])
export const interactionDraftReviewSchema = z.object({
  snapshot: interactionDraftSchema,
  sourceText: z.string().max(20_000).nullable(), currentDraftText: z.string().max(2200).nullable(),
  canSend: z.boolean(), reason: z.enum(['SOURCE_CHANGED', 'DRAFT_CHANGED', 'TARGET_CLOSED', 'DM_WINDOW_EXPIRED']).nullable(),
  observedAt: z.string().datetime({ offset: true }),
}).strict().refine(value => value.canSend === (value.reason === null))
export type InteractionDraftReview = Readonly<z.infer<typeof interactionDraftReviewSchema>>
export type InteractionDraftSnapshot = Readonly<z.infer<typeof interactionDraftSchema>>
export type InteractionDraftCardData = InteractionDraftSnapshot & Readonly<{ id: string }>
export type InteractionDraftRequest = Readonly<{
  targetKind: 'comment' | 'dm'; targetId: string; draftText: string; sourceRef: string
}>
export type InteractionDraftRevisionTarget = Readonly<{
  targetKind: 'comment' | 'dm'; targetId: string; draftId: string; fingerprint: string; sourceRef: string
}>

export function parseInteractionDraftSnapshot(value: unknown, workspaceId: string): InteractionDraftSnapshot {
  const parsed = interactionDraftSchema.safeParse(value)
  if (!parsed.success) throw new Error('INTERACTION_DRAFT_INVALID')
  if (parsed.data.workspaceId !== workspaceId) throw new Error('INTERACTION_DRAFT_SCOPE_MISMATCH')
  return parsed.data
}
