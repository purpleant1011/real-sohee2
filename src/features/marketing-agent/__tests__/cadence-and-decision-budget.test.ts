import { describe, it, expect } from 'vitest'
import { OperatingCadenceEngine } from '../engine/operating-cadence'
import { DecisionBudgetEngine } from '../engine/decision-budget'

describe('Sohee V0.8.8 Operating Cadence & Decision Budget Engine [ANI-181, ANI-182]', () => {
  describe('OperatingCadenceEngine', () => {
    it('raises alert for inquiry SLA breach (> 15 minutes)', () => {
      const result = OperatingCadenceEngine.runContinuousCheck([
        { customerId: 'cust-1', elapsedMinutes: 18 },
        { customerId: 'cust-2', elapsedMinutes: 5 }
      ])

      expect(result.status).toBe('alert_raised')
      expect(result.actionsGenerated[0]).toContain('SLA 경보')
      expect(result.actionsGenerated[0]).toContain('18분')
    })

    it('generates promotion mission when 3+ empty slots are detected in morning brief', () => {
      const result = OperatingCadenceEngine.runMorningBrief(4)

      expect(result.status).toBe('completed')
      expect(result.actionsGenerated[0]).toContain('유휴 슬롯 4개 감지')
      expect(result.actionsGenerated[0]).toContain('할인 프로모션 미션')
    })

    it('computes revenue gap and plans weekly strategy', () => {
      const result = OperatingCadenceEngine.runWeeklyStrategy(1000000, 400000)

      expect(result.status).toBe('completed')
      expect(result.actionsGenerated[1]).toContain('600,000원')
    })

    it('generates daily close briefing with defended slots and revenue summary [ANI-464]', () => {
      const result = OperatingCadenceEngine.runDailyClose(3, 240000, 350)

      expect(result.cadenceType).toBe('daily_close')
      expect(result.status).toBe('completed')
      expect(result.actionsGenerated[0]).toContain('방어 완료 유휴 슬롯: 3건')
      expect(result.actionsGenerated[0]).toContain('240,000원')
    })

    it('generates monthly performance review and ROI calculation [ANI-464]', () => {
      const result = OperatingCadenceEngine.runMonthlyReview(10000000, 4200000, 12000)

      expect(result.cadenceType).toBe('monthly')
      expect(result.status).toBe('completed')
      expect(result.actionsGenerated[0]).toContain('4,200,000원')
      expect(result.actionsGenerated[0]).toContain('42.0%')
    })

    it('handles event-driven trigger for urgent booking cancellation [ANI-464]', () => {
      const result = OperatingCadenceEngine.handleEventTrigger({
        eventType: 'BOOKING_CANCELLED',
        meta: { timeSlot: '화요일 15:00' }
      })

      expect(result.cadenceType).toBe('event_driven')
      expect(result.status).toBe('completed')
      expect(result.actionsGenerated[0]).toContain('예약 취소 발생')
      expect(result.actionsGenerated[0]).toContain('화요일 15:00')
    })
  })

  describe('DecisionBudgetEngine', () => {
    it('escalates high impact, high risk decision to L3_IMMEDIATE_ESCALATION', () => {
      const decision = DecisionBudgetEngine.evaluate({
        id: 'dec-high',
        title: '전체 고객 대상 30% 파격 할인 이벤트',
        category: 'price_discount',
        businessImpact: 5,
        urgency: 4,
        irreversibility: 4,
        risk: 4,
        description: '매출 영향도 큼'
      })

      // 5 * 4 * 4 * 4 = 320 >= 200 -> L3
      expect(decision.score).toBe(320)
      expect(decision.tier).toBe('L3_IMMEDIATE_ESCALATION')
      expect(decision.canAutoPromote).toBe(false)
      expect(decision.recommendedAction).toBe('review')
    })

    it('places standard blog post into L2_BATCH_QUEUE with auto-promote eligibility', () => {
      const decision = DecisionBudgetEngine.evaluate({
        id: 'dec-med',
        title: '네이버 블로그 봄맞이 눈썹 가이드 포스팅',
        category: 'public_publish',
        businessImpact: 3,
        urgency: 3,
        irreversibility: 2,
        risk: 2,
        description: '표준 블로그 포스팅'
      })

      // 3 * 3 * 2 * 2 = 36 < 50 -> L1_NOTIFY
      expect(decision.score).toBe(36)
      expect(decision.tier).toBe('L1_NOTIFY')
      expect(decision.canAutoPromote).toBe(true)
      expect(decision.recommendedAction).toBe('approve')
    })
  })
})
