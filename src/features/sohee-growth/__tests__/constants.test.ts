import { describe, expect, it } from 'vitest'
import { CATEGORY_WEIGHTS, DEFAULT_PROFILE_TEXTS, isMeaningfulText } from '../constants'

describe('isMeaningfulText', () => {
  it('실제 입력은 유효하다', () => {
    expect(isMeaningfulText('모모 카페')).toBe(true)
    expect(isMeaningfulText('  청라동  ')).toBe(true)
  })

  it('비었거나 한 글자거나 문자열이 아니면 무효다', () => {
    expect(isMeaningfulText('')).toBe(false)
    expect(isMeaningfulText('  ')).toBe(false)
    expect(isMeaningfulText('가')).toBe(false)
    expect(isMeaningfulText(null)).toBe(false)
    expect(isMeaningfulText(undefined)).toBe(false)
    expect(isMeaningfulText(123 as unknown)).toBe(false)
  })

  it('미리 채워진 기본 문구는 가르친 것으로 세지 않는다', () => {
    for (const text of DEFAULT_PROFILE_TEXTS) expect(isMeaningfulText(text)).toBe(false)
    expect(isMeaningfulText('신규 매장')).toBe(false)
  })
})

describe('CATEGORY_WEIGHTS', () => {
  it('가중치 합이 100이다', () => {
    expect(Object.values(CATEGORY_WEIGHTS).reduce((a, b) => a + b, 0)).toBe(100)
  })
})
