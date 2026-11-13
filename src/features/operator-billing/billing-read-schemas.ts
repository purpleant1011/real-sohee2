export {}
import { z } from 'zod'

const uuid = z.string().uuid()
const timestamp = z.string().datetime({ offset: true })
const state = z.enum(['fresh', 'stale', 'unknown', 'empty', 'error'])
const paymentState = z.enum(['draft', 'provider_pending', 'provider_succeeded', 'activation_succeeded', 'failed', 'cancelled'])

export const billingWireSchema = z.object({
  items: z.array(z.object({
    workspace_id: uuid,
    workspace_name: z.string().min(1),
    entitlement: z.object({ state, plan_code: z.string().nullable(), policy_version: z.string().nullable(), weekly_limit: z.number().int().nullable(), effective_from: timestamp.nullable(), effective_until: timestamp.nullable(), source_timestamp: timestamp.nullable() }).strict(),
    balance: z.object({ state, version: z.number().int().positive().nullable(), period_start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/u).nullable(), period_end: z.string().regex(/^\d{4}-\d{2}-\d{2}$/u).nullable(), granted: z.number().int().nullable(), adjustments: z.number().int().nullable(), released: z.number().int().nullable(), consumed: z.number().int().nullable(), reserved: z.number().int().nullable(), available: z.number().int().nullable(), source_timestamp: timestamp.nullable() }).strict(),
    payment: z.object({ state, latest_state: paymentState.nullable(), provider_reference_present: z.boolean(), updated_at: timestamp.nullable() }).strict(),
    usage: z.object({ state, usage_event_count: z.number().int().nullable(), computed_credits: z.number().int().nullable(), actual_usage_count: z.number().int().nullable(), estimated_usage_count: z.number().int().nullable(), source_timestamp: timestamp.nullable() }).strict(),
    cost: z.object({ state: z.enum(['unknown', 'empty', 'error']), api_cost_krw: z.number().int().nullable(), reason: z.enum(['NOT_MEASURED', 'SOURCE_UNAVAILABLE', 'PERMISSION_DENIED']) }).strict(),
    freshness: z.object({ state, source_timestamp: timestamp.nullable() }).strict(),
  }).strict()),
  summary: z.object({ state, workspace_count: z.number().int().positive().nullable(), source_timestamp: timestamp.nullable() }).strict(),
}).strict()

export type BillingWire = z.infer<typeof billingWireSchema>
export type BillingItem = BillingWire['items'][number] & {
  isFormal?: boolean
  is_formal?: boolean
  member_status?: string
}
export type BillingOverview = Readonly<{
  items: readonly BillingItem[]
  summary: Readonly<{ state: BillingWire['summary']['state']; workspaceCount: number | null; sourceTimestamp: string | null }>
  applicantCount?: number | null
}>

export type BillingErrorCode = 'BILLING_INPUT_INVALID' | 'OPERATOR_UNAUTHENTICATED' | 'MFA_REQUIRED' | 'OPERATOR_DISABLED' | 'OPERATOR_SCOPE_DENIED' | 'OPERATOR_PERMISSION_DENIED' | 'BILLING_READ_UNAVAILABLE'
