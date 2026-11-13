import { describe, expect, it } from 'vitest'
import { subscriptionOffers, subscriptionOfferPolicy } from './subscription-offers'
import { PLAN_COMPARISON } from '@/features/marketing/v085-content'

describe('신규 기능 구독 상품의 단일 안내 정본', () => {
  it('기존 가격 기준은 유지하되 지급량과 실제 판매 승인을 갖지 않는다', () => {
    expect(subscriptionOffers.map((offer) => offer.monthlyTotalPriceKrw)).toEqual([150000, 300000, 500000])
    expect(subscriptionOffers.every((offer) => offer.vatIncluded === true)).toBe(true)
    expect(subscriptionOfferPolicy.purchaseNotice).toContain('부가가치세를 포함한 최종 결제금액')
    expect(subscriptionOfferPolicy.creditGrant).toBe('none')
    expect(subscriptionOfferPolicy.saleStatus).toBe('blocked_pending_policy_and_contract')
    for (const offer of subscriptionOffers) {
      expect(offer).not.toHaveProperty('includedCredits')
      expect(offer).not.toHaveProperty('includedEnergy')
    }
  })

  it('해지는 현재 기간을 유지하고 다음 갱신 결제를 중단하며 환불과 분리한다', () => {
    expect(subscriptionOfferPolicy).toHaveProperty('cancellation')
    expect(subscriptionOfferPolicy.cancellation).toMatchObject({
      label: '다음 갱신부터 해지', effectiveAt: 'current_period_end',
      retainCurrentPeriod: true, stopNextRenewalCharge: true, refundHandling: 'separate',
    })
    expect(subscriptionOfferPolicy.cancellation.notice).toContain('현재 결제된 이용기간은 유지')
    expect(subscriptionOfferPolicy.cancellation.notice).toContain('다음 갱신 결제 중단')
    expect(subscriptionOfferPolicy.cancellation.refundNotice).toContain('법령에 따른 권리를 제한하지 않습니다')
    expect(subscriptionOfferPolicy.saleStatus).toBe('blocked_pending_policy_and_contract')
    expect(subscriptionOfferPolicy.purchaseNotice).not.toContain('해지·환불 조건을 확정')
  })

  it('홈의 유료 상품명도 요금 페이지와 같고 미확정 기능을 약속하지 않는다', () => {
    const paid = PLAN_COMPARISON.filter(({ id }) => id !== 'diagnosis')
    expect(paid.map(({ name }) => name)).toEqual(subscriptionOffers.map(({ name }) => name))
    for (const plan of paid) {
      expect(plan.content).toBe('크레딧 지급 없음')
      expect(plan.channels).toBe('이용 범위 확정 후 안내')
      expect(plan.customer).toBe('기능 범위 확정 후 안내')
      expect(plan.report).toBe('세부 조건 준비 중')
      expect(plan.price).toContain('VAT 포함')
    }
  })
})
