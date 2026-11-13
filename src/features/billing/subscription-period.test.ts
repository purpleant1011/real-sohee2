import { describe, expect, it } from 'vitest'
import * as offers from './subscription-offers'
import { calculateSubscriptionServicePeriod as periodFor } from './subscription-period'

describe('결제일부터 1개월인 서비스 제공기간 (KST)', () => {
  it.each([
    ['2026-11-06T03:15:12.123Z', '2026-12-06T03:15:12.123Z'],
    ['2026-01-31T03:00:00Z', '2026-02-28T03:00:00.000Z'],
    ['2028-01-31T03:00:00Z', '2028-02-29T03:00:00.000Z'],
    ['2028-02-29T03:00:00Z', '2028-03-29T03:00:00.000Z'],
    ['2026-08-31T03:00:00Z', '2026-09-30T03:00:00.000Z'],
    ['2026-12-31T03:00:00Z', '2027-01-31T03:00:00.000Z'],
    // UTC 1/30은 KST로 1/31. UTC 날짜가 아니라 KST 달력의 말일을 따른다.
    ['2026-01-30T16:30:00Z', '2026-02-27T16:30:00.000Z'],
  ])('%s의 다음 달 동일 날짜·시각 또는 말일은 %s', (approved, expectedEnd) => {
    const input = new Date(approved)
    const before = input.getTime()
    const period = periodFor(input)
    expect(period.startsAt).toBe(input.toISOString())
    expect(period.endsAt).toBe(expectedEnd)
    expect(period.timeZone).toBe('Asia/Seoul')
    expect(period.endExclusive).toBe(true)
    expect(input.getTime()).toBe(before)
  })

  it('유효하지 않거나 표현 범위를 벗어난 날짜는 거부한다', () => {
    expect(() => periodFor(new Date(Number.NaN))).toThrow(RangeError)
    expect(() => periodFor(new Date(8640000000000000))).toThrow(RangeError)
  })

  it('서비스 기간 확정으로 자동갱신이나 결제 활성화를 승인하지 않는다', () => {
    expect(offers.subscriptionOfferPolicy).toHaveProperty('servicePeriod')
    expect(offers.subscriptionOfferPolicy.servicePeriod).toMatchObject({
      label: '결제일부터 1개월', startTrigger: 'server_verified_payment', months: 1,
      missingDay: 'last_day_of_month', timeZone: 'Asia/Seoul',
    })
    expect(offers.subscriptionOfferPolicy.saleStatus).toBe('blocked_pending_policy_and_contract')
    expect(offers.subscriptionOfferPolicy.creditGrant).toBe('none')
  })
})
