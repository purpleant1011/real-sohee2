import { describe, it, expect } from 'vitest'
import { ExperimentEngine } from '../engine/experiment-engine'
import { AttributionEngine } from '../engine/attribution-engine'
import { LearningGovernanceEngine } from '../engine/learning-governance'

describe('Sohee V0.8.8 Experiment, Attribution & Learning Engines [ANI-179, ANI-205, ANI-206]', () => {
  describe('ExperimentEngine', () => {
    it('declares winning variant when sample size threshold is met', () => {
      const exp = ExperimentEngine.evaluate({
        id: 'exp-1',
        title: '인스타그램 눈썹 전후 비교 Hook 문구 A/B 테스트',
        hypothesis: '감성 스토리텔링형 훅이 기능 나열형보다 예약 전환율이 높을 것이다.',
        variableType: 'hook',
        minSampleRequired: 30,
        status: 'running',
        variants: [
          { id: 'var-a', name: 'A: 기능 나열형', payload: {}, impressions: 100, clicks: 20, inquiries: 2, bookings: 1 },
          { id: 'var-b', name: 'B: 감성 스토리텔링형', payload: {}, impressions: 120, clicks: 25, inquiries: 8, bookings: 5 }
        ]
      })

      // Total clicks = 45 >= 30 -> Concluded
      expect(exp.status).toBe('concluded')
      expect(exp.winnerVariantId).toBe('var-b')
      expect(exp.learningSummary).toContain('승자: [B: 감성 스토리텔링형]')
    })
  })

  describe('AttributionEngine', () => {
    it('credits 100% direct attribution for UTM matching bookings', () => {
      const result = AttributionEngine.attributeBooking(
        {
          bookingId: 'bk-1',
          customerId: 'cust-1',
          amountWon: 150000,
          bookedAt: new Date('2026-08-31T15:00:00'),
          utmSource: 'naver_blog'
        },
        [
          {
            id: 'tp-1',
            channel: 'naver_blog',
            campaignId: 'camp-spring',
            contentId: 'cnt-1',
            timestamp: new Date('2026-08-31T14:30:00'),
            interactionType: 'click'
          }
        ]
      )

      expect(result.attributionType).toBe('DIRECT')
      expect(result.attributedRevenueWon).toBe(150000)
      expect(result.confidenceScore).toBeGreaterThanOrEqual(0.9)
    })

    it('credits 50% assisted attribution for touchpoint within 7 days', () => {
      const result = AttributionEngine.attributeBooking(
        {
          bookingId: 'bk-2',
          customerId: 'cust-2',
          amountWon: 120000,
          bookedAt: new Date('2026-08-31T18:00:00')
        },
        [
          {
            id: 'tp-2',
            channel: 'instagram',
            campaignId: 'camp-spring',
            timestamp: new Date('2026-08-28T10:00:00'),
            interactionType: 'view'
          }
        ]
      )

      expect(result.attributionType).toBe('ASSISTED')
      expect(result.attributedRevenueWon).toBe(60000)
    })
  })

  describe('LearningGovernanceEngine', () => {
    it('generates pattern success proposal when mission revenue goal is met', () => {
      const proposals = LearningGovernanceEngine.reviewMission({
        missionId: 'mis-1',
        title: '봄맞이 유휴 슬롯 소진',
        targetChannel: 'naver_blog',
        targetInquiries: 5,
        actualInquiries: 6,
        targetRevenueWon: 500000,
        realizedRevenueWon: 540000,
        bestPerformingKeyword: '청라 센트럴파크 눈썹'
      })

      expect(proposals.length).toBeGreaterThan(0)
      expect(proposals[0].type).toBe('pattern_success')
      expect(proposals[0].recommendation).toContain('청라 센트럴파크 눈썹')
    })
  })
})
