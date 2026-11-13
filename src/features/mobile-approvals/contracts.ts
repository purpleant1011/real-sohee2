import { z } from 'zod'
import { mobileApprovalSchema } from '../mobile-decision/schemas'
import type { MobileApprovalView } from '../mobile-decision/contracts'

export { mobileApprovalSchema as mobileApprovalV1Schema } from '../mobile-decision/schemas'
export type { MobileApprovalView as MobileApprovalViewV1 } from '../mobile-decision/contracts'

const blockerSchema = z.enum([
  'ROLE', 'FEATURE_OFF', 'KILL_SWITCH', 'WORKSPACE_NOT_ALLOWED', 'PROVIDER_NOT_READY',
  'TOKEN_EXPIRED', 'SCOPE_MISSING', 'POLICY_WINDOW_EXPIRED', 'COST_UNACKNOWLEDGED',
  'CONSENT_MISSING', 'SOURCE_STALE', 'ALREADY_SENT', 'IDEMPOTENCY_IN_FLIGHT', 'DATASET_NOT_ACTUAL',
])
export const executionGateSchema = z.object({
  enabled: z.boolean(), blockers: z.array(blockerSchema), userMessage: z.string(), evaluatedAt: z.string().datetime(),
}).strict().refine(gate => gate.enabled === (gate.blockers.length === 0), 'Gate state must match blockers')

export const mobileApprovalV2Schema = mobileApprovalSchema.omit({ writeState: true, datasetMode: true }).extend({
  v: z.literal(2),
  datasetMode: z.enum(['ACTUAL', 'SHOWCASE_DEMO', 'TEST', 'UNKNOWN']),
  version: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  recipients: z.array(z.object({ label: z.string(), verified: z.boolean() }).strict()),
  schedule: z.object({ sendAt: z.string().datetime().nullable(), windowEndsAt: z.string().datetime().nullable() }).strict(),
  cost: z.object({ estimated: z.number().finite().nonnegative().nullable(), unit: z.enum(['원', '크레딧']), basis: z.enum(['CONFIRMED', 'ESTIMATE', 'NONE']) }).strict(),
  changes: z.array(z.object({ before: z.string().nullable(), after: z.string() }).strict()),
  consents: z.array(z.object({ purpose: z.string(), satisfied: z.boolean() }).strict()),
  gate: executionGateSchema,
}).strict()
export type MobileApprovalViewV2 = z.infer<typeof mobileApprovalV2Schema>

/** Deliberately read-only, even when the v2 server gate allows execution. */
export function toMobileApprovalV1(view: MobileApprovalViewV2): MobileApprovalView {
  return mobileApprovalSchema.parse({
    workspaceId: view.workspaceId, id: view.id, kind: view.kind, title: view.title,
    targetLabel: view.targetLabel, sourceText: view.sourceText, fullContent: view.fullContent,
    imageUrls: view.imageUrls, datasetMode: view.datasetMode === 'SHOWCASE_DEMO' ? 'DEMO' : view.datasetMode,
    writeState: 'unsupported', reason: view.gate.userMessage || '내용 검토만 할 수 있어요. 실행은 최종 검토 화면에서 확인해 주세요.',
  })
}

// Route params and header are parsed separately; client authority fields are rejected.
export const mobileApprovalExecuteBodySchema = z.object({
  expectedVersion: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  expectedFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  acknowledged: z.object({ cost: z.boolean(), consent: z.boolean() }).strict(),
}).strict()
export const mobileApprovalIdempotencyKeySchema = z.string().uuid()
export const mobileApprovalKeySchema = z.string().regex(/^(dm|comment|post|proposal|booking_send|booking_confirm):[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)
