import 'server-only'

import { requireOperator, type OperatorAuthGateway } from '@/features/operator-auth/require-operator'
import { systemObservationResponseSchema, type SystemObservation } from './schemas'

type RpcResult = Readonly<{ data: unknown; error: unknown }>
type Gateway = Readonly<{ rpc(name: 'get_operator_system_observations_v2', args: Readonly<Record<string, never>>): Promise<RpcResult> }>
type Dependencies = Readonly<{ gateway?: Gateway; operatorGateway?: OperatorAuthGateway }>
export type SystemObservationError = 'AUTH_REQUIRED' | 'MFA_REQUIRED' | 'OPERATOR_DISABLED' | 'PERMISSION_DENIED' | 'WORKSPACE_SCOPE_DENIED' | 'SYSTEM_OBSERVATION_UNAVAILABLE'
type QueueObservation = Readonly<{ kind: 'waiting' | 'running' | 'retryable_failure' | 'dead_letter'; count: number | null; state: string; freshness: string; observedAt: string | null; safeCode: string | null; factKind: string }>
type ReleaseObservation = Readonly<{ versionCode: string | null; commitShaPrefix: string | null; deployedAt: string | null; rollbackCandidateCode: string | null; verificationState: string; source: string; factKind: string; freshness: string }>
type Result = Readonly<{ data: Readonly<{ items: readonly SystemObservation[]; observationWindow: '24h'; queue?: readonly QueueObservation[]; release?: ReleaseObservation }> | null; error: SystemObservationError | null }>

async function productionGateway(): Promise<Gateway> {
  const supabase = await import('@/lib/supabase/server').then(({ createServerSupabaseClient }) => createServerSupabaseClient())
  return { rpc: (name, args) => (supabase as unknown as { rpc(rpcName: string, rpcArgs: Record<string, never>): Promise<RpcResult> }).rpc(name, args) }
}

function mapError(error: unknown): SystemObservationError {
  const message = error instanceof Error ? error.message : typeof error === 'object' && error !== null && 'message' in error && typeof error.message === 'string' ? error.message : ''
  if (['AUTH_REQUIRED', 'MFA_REQUIRED', 'OPERATOR_DISABLED', 'PERMISSION_DENIED', 'WORKSPACE_SCOPE_DENIED'].includes(message)) return message as SystemObservationError
  return 'SYSTEM_OBSERVATION_UNAVAILABLE'
}

export async function getOperatorSystemObservations(dependencies: Dependencies = {}): Promise<Result> {
  try {
    await requireOperator('system.read', dependencies.operatorGateway)
    const result = await (dependencies.gateway ?? await productionGateway()).rpc('get_operator_system_observations_v2', {})
    if (result.error) return { data: null, error: mapError(result.error) }
    const wire = systemObservationResponseSchema.safeParse(result.data)
    if (!wire.success) return { data: null, error: 'SYSTEM_OBSERVATION_UNAVAILABLE' }
    return {
      data: { items: wire.data.items.map((item) => ({ source: item.source, state: item.state, freshness: item.observed_at !== null && Date.parse(item.observed_at) > Date.now() ? 'unknown' : item.freshness, observedAt: item.observed_at, safeCode: item.safe_code, metricValue: item.metric_value, observationWindow: wire.data.observation_window, factKind: item.fact_kind ?? (['conversation_jobs', 'provider_webhooks', 'operation_events'].includes(item.source) ? 'observed' : 'unknown') })), observationWindow: wire.data.observation_window, ...(wire.data.queue ? { queue: wire.data.queue.map((item) => ({ kind: item.kind, count: item.count, state: item.state, freshness: item.freshness, observedAt: item.observed_at, safeCode: item.safe_code, factKind: item.fact_kind })) } : {}), ...(wire.data.release ? { release: { versionCode: wire.data.release.version_code, commitShaPrefix: wire.data.release.commit_sha_prefix, deployedAt: wire.data.release.deployed_at, rollbackCandidateCode: wire.data.release.rollback_candidate_code, verificationState: wire.data.release.verification_state, source: wire.data.release.source, factKind: wire.data.release.fact_kind, freshness: wire.data.release.freshness } } : {}) },
      error: null,
    }
  } catch (error) {
    return { data: null, error: mapError(error) }
  }
}

export { getNaverPostQueueSummary, listNaverPostDlqItems } from './system-repository'
export type { NaverQueueSummaryResult, NaverDlqListResult, NaverSystemRepositoryDependencies } from './system-repository'

