import { describe, expect, it } from 'vitest'
import { composeNeutralImagePrompt } from './neutral-image-prompt'

describe('composeNeutralImagePrompt', () => {
  it('composes an industry-neutral image prompt without brand-specific wording', () => {
    const prompt = composeNeutralImagePrompt({
      channel: 'naver_blog',
      userPrompt: '전문적인 세무 상담 서비스 소개',
      altText: '세무사가 고객과 서류를 보며 차분하게 상담하는 모습',
      sectionText: '개인사업자 종합소득세 신고 시 주의할 점을 짚어드립니다.',
      industry: '세무/회계',
      tone: '신뢰감 있고 전문적인 어조',
    })

    expect(prompt).toContain('1024x1536')
    expect(prompt).toContain('3:4')
    expect(prompt).toContain('photorealistic')
    expect(prompt).toContain('Business industry: 세무/회계')
    expect(prompt).toContain('Atmosphere and tone: 신뢰감 있고 전문적인 어조')
    expect(prompt).toContain('Subject and scene: 세무사가 고객과 서류를 보며 차분하게 상담하는 모습')
    expect(prompt).toContain('Article context: 개인사업자 종합소득세 신고 시 주의할 점을 짚어드립니다.')
    expect(prompt).toContain('no visible text')

    // Must not contain Byreum or eyebrow-tattoo brand specifics
    expect(prompt).not.toContain('바이름')
    expect(prompt).not.toContain('Byreum')
    expect(prompt).not.toContain('눈썹')
    expect(prompt).not.toContain('medical mask')
  })

  it('extracts altText and section context from structured userPrompt when not passed directly', () => {
    const structuredUserPrompt = [
      '네이버 블로그 글 제목: 세무 관리 팁',
      '글 전체 목표: 세무 상담 안내',
      '해당 문단 맥락: 부가세 신고 기한과 공제 항목 안내 문단',
      '이미지 슬롯 2의 정확한 장면: 계산기와 서류가 정돈된 책상 위 작업 모습',
    ].join('\n')

    const prompt = composeNeutralImagePrompt({
      channel: 'naver_blog',
      userPrompt: structuredUserPrompt,
      industry: '세무',
      tone: '차분한',
    })

    expect(prompt).toContain('계산기와 서류가 정돈된 책상 위 작업 모습')
    expect(prompt).toContain('부가세 신고 기한과 공제 항목 안내 문단')
  })
})
