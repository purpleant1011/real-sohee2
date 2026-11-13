import { z } from 'zod'

const uuid = z.string().uuid()
const timestamp = z.string().datetime({ offset: true })
const readState = z.enum(['fresh', 'stale', 'unknown', 'empty', 'error'])
const agreement = z.object({ agreement_type: z.enum(['service_agreement', 'privacy_consent']), status: z.enum(['accepted', 'withdrawn', 'expired']), accepted_at: timestamp.nullable(), withdrawn_at: timestamp.nullable(), expires_at: timestamp.nullable() }).strict()
const delegation = z.object({ channel: z.string().min(1).max(80), status: z.enum(['accepted', 'withdrawn', 'expired']), accepted_at: timestamp.nullable(), withdrawn_at: timestamp.nullable(), expires_at: timestamp.nullable() }).strict()
const lifecycle = z.object({ state: readState, status: z.enum(['applied','information_pending','contract_review','consent_pending','channel_pending','payment_pending','ready_for_activation','active','paused','terminated']).nullable(), version: z.number().int().positive().nullable(), changed_at: timestamp.nullable() }).strict()
const section = <T extends z.ZodTypeAny>(item: T) => z.object({ state: readState, items: z.array(item).nullable(), code: z.string().min(1).max(80).nullable().optional() }).strict()

export const onboardingOverviewSchema = z.object({
  workspace_id: uuid,
  workspace_name: z.string().min(1).max(200),
  lifecycle,
  agreements: section(agreement),
  delegations: section(delegation),
  activation: z.object({ ready: z.boolean(), missing: z.array(z.string().min(1).max(80)) }).strict(),
  source_timestamps: z.object({ workspace: timestamp.nullable(), lifecycle: timestamp.nullable() }).strict(),
  read_state: readState,
}).strict()

export type LifecycleStatus = z.infer<typeof lifecycle>['status']
export type ReadState<T> = Readonly<{ state: z.infer<typeof readState>; data: T | null; code?: string }>
export type AgreementSummary = z.infer<typeof agreement>
export type DelegationSummary = z.infer<typeof delegation>
export type OperatorOnboardingOverview = Readonly<{
  workspaceId: string
  workspaceName: string
  lifecycle: ReadState<Readonly<{ status: NonNullable<LifecycleStatus>; version: number; changedAt: string }> >
  agreements: ReadState<readonly AgreementSummary[]>
  delegations: ReadState<readonly DelegationSummary[]>
  activation: Readonly<{ ready: boolean; missing: readonly string[] }>
}>

export type OnboardingErrorCode = 'ONBOARDING_INPUT_INVALID' | 'ONBOARDING_OVERVIEW_UNAVAILABLE' | 'OPERATOR_UNAUTHENTICATED' | 'MFA_REQUIRED' | 'OPERATOR_DISABLED' | 'OPERATOR_PERMISSION_DENIED' | 'OPERATOR_SCOPE_DENIED'
