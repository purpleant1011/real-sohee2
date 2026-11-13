// ANI-1781 (partial): 랜딩 업종 쿼리 → 온보딩 첫 단계 프리필. 읽기 전용 계약.
import { describe, expect, it } from 'vitest'
import { resolveIndustryPrefill } from '../onboarding-prefill'
import { LANDING_EXAMPLES } from '@/features/mobile-landing/landing-model'

describe('resolveIndustryPrefill', () => {
  it('랜딩 예시 키를 화면 업종 문구로 바꾼다', () => {
    expect(resolveIndustryPrefill('beauty')).toBe('뷰티')
    expect(resolveIndustryPrefill('cafe')).toBe('카페·식당')
  })

  it('모든 예시 키가 화면 문구로 해석된다', () => {
    for (const example of LANDING_EXAMPLES) {
      expect(resolveIndustryPrefill(example.key)).toBe(example.industry)
    }
  })

  it('알 수 없는 값은 프리필하지 않는다(URL 임의 문자열을 폼 값으로 쓰지 않는다)', () => {
    expect(resolveIndustryPrefill('__import__')).toBeNull()
    expect(resolveIndustryPrefill('뷰티')).toBeNull()
  })

  it('값이 없으면 프리필하지 않는다', () => {
    expect(resolveIndustryPrefill(null)).toBeNull()
    expect(resolveIndustryPrefill(undefined)).toBeNull()
    expect(resolveIndustryPrefill('   ')).toBeNull()
  })
})
