import { describe, it, expect, beforeEach } from 'vitest'
import {
  CanonicalOpportunityDetector,
  type BusinessSignalEnvelope,
} from '@/features/autonomy/opportunity-detector'
import {
  DelegationEnvelopeManager,
  type ActionExecutionCandidate,
  type DelegationPolicyEnvelope,
  generateMinimalEnvelopeProposal,
} from '@/features/autonomy/delegation-envelope'
import {
  MissionBudgetPreflightService,
} from '@/features/finops/mission-budget-preflight'
import {
  OwnerAbsentScheduler,
  type AutomationTrigger,
} from '@/features/autonomy/owner-absent-scheduler'
import {
  DailyBriefingService,
  type BriefingContext,
} from '@/features/autonomy/daily-briefing-service'
import { BackgroundWorkLedger } from '@/features/autonomy/work-ledger'

describe('V0.91 Wave 4 · Proactive Employee Autonomy & Daily Loop', () => {
  const workspaceId = '00000000-0000-4000-8000-0000000000a2'
  const now = new Date('2026-09-10T10:00:00.000Z').getTime()

  // --------------------------------------------------------------------------
  // 1. ANI-1251: Opportunity Detector
  // --------------------------------------------------------------------------
  describe('1. ANI-1251: Opportunity Detector · 예약공백/미답변/콘텐츠공백/목표미달 선제 감지', () => {
    let detector: CanonicalOpportunityDetector

    beforeEach(() => {
      detector = new CanonicalOpportunityDetector({ cooldownMs: 3600 * 1000 })
    })

    it('MUST return 0 opportunities when signals lack verifiable evidence sources (No Fabricated Opportunity)', () => {
      const emptySignals: BusinessSignalEnvelope = {
        workspaceId,
        observedAt: new Date(now).toISOString(),
        bookingSlots: [], // No open slots
        unansweredInquiries: [], // No inquiries
        daysSinceLastPost: 0,
        weeklyGoalProgress: 1.0,
      }

      const opportunities = detector.detect(emptySignals, now)
      expect(opportunities).toHaveLength(0)
    })

    it('MUST detect BOOKING_GAP and UNANSWERED_INQUIRY with strict source lineage and urgency scoring', () => {
      const activeSignals: BusinessSignalEnvelope = {
        workspaceId,
        observedAt: new Date(now).toISOString(),
        bookingSlots: [
          { slotId: 'slot-20260911-1400', date: '2026-09-11', startTime: '14:00', endTime: '15:00' },
          { slotId: 'slot-20260911-1600', date: '2026-09-11', startTime: '16:00', endTime: '17:00' },
        ],
        unansweredInquiries: [
          {
            conversationId: 'conv-inq-001',
            channel: 'INSTAGRAM_DM',
            customerName: '홍길동',
            waitingMinutes: 45,
            sourceMessageId: 'msg-ig-999',
          },
        ],
        daysSinceLastPost: 4,
        weeklyGoalProgress: 0.35,
      }

      const opportunities = detector.detect(activeSignals, now)

      expect(opportunities.length).toBeGreaterThanOrEqual(4)

      // 1. Booking Gap Opportunity
      const bookingGap = opportunities.find((o) => o.type === 'BOOKING_GAP')
      expect(bookingGap).toBeDefined()
      expect(bookingGap?.urgencyScore).toBe(90)
      expect(bookingGap?.source).toEqual({
        type: 'RESERVATION_SLOTS',
        id: 'slot-20260911-1400',
        count: 2,
      })
      expect(bookingGap?.confidence).toBe(1.0)
      expect(bookingGap?.dedupeKey).toContain(`${workspaceId}:BOOKING_GAP:`)

      // 2. Unanswered Inquiry Opportunity
      const inquiryOpp = opportunities.find((o) => o.type === 'UNANSWERED_INQUIRY')
      expect(inquiryOpp).toBeDefined()
      expect(inquiryOpp?.urgencyScore).toBe(85)
      expect(inquiryOpp?.source).toEqual({
        type: 'CUSTOMER_CONVERSATION',
        id: 'conv-inq-001',
        count: 1,
      })

      // 3. Content Drought Opportunity
      const contentOpp = opportunities.find((o) => o.type === 'CONTENT_DROUGHT')
      expect(contentOpp).toBeDefined()
      expect(contentOpp?.urgencyScore).toBe(65)

      // 4. Goal Shortfall Opportunity
      const goalOpp = opportunities.find((o) => o.type === 'GOAL_SHORTFALL')
      expect(goalOpp).toBeDefined()
      expect(goalOpp?.urgencyScore).toBe(70)
    })

    it('MUST filter out stale signals (> 24h old) and honor cooldown deduplication', () => {
      const staleTime = now - 25 * 3600 * 1000 // 25 hours ago
      const staleSignals: BusinessSignalEnvelope = {
        workspaceId,
        observedAt: new Date(staleTime).toISOString(),
        bookingSlots: [{ slotId: 'slot-stale', date: '2026-09-09', startTime: '10:00', endTime: '11:00' }],
        unansweredInquiries: [],
        daysSinceLastPost: 0,
        weeklyGoalProgress: 1.0,
      }

      // Stale signals must not be emitted
      const staleOpps = detector.detect(staleSignals, now)
      expect(staleOpps).toHaveLength(0)

      // Cooldown test
      const freshSignals: BusinessSignalEnvelope = {
        workspaceId,
        observedAt: new Date(now).toISOString(),
        bookingSlots: [{ slotId: 'slot-fresh', date: '2026-09-11', startTime: '10:00', endTime: '11:00' }],
        unansweredInquiries: [],
        daysSinceLastPost: 0,
        weeklyGoalProgress: 1.0,
      }

      const firstRun = detector.detect(freshSignals, now)
      expect(firstRun).toHaveLength(1)

      // Mark executed
      detector.markExecuted(firstRun[0].dedupeKey, now)

      // Second run within cooldown window must suppress duplicate
      const secondRun = detector.detect(freshSignals, now + 10 * 60 * 1000)
      expect(secondRun).toHaveLength(0)
    })
  })

  // --------------------------------------------------------------------------
  // 2. ANI-1252 & ANI-1254: Action-Specific Delegation Envelope
  // --------------------------------------------------------------------------
  describe('2. ANI-1252 & ANI-1254: Action-Specific Delegation Envelope · 4단 정책 & 위임 UX', () => {
    let envelopeManager: DelegationEnvelopeManager

    const defaultEnvelope: DelegationPolicyEnvelope = {
      envelopeId: 'env-byreum-001',
      workspaceId,
      version: 1,
      fingerprint: 'fp-default-v1',
      status: 'ACTIVE',
      quietHours: { startHour: 22, endHour: 8 },
      rules: {
        DRAFT_CONTENT: { tier: 'AUTO', maxCredits: 20 },
        CLASSIFY_INQUIRY: { tier: 'AUTO', maxCredits: 5 },
        REPLY_INQUIRY: {
          tier: 'CONDITIONAL_AUTO',
          allowedChannels: ['INSTAGRAM_DM', 'NAVER_TALK'],
          maxCredits: 10,
          minConfidence: 0.85,
        },
        PUBLISH_FEED: { tier: 'ALWAYS_APPROVE', maxCredits: 50 },
        AD_SPEND: { tier: 'ALWAYS_APPROVE', maxSpendKrw: 100000 },
        MEDICAL_LEGAL_CLAIM: { tier: 'FORBIDDEN_HANDOFF' },
      },
    }

    beforeEach(() => {
      envelopeManager = new DelegationEnvelopeManager(defaultEnvelope)
    })

    it('MUST evaluate AUTO, CONDITIONAL_AUTO, ALWAYS_APPROVE, and FORBIDDEN_HANDOFF tiers correctly', () => {
      // 1. AUTO: Internal drafting
      const autoAction: ActionExecutionCandidate = {
        actionKind: 'DRAFT_CONTENT',
        channel: 'INTERNAL',
        estimatedCredits: 10,
      }
      const autoResult = envelopeManager.evaluate(autoAction, 14) // 14:00
      expect(autoResult.decision).toBe('AUTO_EXECUTE')
      expect(autoResult.tier).toBe('AUTO')
      expect(autoResult.requiresApproval).toBe(false)

      // 2. CONDITIONAL_AUTO: Replying to inquiry within conditions
      const conditionalAction: ActionExecutionCandidate = {
        actionKind: 'REPLY_INQUIRY',
        channel: 'INSTAGRAM_DM',
        estimatedCredits: 5,
        confidence: 0.9,
      }
      const condResult = envelopeManager.evaluate(conditionalAction, 14)
      expect(condResult.decision).toBe('AUTO_EXECUTE')
      expect(condResult.tier).toBe('CONDITIONAL_AUTO')
      expect(condResult.requiresApproval).toBe(false)

      // 3. ALWAYS_APPROVE: Publishing public feed
      const publishAction: ActionExecutionCandidate = {
        actionKind: 'PUBLISH_FEED',
        channel: 'INSTAGRAM_FEED',
        estimatedCredits: 20,
      }
      const pubResult = envelopeManager.evaluate(publishAction, 14)
      expect(pubResult.decision).toBe('REQUIRE_APPROVAL')
      expect(pubResult.tier).toBe('ALWAYS_APPROVE')
      expect(pubResult.requiresApproval).toBe(true)

      // 4. FORBIDDEN_HANDOFF: Medical/Legal claim
      const forbiddenAction: ActionExecutionCandidate = {
        actionKind: 'MEDICAL_LEGAL_CLAIM',
        channel: 'INSTAGRAM_DM',
        estimatedCredits: 5,
      }
      const forbResult = envelopeManager.evaluate(forbiddenAction, 14)
      expect(forbResult.decision).toBe('REJECT_FORBIDDEN')
      expect(forbResult.tier).toBe('FORBIDDEN_HANDOFF')
      expect(forbResult.requiresApproval).toBe(true)
    })

    it('MUST fail-closed and escalate to approval if quiet hours or conditions are violated', () => {
      // CONDITIONAL_AUTO during quiet hours (23:00) must require approval
      const nightAction: ActionExecutionCandidate = {
        actionKind: 'REPLY_INQUIRY',
        channel: 'INSTAGRAM_DM',
        estimatedCredits: 5,
        confidence: 0.9,
      }
      const nightResult = envelopeManager.evaluate(nightAction, 23)
      expect(nightResult.decision).toBe('REQUIRE_APPROVAL')
      expect(nightResult.reason).toContain('심야 시간대(Quiet Hours)')

      // Exceeding credit limit must escalate to approval
      const highCostAction: ActionExecutionCandidate = {
        actionKind: 'REPLY_INQUIRY',
        channel: 'INSTAGRAM_DM',
        estimatedCredits: 25, // limit is 10
        confidence: 0.9,
      }
      const costResult = envelopeManager.evaluate(highCostAction, 14)
      expect(costResult.decision).toBe('REQUIRE_APPROVAL')
      expect(costResult.reason).toContain('크레딧 한도 초과')
    })

    it('ANI-1254: MUST generate minimal-scope delegation proposal with human-readable Korean explanation', () => {
      const currentActionContext: ActionExecutionCandidate = {
        actionKind: 'REPLY_INQUIRY',
        channel: 'NAVER_TALK',
        estimatedCredits: 10,
        confidence: 0.92,
      }

      const proposal = generateMinimalEnvelopeProposal(workspaceId, currentActionContext, '홍차리 대표')

      expect(proposal.targetActionKind).toBe('REPLY_INQUIRY')
      expect(proposal.proposedTier).toBe('CONDITIONAL_AUTO')
      expect(proposal.allowedChannel).toBe('NAVER_TALK')
      expect(proposal.maxCredits).toBe(10)
      expect(proposal.humanReadableSummary).toContain('네이버 톡톡 단순 문의 답변 초안 준비')
      expect(proposal.humanReadableSummary).toContain('최대 10 크레딧')
      expect(proposal.auditEntry.proposedBy).toBe('홍차리 대표')
    })
  })

  // --------------------------------------------------------------------------
  // 3. ANI-1274: FinOps Mission Budget Preflight & Credit Reserve
  // --------------------------------------------------------------------------
  describe('3. ANI-1274: FinOps Mission Budget Preflight & Credit Reserve', () => {
    let mockLedger: { balance: number; reserved: number }
    let preflightService: MissionBudgetPreflightService

    beforeEach(() => {
      mockLedger = { balance: 100, reserved: 0 }
      preflightService = new MissionBudgetPreflightService({
        getAvailableCredits: async (_wsId: string) => mockLedger.balance - mockLedger.reserved,
        reserveCredits: async (wsId: string, runId: string, amount: number, idemKey: string) => {
          if (mockLedger.balance - mockLedger.reserved < amount) {
            throw new Error('INSUFFICIENT_CREDITS: 가용 크레딧 부족')
          }
          mockLedger.reserved += amount
          return { reservationId: `resv_${runId}`, amount, idempotencyKey: idemKey }
        },
        settleCredits: async (resvId: string, actualCost: number) => {
          mockLedger.balance -= actualCost
          mockLedger.reserved = 0
          return { settlementId: `stl_${resvId}`, actualCost, status: 'SETTLED' }
        },
        releaseCredits: async (resvId: string, amount: number) => {
          mockLedger.reserved -= amount
          return { reservationId: resvId, releasedAmount: amount, status: 'RELEASED' }
        },
      })
    })

    it('MUST throw INSUFFICIENT_CREDITS and block external execution when balance is insufficient', async () => {
      mockLedger.balance = 5 // insufficient for 20 credit action

      await expect(
        preflightService.executeWithBudgetPreflight({
          workspaceId,
          actionRunId: 'run-expensive-001',
          requiredCredits: 20,
          idempotencyKey: 'idem-exp-001',
          executeFn: async () => 'SHOULD_NOT_BE_CALLED',
        })
      ).rejects.toThrowError(/INSUFFICIENT_CREDITS/)
    })

    it('MUST execute Reserve -> Execute -> Settle lifecycle and ensure zero credit leak', async () => {
      const result = await preflightService.executeWithBudgetPreflight({
        workspaceId,
        actionRunId: 'run-success-001',
        requiredCredits: 20,
        actualCost: 15,
        idempotencyKey: 'idem-succ-001',
        executeFn: async () => 'EXEC_SUCCESS',
      })

      expect(result.executionResult).toBe('EXEC_SUCCESS')
      expect(result.settlement.actualCost).toBe(15)
      expect(mockLedger.balance).toBe(85) // 100 - 15
      expect(mockLedger.reserved).toBe(0) // Released back
    })

    it('MUST release 100% reserved credits when execution fails', async () => {
      await expect(
        preflightService.executeWithBudgetPreflight({
          workspaceId,
          actionRunId: 'run-failed-001',
          requiredCredits: 20,
          idempotencyKey: 'idem-fail-001',
          executeFn: async () => {
            throw new Error('PROVIDER_NETWORK_ERROR')
          },
        })
      ).rejects.toThrowError(/PROVIDER_NETWORK_ERROR/)

      expect(mockLedger.balance).toBe(100) // untouched
      expect(mockLedger.reserved).toBe(0) // refunded
    })

    it('MUST hold reservation and refuse blind settle/release when result is RESULT_UNKNOWN', async () => {
      const unknownResult = await preflightService.executeWithBudgetPreflight({
        workspaceId,
        actionRunId: 'run-unknown-001',
        requiredCredits: 20,
        idempotencyKey: 'idem-unk-001',
        executeFn: async () => ({ status: 'RESULT_UNKNOWN', reason: 'PROVIDER_TIMEOUT' }),
      })

      expect(unknownResult.isHeldForReconcile).toBe(true)
      expect(mockLedger.balance).toBe(100) // Not deducted yet
      expect(mockLedger.reserved).toBe(20) // Held in reserve
    })
  })

  // --------------------------------------------------------------------------
  // 4. ANI-1253: Owner-Absent Scheduler & Durable Automation Runtime
  // --------------------------------------------------------------------------
  describe('4. ANI-1253: Owner-Absent Scheduler & Durable Automation Runtime', () => {
    let scheduler: OwnerAbsentScheduler
    let workLedger: BackgroundWorkLedger

    beforeEach(() => {
      workLedger = new BackgroundWorkLedger()
      scheduler = new OwnerAbsentScheduler(workLedger)
    })

    it('MUST block new runs completely when workspace is PAUSED', async () => {
      const trigger: AutomationTrigger = {
        triggerId: 'trig-001',
        triggerType: 'SCHEDULE',
        workspaceId,
        workspaceStatus: 'PAUSED', // Paused!
        actionType: 'GENERATE_CONTENT',
      }

      const result = await scheduler.scheduleAndRun(trigger, async () => {
        throw new Error('Should not run in paused workspace')
      })

      expect(result.status).toBe('BLOCKED_WORKSPACE_PAUSED')
      expect(workLedger.listTimeline(workspaceId)).toHaveLength(0)
    })

    it('MUST execute low-risk automation headlessly and persist execution to work ledger', async () => {
      const trigger: AutomationTrigger = {
        triggerId: 'trig-002',
        triggerType: 'SCHEDULE',
        workspaceId,
        workspaceStatus: 'ACTIVE',
        actionType: 'GENERATE_CONTENT',
        charterId: 'charter-v1',
        charterVersion: '1.0',
      }

      const result = await scheduler.scheduleAndRun(trigger, async () => {
        return {
          summary: '점심시간 타임특가 인스타 스토리 자동 초안 작성 완료',
          creditsConsumed: 10,
          evidenceId: 'ev-auto-002',
        }
      })

      expect(result.status).toBe('COMPLETED')
      const timeline = workLedger.listTimeline(workspaceId)
      expect(timeline).toHaveLength(1)
      expect(timeline[0].summary).toContain('타임특가 인스타 스토리')
      expect(timeline[0].verificationState).toBe('EXTERNAL_VERIFIED')
    })
  })

  // --------------------------------------------------------------------------
  // 5. ANI-1255: Daily Briefing Loop & Escalation Delivery
  // --------------------------------------------------------------------------
  describe('5. ANI-1255: Daily Briefing & Escalation Delivery', () => {
    let briefingService: DailyBriefingService

    beforeEach(() => {
      briefingService = new DailyBriefingService()
    })

    it('MUST generate source-backed Morning, Business Hours, and Evening briefings with zero fabrication', () => {
      const context: BriefingContext = {
        workspaceId,
        businessName: '바이름 뷰티',
        yesterdayOutcomes: [
          { metric: '신규 예약 확정', value: '2건', verifiedSourceId: 'book-101' },
          { metric: '인스타 도달', value: '1,240회', verifiedSourceId: 'reach-101' },
        ],
        activeOpportunities: [
          { title: '내일 오후 3시 예약 공백', urgencyScore: 90, sourceId: 'slot-gap-1' },
        ],
        pendingApprovals: [
          { title: '금요 이벤트 피드 게시 승인', approvalId: 'appr-901', deadlineHour: 18 },
        ],
        todayCompletedTasks: [
          { summary: '네이버 톡톡 예약 문의 3건 자동 답변', verified: true },
        ],
      }

      // 1. Morning Briefing
      const morning = briefingService.buildDailyBriefing('MORNING', context)
      expect(morning.slot).toBe('MORNING')
      expect(morning.headline).toContain('좋은 아침입니다')
      expect(morning.items).toHaveLength(4) // 2 yesterday outcomes + 1 opportunity + 1 pending approval

      // 2. Business Hours Briefing
      const midday = briefingService.buildDailyBriefing('BUSINESS_HOURS', context)
      expect(midday.slot).toBe('BUSINESS_HOURS')
      expect(midday.items.some((i) => i.title.includes('예약 공백'))).toBe(true)

      // 3. Evening Briefing
      const evening = briefingService.buildDailyBriefing('EVENING', context)
      expect(evening.slot).toBe('EVENING')
      expect(evening.items.some((i) => i.title.includes('자동 답변'))).toBe(true)
    })

    it('MUST deliver notifications with deduplication and canonical state routing', () => {
      const eventKey = `${workspaceId}:ESCALATION:appr-901`

      // First delivery attempt
      const firstDelivery = briefingService.dispatchEscalationNotification({
        workspaceId,
        eventKey,
        title: '신규 피드 게시 승인 필요',
        body: '바이름 가을 이벤트 피드 발행 전 확인이 필요합니다.',
        targetRoute: `/app/missions/msn-feed-001`,
        urgency: 'HIGH',
      })

      expect(firstDelivery.delivered).toBe(true)
      expect(firstDelivery.isDuplicate).toBe(false)
      expect(firstDelivery.resolvedRoute).toBe(`/app/missions/msn-feed-001`)

      // Second delivery attempt with same eventKey must be deduplicated (0 duplicate notifications)
      const secondDelivery = briefingService.dispatchEscalationNotification({
        workspaceId,
        eventKey,
        title: '신규 피드 게시 승인 필요 (재시도)',
        body: '바이름 가을 이벤트 피드 발행 전 확인이 필요합니다.',
        targetRoute: `/app/missions/msn-feed-001`,
        urgency: 'HIGH',
      })

      expect(secondDelivery.delivered).toBe(false)
      expect(secondDelivery.isDuplicate).toBe(true)
    })
  })
})
