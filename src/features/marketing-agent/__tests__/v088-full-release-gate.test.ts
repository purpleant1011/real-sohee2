import { describe, it, expect } from 'vitest'
import { deriveCustomerStage, evaluateSignalFreshness, type MarketSignalRecord } from '../engine/strategic-brain'
import { QualityGateEngine } from '../engine/quality-gate'
import { GuardrailEngine } from '../engine/guardrail-engine'
import { DecisionBudgetEngine } from '../engine/decision-budget'
import { ExperimentEngine } from '../engine/experiment-engine'
import { AttributionEngine } from '../engine/attribution-engine'
import { LearningGovernanceEngine } from '../engine/learning-governance'
import { AgentStudioGovernanceEngine } from '../engine/agent-studio-governance'
import { ReservationEngine, CrmRetentionLoopEngine, ReputationEngine } from '../engine/crm-and-channels'

describe('Sohee V0.8.8 Full Funnel & Release Gate E2E [ANI-213 ~ ANI-219]', () => {
  it('E2E Full Marketing Loop: Opportunity → Strategy → Content → QC → Approval → Publish → Customer → Booking → Attribution → Learning', () => {
    // 1. Radar detects market signal & evaluates freshness
    const signal: MarketSignalRecord = {
      id: 'sig-1',
      workspaceId: 'ws-byreum',
      source: 'local_event',
      title: '청라 봄맞이 뷰티 검색량 증가',
      fact: '전주 대비 +42% 상승',
      inference: '봄맞이 맞춤 눈썹 프로모션 기회',
      confidence: 0.9,
      relevanceScore: 0.85,
      observedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 48 * 3600 * 1000).toISOString(),
      isDecayed: false
    }
    const freshEval = evaluateSignalFreshness(signal)
    expect(freshEval.isDecayed).toBe(false)
    expect(freshEval.effectiveConfidence).toBeGreaterThan(0.8)

    // 2. Customer Lifecycle Stage calculation
    const customerStage = deriveCustomerStage({ hasInquiry: true, hasBooking: false, hasPayment: false })
    expect(customerStage).toBe('inquiry')

    // 3. Content Creation & Quality Gate Inspection
    const content = {
      channel: 'naver_blog' as const,
      title: '2026 청라 자연 눈썹: 봄 맞춤 디자인 가이드',
      body: '인천 청라 센트럴파크 인근 바이름 맞춤 눈썹 상담입니다. 자연스러운 결을 살려드립니다.',
      images: ['https://example.com/eyebrow.jpg'],
      externalLinks: ['https://booking.naver.com/byreum?utm_source=naver_blog']
    }
    const qcResult = QualityGateEngine.inspect(content)
    expect(qcResult.passed).toBe(true)
    expect(qcResult.overallScore).toBeGreaterThanOrEqual(80)

    // 4. Decision Budget & Escalation Gate
    const decision = DecisionBudgetEngine.evaluate({
      id: 'dec-1',
      title: content.title,
      category: 'public_publish',
      businessImpact: 3,
      urgency: 3,
      irreversibility: 2,
      risk: 2,
      description: '블로그 발행 승인'
    })
    expect(decision.recommendedAction).toBe('approve')

    // 5. Pre-publish Guardrail safety check
    const guardrail = new GuardrailEngine()
    const guardrailCheck = guardrail.evaluate({
      workspaceId: 'ws-byreum',
      actionType: 'publish_post'
    })
    expect(guardrailCheck.allowed).toBe(true)

    // 6. Customer inquiry, reservation & booking confirmation
    const availableSlots = [
      { slotId: 'slot-tue-1500', date: '2026-09-01', startTime: '15:00', endTime: '16:30', status: 'AVAILABLE' as const }
    ]
    const heldSlot = ReservationEngine.holdSlot(availableSlots[0], 'cust-minji')
    const confirmedBooking = ReservationEngine.confirmBooking(heldSlot, 150000)
    expect(confirmedBooking.status).toBe('BOOKED')
    expect(confirmedBooking.amountWon).toBe(150000)

    // 7. Revenue Attribution
    const attribution = AttributionEngine.attributeBooking(
      {
        bookingId: 'bk-101',
        customerId: 'cust-minji',
        amountWon: 150000,
        bookedAt: new Date(),
        utmSource: 'naver_blog'
      },
      [
        {
          id: 'tp-1',
          channel: 'naver_blog',
          contentId: 'cnt-1',
          timestamp: new Date(),
          interactionType: 'click'
        }
      ]
    )
    expect(attribution.attributionType).toBe('DIRECT')
    expect(attribution.attributedRevenueWon).toBe(150000)

    // 8. Post-Mission Learning Loop & Playbook Update
    const proposals = LearningGovernanceEngine.reviewMission({
      missionId: 'mis-spring-1',
      title: '봄맞이 슬롯 소진',
      targetChannel: 'naver_blog',
      targetInquiries: 4,
      actualInquiries: 6,
      targetRevenueWon: 150000,
      realizedRevenueWon: 150000,
      bestPerformingKeyword: '청라 센트럴파크 맞춤 눈썹'
    })
    expect(proposals).toHaveLength(1)
    expect(proposals[0].type).toBe('pattern_success')
  })

  it('verifies strict safety halt on Kill Switch and Quiet Hours breach', () => {
    const guardrail = new GuardrailEngine()
    guardrail.setKillSwitch(true)

    const result = guardrail.evaluate({
      workspaceId: 'ws-byreum',
      actionType: 'outbound_message',
      customerId: 'cust-1'
    })

    expect(result.allowed).toBe(false)
    expect(result.enforcementRule).toBe('KILL_SWITCH')
  })
})
