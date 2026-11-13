import 'server-only'
import { z } from 'zod'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { onboardingOverviewSchema, type AgreementSummary, type DelegationSummary, type OnboardingErrorCode, type OperatorOnboardingOverview, type ReadState } from './lifecycle-schemas'

export type OperatorOnboardingGateway = Readonly<{ rpc(name: 'get_operator_onboarding_overview', args: Readonly<{ p_workspace_id: string | null }>): Promise<Readonly<{ data: unknown; error: unknown }>> }>
type Result<T> = Readonly<{ data: T; error: null } | { data: null; error: OnboardingErrorCode }>
const uuid = z.string().uuid()
const safeErrors = new Set<OnboardingErrorCode>(['ONBOARDING_INPUT_INVALID','ONBOARDING_OVERVIEW_UNAVAILABLE','OPERATOR_UNAUTHENTICATED','MFA_REQUIRED','OPERATOR_DISABLED','OPERATOR_PERMISSION_DENIED','OPERATOR_SCOPE_DENIED'])

function safeError(error: unknown): OnboardingErrorCode {
  const value = error instanceof Error ? error.message : typeof error === 'object' && error !== null && 'message' in error && typeof error.message === 'string' ? error.message : ''
  return safeErrors.has(value as OnboardingErrorCode) ? value as OnboardingErrorCode : 'ONBOARDING_OVERVIEW_UNAVAILABLE'
}
function mapState<T>(state: 'fresh' | 'stale' | 'unknown' | 'empty' | 'error', items: T[] | null, code?: string): ReadState<T[]> { return { state, data: items, ...(code ? { code } : {}) } }
async function productionGateway(): Promise<OperatorOnboardingGateway> { const supabase = await createServerSupabaseClient(); return { rpc: (name, args) => supabase.rpc(name as never, args as never) as unknown as ReturnType<OperatorOnboardingGateway['rpc']> } }

export async function getOperatorOnboardingOverview(workspaceId?: string, providedGateway?: OperatorOnboardingGateway): Promise<Result<readonly OperatorOnboardingOverview[]>> {
  if (workspaceId !== undefined && !uuid.safeParse(workspaceId).success) return { data: null, error: 'ONBOARDING_INPUT_INVALID' }
  let result: Readonly<{ data: unknown; error: unknown }>
  try { result = await (providedGateway ?? await productionGateway()).rpc('get_operator_onboarding_overview', { p_workspace_id: workspaceId ?? null }) } catch (error) { return { data: null, error: safeError(error) } }
  if (result.error) return { data: null, error: safeError(result.error) }
  const rows = z.array(onboardingOverviewSchema).safeParse(result.data)
  if (!rows.success || (workspaceId !== undefined && rows.data.some((row) => row.workspace_id !== workspaceId))) return { data: null, error: 'ONBOARDING_OVERVIEW_UNAVAILABLE' }
  return { data: rows.data.map((row) => ({ workspaceId: row.workspace_id, workspaceName: row.workspace_name, lifecycle: { state: row.lifecycle.state, data: row.lifecycle.status && row.lifecycle.version && row.lifecycle.changed_at ? { status: row.lifecycle.status, version: row.lifecycle.version, changedAt: row.lifecycle.changed_at } : null }, agreements: mapState(row.agreements.state, row.agreements.items as AgreementSummary[] | null, row.agreements.code ?? undefined), delegations: mapState(row.delegations.state, row.delegations.items as DelegationSummary[] | null, row.delegations.code ?? undefined), activation: row.activation })), error: null }
}
