import 'server-only'

import { requireOperator, type OperatorAuthGateway } from '@/features/operator-auth/require-operator'
import { incidentResponseSchema, type OperatorIncident } from './schemas'

type RpcResult = Readonly<{ data: unknown; error: unknown }>
type Gateway = Readonly<{ rpc(name: 'list_operator_incidents', args: Readonly<{ p_limit: number }>): Promise<RpcResult> }>
type Dependencies = Readonly<{ gateway?: Gateway; operatorGateway?: OperatorAuthGateway }>
export type IncidentError = 'AUTH_REQUIRED' | 'MFA_REQUIRED' | 'OPERATOR_DISABLED' | 'PERMISSION_DENIED' | 'WORKSPACE_SCOPE_DENIED' | 'INCIDENT_INPUT_INVALID' | 'INCIDENT_READ_UNAVAILABLE'
type Result = Readonly<{ data: Readonly<{ items: readonly OperatorIncident[] }> | null; error: IncidentError | null }>

async function productionGateway(): Promise<Gateway> {
  const supabase = await import('@/lib/supabase/server').then(({ createServerSupabaseClient }) => createServerSupabaseClient())
  return { rpc: (name, args) => (supabase as unknown as { rpc(rpcName: string, rpcArgs: { p_limit: number }): Promise<RpcResult> }).rpc(name, args) }
}

function mapError(error: unknown): IncidentError {
  const message = error instanceof Error ? error.message : typeof error === 'object' && error !== null && 'message' in error && typeof error.message === 'string' ? error.message : ''
  if (['AUTH_REQUIRED', 'MFA_REQUIRED', 'OPERATOR_DISABLED', 'PERMISSION_DENIED', 'WORKSPACE_SCOPE_DENIED', 'INCIDENT_INPUT_INVALID'].includes(message)) return message as IncidentError
  return 'INCIDENT_READ_UNAVAILABLE'
}

export async function listOperatorIncidents(dependencies: Dependencies = {}): Promise<Result> {
  try {
    await requireOperator('system.read', dependencies.operatorGateway)
    const result = await (dependencies.gateway ?? await productionGateway()).rpc('list_operator_incidents', { p_limit: 50 })
    if (result.error) return { data: null, error: mapError(result.error) }
    const wire = incidentResponseSchema.safeParse(result.data)
    if (!wire.success) return { data: null, error: 'INCIDENT_READ_UNAVAILABLE' }
    return {
      data: { items: wire.data.items.map((item) => ({
        id: item.id, source: item.source, sourceState: item.source_state, sourceFreshness: item.source_freshness, sourceObservedAt: item.source_observed_at,
        title: item.title, severity: item.severity, status: item.status, version: item.version, reason: item.reason, factKind: item.fact_kind,
        rollbackCandidateCode: item.rollback_candidate_code, assigneeUserId: item.assignee_user_id, assigneeDisplay: item.assignee_display,
        impactScope: item.impact_scope, recoveryVerifiedAt: item.recovery_verified_at, recoveryEvidenceSummary: item.recovery_evidence_summary,
        remediationKind: item.remediation_kind, remediationResult: item.remediation_result,
        recoveryState: item.recovery_state, openedAt: item.opened_at, updatedAt: item.updated_at, freshness: item.freshness,
        timeline: item.timeline.map((event) => ({ id: event.id, eventType: event.event_type, factKind: event.fact_kind, reason: event.reason, version: event.version, resultingStatus: event.resulting_status, resultingRecoveryState: event.resulting_recovery_state, occurredAt: event.occurred_at })),
      })) },
      error: null,
    }
  } catch (error) {
    return { data: null, error: mapError(error) }
  }
}
