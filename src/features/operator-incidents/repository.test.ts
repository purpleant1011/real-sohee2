import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

const mocks = vi.hoisted(() => ({
  requireOperator: vi.fn(async () => ({ userId: '10000000-0000-4000-8000-000000000001' })),
}))

vi.mock('@/features/operator-auth/require-operator', () => ({ requireOperator: mocks.requireOperator }))

import { listOperatorIncidents } from './repository'

const incident = {
  id: '46000000-0000-4000-8000-000000000001',
  source: 'conversation_jobs' as const,
  sourceState: 'degraded' as const,
  sourceFreshness: 'fresh' as const,
  sourceObservedAt: '2026-08-23T03:00:00.000Z',
  title: '작업 큐 주의',
  severity: 'high' as const,
  status: 'open' as const,
  version: 1,
  reason: '최근 관측 창에서 주의 상태가 확인되었습니다.',
  factKind: 'observed' as const,
  rollbackCandidateCode: 'QUEUE_RETRY_CANDIDATE',
  assigneeUserId: '10000000-0000-4000-8000-000000000001',
  assigneeDisplay: 'o***@sohee.test',
  impactScope: 'QUEUE_PROCESSING',
  recoveryVerifiedAt: '2026-08-23T04:00:00.000Z',
  recoveryEvidenceSummary: '재시도 큐가 정상 처리되는 것을 확인했습니다.',
  remediationKind: 'prevention' as const,
  remediationResult: '재발 방지 규칙을 적용했습니다.',
  recoveryState: 'pending' as const,
  openedAt: '2026-08-23T03:00:00.000Z',
  updatedAt: '2026-08-23T03:00:00.000Z',
  freshness: 'fresh' as const,
  timeline: [{
    id: '46000000-0000-4000-8000-000000000002',
    eventType: 'opened' as const,
    factKind: 'observed' as const,
    reason: '관측 상태에서 생성',
    version: 1,
    occurredAt: '2026-08-23T03:00:00.000Z',
  }],
}

const wireIncident = {
  id: incident.id, source: incident.source, source_state: incident.sourceState, source_freshness: incident.sourceFreshness, source_observed_at: incident.sourceObservedAt,
  title: incident.title, severity: incident.severity, status: incident.status, version: incident.version, reason: incident.reason, fact_kind: incident.factKind,
  rollback_candidate_code: incident.rollbackCandidateCode, recovery_state: incident.recoveryState, opened_at: incident.openedAt, updated_at: incident.updatedAt, freshness: incident.freshness,
  assignee_user_id: incident.assigneeUserId, assignee_display: incident.assigneeDisplay, impact_scope: incident.impactScope,
  recovery_verified_at: incident.recoveryVerifiedAt, recovery_evidence_summary: incident.recoveryEvidenceSummary,
  remediation_kind: incident.remediationKind, remediation_result: incident.remediationResult,
  timeline: [{ id: incident.timeline[0].id, event_type: incident.timeline[0].eventType, fact_kind: incident.timeline[0].factKind, reason: incident.timeline[0].reason, version: incident.timeline[0].version, occurred_at: incident.timeline[0].occurredAt, resulting_status: 'open', resulting_recovery_state: 'pending' }],
}

describe('listOperatorIncidents', () => {
  beforeEach(() => vi.clearAllMocks())

  it('requires system.read and returns safe incident and timeline facts', async () => {
    const rpc = vi.fn(async () => ({ data: { items: [wireIncident] }, error: null }))

    const result = await listOperatorIncidents({ gateway: { rpc } })

    expect(mocks.requireOperator).toHaveBeenCalledWith('system.read', undefined)
    expect(rpc).toHaveBeenCalledWith('list_operator_incidents', { p_limit: 50 })
    expect(result.data?.items[0]).toMatchObject({ id: incident.id, severity: 'high', status: 'open', factKind: 'observed', rollbackCandidateCode: 'QUEUE_RETRY_CANDIDATE' })
    expect(JSON.stringify(result)).not.toContain('raw_log')
    expect(JSON.stringify(result)).not.toContain('secret')
  })

  it('fails closed for unsafe codes or raw configuration-shaped fields', async () => {
    const result = await listOperatorIncidents({ gateway: { rpc: async () => ({ data: { items: [{ ...wireIncident, rollback_candidate_code: 'sk_live_token', raw_config: 'private' }] }, error: null }) } })

    expect(result).toEqual({ data: null, error: 'INCIDENT_READ_UNAVAILABLE' })
  })

  it('keeps recovery transitions out of the read repository', async () => {
    const rpc = vi.fn(async () => ({ data: { items: [] }, error: null }))
    await listOperatorIncidents({ gateway: { rpc } })
    expect(rpc).toHaveBeenCalledTimes(1)
  })
})
