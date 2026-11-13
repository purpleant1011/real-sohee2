import { describe, it, expect } from 'vitest'
import {
  ContentDraftService,
  TenantGroundingViolationError,
} from '@/features/content/content-draft-service'
import { VerifiedOutcomeAggregatorService } from '@/features/learning/verified-outcome-aggregator'
import { NextBestActionPlanner } from '@/features/learning/next-best-action-planner'

describe('[RC-04][Regression] Tenant-scoped Grounding & Truth (ANI-1329)', () => {
  const byreumWorkspaceId = '00000000-0000-4000-8000-0000000000a2' // Beauty/Eyebrow Salon

  describe('1. Tenant Grounding Boundary & Foreign Keyword Prevention', () => {
    it('throws TenantGroundingViolationError when Byreum beauty salon is given Bakery keywords/topics', async () => {
      // Attempting to generate bakery tart draft under Byreum beauty salon workspace
      await expect(
        ContentDraftService.generateAndSaveDraft({
          workspaceId: byreumWorkspaceId,
          topic: '달빛제과 주말 한정 단호박 타르트 신메뉴 안내',
          channel: 'INSTAGRAM',
        })
      ).rejects.toThrow(TenantGroundingViolationError)

      await expect(
        ContentDraftService.generateAndSaveDraft({
          workspaceId: byreumWorkspaceId,
          topic: '수제 제주 말차 르뱅쿠키와 캄파뉴 베이커리 오픈',
          channel: 'INSTAGRAM',
        })
      ).rejects.toThrow(TenantGroundingViolationError)
    })

    it('successfully generates legitimate beauty draft under Byreum workspace without foreign leakage', async () => {
      const draft = await ContentDraftService.generateAndSaveDraft({
        workspaceId: byreumWorkspaceId,
        topic: '바이름 25년 경력 원장 1:1 맞춤 자연눈썹 케어 안내',
        channel: 'INSTAGRAM',
        tone: '전문적이고 신뢰감 있는',
      })

      expect(draft).toBeDefined()
      expect(draft.caption).toMatch(/자연눈썹|눈썹/)
      expect(draft.caption).not.toContain('달빛제과')
      expect(draft.caption).not.toContain('타르트')
      expect(draft.caption).not.toContain('르뱅쿠키')
    }, 15000)
  })

  describe('2. Outcome Aggregator Revenue & Inbound Truth (No 150000 KRW or Foreign Chat Binding)', () => {
    it('does NOT fabricate 150000 KRW revenue when booking has null or zero amount', async () => {
      const missionId = 'mis-byreum-test-1'
      const bookingId = 'bk-zero-rev-1'

      const mockClient = {
        from: (table: string) => {
          if (table === 'marketing_missions') {
            return {
              select: () => ({
                eq: () => ({
                  eq: () => ({
                    single: async () => ({
                      data: {
                        id: missionId,
                        workspace_id: byreumWorkspaceId,
                        booking_id: bookingId,
                        customer_id: null,
                        metadata: {},
                      },
                      error: null,
                    }),
                  }),
                }),
              }),
              update: () => ({ eq: () => ({ eq: () => Promise.resolve({ error: null }) }) }),
            }
          }
          if (table === 'reservations') {
            return {
              select: () => ({
                eq: () => ({
                  eq: () => ({
                    eq: () => ({
                      maybeSingle: async () => ({
                        data: {
                          id: bookingId,
                          workspace_id: byreumWorkspaceId,
                          status: 'CONFIRMED',
                          total_amount_krw: null, // No revenue recorded!
                        },
                        error: null,
                      }),
                    }),
                  }),
                }),
              }),
            }
          }
          if (table === 'customer_conversations') {
            return {
              select: () => ({
                eq: () => ({
                  eq: () => ({
                    limit: () => Promise.resolve({ data: [], error: null }),
                  }),
                }),
              }),
            }
          }
          if (table === 'performance_learning_candidates') {
            return {
              insert: async () => ({ error: null }),
            }
          }
          if (table === 'mission_events') {
            return {
              insert: async () => ({ error: null }),
            }
          }
          return {
            select: () => ({
              eq: () => ({
                maybeSingle: async () => ({ data: null, error: null }),
              }),
            }),
          }
        },
        rpc: async (fnName: string, _args: any) => {
          if (fnName === 'create_performance_learning_candidate') {
            return { data: 'cand-rc04-test-1', error: null }
          }
          return { data: null, error: new Error(`Unknown RPC function: ${fnName}`) }
        },
      }

      const aggregator = new VerifiedOutcomeAggregatorService(mockClient as any)
      const result = await aggregator.aggregateMissionOutcome(byreumWorkspaceId, missionId)

      // Strict assertions: Revenue MUST NOT be fabricated to 150000 KRW!
      expect(result.outcome.verifiedRevenueKrw).toBe(0)
      expect(result.outcome.verifiedRevenueKrw).not.toBe(150000)
    })

    it('does NOT arbitrarily bind unrelated customer conversations when mission has no customer_id', async () => {
      const missionId = 'mis-byreum-unrelated-conv-1'

      const mockClient = {
        from: (table: string) => {
          if (table === 'marketing_missions') {
            return {
              select: () => ({
                eq: () => ({
                  eq: () => ({
                    single: async () => ({
                      data: {
                        id: missionId,
                        workspace_id: byreumWorkspaceId,
                        booking_id: null,
                        customer_id: null, // No customer linked to this mission
                        metadata: {},
                      },
                      error: null,
                    }),
                  }),
                }),
              }),
            }
          }
          if (table === 'reservations') {
            return {
              select: () => ({
                eq: () => ({
                  eq: () => ({
                    eq: () => Promise.resolve({ data: [], error: null }),
                  }),
                }),
              }),
            }
          }
          if (table === 'customer_conversations') {
            return {
              select: () => ({
                eq: (col: string, _val: string) => {
                  if (col === 'workspace_id') {
                    return {
                      eq: (col2: string, val2: string) => {
                        // Correct query must filter by mission_id
                        if (col2 === 'mission_id' && val2 === missionId) {
                          return { limit: () => Promise.resolve({ data: [], error: null }) }
                        }
                        return { limit: () => Promise.resolve({ data: [], error: null }) }
                      },
                      limit: () => {
                        // Unrelated conversations in workspace!
                        return Promise.resolve({
                          data: [
                            { id: 'conv-unrelated-1', customer_id: 'cust-unrelated-1' },
                            { id: 'conv-unrelated-2', customer_id: 'cust-unrelated-2' },
                          ],
                          error: null,
                        })
                      },
                    }
                  }
                  return { limit: () => Promise.resolve({ data: [], error: null }) }
                },
              }),
            }
          }
          return {}
        },
        rpc: async (fnName: string, _args: any) => {
          if (fnName === 'create_performance_learning_candidate') {
            return { data: 'cand-rc04-unrelated-1', error: null }
          }
          return { data: null, error: new Error(`Unknown RPC function: ${fnName}`) }
        },
      }

      const aggregator = new VerifiedOutcomeAggregatorService(mockClient as any)
      const result = await aggregator.aggregateMissionOutcome(byreumWorkspaceId, missionId)

      // Assertions: Unrelated conversations must NOT be stolen into this mission!
      expect(result.outcome.verifiedInboundCount).toBe(0)
      expect(result.outcome.status).toBe('NOT_OBSERVED')
      expect(result.outcome.evidenceChain.customerId).toBeNull()
      expect(result.learningCandidateId).toBeNull()
      expect(result.nextBestAction).toBeNull()
    })
  })

  describe('3. Next Best Action Insufficient Data Guard (No Forced 85% Recommendations)', () => {
    it('defers NBA recommendation with DEFERRED_INSUFFICIENT_DATA and confidence 0 when evidence is UNKNOWN', () => {
      const planner = new NextBestActionPlanner()
      const nba = planner.plan({
        workspaceId: byreumWorkspaceId,
        sourceMissionId: 'mis-insufficient-1',
        businessGoal: '예약 공백 채우기',
        latestOutcome: {
          status: 'NOT_OBSERVED',
          evidenceClass: 'UNKNOWN',
          bookingsCount: 0,
          revenueKrw: 0,
          channel: 'INSTAGRAM',
        },
        availableCredit: 50000,
        riskTier: 'LOW',
        recentFailedActionTypes: [],
      })

      expect(nba.actionType).toBe('DEFERRED_INSUFFICIENT_DATA')
      expect(nba.confidence).toBe(0)
      expect(nba.requiresApproval).toBe(false)
      expect(nba.channel).toBe('NONE')
    })
  })
})
