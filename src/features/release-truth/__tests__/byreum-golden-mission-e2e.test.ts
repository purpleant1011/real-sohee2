/**
 * src/features/release-truth/__tests__/byreum-golden-mission-e2e.test.ts
 *
 * Wave 5 · 바이름 Golden Mission Closed-Loop Production E2E Test
 * (ANI-1226, ANI-1199, ANI-1227, ANI-1228)
 */

import { describe, it, expect, beforeEach } from 'vitest'
import {
  ByreumGoldenMissionRunner,
  CANONICAL_BYREUM_WORKSPACE_ID,
} from '../byreum-golden-mission-runner'
import { ReservationCanonicalService } from '@/features/reservations/reservation-canonical-service'

describe('바이름 Fresh Golden Mission · Production Closed-Loop E2E (ANI-1226, ANI-1199, ANI-1227)', () => {
  beforeEach(() => {
    ReservationCanonicalService.resetState()
  })

  it('1. MUST execute the complete 8-stage Golden Mission closed loop with 100% verified evidence', async () => {
    const runner = new ByreumGoldenMissionRunner()
    const result = await runner.executeFullGoldenMission()

    // 1. Mission & Trace Identity
    expect(result.missionId).toBeDefined()
    expect(result.traceId).toBeDefined()

    // 2. Release Evidence Manifest Verifications
    const { manifest } = result
    expect(manifest.userReady).toBe(true)
    expect(manifest.overallStatus).toBe('RELEASE_READY')
    expect(manifest.verifiedStages).toBe(8)
    expect(manifest.unverifiedStages).toBe(0)
    expect(manifest.blockers).toEqual([])
    expect(manifest.secretLeakScanPassed).toBe(true)
    expect(manifest.freshnessValidationPassed).toBe(true)
    expect(manifest.advisorGatePassed).toBe(true)
    expect(manifest.targetWorkspaceId).toBe(CANONICAL_BYREUM_WORKSPACE_ID)

    // 3. Owner Home 5 Priority UX Verifications (ANI-1191, ANI-1220)
    const { homeReadModel } = result
    expect(homeReadModel.priority1_todayGoal.goal).toContain('주중 14:00~17:00 슬롯 가동률 80%')
    expect(homeReadModel.priority2_soheeWorkingOn.statusBadge).toBeDefined()
    expect(homeReadModel.priority4_verifiedOutcome.verifiedRevenueKrw).toBeNull()
    expect(homeReadModel.priority4_verifiedOutcome.revenueState).toBe('NOT_OBSERVED')
    expect(homeReadModel.priority4_verifiedOutcome.confirmedBookingsCount).toBe(1)
    expect(homeReadModel.priority5_nextBestAction.title).toBeDefined()

    // 4. Admin Customer 360 Verifications (ANI-1196, ANI-1222)
    const { customer360 } = result
    expect(customer360.identityBar.badge).toBe('PRODUCTION_PRIMARY')
    expect(customer360.identityBar.workspaceId).toBe(CANONICAL_BYREUM_WORKSPACE_ID)
    expect(customer360.metrics.totalRevenue).toBeNull()
    expect(customer360.metrics.revenueState).toBe('NOT_OBSERVED')
    expect(customer360.metrics.confirmedBookings).toBe(1)
    expect(customer360.metrics.activeMissionsCount).toBe(1)

    // 5. Admin Mission Trace Timeline Verifications (ANI-1201, ANI-1223)
    const { traceTimeline } = result
    expect(traceTimeline.totalObservedStages).toBe(8)
    expect(traceTimeline.stages.some(s => s.status === 'NOT_OBSERVED')).toBe(false)
    expect(traceTimeline.stages.some(s => s.actorBadge === 'USER')).toBe(true)
    expect(traceTimeline.stages.some(s => s.actorBadge === 'AGENT')).toBe(true)
    expect(traceTimeline.stages.some(s => s.actorBadge === 'PROVIDER')).toBe(true)
    expect(traceTimeline.stages.some(s => s.actorBadge === 'CUSTOMER')).toBe(true)
    expect(traceTimeline.stages.find(s => s.stageName === 'BOOKING_CONFIRMED')).toMatchObject({
      actorBadge: 'CUSTOMER',
      status: 'OBSERVED',
      evidenceRef: expect.any(String),
    })

    // 6. Append-only Audit Trail Verifications (ANI-1197, ANI-1224)
    expect(result.auditRecordsCount).toBeGreaterThanOrEqual(6)
  })

  it('2. MUST prove Same-Truth: Owner Home metrics match Admin Customer 360 numbers with 0 discrepancies', async () => {
    const runner = new ByreumGoldenMissionRunner()
    const result = await runner.executeFullGoldenMission()

    // 매출은 양쪽 모두 관측 근거 미연결(null)로 동일해야 한다.
    const ownerRevenue = result.homeReadModel.priority4_verifiedOutcome.verifiedRevenueKrw
    const adminRevenue = result.customer360.metrics.totalRevenue
    expect(ownerRevenue).toBeNull()
    expect(adminRevenue).toBeNull()
    expect(ownerRevenue).toBe(adminRevenue)

    const ownerRevenueState = result.homeReadModel.priority4_verifiedOutcome.revenueState
    const adminRevenueState = result.customer360.metrics.revenueState
    expect(ownerRevenueState).toBe(adminRevenueState)
    expect(ownerRevenueState).toBe('NOT_OBSERVED')

    const ownerBookings = result.homeReadModel.priority4_verifiedOutcome.confirmedBookingsCount
    const adminBookings = result.customer360.metrics.confirmedBookings
    expect(ownerBookings).toBe(adminBookings)
    expect(ownerBookings).toBe(1)
  })

  it('3. MUST enforce PostgreSQL RPC contract in test double: status review_required, version CAS increment, and fail-closed rejections', async () => {
    const runner = new ByreumGoldenMissionRunner()
    const client = runner.getMockClient()

    // 1. Create candidate via RPC
    const createRes = await client.rpc('create_performance_learning_candidate', {
      p_workspace_id: CANONICAL_BYREUM_WORKSPACE_ID,
      p_actor_user_id: 'usr-byreum-owner-001',
      p_observation: { summary: '관측 내용' },
      p_interpretation: { hypothesis: '해석 가설' },
      p_proposed_impact: { targetScope: 'NEXT_PLAN_ONLY' },
      p_stop_condition: { minSamples: 3 },
    })

    expect(createRes.error).toBeNull()
    const candidateId = createRes.data
    expect(candidateId).toBeDefined()

    const candidate = runner.getMockLearningCandidate(candidateId)
    expect(candidate).toBeDefined()
    expect(candidate.status).toBe('review_required')
    expect(candidate.created_by).toBe('usr-byreum-owner-001')
    expect(candidate.version).toBe(1)

    // 2. Reject NULL decision (fail-closed)
    const nullDecRes = await client.rpc('review_performance_learning_candidate', {
      p_workspace_id: CANONICAL_BYREUM_WORKSPACE_ID,
      p_candidate_id: candidateId,
      p_decision: null,
      p_reason: 'no decision',
      p_expected_version: 1,
    })
    expect(nullDecRes.data).toBe(false)

    // 3. Reject invalid uppercase or unrecognized decision (fail-closed)
    const invalidDecRes = await client.rpc('review_performance_learning_candidate', {
      p_workspace_id: CANONICAL_BYREUM_WORKSPACE_ID,
      p_candidate_id: candidateId,
      p_decision: 'APPROVE', // Case-sensitive: only 'approved' or 'rejected'
      p_reason: 'uppercase not allowed',
      p_expected_version: 1,
    })
    expect(invalidDecRes.data).toBe(false)

    // 4. Reject workspace mismatch (fail-closed tenant isolation)
    const foreignWsRes = await client.rpc('review_performance_learning_candidate', {
      p_workspace_id: 'foreign-workspace-999',
      p_candidate_id: candidateId,
      p_decision: 'approved',
      p_reason: 'foreign workspace attempt',
      p_expected_version: 1,
    })
    expect(foreignWsRes.data).toBe(false)

    // 5. Reject version CAS mismatch (fail-closed optimistic locking)
    const staleVersionRes = await client.rpc('review_performance_learning_candidate', {
      p_workspace_id: CANONICAL_BYREUM_WORKSPACE_ID,
      p_candidate_id: candidateId,
      p_decision: 'approved',
      p_reason: 'stale version',
      p_expected_version: 99, // Expecting 1
    })
    expect(staleVersionRes.data).toBe(false)

    // 6. Legitimate review approval: transitions review_required -> approved, version increments
    const validApproveRes = await client.rpc('review_performance_learning_candidate', {
      p_workspace_id: CANONICAL_BYREUM_WORKSPACE_ID,
      p_candidate_id: candidateId,
      p_decision: 'approved',
      p_reason: '근거 확인 완료',
      p_expected_version: 1,
    })
    expect(validApproveRes.data).toBe(true)

    const approvedCandidate = runner.getMockLearningCandidate(candidateId)
    expect(approvedCandidate.status).toBe('approved')
    expect(approvedCandidate.version).toBe(2) // Version incremented atomically
    expect(approvedCandidate.decided_by).toBeDefined()
    expect(approvedCandidate.review_reason).toBe('근거 확인 완료')

    // 7. Reject secondary review when status is no longer review_required (fail-closed status guard)
    const secondReviewRes = await client.rpc('review_performance_learning_candidate', {
      p_workspace_id: CANONICAL_BYREUM_WORKSPACE_ID,
      p_candidate_id: candidateId,
      p_decision: 'rejected',
      p_reason: 'double review attempt',
      p_expected_version: 2,
    })
    expect(secondReviewRes.data).toBe(false)
  })
})
