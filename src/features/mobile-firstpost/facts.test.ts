import { describe, expect, it } from 'vitest'
import {
  FACT_ANSWER_MAX_LENGTH,
  FACT_FIELDS,
  FACT_QUESTIONS,
  FACT_STATUS_LABEL,
  canProceed,
  confirmFact,
  discardProposal,
  factProgress,
  findFact,
  nextFactField,
  pendingProposal,
  seedConfirmedFacts,
  skipFact,
  submitFactAnswer,
  unaskedFields,
  usableFactValues,
  type FactEntry,
} from './facts'

describe('M05 — 누락된 사실만 한 번씩 묻는다', () => {
  it('5개 항목 모두 미확인이면 정본 순서대로 묻는다', () => {
    expect(unaskedFields([])).toEqual(FACT_FIELDS)
    expect(nextFactField([])).toBe('price')
  })

  it('확정·제안·건너뜀은 모두 "이미 물은" 항목이라 다시 묻지 않는다', () => {
    const state = seedConfirmedFacts({ price: '30,000원' })
    expect(unaskedFields(state)).toEqual(['menu', 'hours', 'eventPeriod', 'contact'])
    expect(nextFactField(state)).toBe('menu')
  })

  it('모든 항목이 정리되면 다음 질문이 없다', () => {
    let state: readonly FactEntry[] = []
    for (const field of FACT_FIELDS) {
      const result = skipFact(state, field)
      if (!result.ok) throw new Error('건너뛰기가 성공해야 한다')
      state = result.state
    }
    expect(nextFactField(state)).toBeNull()
  })

  it('업종 중립 문구가 항목별로 하나씩 있다', () => {
    for (const field of FACT_FIELDS) expect(FACT_QUESTIONS[field].length).toBeGreaterThan(0)
  })
})

describe('seedConfirmedFacts — 서버 기억은 확정으로 시작, 빈 값은 기억이 아니다', () => {
  it('값이 있는 항목만 CONFIRMED 로 만든다', () => {
    expect(seedConfirmedFacts({ price: '30,000원', menu: '  ' })).toEqual([
      { field: 'price', status: 'CONFIRMED', value: '30,000원' },
    ])
  })

  it('앞뒤 공백은 제거하고, 확정된 값은 홍보 문구에 쓸 수 있다', () => {
    const state = seedConfirmedFacts({ hours: ' 매일 10:00-20:00 ' })
    expect(usableFactValues(state)).toEqual({ hours: '매일 10:00-20:00' })
  })
})

describe('submitFactAnswer — 답변은 곧바로 정본이 아니라 수정 제안', () => {
  it('답변은 PROPOSED 로 저장되고, 확인 전에는 홍보 문구에 쓰지 않는다', () => {
    const result = submitFactAnswer([], 'price', '이벤트가 15,000원')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(findFact(result.state, 'price')).toEqual({ field: 'price', status: 'PROPOSED', value: '이벤트가 15,000원' })
    expect(usableFactValues(result.state)).toEqual({})
    expect(pendingProposal(result.state)?.field).toBe('price')
  })

  it('제안을 확인해야만 CONFIRMED 가 되고 홍보 문구에 쓰인다', () => {
    const submitted = submitFactAnswer([], 'contact', '전화 또는 DM')
    if (!submitted.ok) throw new Error('제안이 만들어져야 한다')
    const confirmed = confirmFact(submitted.state, 'contact')
    if (!confirmed.ok) throw new Error('확인이 성공해야 한다')
    expect(findFact(confirmed.state, 'contact')?.status).toBe('CONFIRMED')
    expect(usableFactValues(confirmed.state)).toEqual({ contact: '전화 또는 DM' })
  })

  it('빈 답변과 길이 초과는 저장하지 않고 이유를 돌려준다', () => {
    expect(submitFactAnswer([], 'price', '   ')).toEqual({ ok: false, reason: 'EMPTY' })
    expect(submitFactAnswer([], 'price', 'ㄱ'.repeat(FACT_ANSWER_MAX_LENGTH + 1))).toEqual({
      ok: false,
      reason: 'TOO_LONG',
    })
  })

  it('경계값(최대 길이)은 저장한다', () => {
    const result = submitFactAnswer([], 'price', 'ㄱ'.repeat(FACT_ANSWER_MAX_LENGTH))
    expect(result.ok).toBe(true)
  })

  it('이미 확정된 값과 같은 답변은 다시 제안하지 않는다', () => {
    const state = seedConfirmedFacts({ hours: '매일 10:00-20:00' })
    expect(submitFactAnswer(state, 'hours', '매일 10:00-20:00')).toEqual({ ok: true, state, changed: false })
    expect(submitFactAnswer(state, 'hours', ' 주말 11:00-19:00 ')).toMatchObject({ ok: true, changed: true })
  })

  it('확정된 값도 새 답변이 오면 확인을 다시 받는다(제안으로 강등)', () => {
    const state = seedConfirmedFacts({ price: '30,000원' })
    const result = submitFactAnswer(state, 'price', '25,000원')
    if (!result.ok) throw new Error('제안이 만들어져야 한다')
    expect(findFact(result.state, 'price')).toMatchObject({ status: 'PROPOSED', value: '25,000원' })
    expect(usableFactValues(result.state)).toEqual({})
  })

  it('제안을 버리면 그 항목은 다시 물을 수 있는 상태가 된다', () => {
    const submitted = submitFactAnswer([], 'eventPeriod', '10월 31일까지')
    if (!submitted.ok) throw new Error('제안이 만들어져야 한다')
    const discarded = discardProposal(submitted.state, 'eventPeriod')
    if (!discarded.ok) throw new Error('버리기가 성공해야 한다')
    expect(findFact(discarded.state, 'eventPeriod')).toBeUndefined()
    expect(nextFactField(discarded.state)).toBe('price')
  })

  it('제안이 없는 항목의 확인·버리기는 거부된다', () => {
    expect(confirmFact([], 'price')).toEqual({ ok: false, reason: 'NO_PROPOSAL' })
    expect(discardProposal([], 'price')).toEqual({ ok: false, reason: 'NO_PROPOSAL' })
    expect(confirmFact(seedConfirmedFacts({ price: '30,000원' }), 'price')).toEqual({ ok: false, reason: 'NO_PROPOSAL' })
  })
})

describe("'해당 정보 없이 진행' — 건너뛴 항목은 다시 묻지 않는다", () => {
  it('건너뜀은 값 없이 SKIPPED 로 기록된다', () => {
    const result = skipFact([], 'eventPeriod')
    if (!result.ok) throw new Error('건너뛰기가 성공해야 한다')
    expect(findFact(result.state, 'eventPeriod')).toEqual({ field: 'eventPeriod', status: 'SKIPPED' })
    expect(usableFactValues(result.state)).toEqual({})
  })

  it('이미 확정된 기억은 건너뛰기로 지우지 않는다', () => {
    const state = seedConfirmedFacts({ contact: '전화' })
    expect(skipFact(state, 'contact')).toEqual({ ok: false, reason: 'ALREADY_CONFIRMED' })
    expect(usableFactValues(state)).toEqual({ contact: '전화' })
  })

  it('이미 건너뛴 항목은 중복 기록 없이 그대로 둔다', () => {
    const skipped = skipFact([], 'hours')
    if (!skipped.ok) throw new Error('건너뛰기가 성공해야 한다')
    expect(skipFact(skipped.state, 'hours')).toEqual({ ok: true, state: skipped.state, changed: false })
  })
})

describe('canProceed — 제안 확인 전에는 다음 단계로 가지 않는다', () => {
  it('미확인 항목이 남아 있으면 진행 불가', () => {
    expect(canProceed([])).toBe(false)
    expect(canProceed([{ field: 'price', status: 'PROPOSED', value: '30,000원' }])).toBe(false)
  })

  it('모든 항목이 확인 또는 건너뜀이고 대기 제안이 없으면 진행 가능', () => {
    let state: readonly FactEntry[] = []
    for (const field of FACT_FIELDS) {
      const result = skipFact(state, field)
      if (!result.ok) throw new Error('건너뛰기가 성공해야 한다')
      state = result.state
    }
    expect(canProceed(state)).toBe(true)
    expect(factProgress(state)).toEqual({ confirmed: 0, skipped: FACT_FIELDS.length, remaining: 0 })
  })

  it('확정만 있어도 진행 가능하다', () => {
    expect(canProceed(seedConfirmedFacts({ price: 'a', menu: 'b', hours: 'c', eventPeriod: 'd', contact: 'e' }))).toBe(true)
  })
})

describe('usableFactValues — 근거 없는 가격·할인율이 원고로 새지 않게 한다', () => {
  it('PROPOSED·SKIPPED 값은 홍보 문구에서 제외한다', () => {
    let state = seedConfirmedFacts({ price: '30,000원' })
    const proposed = submitFactAnswer(state, 'menu', '신메뉴 30% 할인')
    if (!proposed.ok) throw new Error('제안이 만들어져야 한다')
    state = proposed.state
    const skipped = skipFact(state, 'hours')
    if (!skipped.ok) throw new Error('건너뛰기가 성공해야 한다')
    expect(usableFactValues(skipped.state)).toEqual({ price: '30,000원' })
    expect(Object.keys(usableFactValues(skipped.state))).toEqual(['price'])
  })

  it('빈 상태에서는 아무 값도 만들지 않는다', () => {
    expect(usableFactValues([])).toEqual({})
  })
})

describe('화면 표기 — 영문 상태 코드는 사용자 화면에 나가지 않는다', () => {
  it('세 상태 모두 한국어 표기를 가진다', () => {
    expect(FACT_STATUS_LABEL).toEqual({
      CONFIRMED: '확인된 기억',
      PROPOSED: '소희의 제안',
      SKIPPED: '이번 홍보에는 쓰지 않음',
    })
    for (const label of Object.values(FACT_STATUS_LABEL)) expect(label).not.toMatch(/[A-Z_]{3,}/)
  })
})

describe('상태는 항상 정본 질문 순서로 정렬된다', () => {
  it('뒤 항목부터 답해도 순서가 유지된다', () => {
    const contact = submitFactAnswer([], 'contact', 'DM')
    if (!contact.ok) throw new Error('제안이 만들어져야 한다')
    const price = submitFactAnswer(contact.state, 'price', '30,000원')
    if (!price.ok) throw new Error('제안이 만들어져야 한다')
    expect(price.state.map((entry) => entry.field)).toEqual(['price', 'contact'])
  })

  it('factProgress 는 남은 항목 수를 실제 상태에서 센다', () => {
    const state = seedConfirmedFacts({ price: '30,000원', hours: '10:00-20:00' })
    expect(factProgress(state)).toEqual({ confirmed: 2, skipped: 0, remaining: 3 })
  })
})
