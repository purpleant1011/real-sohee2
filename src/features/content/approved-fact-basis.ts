import { z } from 'zod'

export const factSourceTypeSchema = z.enum([
  'owner_approved_fact',
  'user_utterance',
  'public_external_reference',
  'ai_hypothesis',
])

export type FactSourceType = z.infer<typeof factSourceTypeSchema>

export const factClaimCategorySchema = z.enum([
  'business_info',
  'pricing',
  'procedure_effect',
  'customer_review',
  'experience_testimony',
  'other',
])

export type FactClaimCategory = z.infer<typeof factClaimCategorySchema>

export const factOwnerApprovalSchema = z.object({
  approvedByUserId: z.string().min(1),
  approvedAt: z.string().datetime({ offset: true }),
}).strict()

export type FactOwnerApproval = z.infer<typeof factOwnerApprovalSchema>

export const factProvenanceItemSchema = z.object({
  factId: z.string().min(1),
  sourceType: factSourceTypeSchema,
  capturedAt: z.string().datetime({ offset: true }),
  sourceSpan: z.string(),
  sourceHash: z.string().regex(/^[a-f0-9]{64}$/u),
  validity: z.enum(['active', 'deprecated', 'superseded']),
  ownerApproval: factOwnerApprovalSchema.nullable(),
  claimCategory: factClaimCategorySchema,
}).strict().superRefine((data, ctx) => {
  if (data.sourceType === 'owner_approved_fact' && !data.ownerApproval) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'owner_approved_fact requires valid ownerApproval',
      path: ['ownerApproval'],
    })
  }
})

export type FactProvenanceItem = z.infer<typeof factProvenanceItemSchema>

export type FactClaimGateResult = {
  allowed: boolean
  reason?:
    | 'INACTIVE_SOURCE'
    | 'OWNER_APPROVAL_REQUIRED'
    | 'EMPTY_SOURCE_SPAN'
    | 'UNVERIFIED_PROCEDURE_EFFECT'
    | 'FORBIDDEN_TESTIMONY_AS_FACT'
    | 'AI_HYPOTHESIS_CANNOT_BE_FACT'
}

/**
 * ANI-1896 Claim Gate:
 * 허위 시술효과, 가공된 고객 후기/체험 증언, 출처 없는 인용 및 비승인 AI 가설의 사실 승격을 Fail-Closed 차단.
 */
export function validateFactClaimGate(item: FactProvenanceItem): FactClaimGateResult {
  if (item.validity !== 'active') {
    return { allowed: false, reason: 'INACTIVE_SOURCE' }
  }

  if (item.sourceType === 'owner_approved_fact' && !factOwnerApprovalSchema.safeParse(item.ownerApproval).success) {
    return { allowed: false, reason: 'OWNER_APPROVAL_REQUIRED' }
  }

  if (!item.sourceSpan || !item.sourceSpan.trim()) {
    return { allowed: false, reason: 'EMPTY_SOURCE_SPAN' }
  }

  if (item.claimCategory === 'procedure_effect') {
    return { allowed: false, reason: 'UNVERIFIED_PROCEDURE_EFFECT' }
  }

  if (item.claimCategory === 'customer_review' || item.claimCategory === 'experience_testimony') {
    return { allowed: false, reason: 'FORBIDDEN_TESTIMONY_AS_FACT' }
  }

  if (item.sourceType === 'ai_hypothesis') {
    return { allowed: false, reason: 'AI_HYPOTHESIS_CANNOT_BE_FACT' }
  }

  return { allowed: true }
}

/** 승인 사실의 검사 기준. 외부 게시·효능·성과가 검증됐다는 표시는 아니다. */
export const approvedFactBasisSchema = z.object({
  workspaceId: z.string().uuid(),
  snapshotHash: z.string().regex(/^[a-f0-9]{64}$/u),
  resolvedAt: z.string().datetime({ offset: true }),
  sources: z.array(z.object({
    factId: z.string().min(1),
    sourceCandidateId: z.string().min(1),
    approvedAt: z.string().datetime({ offset: true }),
  }).strict()).max(1000),
  provenance: z.array(factProvenanceItemSchema).max(1000).optional(),
}).strict().superRefine((data, ctx) => {
  const sources = new Map<string, (typeof data.sources)[number]>()
  for (let i = 0; i < data.sources.length; i++) {
    const source = data.sources[i]
    if (sources.has(source.factId)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Duplicate fact source', path: ['sources', i, 'factId'] })
    }
    sources.set(source.factId, source)
  }
  if (data.provenance) {
    const seen = new Set<string>()
    for (let i = 0; i < data.provenance.length; i++) {
      const item = data.provenance[i]
      const source = sources.get(item.factId)
      if (!source || seen.has(item.factId)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Provenance requires a unique matching fact source', path: ['provenance', i, 'factId'] })
      }
      seen.add(item.factId)
      if (source && item.ownerApproval && Date.parse(source.approvedAt) !== Date.parse(item.ownerApproval.approvedAt)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Provenance approval does not match fact source', path: ['provenance', i, 'ownerApproval'] })
      }
      const gate = validateFactClaimGate(item)
      if (!gate.allowed) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Claim Gate rejected provenance item [${item.factId}]: ${gate.reason}`,
          path: ['provenance', i],
        })
      }
    }
  }
})

export type ApprovedFactBasis = z.infer<typeof approvedFactBasisSchema>
