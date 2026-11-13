import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  aggregateMetricsByEvidenceClass,
  resolveEvidenceClass,
  type AttributedMetric,
} from '@/features/attribution/evidence-class'
import {
  VerifiedOutcomeAggregatorService,
} from '../verified-outcome-aggregator'

describe('Verified Outcome Attribution & Next Best Action Loop (ANI-1218, ANI-1219, ANI-1195)', () => {
  const workspaceId = '00000000-0000-4000-8000-0000000000a2'
  const missionId = 'msn-byreum-outcome-001'
  const bookingId = 'bk_confirmed_test_123'
  const customerId = 'cust_test_456'

  let mockMissionsDb: Record<string, any> = {}
  let mockReservationsDb: Record<string, any> = {}
  let mockConversationsDb: Record<string, any> = {}
  let mockLearningsDb: Record<string, any> = {}

  const mockSupabaseClient = {
    from: (table: string) => {
      if (table === 'marketing_missions') {
        return {
          select: vi.fn().mockImplementation(() => {
            const filters: Array<{ col: string; val: any }> = []
            const chain = {
              eq: (col: string, val: any) => {
                filters.push({ col, val })
                return chain
              },
              single: async () => {
                const match = Object.values(mockMissionsDb).find(r =>
                  filters.every(f => r[f.col] === f.val)
                )
                return { data: match || null, error: match ? null : new Error('Not found') }
              },
              maybeSingle: async () => {
                const match = Object.values(mockMissionsDb).find(r =>
                  filters.every(f => r[f.col] === f.val)
                )
                return { data: match || null, error: null }
              },
            }
            return chain
          }),
          update: vi.fn().mockImplementation((updates: any) => {
            const filters: Array<{ col: string; val: any }> = []
            const chain = {
              eq: (col: string, val: any) => {
                filters.push({ col, val })
                return chain
              },
              select: () => ({
                single: async () => {
                  const match = Object.values(mockMissionsDb).find(r =>
                    filters.every(f => r[f.col] === f.val)
                  )
                  if (match) {
                    Object.assign(match, updates)
                    return { data: match, error: null }
                  }
                  return { data: null, error: new Error('Not found') }
                },
              }),
            }
            return chain
          }),
        }
      }

      if (table === 'reservations') {
        return {
          select: vi.fn().mockImplementation(() => {
            const filters: Array<{ col: string; val: any }> = []
            const chain = {
              eq: (col: string, val: any) => {
                filters.push({ col, val })
                return chain
              },
              maybeSingle: async () => {
                const match = Object.values(mockReservationsDb).find(r =>
                  filters.every(f => r[f.col] === f.val)
                )
                return { data: match || null, error: null }
              },
            }
            return chain
          }),
        }
      }

      if (table === 'customer_conversations') {
        return {
          select: vi.fn().mockImplementation(() => {
            const filters: Array<{ col: string; val: any }> = []
            const chain = {
              eq: (col: string, val: any) => {
                filters.push({ col, val })
                return chain
              },
              limit: () => ({
                then: (cb: any) => cb({ data: Object.values(mockConversationsDb), error: null }),
              }),
            }
            return chain
          }),
        }
      }

      if (table === 'performance_learning_candidates') {
        return {
          insert: vi.fn().mockImplementation(async (row: any) => {
            mockLearningsDb[row.id] = row
            return { data: row, error: null }
          }),
        }
      }

      if (table === 'mission_events') {
        return {
          insert: vi.fn().mockResolvedValue({ error: null }),
        }
      }

      throw new Error(`Unexpected table: ${table}`)
    },
    rpc: vi.fn().mockImplementation(async (fnName: string, args: any) => {
      if (fnName === 'create_performance_learning_candidate') {
        const id = 'cand_' + Math.random().toString(36).slice(2, 9)
        mockLearningsDb[id] = {
          id,
          workspace_id: args.p_workspace_id,
          observation: args.p_observation,
          interpretation: args.p_interpretation,
          proposed_impact: args.p_proposed_impact,
          stop_condition: args.p_stop_condition,
          status: 'candidate',
          version: 1,
          created_by: args.p_actor_user_id,
        }
        return { data: id, error: null }
      }
      if (fnName === 'review_performance_learning_candidate') {
        const row = mockLearningsDb[args.p_candidate_id]
        if (!row || row.workspace_id !== args.p_workspace_id || row.version !== args.p_expected_version) {
          return { data: false, error: null }
        }
        row.status = args.p_decision
        row.version += 1
        row.review_reason = args.p_reason
        return { data: true, error: null }
      }
      throw new Error(`Unexpected RPC: ${fnName}`)
    }),
  } as any

  beforeEach(() => {
    mockMissionsDb = {}
    mockReservationsDb = {}
    mockConversationsDb = {}
    mockLearningsDb = {}

    mockMissionsDb[missionId] = {
      id: missionId,
      workspace_id: workspaceId,
      trace_id: 'trc-verified-outcome-001',
      status: 'BOOKED',
      goal: '바이름 가을 자연눈썹 10명 모객',
      customer_id: customerId,
      booking_id: bookingId,
      target_channel: 'instagram',
      metadata: {
        provider_post_reference: '18029384729102938',
      },
      external_action_receipt_id: 'rcp_meta_pub_001',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }

    mockReservationsDb[bookingId] = {
      id: bookingId,
      workspace_id: workspaceId,
      mission_id: missionId,
      customer_id: customerId,
      slot_id: '2026-09-12T14:00:00+09:00',
      status: 'CONFIRMED',
      deposit_krw: 30000,
      total_amount_krw: 180000,
    }
  })

  describe('1. Attribution Evidence Class Separation (ANI-1218)', () => {
    it('MUST strictly separate VERIFIED vs INFERRED vs UNKNOWN and never inflate verified totals', () => {
      const metrics: AttributedMetric[] = [
        {
          metricId: 'm-1',
          metricType: 'revenue_krw',
          evidenceClass: 'VERIFIED',
          value: 180000,
          sourceKind: 'booking',
          sourceId: bookingId,
          evidenceRefs: [`booking:${bookingId}`, 'receipt:rcp_001'],
          timestamp: new Date().toISOString(),
        },
        {
          metricId: 'm-2',
          metricType: 'revenue_krw',
          evidenceClass: 'INFERRED',
          value: 50000, // Estimated trend
          sourceKind: 'estimated_trend',
          sourceId: 'trend_est_01',
          evidenceRefs: [],
          timestamp: new Date().toISOString(),
        },
        {
          metricId: 'm-3',
          metricType: 'conversions',
          evidenceClass: 'UNKNOWN',
          value: 10,
          sourceKind: 'unknown',
          evidenceRefs: [],
          timestamp: new Date().toISOString(),
        },
      ]

      const result = aggregateMetricsByEvidenceClass(metrics)

      // Verified total MUST ONLY be the verified booking revenue
      expect(result.verifiedTotal).toBe(180000)
      expect(result.inferredTotal).toBe(50000)
      expect(result.unknownTotal).toBe(10)
      expect(result.hasVerifiedEvidence).toBe(true)
      expect(result.sourceEvidenceRefs).toContain(`booking:${bookingId}`)
    })

    it('MUST resolve evidence class according to source existence and evidence integrity', () => {
      // Concrete booking with proof -> VERIFIED
      expect(
        resolveEvidenceClass({
          sourceKind: 'booking',
          sourceId: 'bk_123',
          evidenceRefs: ['proof_123'],
        })
      ).toBe('VERIFIED')

      // Trend estimation -> INFERRED
      expect(
        resolveEvidenceClass({
          sourceKind: 'estimated_trend',
          sourceId: 'trend_1',
        })
      ).toBe('INFERRED')

      // Missing sourceId -> UNKNOWN
      expect(
        resolveEvidenceClass({
          sourceKind: 'unknown',
          sourceId: null,
        })
      ).toBe('UNKNOWN')
    })
  })

  describe('2. Verified Outcome Aggregator, Learning Candidate, Next Best Action (ANI-1219, ANI-1195)', () => {
    it('MUST aggregate verified booking outcome, produce structured learning candidate via RPC, and advance to NEXT_ACTION_READY', async () => {
      const aggregator = new VerifiedOutcomeAggregatorService(mockSupabaseClient)

      const result = await aggregator.aggregateMissionOutcome(workspaceId, missionId)

      // 1. Outcome Summary
      expect(result.outcome.status).toBe('OBSERVED')
      expect(result.outcome.verifiedBookingsCount).toBe(1)
      expect(result.outcome.verifiedRevenueKrw).toBe(180000)
      expect(result.outcome.evidenceChain.bookingId).toBe(bookingId)
      expect(result.outcome.evidenceChain.postReference).toBe('18029384729102938')
      expect(result.outcome.narrativeOutcome).toContain('180,000')

      // 2. Learning Candidate persisted in DB via RPC (Sample=1 holds conclusion)
      expect(result.learningCandidateId).toBeDefined()
      const savedLearning = mockLearningsDb[result.learningCandidateId!]
      expect(savedLearning).toBeDefined()
      expect(savedLearning.observation.summary).toContain('180,000')
      expect(savedLearning.interpretation.hypothesis).toBeDefined()
      expect(savedLearning.interpretation.isCausalAssertion).toBe(false)
      expect(savedLearning.interpretation.conclusionState).toBe('PENDING_FURTHER_OBSERVATION')
      expect(savedLearning.proposed_impact.targetScope).toBe('NEXT_PLAN_ONLY')
      expect(savedLearning.stop_condition.threshold).toBeDefined()
      expect(savedLearning.status).toBe('candidate')

      // 3. Next Best Action recommendation (Confidence is null when calibration/baseline is absent)
      expect(result.nextBestAction).toBeDefined()
      expect(result.nextBestAction?.title).toBeDefined()
      expect(result.nextBestAction?.confidence).toBeNull()
      expect(result.nextBestAction?.riskTier).toBe('MEDIUM')
      expect(result.nextBestAction?.requiresApproval).toBe(true)
      expect(result.nextBestAction?.evidenceRefs).toContain(`mission:${missionId}`)

      // 4. Mission state progression to NEXT_ACTION_READY
      const updatedMission = mockMissionsDb[missionId]
      expect(updatedMission.status).toBe('NEXT_ACTION_READY')
      expect(updatedMission.metadata.next_best_action).toBeDefined()
      expect(updatedMission.metadata.learning_candidate_id).toBe(result.learningCandidateId)
    })

    it('MUST fail closed and NOT advance to LEARNING or return candidateId when candidate write RPC fails', async () => {
      const failingClient = {
        ...mockSupabaseClient,
        rpc: vi.fn().mockImplementation(async (fnName: string) => {
          if (fnName === 'create_performance_learning_candidate') {
            return { data: null, error: { message: 'DB_CONNECTION_LOST' } }
          }
          return { data: true, error: null }
        }),
      }

      const aggregator = new VerifiedOutcomeAggregatorService(failingClient as any)

      await expect(
        aggregator.aggregateMissionOutcome(workspaceId, missionId)
      ).rejects.toThrow('[LEARNING_CANDIDATE_CREATION_FAILED]')

      // Ensure mission was not left in LEARNING
      const mission = mockMissionsDb[missionId]
      expect(mission.status).not.toBe('LEARNING')
      expect(mission.metadata?.learning_candidate_id).toBeUndefined()
    })

    it('MUST execute reviewLearningCandidate with CAS version check and version increment', async () => {
      const aggregator = new VerifiedOutcomeAggregatorService(mockSupabaseClient)
      const candId = 'cand_cas_test'
      mockLearningsDb[candId] = {
        id: candId,
        workspace_id: workspaceId,
        status: 'review_required',
        version: 1,
      }

      // 1. Success with matching version (version 1 -> 2)
      const success = await aggregator.reviewLearningCandidate({
        workspaceId,
        candidateId: candId,
        decision: 'approved',
        reason: '대표 원장 검토 승인',
        expectedVersion: 1,
      })
      expect(success).toBe(true)
      expect(mockLearningsDb[candId].status).toBe('approved')
      expect(mockLearningsDb[candId].version).toBe(2)

      // 2. Failure with stale version (expected 1, but now 2)
      const staleReview = await aggregator.reviewLearningCandidate({
        workspaceId,
        candidateId: candId,
        decision: 'rejected',
        reason: '재검토 시도',
        expectedVersion: 1,
      })
      expect(staleReview).toBe(false)
      expect(mockLearningsDb[candId].status).toBe('approved') // unchanged
    })

    it('MUST return NOT_OBSERVED when no booking or inbound response exists', async () => {
      const idleMissionId = 'msn-idle-001'
      mockMissionsDb[idleMissionId] = {
        id: idleMissionId,
        workspace_id: workspaceId,
        trace_id: 'trc-idle-001',
        status: 'LISTENING',
        goal: '새 프로모션',
        customer_id: null,
        booking_id: null,
        metadata: {},
      }

      const aggregator = new VerifiedOutcomeAggregatorService(mockSupabaseClient)
      const result = await aggregator.aggregateMissionOutcome(workspaceId, idleMissionId)

      expect(result.outcome.status).toBe('NOT_OBSERVED')
      expect(result.outcome.verifiedBookingsCount).toBe(0)
      expect(result.outcome.verifiedRevenueKrw).toBe(0)
      expect(result.learningCandidateId).toBeNull()
      expect(result.nextBestAction).toBeNull()

      // Mission status should not advance
      expect(mockMissionsDb[idleMissionId].status).toBe('LISTENING')
    })
  })
})
