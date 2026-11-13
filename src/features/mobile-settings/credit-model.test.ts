import { describe, expect, it } from 'vitest'
import { canSpend, usableMemory } from './credit-model'

const L = (available: number | null) => ({ available, reserved: 0, consumed: 0, refunded: 0, observedAt: null })
describe('크레딧', () => {
  it('예상 비용 없으면 실행 불가', () => expect(canSpend(L(100), null)).toMatchObject({ allowed: false, reason: 'no_estimate' }))
  it('잔액 미확인은 막고 다시 확인', () => expect(canSpend(L(null), 5)).toMatchObject({ allowed: false, reason: 'unknown_balance' }))
  it('부족하면 다음 행동 제시', () => expect(canSpend(L(1), 5)).toMatchObject({ allowed: false, reason: 'insufficient' }))
  it('충분하면 허용', () => expect(canSpend(L(10), 5).allowed).toBe(true))
})
describe('가게 기억', () => {
  it('승인 전 제안/업데이트 필요는 사용 금지', () => {
    const items = [
      { key: '가격', value: '3만원', state: 'suggested' as const, approvedAt: null },
      { key: '시간', value: '10-19', state: 'confirmed' as const, approvedAt: '2026-10-01' },
      { key: '정책', value: 'x', state: 'confirmed' as const, approvedAt: null },
    ]
    expect(usableMemory(items).map(i => i.key)).toEqual(['시간'])
  })
})
