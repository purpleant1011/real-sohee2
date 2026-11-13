import { describe, it, expect } from 'vitest'
import {
  evaluateSampleSufficiency,
  validateHypothesisSeparation,
  assertTenantIsolation,
  applyApprovedHypothesisToNextPlan,
  proposeHypothesisToNextPlanDraft,
  filterSuppressedOrRejectedHypotheses,
  HypothesisSeparationViolationError,
  TenantLearningLeakError,
  UnapprovedHypothesisApplicationError,
  type LearningCandidatePayload,
} from '../learning-contract'
import { WeeklyCeoReportService } from '@/features/reporting/weekly-ceo-report-service'

describe('Controlled Learning & Next Mission Contract (ANI-1882 / Task 10)', () => {
  const dummyCandidate: LearningCandidatePayload = {
    id: 'cand-001',
    workspace_id: 'ws-test-1',
    status: 'approved',
    observation: {
      period: { start: '2026-10-01T00:00:00Z', end: '2026-10-08T00:00:00Z' },
      sampleSize: 1,
      coverage: 'confirmed_reservations',
      baseline: null,
      evidenceRefs: ['booking:bk_001', 'receipt:rcp_001'],
      summary: 'instagram 채널 마케팅 후 확정 예약 1건 관측',
      channel: 'instagram',
      metric: {
        revenueKrw: 150000,
        bookings: 1,
        inboundCount: 0,
      },
    },
    interpretation: {
      hypothesis: '가을 프로모션 메시지가 예약 문의를 유도했을 가능성 관측',
      rationale: '단일 표본이므로 인과 단정 보류',
      sampleConfidence: 'INSUFFICIENT',
      isCausalAssertion: false,
      conclusionState: 'PENDING_FURTHER_OBSERVATION',
    },
    proposed_impact: {
      targetScope: 'NEXT_PLAN_ONLY',
      targetMetric: 'weekly_bookings',
      expectedImpact: '다음 기획 참고',
      projectedRevenueKrw: null,
      rollbackVersion: 1,
    },
    stop_condition: {
      threshold: '전환 부재 시 철회',
      maxFailureCount: 3,
      reviewIntervalHours: 72,
      stopAction: 'suppress',
    },
  }

  describe('1. Sample Sufficiency & Inconclusive Rules', () => {
    it('MUST hold conclusion (PENDING_FURTHER_OBSERVATION) when sample is 1', () => {
      const evalResult = evaluateSampleSufficiency({
        confirmedBookingsCount: 1,
        inboundCount: 0,
      })

      expect(evalResult.isSampleSufficient).toBe(false)
      expect(evalResult.sampleConfidence).toBe('INSUFFICIENT')
      expect(evalResult.conclusionState).toBe('PENDING_FURTHER_OBSERVATION')
      expect(evalResult.reason).toContain('단순 동시 관측')
    })

    it('MUST hold conclusion without baseline regardless of booking count', () => {
      const evalResult = evaluateSampleSufficiency({
        confirmedBookingsCount: 20,
        inboundCount: 10,
        hasBaseline: false,
      })

      expect(evalResult.isSampleSufficient).toBe(false)
      expect(evalResult.sampleConfidence).toBe('INSUFFICIENT')
      expect(evalResult.conclusionState).toBe('PENDING_FURTHER_OBSERVATION')
      expect(evalResult.reason).toContain('기준선(baseline)')
    })

    it('MUST declare INCONCLUSIVE when observations are 0', () => {
      const evalResult = evaluateSampleSufficiency({
        confirmedBookingsCount: 0,
        inboundCount: 0,
      })

      expect(evalResult.isSampleSufficient).toBe(false)
      expect(evalResult.conclusionState).toBe('INCONCLUSIVE')
    })

    it('MUST declare INCONCLUSIVE on late cancellation or cancelled bookings', () => {
      const evalResult = evaluateSampleSufficiency({
        confirmedBookingsCount: 0,
        inboundCount: 0,
        cancelledBookingsCount: 1,
        isLateCancellation: true,
      })

      expect(evalResult.isSampleSufficient).toBe(false)
      expect(evalResult.conclusionState).toBe('INCONCLUSIVE')
      expect(evalResult.reason).toContain('취소')
    })

    it('allows OBSERVED_CORRELATION only when baseline exists and sample size is sufficient (>= 30)', () => {
      const evalResult = evaluateSampleSufficiency({
        confirmedBookingsCount: 35,
        inboundCount: 5,
        hasBaseline: true,
      })

      expect(evalResult.isSampleSufficient).toBe(true)
      expect(evalResult.sampleConfidence).toBe('MODERATE')
      expect(evalResult.conclusionState).toBe('OBSERVED_CORRELATION')
    })
  })

  describe('2. Memory Separation & Mutation Guard', () => {
    it('MUST throw HypothesisSeparationViolationError when candidate targetScope is not NEXT_PLAN_ONLY', () => {
      const invalidCandidate: LearningCandidatePayload = {
        ...dummyCandidate,
        proposed_impact: {
          ...dummyCandidate.proposed_impact,
          targetScope: 'GLOBAL_OVERRIDE' as any,
        },
      }

      expect(() =>
        validateHypothesisSeparation({ candidate: invalidCandidate })
      ).toThrow(HypothesisSeparationViolationError)
    })

    it('MUST throw when hypothesis attempts to mutate store facts (e.g. price, procedure)', () => {
      expect(() =>
        validateHypothesisSeparation({
          candidate: dummyCandidate,
          attemptedMutations: {
            storeFacts: { priceKrw: 120000 },
          },
        })
      ).toThrow(/확정된 가게 사실/)
    })

    it('MUST throw when hypothesis attempts to mutate past approved drafts', () => {
      expect(() =>
        validateHypothesisSeparation({
          candidate: dummyCandidate,
          attemptedMutations: {
            approvedDrafts: [{ id: 'draft-past-1', modified: true }],
          },
        })
      ).toThrow(/과거 이미 승인된 원고를 소급 수정/)
    })

    it('MUST throw when hypothesis attempts to mutate customer consents', () => {
      expect(() =>
        validateHypothesisSeparation({
          candidate: dummyCandidate,
          attemptedMutations: {
            consents: [{ id: 'consent-1', modified: true }],
          },
        })
      ).toThrow(/고객 동의 내역/)
    })
  })

  describe('3. Application to Next Plan Only & Zero Past Mutation', () => {
    it('MUST throw UnapprovedHypothesisApplicationError when candidate status is not strictly approved (negative regressions)', () => {
      const nonApprovedStatuses = ['review_required', 'rejected', 'superseded', '', undefined, null]

      for (const st of nonApprovedStatuses) {
        const candidate = { ...dummyCandidate, status: st as any }
        expect(() =>
          applyApprovedHypothesisToNextPlan({
            workspaceId: 'ws-test-1',
            candidateId: 'cand-001',
            candidate,
            currentPlanVersion: 2,
            existingApprovedDraftsCount: 5,
          })
        ).toThrow(UnapprovedHypothesisApplicationError)
      }
    })

    it('MUST throw TenantLearningLeakError when candidate workspace_id is missing, null, or empty', () => {
      const invalidWorkspaces = [undefined, null, '', '   ']

      for (const ws of invalidWorkspaces) {
        const candidate = { ...dummyCandidate, workspace_id: ws as any }
        expect(() =>
          applyApprovedHypothesisToNextPlan({
            workspaceId: 'ws-test-1',
            candidateId: 'cand-001',
            candidate,
            currentPlanVersion: 2,
            existingApprovedDraftsCount: 5,
          })
        ).toThrow(TenantLearningLeakError)
      }
    })

    it('MUST throw UnapprovedHypothesisApplicationError when candidate.id does not match candidateId or is missing', () => {
      const mismatchedIds = ['cand-other', '', undefined, null]

      for (const id of mismatchedIds) {
        const candidate = { ...dummyCandidate, id: id as any }
        expect(() =>
          applyApprovedHypothesisToNextPlan({
            workspaceId: 'ws-test-1',
            candidateId: 'cand-001',
            candidate,
            currentPlanVersion: 2,
            existingApprovedDraftsCount: 5,
          })
        ).toThrow(UnapprovedHypothesisApplicationError)
      }
    })

    it('MUST increment plan version and guarantee 0 mutations to past approved drafts and store facts', () => {
      const result = applyApprovedHypothesisToNextPlan({
        workspaceId: 'ws-test-1',
        candidateId: 'cand-001',
        candidate: dummyCandidate,
        currentPlanVersion: 2,
        existingApprovedDraftsCount: 5,
      })

      expect(result.nextPlanVersion).toBe(3)
      expect(result.appliedLearningCandidateId).toBe('cand-001')
      expect(result.rollbackVersion).toBe(2)
      expect(result.mutatedApprovedDraftsCount).toBe(0)
      expect(result.mutatedStoreFactsCount).toBe(0)
      expect(result.note).toContain('[Plan v3]')
    })

    it('proposes draft to next plan version via pure helper without requiring approved status', () => {
      const pendingCandidate = { ...dummyCandidate, status: 'review_required' }
      const draftResult = proposeHypothesisToNextPlanDraft({
        workspaceId: 'ws-test-1',
        candidateId: 'cand-001',
        candidate: pendingCandidate,
        currentPlanVersion: 2,
      })
      expect(draftResult.targetPlanVersion).toBe(3)
      expect(draftResult.isDraftProposal).toBe(true)
      expect(draftResult.note).toContain('[초안 제안]')
    })
  })

  describe('4. Tenant Isolation', () => {
    it('MUST throw TenantLearningLeakError when cross-tenant access is detected', () => {
      expect(() =>
        assertTenantIsolation('ws-byreum-alpha', 'ws-other-beta')
      ).toThrow(TenantLearningLeakError)
    })

    it('passes when tenant matches', () => {
      expect(() =>
        assertTenantIsolation('ws-byreum-alpha', 'ws-byreum-alpha')
      ).not.toThrow()
    })
  })

  describe('5. Suppression of Rejected/Superseded Hypotheses', () => {
    it('MUST suppress rejected and superseded candidates from being re-proposed', () => {
      const candidates = [
        { id: 'c1', status: 'candidate' },
        { id: 'c2', status: 'approved' },
        { id: 'c3', status: 'rejected', review_reason: '사장님 취향 불일치' },
        { id: 'c4', status: 'superseded' },
      ]

      const filtered = filterSuppressedOrRejectedHypotheses(candidates)
      expect(filtered.map((c) => c.id)).toEqual(['c1', 'c2'])
    })
  })

  describe('6. Weekly CEO Report Projection Grounding', () => {
    it('projects learning hypotheses and proposed next actions from DB without asserting causal revenue', async () => {
      const wsId = 'ws-test-weekly'
      const mockClient = {
        from: (table: string) => {
          const query: any = {
            select: () => query,
            eq: () => query,
            order: () => query,
            range: () => query,
            gte: () => query,
            lt: () => query,
            maybeSingle: () => Promise.resolve({ data: { workspace_id: wsId, dataset_mode: 'ACTUAL' }, error: null }),
            then: (resolve: any) => {
              if (table === 'workspace_registry') {
                return resolve({ data: { workspace_id: wsId, dataset_mode: 'ACTUAL' }, error: null })
              }
              if (table === 'performance_learning_candidates') {
                return resolve({
                  data: [
                    {
                      workspace_id: wsId,
                      id: 'cand-weekly-1',
                      status: 'candidate',
                      observation: { evidenceRefs: ['booking:bk_1'] },
                      interpretation: {
                        hypothesis: '주간 예약 문의 증가와 연계된 채널 가설',
                        sampleConfidence: 'PRELIMINARY',
                        conclusionState: 'OBSERVED_CORRELATION',
                      },
                      created_at: '2026-10-14T00:00:00Z',
                    },
                  ],
                  error: null,
                })
              }
              if (table === 'marketing_missions') {
                return resolve({
                  data: [
                    {
                      workspace_id: wsId,
                      id: 'msn-weekly-1',
                      status: 'NEXT_ACTION_READY',
                      target_channel: 'instagram',
                      metadata: {
                        next_best_action: {
                          actionId: 'nba-weekly-1',
                          title: '동일 채널 후속 릴스 발행 검토',
                          channel: 'instagram',
                          requiresApproval: true,
                        },
                      },
                    },
                  ],
                  error: null,
                })
              }
              return resolve({ data: [], error: null })
            },
          }
          return query
        },
      }

      const service = new WeeklyCeoReportService(mockClient as any)
      const report = await service.generateReport(wsId, new Date('2026-10-15T00:00:00Z'))

      expect(report.learningHypothesesState).toBe('OBSERVED')
      expect(report.learningHypotheses).toBeDefined()
      expect(report.learningHypotheses).toHaveLength(1)
      expect(report.learningHypotheses![0].id).toBe('cand-weekly-1')
      expect(report.learningHypotheses![0].hypothesis).toBe('주간 예약 문의 증가와 연계된 채널 가설')
      expect(report.learningHypotheses![0].sampleConfidence).toBe('PRELIMINARY')

      expect(report.proposedNextActions).toBeDefined()
      expect(report.proposedNextActions).toHaveLength(1)
      expect(report.proposedNextActions![0].id).toBe('nba-weekly-1')
      expect(report.proposedNextActions![0].title).toBe('동일 채널 후속 릴스 발행 검토')
      expect(report.proposedNextActions![0].requiresApproval).toBe(true)

      // Ensures truthfulness: Executive summary never fabricates unobserved revenue or savings
      expect(report.totalRevenueWon).toBeNull()
      expect(report.executiveSummary).toContain('수납·매출·방문 완료와 절감 시간·비용은 확인 근거가 연결되지 않아 계산하지 않았어요.')
    })

    it('distinguishes query ERROR from EMPTY, fails closed for hypothesis-linked actions, and maintains independent actions', async () => {
      const wsId = 'ws-test-weekly-error'
      const mockFailingClient = {
        from: (table: string) => {
          const query: any = {
            select: () => query,
            eq: () => query,
            order: () => query,
            range: () => query,
            gte: () => query,
            lt: () => query,
            maybeSingle: () => Promise.resolve({ data: { workspace_id: wsId, dataset_mode: 'ACTUAL' }, error: null }),
            then: (resolve: any) => {
              if (table === 'workspace_registry') {
                return resolve({ data: { workspace_id: wsId, dataset_mode: 'ACTUAL' }, error: null })
              }
              if (table === 'performance_learning_candidates') {
                // Table query fails with DB error
                return resolve({ data: null, error: { message: 'connection error' } })
              }
              if (table === 'marketing_missions') {
                return resolve({
                  data: [
                    {
                      workspace_id: wsId,
                      id: 'msn-failing-linked',
                      status: 'NEXT_ACTION_READY',
                      metadata: {
                        learning_candidate_id: 'cand-unverified-1',
                        next_best_action: { actionId: 'nba-linked-fail', title: '학습 연계 제안' },
                      },
                    },
                    {
                      workspace_id: wsId,
                      id: 'msn-general-action',
                      status: 'NEXT_ACTION_READY',
                      metadata: {
                        next_best_action: { actionId: 'nba-independent', title: '가설 무관 일반 제안' },
                      },
                    },
                  ],
                  error: null,
                })
              }
              return resolve({ data: [], error: null })
            },
          }
          return query
        },
      }

      const failingService = new WeeklyCeoReportService(mockFailingClient as any)
      const errorReport = await failingService.generateReport(wsId, new Date('2026-10-15T00:00:00Z'))

      // 1. Query ERROR must not be confused with EMPTY []
      expect(errorReport.learningHypothesesState).toBe('ERROR')
      expect(errorReport.learningHypotheses).toBeNull()

      // 2. Learning-linked action is suppressed when learning query errors (fail-closed)
      // while independent action is preserved
      expect(errorReport.proposedNextActions).toHaveLength(1)
      expect(errorReport.proposedNextActions![0].id).toBe('nba-independent')

      // Next: verify candidates outside report period and suppression of rejected candidates
      const mockFilterClient = {
        from: (table: string) => {
          const query: any = {
            select: () => query,
            eq: () => query,
            order: () => query,
            range: () => query,
            gte: () => query,
            lt: () => query,
            maybeSingle: () => Promise.resolve({ data: { workspace_id: wsId, dataset_mode: 'ACTUAL' }, error: null }),
            then: (resolve: any) => {
              if (table === 'workspace_registry') {
                return resolve({ data: { workspace_id: wsId, dataset_mode: 'ACTUAL' }, error: null })
              }
              if (table === 'performance_learning_candidates') {
                return resolve({
                  data: [
                    {
                      workspace_id: wsId,
                      id: 'cand-rejected-in-period',
                      status: 'rejected',
                      observation: { evidenceRefs: [] },
                      interpretation: { hypothesis: '기간 내 거절된 가설' },
                      created_at: '2026-10-14T00:00:00Z',
                    },
                    {
                      workspace_id: wsId,
                      id: 'cand-approved-in-period',
                      status: 'approved',
                      observation: { evidenceRefs: [] },
                      interpretation: { hypothesis: '기간 내 승인된 가설' },
                      created_at: '2026-10-14T00:00:00Z',
                    },
                    {
                      workspace_id: wsId,
                      id: 'cand-rejected-out-of-period',
                      status: 'rejected',
                      observation: { evidenceRefs: [] },
                      interpretation: { hypothesis: '보고 기간 밖(2달 전) 거절된 가설' },
                      created_at: '2026-08-01T00:00:00Z',
                    },
                    {
                      workspace_id: wsId,
                      id: 'cand-approved-out-of-period',
                      status: 'approved',
                      observation: { evidenceRefs: [] },
                      interpretation: { hypothesis: '보고 기간 밖(2달 전) 승인된 가설' },
                      created_at: '2026-08-01T00:00:00Z',
                    },
                  ],
                  error: null,
                })
              }
              if (table === 'marketing_missions') {
                return resolve({
                  data: [
                    {
                      workspace_id: wsId,
                      id: 'msn-rejected-in',
                      status: 'NEXT_ACTION_READY',
                      metadata: {
                        learning_candidate_id: 'cand-rejected-in-period',
                        next_best_action: { actionId: 'nba-rejected-in', title: '기간 내 거절 제안' },
                      },
                    },
                    {
                      workspace_id: wsId,
                      id: 'msn-rejected-out',
                      status: 'NEXT_ACTION_READY',
                      metadata: {
                        learning_candidate_id: 'cand-rejected-out-of-period',
                        next_best_action: { actionId: 'nba-rejected-out', title: '기간 밖 거절 제안' },
                      },
                    },
                    {
                      workspace_id: wsId,
                      id: 'msn-approved-in',
                      status: 'NEXT_ACTION_READY',
                      metadata: {
                        learning_candidate_id: 'cand-approved-in-period',
                        next_best_action: { actionId: 'nba-approved-in', title: '기간 내 승인 제안' },
                      },
                    },
                    {
                      workspace_id: wsId,
                      id: 'msn-approved-out',
                      status: 'NEXT_ACTION_READY',
                      metadata: {
                        learning_candidate_id: 'cand-approved-out-of-period',
                        next_best_action: { actionId: 'nba-approved-out', title: '기간 밖 승인 제안' },
                      },
                    },
                  ],
                  error: null,
                })
              }
              return resolve({ data: [], error: null })
            },
          }
          return query
        },
      }

      const filterService = new WeeklyCeoReportService(mockFilterClient as any)
      const filteredReport = await filterService.generateReport(wsId, new Date('2026-10-15T00:00:00Z'))

      expect(filteredReport.learningHypothesesState).toBe('OBSERVED')
      // Weekly hypotheses list only projects hypotheses created within the report period
      expect(filteredReport.learningHypotheses).toHaveLength(1)
      expect(filteredReport.learningHypotheses![0].id).toBe('cand-approved-in-period')

      // Actions linked to rejected hypotheses (both in and out of period) must be completely excluded
      expect(filteredReport.proposedNextActions).toHaveLength(2)
      const actionIds = filteredReport.proposedNextActions!.map((a) => a.id)
      expect(actionIds).toContain('nba-approved-in')
      expect(actionIds).toContain('nba-approved-out')
      expect(actionIds).not.toContain('nba-rejected-in')
      expect(actionIds).not.toContain('nba-rejected-out')
    })
  })
})
