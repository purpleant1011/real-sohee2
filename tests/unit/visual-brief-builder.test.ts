import { describe, it, expect } from 'vitest'
import {
  buildVisualBrief,
  calculatePromptDigest,
} from '@/features/creative/visual-brief-builder'
import { VisualBriefValidationError } from '@/features/creative/visual-brief-types'

describe('ANI-1074: Business-aware Visual Brief Builder', () => {
  const bakeryInput = {
    workspaceId: '00000000-0000-4000-8000-0000000000a2',
    contentVersionId: 'v10-cv-test-01',
    businessContext: {
      name: '소희네 베이커리',
      industry: 'bakery' as const,
      keywords: ['수제 타르트', '당일 생산', '구움과자'],
      targetAudience: '디저트를 사랑하는 2030 직장인 및 주민',
    },
    productContext: {
      name: '단호박 타르트',
      description: '국내산 단호박 필링과 바삭한 파이지의 조화',
      ingredientsOrMaterials: ['국내산 단호박', '프랑스 고메버터', '피칸'],
      sellingPoints: ['은은한 단맛', '겉바속촉 식감'],
    },
    channel: 'instagram' as const,
    caption: '가을을 담은 소희네 시그니처 단호박 타르트가 구워졌습니다. 고소한 버터 풍미를 느껴보세요!',
  }

  it('builds a valid structured visual brief with SHA-256 prompt digest', () => {
    const brief = buildVisualBrief(bakeryInput)

    expect(brief.briefVersion).toBe('v10.0')
    expect(brief.workspaceId).toBe(bakeryInput.workspaceId)
    expect(brief.contentVersionId).toBe(bakeryInput.contentVersionId)
    expect(brief.channelSpec.channel).toBe('instagram')
    expect(brief.channelSpec.aspectRatio).toBe('1:1')
    expect(brief.negativeConstraints.textRendering).toBe('NO_TEXT_IN_IMAGE')
    expect(brief.promptText).toContain('단호박 타르트')
    expect(brief.promptDigest).toMatch(/^[a-f0-9]{64}$/)
    expect(brief.promptDigest).toBe(calculatePromptDigest(brief.promptText))
  })

  it('throws CROSS_DOMAIN_CONTAMINATION_DETECTED when beauty tokens enter bakery context', () => {
    const pollutedInput = {
      ...bakeryInput,
      caption: '단호박 타르트 드시러 오세요! 속눈썹 펌 예약도 가능합니다.',
    }

    expect(() => buildVisualBrief(pollutedInput)).toThrowError(VisualBriefValidationError)
    expect(() => buildVisualBrief(pollutedInput)).toThrowError(
      /Cross-domain pollution detected/
    )

    try {
      buildVisualBrief(pollutedInput)
    } catch (err: any) {
      expect(err.code).toBe('CROSS_DOMAIN_CONTAMINATION_DETECTED')
    }
  })

  it('throws CAPTION_HERO_MISMATCH when caption dessert does not match product dessert', () => {
    const mismatchedInput = {
      ...bakeryInput,
      caption: '오늘의 스콘 라인업 안내! 바삭한 플레인 스콘이 준비되어 있습니다.',
      productContext: {
        ...bakeryInput.productContext,
        name: '단호박 타르트',
      },
    }

    expect(() => buildVisualBrief(mismatchedInput)).toThrowError(VisualBriefValidationError)
    try {
      buildVisualBrief(mismatchedInput)
    } catch (err: any) {
      expect(err.code).toBe('CAPTION_HERO_MISMATCH')
    }
  })

  it('correctly maps channel aspect ratios (Instagram 1:1, Threads 1:1, Naver Blog 16:9)', () => {
    const instaBrief = buildVisualBrief({ ...bakeryInput, channel: 'instagram' })
    const threadsBrief = buildVisualBrief({ ...bakeryInput, channel: 'threads' })
    const naverBrief = buildVisualBrief({ ...bakeryInput, channel: 'naver_blog' })

    expect(instaBrief.channelSpec.aspectRatio).toBe('1:1')
    expect(threadsBrief.channelSpec.aspectRatio).toBe('1:1')
    expect(naverBrief.channelSpec.aspectRatio).toBe('16:9')
  })

  it('strictly omits fabricated facts and food bias from generated promptText when industry and products are unknown', () => {
    const neutralInput = {
      workspaceId: '00000000-0000-4000-8000-0000000000a2',
      contentVersionId: 'v10-cv-neutral-01',
      businessContext: {
        name: '바이름 뷰티 살롱 본점',
      },
      productContext: {},
      channel: 'instagram' as const,
      caption: '새로운 하루를 기분 좋게 시작하는 공간',
    }

    const brief = buildVisualBrief(neutralInput as any)

    // Multi-word business name exact preservation
    expect(brief.promptText).toContain('바이름 뷰티 살롱 본점')

    // Strictly NO fabricated business facts
    expect(brief.promptText).not.toContain('대표 시그니처')
    expect(brief.promptText).not.toContain('고객')
    expect(brief.promptText).not.toContain('매장')
    expect(brief.promptText).not.toContain('general')
    expect(brief.promptText).not.toContain('시각적 스타일 재구성')

    // Strictly NO food-coded words when industry is unconfirmed
    const lowerPrompt = brief.promptText.toLowerCase()
    expect(lowerPrompt).not.toContain('appetizing')
    expect(lowerPrompt).not.toContain('gourmet')
    expect(lowerPrompt).not.toContain('culinary')
    expect(lowerPrompt).not.toContain('bakery')
  })

  it('strictly omits unconfirmed setting, lighting, palette, and style semantics when industry is unknown', () => {
    const unknownInput = {
      workspaceId: '00000000-0000-4000-8000-0000000000a2',
      contentVersionId: 'v10-cv-unknown-01',
      businessContext: {
        name: '서울 디자인 스튜디오 연구소',
      },
      productContext: undefined,
      channel: 'instagram' as const,
      caption: '새로운 프로젝트를 준비 중입니다',
    }

    const brief = buildVisualBrief(unknownInput as any)

    // Preserve multi-word business name
    expect(brief.promptText).toContain('서울 디자인 스튜디오 연구소')

    // Must NOT contain unconfirmed style / setting / palette / commercial daylight semantics
    const lowerPrompt = brief.promptText.toLowerCase()
    expect(lowerPrompt).not.toContain('minimalist modern commercial setting')
    expect(lowerPrompt).not.toContain('lifestyle magazine commercial editorial')
    expect(lowerPrompt).not.toContain('commercial hero angle')
    expect(lowerPrompt).not.toContain('natural daylight')
    expect(brief.promptText).not.toContain('우리 매장')
    expect(brief.promptText).not.toContain('매장')
    expect(brief.promptText).not.toContain('general')

    // Brief structure itself must omit unconfirmed environment/lighting/palette
    expect(brief.creativeDirection.environment).toBeUndefined()
    expect(brief.creativeDirection.lighting).toBeUndefined()
    expect(brief.creativeDirection.colorPalette).toEqual([])
  })

  it('incorporates approved learned visual style and preserves learningProvenance without claiming proprietary prompt recovery', () => {
    const inputWithLearned = {
      ...bakeryInput,
      learnedVisualContext: {
        imageStyle: '우드 톤 테이블 위 자연광과 미니멀한 매트 질감',
        dependencies: [
          {
            workspaceId: bakeryInput.workspaceId,
            sourceId: 'src-1234',
            revision: 2,
          },
        ],
        epoch: 3,
      },
    }

    const brief = buildVisualBrief(inputWithLearned)
    expect(brief.promptText).toContain('Learned visual style guidance from approved channel observation')
    expect(brief.promptText).toContain('우드 톤 테이블 위 자연광과 미니멀한 매트 질감')
    expect(brief.promptText).not.toContain('harness restoration')
    expect(brief.learningProvenance?.epoch).toBe(3)
    expect(brief.learningProvenance?.dependencies).toHaveLength(1)
  })

  it('prioritizes explicit user customDirection over defaults and learned style', () => {
    const inputWithUserStyle = {
      ...bakeryInput,
      customDirection: {
        heroSubject: '사장님이 지정한 특별 촬영 구도',
        stylePreset: 'lifestyle_candid' as const,
        composition: '정면 클로즈업 샷',
      },
      learnedVisualContext: {
        imageStyle: '학습된 다른 스타일',
      },
    }

    const brief = buildVisualBrief(inputWithUserStyle)
    expect(brief.creativeDirection.heroSubject).toBe('사장님이 지정한 특별 촬영 구도')
    expect(brief.creativeDirection.stylePreset).toBe('lifestyle_candid')
    expect(brief.creativeDirection.composition).toBe('정면 클로즈업 샷')
  })
})
