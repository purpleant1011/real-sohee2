import { describe, expect, it } from 'vitest'
import { sanitizeClaimsText, selfHealBlogDraft } from './claim-sanitizer'

describe('claim-sanitizer (사실관계 미확인 주장 자동 자체 치유 엔진)', () => {
  it('replaces prices, discounts, medical efficacy, awards with safe alternatives', () => {
    const rawText = '이번 주말에만 50% 할인 이벤트 진행! 10000원 특가로 완치와 최고의 효능을 보장합니다.'
    const cleaned = sanitizeClaimsText(rawText)

    expect(cleaned).not.toContain('50%')
    expect(cleaned).not.toContain('할인')
    expect(cleaned).not.toContain('이벤트')
    expect(cleaned).not.toContain('10000원')
    expect(cleaned).not.toContain('특가')
    expect(cleaned).not.toContain('완치')
    expect(cleaned).not.toContain('최고')
    expect(cleaned).toContain('특별한 정성')
    expect(cleaned).toContain('맞춤 비용')
    expect(cleaned).toContain('세심한 케어')
  })

  it('selfHealBlogDraft cleans entire draft structure seamlessly', () => {
    const draft = {
      title: '최고의 50% 할인 뷰티샵',
      introduction: '선착순 10명만 30000원에 제공합니다.',
      sections: [
        { heading: '부작용없는 완치 케어', body: '영업시간은 24시간 연중무휴입니다.' },
      ],
      cta: '지금 바로 무료 상담 이벤트 신청하세요.',
      editorBlueprint: [
        { kind: 'heading', text: '최고의 50% 할인' },
        { kind: 'paragraph', text: '부작용없는 완치 케어' },
      ],
    }

    const healed = selfHealBlogDraft(draft)

    expect(healed.title).not.toContain('50%')
    expect(healed.title).not.toContain('할인')
    expect(healed.title).not.toContain('최고')
    expect(healed.introduction).not.toContain('30000원')
    expect(healed.sections[0].heading).not.toContain('완치')
    expect(healed.sections[0].body).not.toContain('영업시간')
    expect(healed.cta).not.toContain('무료')
    expect(healed.editorBlueprint[0].text).not.toContain('할인')
  })
})
