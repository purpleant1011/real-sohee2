/**
 * Sohee V0.8.8 Attribution Engine
 * [ANI-205] Attribution Engine — Campaign/Mission/Content/Conversation 기여도
 */

export interface CustomerTouchpoint {
  id: string
  channel: 'instagram' | 'threads' | 'naver_blog' | 'daangn'
  contentId?: string
  campaignId?: string
  timestamp: Date
  interactionType: 'view' | 'click' | 'inquiry' | 'coupon_download'
}

export interface BookingEvent {
  bookingId: string
  customerId: string
  amountWon: number
  bookedAt: Date
  utmSource?: string
}

export type AttributionType = 'DIRECT' | 'ASSISTED' | 'ORGANIC'

export interface AttributionResult {
  bookingId: string
  attributionType: AttributionType
  attributedCampaignId?: string
  attributedContentId?: string
  attributedRevenueWon: number
  confidenceScore: number // 0.0 ~ 1.0
  reasoning: string
}

export class AttributionEngine {
  /**
   * Calculate attribution for a confirmed booking based on customer touchpoints
   */
  static attributeBooking(booking: BookingEvent, touchpoints: CustomerTouchpoint[]): AttributionResult {
    // 1. Check for Direct UTM / Coupon match
    if (booking.utmSource) {
      const directTouch = touchpoints.find(t => t.channel.toLowerCase().includes(booking.utmSource!.toLowerCase()))
      return {
        bookingId: booking.bookingId,
        attributionType: 'DIRECT',
        attributedCampaignId: directTouch?.campaignId,
        attributedContentId: directTouch?.contentId,
        attributedRevenueWon: booking.amountWon,
        confidenceScore: 0.95,
        reasoning: `UTM 파라미터(${booking.utmSource}) 직접 유입으로 100% 직접 기여가 확정되었습니다.`
      }
    }

    // 2. Check for Assisted Touchpoints within 7 days
    const sevenDaysBefore = new Date(booking.bookedAt.getTime() - 7 * 24 * 60 * 60 * 1000)
    const recentTouchpoints = touchpoints.filter(
      t => t.timestamp >= sevenDaysBefore && t.timestamp <= booking.bookedAt
    )

    if (recentTouchpoints.length > 0) {
      const lastTouch = recentTouchpoints[recentTouchpoints.length - 1]
      return {
        bookingId: booking.bookingId,
        attributionType: 'ASSISTED',
        attributedCampaignId: lastTouch.campaignId,
        attributedContentId: lastTouch.contentId,
        attributedRevenueWon: Math.round(booking.amountWon * 0.5),
        confidenceScore: 0.7,
        reasoning: `예약 전 7일 이내 마케팅 콘텐츠(${lastTouch.channel}) 상호작용이 감지되어 50% 간접 기여로 산정되었습니다.`
      }
    }

    // 3. Organic
    return {
      bookingId: booking.bookingId,
      attributionType: 'ORGANIC',
      attributedRevenueWon: 0,
      confidenceScore: 0.4,
      reasoning: '마케팅 터치포인트 연관성이 관측되지 않아 자연 유입(Organic)으로 분류되었습니다.'
    }
  }
}
