/**
 * Sohee V0.8.8 CRM, Retention, Reservation & Channel Verification Engine
 * [ANI-198, ANI-200, ANI-201, ANI-202, ANI-203]
 */

// 1. [ANI-198] Reservation & Availability
export interface BookingSlot {
  slotId: string
  date: string // YYYY-MM-DD
  startTime: string // HH:mm
  endTime: string // HH:mm
  status: 'AVAILABLE' | 'HOLD' | 'BOOKED' | 'COMPLETED'
  bookedCustomerId?: string
  serviceName?: string
  amountWon?: number
}

export class ReservationEngine {
  static getEmptySlots(slots: BookingSlot[]): BookingSlot[] {
    return slots.filter(s => s.status === 'AVAILABLE')
  }

  static holdSlot(slot: BookingSlot, customerId: string): BookingSlot {
    if (slot.status !== 'AVAILABLE') {
      throw new Error(`이미 예약 또는 보류된 슬롯입니다: ${slot.slotId}`)
    }
    return { ...slot, status: 'HOLD', bookedCustomerId: customerId }
  }

  static confirmBooking(slot: BookingSlot, amountWon: number, serviceName = '자연 눈썹 1:1 맞춤 디자인'): BookingSlot {
    return { ...slot, status: 'BOOKED', amountWon, serviceName }
  }
}

// 2. [ANI-202] CRM & Retention Loops
export interface CustomerRecord {
  id: string
  name: string
  phone?: string
  lastVisitDate?: Date
  lastServiceName?: string
  touchpointCount: number
  retentionStage: 'NEW_INQUIRY' | 'VISITED' | 'RETOUCH_DUE' | 'DORMANT'
}

export class CrmRetentionLoopEngine {
  /**
   * Evaluates customer visit history and determines retention actions:
   * - 60 days after visit -> Retouch notification
   * - 180 days after visit -> Dormant reactivation coupon
   */
  static evaluateCustomerRetention(customer: CustomerRecord, referenceDate = new Date()): {
    stage: CustomerRecord['retentionStage']
    actionGenerated?: string
  } {
    if (!customer.lastVisitDate) {
      return { stage: 'NEW_INQUIRY', actionGenerated: '첫 방문 상담 및 15% 할인 예약 링크 안내' }
    }

    const diffDays = Math.floor((referenceDate.getTime() - customer.lastVisitDate.getTime()) / (1000 * 60 * 60 * 24))

    if (diffDays >= 180) {
      return {
        stage: 'DORMANT',
        actionGenerated: `방문 후 180일 경과 (${diffDays}일) → 휴면 고객 재활성화 특별 20% 웰컴백 쿠폰 발송`
      }
    } else if (diffDays >= 60) {
      return {
        stage: 'RETOUCH_DUE',
        actionGenerated: `시술 후 60일 경과 (${diffDays}일) → ${customer.lastServiceName || '눈썹'} 리터치 주기 알림 및 슬롯 추천`
      }
    }

    return { stage: 'VISITED' }
  }
}

// 3. [ANI-203] Reputation & Local Review Engine
export interface PlaceReview {
  reviewId: string
  authorName: string
  rating: number // 1 ~ 5
  comment: string
  createdAt: Date
  channel: 'naver_place' | 'daangn'
}

export class ReputationEngine {
  static evaluateReview(review: PlaceReview): {
    needsEscalation: boolean
    suggestedReply: string
  } {
    if (review.rating <= 2) {
      return {
        needsEscalation: true,
        suggestedReply: `[긴급 사장님 검토 필요] 별점 ${review.rating}점 불만 리뷰가 접수되었습니다. 사실 확인 후 1:1 상담 연결을 권장합니다.`
      }
    }

    return {
      needsEscalation: false,
      suggestedReply: `안녕하세요 ${review.authorName}님! 바이름을 찾아주셔서 진심으로 감사드립니다 😊 만족스러운 눈썹 결과로 보답할 수 있어 기쁩니다. 리터치 기간에 또 뵙겠습니다!`
    }
  }
}
