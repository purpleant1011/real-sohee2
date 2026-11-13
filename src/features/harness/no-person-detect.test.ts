import { describe, expect, it } from 'vitest'
import { isNoPersonRequest } from './no-person-detect'

describe('isNoPersonRequest', () => {
  it('오탐 방지: "인물중심피부결강조", "인물 사진" 등은 false를 반환한다', () => {
    expect(isNoPersonRequest('인물중심피부결강조')).toBe(false)
    expect(isNoPersonRequest('자연스러운 인물 사진')).toBe(false)
    expect(isNoPersonRequest('얼굴 피부톤 개선')).toBe(false)
    expect(isNoPersonRequest('')).toBe(false)
    expect(isNoPersonRequest(null)).toBe(false)
    expect(isNoPersonRequest(undefined)).toBe(false)
  })

  it('미탐 방지: 명시적 부정 지시문들을 정확히 감지한다', () => {
    expect(isNoPersonRequest('인물없이')).toBe(true)
    expect(isNoPersonRequest('사람없는')).toBe(true)
    expect(isNoPersonRequest('얼굴없이 매장 전경만')).toBe(true)
    expect(isNoPersonRequest('인물·얼굴·전후·효과비교 금지, 비인물일러스트')).toBe(true)
    expect(isNoPersonRequest('비인물 이미지')).toBe(true)
    expect(isNoPersonRequest('인물 제외')).toBe(true)
    expect(isNoPersonRequest('사람 나오지 않게')).toBe(true)
    expect(isNoPersonRequest('no people in image')).toBe(true)
    expect(isNoPersonRequest('no human face')).toBe(true)
  })
})
