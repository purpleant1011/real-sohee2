import { describe, it, expect } from 'vitest'
import { 
  ReservationEngine, 
  CrmRetentionLoopEngine, 
  ReputationEngine,
  type BookingSlot,
  type CustomerRecord,
  type PlaceReview
} from '../engine/crm-and-channels'

describe('Sohee V0.8.8 CRM, Retention, Reservation & Reputation Engines [ANI-198 ~ ANI-203]', () => {
  describe('ReservationEngine', () => {
    it('correctly filters empty available slots and holds slot', () => {
      const slots: BookingSlot[] = [
        { slotId: 's1', date: '2026-09-01', startTime: '14:00', endTime: '15:30', status: 'AVAILABLE' },
        { slotId: 's2', date: '2026-09-01', startTime: '16:00', endTime: '17:30', status: 'BOOKED', amountWon: 150000 }
      ]

      const available = ReservationEngine.getEmptySlots(slots)
      expect(available).toHaveLength(1)
      expect(available[0].slotId).toBe('s1')

      const held = ReservationEngine.holdSlot(available[0], 'cust-1')
      expect(held.status).toBe('HOLD')
      expect(held.bookedCustomerId).toBe('cust-1')

      const confirmed = ReservationEngine.confirmBooking(held, 150000)
      expect(confirmed.status).toBe('BOOKED')
      expect(confirmed.amountWon).toBe(150000)
    })
  })

  describe('CrmRetentionLoopEngine', () => {
    it('triggers retouch reminder when visit date is 65 days ago', () => {
      const today = new Date('2026-08-31T12:00:00')
      const visitDate = new Date('2026-06-25T12:00:00') // 67 days ago

      const customer: CustomerRecord = {
        id: 'cust-1',
        name: '이수연',
        lastVisitDate: visitDate,
        lastServiceName: '자연 눈썹',
        touchpointCount: 3,
        retentionStage: 'VISITED'
      }

      const result = CrmRetentionLoopEngine.evaluateCustomerRetention(customer, today)
      expect(result.stage).toBe('RETOUCH_DUE')
      expect(result.actionGenerated).toContain('리터치 주기 알림')
    })

    it('triggers dormant reactivation coupon when visit date is 200 days ago', () => {
      const today = new Date('2026-08-31T12:00:00')
      const visitDate = new Date('2026-01-10T12:00:00') // > 180 days ago

      const customer: CustomerRecord = {
        id: 'cust-2',
        name: '박지수',
        lastVisitDate: visitDate,
        touchpointCount: 1,
        retentionStage: 'VISITED'
      }

      const result = CrmRetentionLoopEngine.evaluateCustomerRetention(customer, today)
      expect(result.stage).toBe('DORMANT')
      expect(result.actionGenerated).toContain('휴면 고객 재활성화')
    })
  })

  describe('ReputationEngine', () => {
    it('escalates 1-star negative review to owner immediately', () => {
      const review: PlaceReview = {
        reviewId: 'rev-1',
        authorName: '방문자A',
        rating: 1,
        comment: '시술 시간이 너무 지연되었습니다.',
        createdAt: new Date(),
        channel: 'naver_place'
      }

      const result = ReputationEngine.evaluateReview(review)
      expect(result.needsEscalation).toBe(true)
      expect(result.suggestedReply).toContain('긴급 사장님 검토 필요')
    })

    it('generates polite appreciation reply for 5-star positive review', () => {
      const review: PlaceReview = {
        reviewId: 'rev-2',
        authorName: '김민서',
        rating: 5,
        comment: '눈썹 모양이 너무 자연스럽고 마음에 쏙 들어요!',
        createdAt: new Date(),
        channel: 'naver_place'
      }

      const result = ReputationEngine.evaluateReview(review)
      expect(result.needsEscalation).toBe(false)
      expect(result.suggestedReply).toContain('바이름을 찾아주셔서 진심으로 감사드립니다')
    })
  })
})
