import { describe, expect, it } from 'vitest'
import { computeCategoryScores, computeCompleteness } from '../categories'
import type { GrowthEvidence } from '../types'
import { EMPTY, FULL, PARTIAL } from './fixtures'

const byKey = (scores: ReturnType<typeof computeCategoryScores>) =>
  Object.fromEntries(scores.map((s) => [s.key, s.percent]))

describe('computeCategoryScores', () => {
  it('아무것도 가르치지 않았으면 모두 0점', () => {
    expect(byKey(computeCategoryScores(EMPTY))).toEqual({
      shop: 0, customer: 0, style: 0, caution: 0, materials: 0, manual: 0,
    })
  })

  it('모두 가르쳤으면 모두 100점', () => {
    expect(byKey(computeCategoryScores(FULL))).toEqual({
      shop: 100, customer: 100, style: 100, caution: 100, materials: 100, manual: 100,
    })
  })

  it('부분적으로 가르친 점수를 규칙대로 계산한다', () => {
    expect(byKey(computeCategoryScores(PARTIAL))).toEqual({
      shop: 80, // 15*3 + 15(키워드) + MENU·PRICE 20
      customer: 45, // 위치 30 + FAQ 1개 15
      style: 60, // 말투 30 + 글 쓰는 기준 30
      caution: 40, // 금지어 2개
      materials: 0,
      manual: 0,
    })
  })

  it('FAQ 는 4개까지만 점수가 오르고, 자료는 3개까지만 오른다', () => {
    const many: GrowthEvidence = { ...EMPTY, factCounts: { FAQ: 9 }, sourceCount: 9 }
    const scores = byKey(computeCategoryScores(many))
    expect(scores.customer).toBe(60)
    expect(scores.materials).toBe(100)
    expect(scores.manual).toBe(40)
  })

  it('항목 이름과 가중치를 함께 돌려준다', () => {
    const shop = computeCategoryScores(EMPTY).find((s) => s.key === 'shop')
    expect(shop).toMatchObject({ label: '가게·상품·가격', weight: 25 })
  })
})

describe('computeCompleteness', () => {
  it('0 과 100 의 경계', () => {
    expect(computeCompleteness(computeCategoryScores(EMPTY))).toBe(0)
    expect(computeCompleteness(computeCategoryScores(FULL))).toBe(100)
  })

  it('가중 평균을 반올림한다 (41.75 → 42)', () => {
    expect(computeCompleteness(computeCategoryScores(PARTIAL))).toBe(42)
  })
})
