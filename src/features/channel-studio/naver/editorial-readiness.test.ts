import { describe, expect, it } from 'vitest'
import {
  evaluateEditorialReadiness,
  READINESS_RUBRIC_VERSION,
  type ReadinessInput,
} from './editorial-readiness'

describe('editorial-readiness (SOHEE Editorial Readiness)', () => {
  const baseInput: ReadinessInput = {
    title: '연남동 핸드드립 커피 가이드: 원두 선별부터 추출까지',
    body: `## 원두의 풍미를 살리는 기본 추출법
신선한 에티오피아 원두는 화사한 산미와 꽃향기가 특징입니다. 분쇄도를 중간 정도로 맞추고 물 온도는 92도로 추출해보세요.

## 물 온도와 추출 시간
첫 번째 푸어링에서는 원두가 골고루 젖도록 천천히 물을 부어줍니다. 약 2분 30초 내외로 추출을 마무리하면 깔끔한 단맛이 납니다.`,
    tags: ['커피', '핸드드립', '연남동카페'],
    approvedFacts: ['에티오피아 원두 취급', '추출 시간 약 2분 30초 권장'],
    readerQuestions: ['핸드드립 적정 물 온도는 몇 도인가요?', '추출 시간은 얼마나 걸리나요?'],
    priorPostTitles: ['성수동 핸드드립 카페 투어', '초보자를 위한 홈카페 도구 추천'],
    images: [
      {
        sourceKind: 'OWNER_UPLOAD',
        rightsStatus: 'CONFIRMED',
        altText: '핸드드립 추출 과정 사진',
      },
    ],
    hasCta: true,
  }

  it('버전 상수와 면책 문구(disclaimer)가 정확히 명시된다', () => {
    expect(READINESS_RUBRIC_VERSION).toBe('1.2.0')

    const result = evaluateEditorialReadiness(baseInput)
    expect(result.rubricVersion).toBe('1.2.0')
    expect(result.disclaimer).toBe(
      '소희가 발행 전 원고를 점검한 내부 진단이며 네이버 검색 순위·노출과는 관련 없어요.',
    )
  })

  it('결측 입력(approvedFacts, readerQuestions, images undefined)은 0점이 아닌 rawScore=null 및 NOT_ASSESSED 처리된다', () => {
    const inputWithMissingDimensions: ReadinessInput = {
      title: '간단한 일상 기록',
      body: '오늘 날씨가 참 좋습니다.\n\n산책하기 딱 좋은 계절이네요.',
      tags: ['일상'],
      // approvedFacts undefined
      // readerQuestions undefined
      // images undefined
    }

    const result = evaluateEditorialReadiness(inputWithMissingDimensions)

    const factual = result.dimensions.find((d) => d.key === 'FACTUAL_SUPPORT')
    const readerQ = result.dimensions.find((d) => d.key === 'READER_QUESTION_COVERAGE')
    const imagesCta = result.dimensions.find((d) => d.key === 'IMAGE_RIGHTS_AND_CTA')

    expect(factual).toBeDefined()
    expect(factual?.status).toBe('NOT_ASSESSED')
    expect(factual?.rawScore).toBeNull()

    expect(readerQ).toBeDefined()
    expect(readerQ?.status).toBe('NOT_ASSESSED')
    expect(readerQ?.rawScore).toBeNull()

    expect(imagesCta).toBeDefined()
    expect(imagesCta?.status).toBe('NOT_ASSESSED')
    expect(imagesCta?.rawScore).toBeNull()

    // 미평가 축이 있으므로 totalIfComplete는 null, eligibility는 INCOMPLETE
    expect(result.totalIfComplete).toBeNull()
    expect(result.eligibility).toBe('INCOMPLETE')
  })

  it('5축 모두 평가되고 hardStop이 없으면 totalIfComplete가 0~100 사이의 정수로 산출된다', () => {
    const result = evaluateEditorialReadiness(baseInput)

    expect(result.dimensions).toHaveLength(5)
    for (const dim of result.dimensions) {
      expect(dim.status).toBe('ASSESSED')
      expect(typeof dim.rawScore).toBe('number')
      expect(dim.rawScore).toBeGreaterThanOrEqual(0)
      expect(dim.rawScore).toBeLessThanOrEqual(dim.maxScore)
    }

    expect(result.hardStops).toEqual([])
    expect(result.totalIfComplete).not.toBeNull()
    expect(typeof result.totalIfComplete).toBe('number')
    expect(Number.isInteger(result.totalIfComplete)).toBe(true)
    expect(result.totalIfComplete).toBeGreaterThanOrEqual(0)
    expect(result.totalIfComplete).toBeLessThanOrEqual(100)
    expect(result.eligibility).toBe('READY')
  })

  describe('하드스톱(hardStops) 감지 검증 (3종 이상)', () => {
    it('1) 승인되지 않은 가격/할인 표기 포함 시 NOT_READY 하드스톱이 발생한다', () => {
      const input: ReadinessInput = {
        ...baseInput,
        body: '기본 핸드드립 코스는 15,000원에 제공하며, 첫 방문 시 20% 할인 혜택이 있습니다.',
        approvedFacts: ['핸드드립 전문점 운영'], // 가격/할인 사실 미승인
      }

      const result = evaluateEditorialReadiness(input)
      expect(result.hardStops.length).toBeGreaterThan(0)
      const priceStop = result.hardStops.find(
        (h) => h.code === 'UNAPPROVED_PRICE_CLAIM' || h.code.includes('PRICE'),
      )
      expect(priceStop).toBeDefined()
      expect(result.eligibility).toBe('NOT_READY')
      expect(result.totalIfComplete).toBeNull()
    })

    it('2) 의학적 효능 단정 표현 포함 시 NOT_READY 하드스톱이 발생한다', () => {
      const input: ReadinessInput = {
        ...baseInput,
        body: '이 차를 꾸준히 마시면 만성 위장 질환이 완치되며 100% 효과를 보실 수 있습니다.',
      }

      const result = evaluateEditorialReadiness(input)
      expect(result.hardStops.length).toBeGreaterThan(0)
      const medicalStop = result.hardStops.find(
        (h) => h.code === 'MEDICAL_CLAIM' || h.code.includes('MEDICAL'),
      )
      expect(medicalStop).toBeDefined()
      expect(result.eligibility).toBe('NOT_READY')
      expect(result.totalIfComplete).toBeNull()
    })

    it('3) 승인되지 않은 1인칭 체험 단정 표현 포함 시 NOT_READY 하드스톱이 발생한다', () => {
      const input: ReadinessInput = {
        ...baseInput,
        body: '제가 직접 받아보니 피부가 몰라보게 매끄러워졌고 바로 체감되었습니다.',
        approvedFacts: ['피부 관리 샵 운영'], // 1인칭 체험 승인 사실 없음
      }

      const result = evaluateEditorialReadiness(input)
      expect(result.hardStops.length).toBeGreaterThan(0)
      const experienceStop = result.hardStops.find(
        (h) => h.code === 'UNVERIFIED_FIRST_PERSON_EXPERIENCE' || h.code.includes('EXPERIENCE'),
      )
      expect(experienceStop).toBeDefined()
      expect(result.eligibility).toBe('NOT_READY')
      expect(result.totalIfComplete).toBeNull()
    })

    it('4) 권리 미확인(UNCONFIRMED) 소유자 이미지 포함 시 REVIEW_REQUIRED 하드스톱이 발생한다', () => {
      const input: ReadinessInput = {
        ...baseInput,
        images: [
          {
            sourceKind: 'OWNER_UPLOAD',
            rightsStatus: 'UNCONFIRMED',
            altText: '매장 사진',
          },
        ],
      }

      const result = evaluateEditorialReadiness(input)
      const imageStop = result.hardStops.find(
        (h) => h.code === 'IMAGE_RIGHTS_UNCONFIRMED' || h.code.includes('IMAGE'),
      )
      expect(imageStop).toBeDefined()
      expect(result.eligibility).toBe('REVIEW_REQUIRED')
      expect(result.totalIfComplete).toBeNull()
    })

    it('5) AI 이미지 라벨(aiLabeled) 누락 시 REVIEW_REQUIRED 하드스톱이 발생한다', () => {
      const input: ReadinessInput = {
        ...baseInput,
        images: [
          {
            sourceKind: 'AI_ILLUSTRATION',
            rightsStatus: 'CONFIRMED',
            aiLabeled: false,
            altText: 'AI 생성 일러스트',
          },
        ],
      }

      const result = evaluateEditorialReadiness(input)
      const aiStop = result.hardStops.find((h) => h.code === 'AI_IMAGE_UNLABELED')
      expect(aiStop).toBeDefined()
      expect(result.eligibility).toBe('REVIEW_REQUIRED')
    })
  })

  it('짧은 글이라도 길이 때문에 가독성 감점이 발생하지 않는다', () => {
    const shortInput: ReadinessInput = {
      title: '오늘의 한 줄 팁',
      body: `## 커피 보관법
원두는 밀폐 용기에 담아 서늘한 곳에 보관하는 것이 향을 지키는 가장 좋은 방법입니다.`,
      tags: ['커피팁'],
      approvedFacts: ['원두 서늘한 밀폐 보관 권장'],
      readerQuestions: ['원두는 어디에 보관하나요?'],
      images: [],
    }

    const result = evaluateEditorialReadiness(shortInput)
    const readability = result.dimensions.find((d) => d.key === 'READABILITY')

    expect(readability).toBeDefined()
    expect(readability?.status).toBe('ASSESSED')
    // 짧은 글이어도 소제목이 있고 문장이 깔끔하면 만점(15) 혹은 고득점이어야 하며 감점 사유가 아니어야 함
    expect(readability?.rawScore).toBe(15)
  })

  it('결과 JSON에 금지 문구가 일절 포함되지 않는다', () => {
    const prohibitedWords = [
      '상위노출',
      '네이버 점수',
      '지수',
      'C-Rank',
      'D.I.A',
      '순위 보장',
    ]

    const result = evaluateEditorialReadiness(baseInput)
    const serialized = JSON.stringify(result)

    for (const forbidden of prohibitedWords) {
      expect(serialized).not.toContain(forbidden)
    }

    // 하드스톱 케이스의 직렬화 결과에서도 금지 문구가 없어야 함
    const stoppedInput: ReadinessInput = {
      ...baseInput,
      body: '100% 효과 보장 치료됩니다 50,000원',
    }
    const stoppedResult = evaluateEditorialReadiness(stoppedInput)
    const stoppedSerialized = JSON.stringify(stoppedResult)
    for (const forbidden of prohibitedWords) {
      expect(stoppedSerialized).not.toContain(forbidden)
    }
  })

  it('suggestedFixes는 각 축당 최대 3개, actionableFixes는 전체 최대 3개로 제한된다', () => {
    const problemInput: ReadinessInput = {
      title: '테스트 글',
      body: '15,000원 완치 보장. 제가 직접 받아보니 너무 좋습니다.',
      tags: [],
      approvedFacts: [],
      readerQuestions: ['언제 가야 하나요?', '위치는 어디인가요?', '주차 가능한가요?'],
      images: [
        {
          sourceKind: 'OWNER_UPLOAD',
          rightsStatus: 'UNCONFIRMED',
        },
      ],
      hasCta: false,
    }

    const result = evaluateEditorialReadiness(problemInput)

    for (const dim of result.dimensions) {
      expect(dim.suggestedFixes.length).toBeLessThanOrEqual(3)
    }
    expect(result.actionableFixes.length).toBeLessThanOrEqual(3)
    expect(result.actionableFixes.length).toBeGreaterThan(0)
  })

  it('빈 독자 질문 목록은 만점이 아니라 미평가로 처리한다', () => {
    const result = evaluateEditorialReadiness({ title: '제목', body: '본문입니다.', tags: [], readerQuestions: [] })
    const dim = result.dimensions.find((d) => d.key === 'READER_QUESTION_COVERAGE')
    expect(dim?.status).toBe('NOT_ASSESSED')
    expect(dim?.rawScore).toBeNull()
    expect(result.totalIfComplete).toBeNull()
  })

  it('어미가 달라도 같은 어간이면 독자 질문이 반영된 것으로 본다', () => {
    const result = evaluateEditorialReadiness({
      title: '첫 방문 안내', tags: [],
      body: '처음 방문하시는 분들을 위해 이용 흐름과 예약 방법을 차근차근 안내해 드려요.',
      readerQuestions: ['처음 방문하면 어떻게 이용하나요', '예약은 어떻게 하나요'],
    })
    const dim = result.dimensions.find((d) => d.key === 'READER_QUESTION_COVERAGE')
    expect(dim?.status).toBe('ASSESSED')
    expect(dim?.rawScore ?? 0).toBeGreaterThanOrEqual(15)
  })

  it('본문과 무관한 질문은 낮게 평가한다', () => {
    const result = evaluateEditorialReadiness({
      title: '제목', tags: [], body: '공간과 분위기를 소개합니다.',
      readerQuestions: ['주차는 가능한가요'],
    })
    expect(result.dimensions.find((d) => d.key === 'READER_QUESTION_COVERAGE')?.rawScore ?? 99).toBeLessThanOrEqual(8)
  })
})
