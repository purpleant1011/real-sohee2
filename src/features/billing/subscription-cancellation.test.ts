import { describe, expect, it } from 'vitest'
import type { SubscriptionServicePeriod } from './subscription-period'
import { planSubscriptionCancellation } from './subscription-cancellation'

describe('planSubscriptionCancellation - 기간말 해지 순수 계획 계산', () => {
  const validPeriod: SubscriptionServicePeriod = Object.freeze({
    startsAt: '2026-11-06T03:00:00.000Z',
    endsAt: '2026-12-06T03:00:00.000Z',
    timeZone: 'Asia/Seoul',
    endExclusive: true,
  })

  describe('정상 케이스 (유효한 현재 기간 안 요청)', () => {
    it('기간 내 요청 시 scheduled 상태를 반환하고 effectiveAt은 기존 endsAt을 유지한다', () => {
      const requestedAt = new Date('2026-11-15T10:00:00.000Z')
      const result = planSubscriptionCancellation(validPeriod, requestedAt)

      expect(result).toEqual({
        status: 'scheduled',
        requestedAt: '2026-11-15T10:00:00.000Z',
        effectiveAt: '2026-12-06T03:00:00.000Z',
        blockNextRenewal: true,
      })
      expect(Object.isFrozen(result)).toBe(true)
    })
  })

  describe('경계 케이스', () => {
    it('startsAt과 정확히 동일한 시각에 요청하면 scheduled 상태를 반환한다', () => {
      const requestedAt = new Date('2026-11-06T03:00:00.000Z')
      const result = planSubscriptionCancellation(validPeriod, requestedAt)

      expect(result).toEqual({
        status: 'scheduled',
        requestedAt: '2026-11-06T03:00:00.000Z',
        effectiveAt: '2026-12-06T03:00:00.000Z',
        blockNextRenewal: true,
      })
    })

    it('endsAt 직전 1ms 시점에 요청하면 scheduled 상태를 반환한다', () => {
      const requestedAt = new Date('2026-12-06T02:59:59.999Z')
      const result = planSubscriptionCancellation(validPeriod, requestedAt)

      expect(result.status).toBe('scheduled')
      expect(result.effectiveAt).toBe('2026-12-06T03:00:00.000Z')
      expect(result.blockNextRenewal).toBe(true)
    })

    it('endsAt과 정확히 동일한 시각(requestedAt >= endsAt)에 요청하면 period_already_ended를 반환한다', () => {
      const requestedAt = new Date('2026-12-06T03:00:00.000Z')
      const result = planSubscriptionCancellation(validPeriod, requestedAt)

      expect(result).toEqual({
        status: 'period_already_ended',
        requestedAt: '2026-12-06T03:00:00.000Z',
        effectiveAt: '2026-12-06T03:00:00.000Z',
        blockNextRenewal: true,
      })
    })
  })

  describe('만료 케이스 (requestedAt > endsAt)', () => {
    it('기간 종료 후 요청하면 period_already_ended를 반환하고 기간을 연장하지 않는다', () => {
      const requestedAt = new Date('2026-12-10T00:00:00.000Z')
      const result = planSubscriptionCancellation(validPeriod, requestedAt)

      expect(result).toEqual({
        status: 'period_already_ended',
        requestedAt: '2026-12-10T00:00:00.000Z',
        effectiveAt: '2026-12-06T03:00:00.000Z',
        blockNextRenewal: true,
      })
    })
  })

  describe('시작 전 요청 케이스 (requestedAt < startsAt)', () => {
    it('서비스 시작 전 시각으로 요청하면 RangeError를 던진다', () => {
      const requestedAt = new Date('2026-11-06T02:59:59.999Z')
      expect(() => planSubscriptionCancellation(validPeriod, requestedAt)).toThrow(RangeError)
    })
  })

  describe('invalid / 위조 케이스', () => {
    it('잘못된 requestedAt Date는 RangeError를 던진다', () => {
      expect(() => planSubscriptionCancellation(validPeriod, new Date('invalid'))).toThrow(RangeError)
      // @ts-expect-error type check bypass
      expect(() => planSubscriptionCancellation(validPeriod, null)).toThrow(RangeError)
      // @ts-expect-error type check bypass
      expect(() => planSubscriptionCancellation(validPeriod, '2026-11-15T00:00:00Z')).toThrow(RangeError)
    })

    it('period가 null이거나 객체가 아니면 RangeError를 던진다', () => {
      // @ts-expect-error type check bypass
      expect(() => planSubscriptionCancellation(null, new Date('2026-11-15T00:00:00Z'))).toThrow(RangeError)
      // @ts-expect-error type check bypass
      expect(() => planSubscriptionCancellation(undefined, new Date('2026-11-15T00:00:00Z'))).toThrow(RangeError)
    })

    it('timeZone이 Asia/Seoul이 아니거나 위조된 경우 RangeError를 던진다', () => {
      const forged = { ...validPeriod, timeZone: 'UTC' as const }
      // @ts-expect-error type check bypass
      expect(() => planSubscriptionCancellation(forged, new Date('2026-11-15T00:00:00Z'))).toThrow(RangeError)
    })

    it('endExclusive가 true가 아니거나 위조된 경우 RangeError를 던진다', () => {
      const forged = { ...validPeriod, endExclusive: false }
      // @ts-expect-error type check bypass
      expect(() => planSubscriptionCancellation(forged, new Date('2026-11-15T00:00:00Z'))).toThrow(RangeError)
    })

    it('startsAt 또는 endsAt이 canonical ISO 형식이 아닌 경우 RangeError를 던진다', () => {
      const nonCanonicalStartsAt = { ...validPeriod, startsAt: '2026-11-06 03:00:00' }
      expect(() => planSubscriptionCancellation(nonCanonicalStartsAt, new Date('2026-11-15T00:00:00Z'))).toThrow(RangeError)

      const nonCanonicalEndsAt = { ...validPeriod, endsAt: '2026-12-06' }
      expect(() => planSubscriptionCancellation(nonCanonicalEndsAt, new Date('2026-11-15T00:00:00Z'))).toThrow(RangeError)

      const customOffset = { ...validPeriod, startsAt: '2026-11-06T12:00:00+09:00' }
      expect(() => planSubscriptionCancellation(customOffset, new Date('2026-11-15T00:00:00Z'))).toThrow(RangeError)
    })

    it('기간 역전(startsAt >= endsAt)인 경우 RangeError를 던진다', () => {
      const reversed = {
        ...validPeriod,
        startsAt: '2026-12-06T03:00:00.000Z',
        endsAt: '2026-11-06T03:00:00.000Z',
      }
      expect(() => planSubscriptionCancellation(reversed, new Date('2026-11-15T00:00:00Z'))).toThrow(RangeError)

      const zeroLength = {
        ...validPeriod,
        startsAt: '2026-11-06T03:00:00.000Z',
        endsAt: '2026-11-06T03:00:00.000Z',
      }
      expect(() => planSubscriptionCancellation(zeroLength, new Date('2026-11-06T03:00:00.000Z'))).toThrow(RangeError)
    })
  })

  describe('입력 불변성 및 동일 입력 동일 결과', () => {
    it('입력된 Date와 period 객체를 변경하지 않는다', () => {
      const requestedAt = new Date('2026-11-15T10:00:00.000Z')
      const beforeTime = requestedAt.getTime()
      const periodCopy = { ...validPeriod }

      planSubscriptionCancellation(validPeriod, requestedAt)

      expect(requestedAt.getTime()).toBe(beforeTime)
      expect(validPeriod).toEqual(periodCopy)
    })

    it('동일한 입력을 전달하면 완전히 동일한 결과를 반환한다', () => {
      const requestedAt = new Date('2026-11-15T10:00:00.000Z')
      const res1 = planSubscriptionCancellation(validPeriod, requestedAt)
      const res2 = planSubscriptionCancellation(validPeriod, requestedAt)

      expect(res1).toEqual(res2)
    })
  })
})
