import { describe, it, expect } from 'vitest'
import {
  deriveCustomerStage,
  evaluateSignalFreshness,
  type MarketSignalRecord
} from '../engine/strategic-brain'

describe('Strategic Marketing Brain Engine (V0.8.8)', () => {
  describe('deriveCustomerStage', () => {
    it('should derive lead stage when no actions occurred', () => {
      expect(deriveCustomerStage({ hasInquiry: false, hasBooking: false, hasPayment: false })).toBe('lead')
    })

    it('should derive inquiry stage when customer sent inquiry', () => {
      expect(deriveCustomerStage({ hasInquiry: true, hasBooking: false, hasPayment: false })).toBe('inquiry')
    })

    it('should derive booked stage when reservation is confirmed', () => {
      expect(deriveCustomerStage({ hasInquiry: true, hasBooking: true, hasPayment: false })).toBe('booked')
    })

    it('should derive visited_paid stage when payment is recorded', () => {
      expect(deriveCustomerStage({ hasInquiry: true, hasBooking: true, hasPayment: true, daysSinceLastVisit: 10 })).toBe('visited_paid')
    })

    it('should derive repeat_due when last visit was over 60 days ago', () => {
      expect(deriveCustomerStage({ hasInquiry: false, hasBooking: false, hasPayment: true, daysSinceLastVisit: 65 })).toBe('repeat_due')
    })

    it('should derive reactivated when customer responds to re-engagement campaign', () => {
      expect(deriveCustomerStage({ hasInquiry: true, hasBooking: false, hasPayment: true, isReactivated: true })).toBe('reactivated')
    })
  })

  describe('evaluateSignalFreshness', () => {
    const baseSignal: MarketSignalRecord = {
      id: 'sig-1',
      workspaceId: 'ws-1',
      source: 'local_event',
      title: '청라 봄맞이 뷰티 페스티벌',
      fact: '3월 25일부터 인근 센트럴파크 축제 개최',
      inference: '축제 방문객 대상 봄 신규 눈썹 예약 수요 30% 증가 예상',
      confidence: 0.85,
      relevanceScore: 0.9,
      observedAt: '2026-08-01T00:00:00Z',
      expiresAt: '2026-08-31T00:00:00Z',
      isDecayed: false
    }

    it('should return decayed state if current time is past expiry', () => {
      const result = evaluateSignalFreshness(baseSignal, new Date('2026-09-05T00:00:00Z'))
      expect(result.isDecayed).toBe(true)
      expect(result.effectiveConfidence).toBeLessThan(0.85)
    })

    it('should retain freshness and calculate decayed confidence over time', () => {
      const result = evaluateSignalFreshness(baseSignal, new Date('2026-08-15T00:00:00Z'))
      expect(result.isDecayed).toBe(false)
      expect(result.effectiveConfidence).toBeGreaterThan(0.5)
      expect(result.effectiveConfidence).toBeLessThanOrEqual(0.85)
    })
  })
})
