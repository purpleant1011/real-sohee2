import { describe, expect, it } from 'vitest'
import { sanitizePublicMetaCopy } from './meta-content-text'

describe('sanitizePublicMetaCopy', () => {
  it.each([
    'AI를 활용해 제작한 이미지와 문안입니다.',
    '검토용 초안입니다.',
    '소희 자동 게시 시스템입니다.',
    '활성 하네스를 적용한 결과입니다.',
  ])('removes internal production copy from public text: %s', (forbidden) => {
    expect(sanitizePublicMetaCopy(`자연스러운 눈썹 상담 기준을 안내합니다. ${forbidden}`))
      .toBe('자연스러운 눈썹 상담 기준을 안내합니다.')
  })
})
