// @vitest-environment node
import { describe, expect, it } from 'vitest'
import type { CreditBalance } from '@/features/credits/types'
import { buildCreditSnapshot } from './credit-snapshot'

const WS = '11111111-1111-4111-8111-111111111111'
const CHECKED_AT = '2026-10-24T05:00:00.000Z'

function balance(overrides: Partial<CreditBalance> = {}): CreditBalance {
  return {
    workspaceId: WS,
    periodStart: '2026-10-21T00:00:00.000Z',
    periodEnd: '2026-10-28T00:00:00.000Z',
    granted: 100,
    adjustments: 0,
    released: 7,
    consumed: 40,
    reserved: 3,
    available: 50,
    weeklyLimit: 100,
    policyVersion: 'v1',
    ...overrides,
  }
}

describe('요금·크레딧(M25) 스냅샷 조립', () => {
  it('두 원천이 모두 확인되면 ready 이고 원장별 값을 그대로 옮긴다', () => {
    const snap = buildCreditSnapshot({ balance: balance(), authoritativeAvailable: 47, checkedAt: CHECKED_AT })

    expect(snap.loadState).toBe('ready')
    expect(snap.credit).toEqual({
      available: 47,
      reserved: 3,
      consumed: 40,
      refunded: 7,
      observedAt: CHECKED_AT,
    })
    expect(snap.checkedAt).toBe(CHECKED_AT)
  })

  it('두 원천이 모두 실패하면 0 이 아니라 error 로 닫고 확인 시각도 비운다', () => {
    const snap = buildCreditSnapshot({ balance: null, authoritativeAvailable: null, checkedAt: CHECKED_AT })

    expect(snap.loadState).toBe('error')
    expect(snap.credit).toEqual({ available: null, reserved: null, consumed: null, refunded: null, observedAt: null })
    expect(snap.checkedAt).toBeNull()
  })

  it('실행 가능 판정에 쓰는 값은 authoritative 원천만 쓴다 — 잔액 원장으로 대체하지 않는다', () => {
    const snap = buildCreditSnapshot({ balance: balance({ available: 50 }), authoritativeAvailable: null, checkedAt: CHECKED_AT })

    expect(snap.loadState).toBe('ready')
    expect(snap.credit.available).toBeNull()
    // 나머지 원장 값은 balance 에서 읽었으므로 그대로 보여준다.
    expect(snap.credit.reserved).toBe(3)
    expect(snap.credit.consumed).toBe(40)
  })

  it('authoritative 만 확인되면 나머지 원장은 0 이 아니라 미확인(null)으로 남긴다', () => {
    const snap = buildCreditSnapshot({ balance: null, authoritativeAvailable: 0, checkedAt: CHECKED_AT })

    expect(snap.loadState).toBe('ready')
    expect(snap.credit.available).toBe(0)
    expect(snap.credit.reserved).toBeNull()
    expect(snap.credit.consumed).toBeNull()
    expect(snap.credit.refunded).toBeNull()
  })

  it('예약금 원장과 예상 비용은 읽지 않았으므로 지어내지 않고 null 로 둔다', () => {
    const snap = buildCreditSnapshot({ balance: balance(), authoritativeAvailable: 47, checkedAt: CHECKED_AT })

    expect(snap.customerDeposit).toBeNull()
    expect(snap.estimate).toBeNull()
  })

  it('반환값은 기존 잔액 원장의 released 를 쓰고 원장 종류를 다시 해석하지 않는다', () => {
    const snap = buildCreditSnapshot({
      balance: balance({ released: 0, consumed: 0 }),
      authoritativeAvailable: 10,
      checkedAt: CHECKED_AT,
    })

    expect(snap.credit.refunded).toBe(0)
    expect(snap.credit.consumed).toBe(0)
  })
})
