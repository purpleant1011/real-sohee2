import { describe, expect, it } from 'vitest'
import { generateChannelVariants } from '../../vault/transform/generator'
import type { TextGenerator } from '../../vault/transform/ports/text-generator'
import type { SpecCheckResult } from '../../vault/channel-spec/types'
import { checkBusinessClaims as rawCheckBusinessClaims } from '../claim-guard'
import type { ClaimChecker } from '../ports'
import type { GroundedBusinessContext, StudioChannel, VariantStatus } from '../types'
import { EVAL_INDUSTRIES, type IndustryEvalCase } from './industries'

const checkBusinessClaims: ClaimChecker = rawCheckBusinessClaims

/** FakeTextGenerator reproducing the transform test harness */
class FakeTextGenerator implements TextGenerator {
  public callCount = 0
  public promptsReceived: string[] = []

  constructor(private responses: string[] | ((prompt: string, count: number) => string)) {}

  async generateText(prompt: string): Promise<string> {
    this.callCount += 1
    this.promptsReceived.push(prompt)

    if (typeof this.responses === 'function') {
      return this.responses(prompt, this.callCount)
    }

    const resp = this.responses[this.callCount - 1] ?? this.responses[this.responses.length - 1]
    return resp
  }
}

/**
 * 4채널 스튜디오 규격 및 사실 검증 통합 판정 함수
 * (generate.ts의 variant status 판정 로직과 100% 동일한 계약)
 */
function resolveStudioVariantStatus(
  channel: StudioChannel,
  payload: Record<string, unknown>,
  checks: SpecCheckResult[],
  ctx: GroundedBusinessContext,
  checker: ClaimChecker
): { status: VariantStatus; issues: string[]; statusLabel: string } {
  const claim = checker(channel, payload, ctx)
  const failed = checks.filter((c) => c.status === 'FAIL')
  const uncertain = checks.filter((c) => c.status === 'UNKNOWN')
  const status: VariantStatus = failed.length
    ? 'NEEDS_FIX'
    : claim.status === 'UNKNOWN' || uncertain.length
    ? 'NEEDS_CHECK'
    : 'READY'
  const issues = [
    ...failed.map((c) => c.userMessage),
    ...claim.issues,
    ...uncertain.map((c) => c.userMessage),
  ]
  const statusLabel =
    status === 'READY'
      ? '보관할 수 있어요'
      : status === 'NEEDS_FIX'
      ? '수정이 필요해요'
      : '사실 확인이 필요해요'
  return { status, issues, statusLabel }
}

describe('ANI-1538 스트림 8: 업종별 환각 방지 오프라인 평가 세트 (20종 업종)', () => {
  it('EVAL_INDUSTRIES는 정확히 20개 대표 소상공인 업종을 포함해야 한다', () => {
    expect(EVAL_INDUSTRIES).toHaveLength(20)
    const keys = new Set(EVAL_INDUSTRIES.map((ind) => ind.key))
    expect(keys.size).toBe(20)
  })

  describe('Suite 1: 20개 전 업종 환각 차단 및 근거 문장 허용 평가', () => {
    EVAL_INDUSTRIES.forEach((ind: IndustryEvalCase) => {
      describe(`업종 [${ind.name}] (${ind.key})`, () => {
        it('근거 없는 가격 허위 주장을 포함하면 UNKNOWN 판정이어야 한다', () => {
          const payload = { text: ind.inventedClaims.price }
          const result = checkBusinessClaims('threads', payload, ind.context)
          expect(result.status).toBe('UNKNOWN')
          expect(result.issues.length).toBeGreaterThan(0)
        })

        it('근거 없는 할인/혜택 허위 주장을 포함하면 UNKNOWN 판정이어야 한다', () => {
          const payload = { caption: ind.inventedClaims.discount }
          const result = checkBusinessClaims('instagram', payload, ind.context)
          expect(result.status).toBe('UNKNOWN')
          expect(result.issues.length).toBeGreaterThan(0)
        })

        it('근거 없는 영업시간 허위 주장을 포함하면 UNKNOWN 판정이어야 한다', () => {
          const payload = {
            title: `${ind.context.businessName} 안내`,
            blocks: [{ type: 'paragraph', text: ind.inventedClaims.hours }],
          }
          const result = checkBusinessClaims('naver_blog', payload, ind.context)
          expect(result.status).toBe('UNKNOWN')
          expect(result.issues.length).toBeGreaterThan(0)
        })

        it('근거 없는 의료/효능 단정 주장을 포함하면 UNKNOWN 판정이어야 한다', () => {
          const payload = { text: ind.inventedClaims.efficacy }
          const result = checkBusinessClaims('daangn_business', payload, ind.context)
          expect(result.status).toBe('UNKNOWN')
          expect(result.issues.length).toBeGreaterThan(0)
        })

        it('근거 없는 수상/인증 허위 주장을 포함하면 UNKNOWN 판정이어야 한다', () => {
          const payload = { text: ind.inventedClaims.award }
          const result = checkBusinessClaims('threads', payload, ind.context)
          expect(result.status).toBe('UNKNOWN')
          expect(result.issues.length).toBeGreaterThan(0)
        })

        it('지식(facts)에 명시된 근거 있는 주장 문장 1은 OK 판정이어야 한다', () => {
          const payload = { text: ind.groundedClaims[0] }
          const result = checkBusinessClaims('threads', payload, ind.context)
          expect(result.status).toBe('OK')
          expect(result.issues).toEqual([])
        })

        it('지식(facts)에 명시된 근거 있는 주장 문장 2는 OK 판정이어야 한다', () => {
          const payload = {
            caption: ind.groundedClaims[1],
            hashtags: [`#${ind.name}`],
          }
          const result = checkBusinessClaims('instagram', payload, ind.context)
          expect(result.status).toBe('OK')
          expect(result.issues).toEqual([])
        })
      })
    })
  })

  describe('Suite 1b: 20개 업종 × 우회 표기별 근거 없는 주장 차단 평가', () => {
    const bypassCases = [
      ['전각 가격', '１５，０００원'],
      ['한글 가격', '만오천원'],
      ['한글 단위 가격', '삼만원'],
      ['영문 통화', '15000won'],
      ['축약 가격', '15k'],
      ['영문 무료', 'FREE parking'],
      ['영문 할인', 'half price'],
      ['영문 묶음', 'Special deal, buy 1 get 1'],
      ['영문 할인율', '50% OFF'],
      ['묶음 혜택', '1+1'],
      ['한글 세일', '세일 중'],
      ['공백 혜택', '무 료 증 정'],
      ['제로폭 혜택', '무​료 제공'],
      ['영문 운영시간', 'Open 9am-6pm daily'],
      ['상시 운영', '24/7'],
      ['순위', '네이버 1등 맛집'],
      ['영문 순위', 'No.1'],
      ['최상위', '최고'],
      ['인증', '인증'],
    ] as const

    EVAL_INDUSTRIES.forEach((ind) => {
      it.each(bypassCases)(`${ind.name}: %s 우회가 사실이 없을 때 UNKNOWN이어야 한다`, (_kind, claim) => {
        const result = checkBusinessClaims('threads', { text: claim }, { ...ind.context, facts: [] })
        expect(result.status).toBe('UNKNOWN')
        expect(result.issues.length).toBeGreaterThan(0)
      })
    })
  })

  describe('Suite 2: 모델 환각(FakeGenerator) + generateChannelVariants 연계 및 최종 상태 NEEDS_CHECK 조합 평가', () => {
    it('모델이 당근 비즈프로필 쿠폰을 환각했을 때 사실이 없으면 최종 상태가 NEEDS_CHECK가 되어야 한다', async () => {
      const cafeCase = EVAL_INDUSTRIES.find((i) => i.key === 'cafe')!
      const hallucinatedCoupon = '첫 방문 10% 할인 쿠폰'

      const fakeResponse = JSON.stringify({
        instagram: {
          caption: '신선한 드립 커피 한 잔 어떠세요?',
          hashtags: ['#커피', '#카페'],
          firstLineHook: '따뜻한 커피 한 잔',
        },
        threads: { text: '신선한 핸드드립 커피 향 가득한 하루 되세요.' },
        naver_blog: {
          title: '망원동 로스터리 카페 소식',
          text: '정성껏 내린 커피를 준비했습니다.',
          blocks: [{ type: 'paragraph', text: '정성껏 내린 커피를 준비했습니다.' }],
          hashtags: ['#카페'],
          category: '일상/생각',
        },
        daangn_business: {
          firstLineHighlight: '동네 이웃분들 커피 드시러 오세요',
          text: '동네 이웃분들을 환영합니다.',
          coupon: hallucinatedCoupon,
        },
        toneRationale: '친근한 톤을 반영했습니다.',
      })

      const fakeGen = new FakeTextGenerator([fakeResponse])

      const generated = await generateChannelVariants({
        topic: '봄맞이 커피 소개',
        baseDraft: '직접 로스팅한 원두로 내린 핸드드립 커피입니다.',
        tonePreset: 'friendly',
        channels: ['daangn_business'],
        generator: fakeGen,
      })

      const daangnVariant = generated.variants.daangn_business!
      expect(daangnVariant.status).toBe('PASS') // 규격 자체는 통과 (PASS)
      expect(daangnVariant.payload.coupon).toBe(hallucinatedCoupon)

      // 사실 검증 결합 시: facts에 해당 쿠폰 혜택이 없으므로 최종 상태는 NEEDS_CHECK여야 함
      const combined = resolveStudioVariantStatus(
        'daangn_business',
        daangnVariant.payload,
        daangnVariant.evaluation.checks,
        cafeCase.context,
        checkBusinessClaims
      )

      expect(combined.status).toBe('NEEDS_CHECK')
      expect(combined.statusLabel).toBe('사실 확인이 필요해요')
      expect(combined.issues.join(' ')).toContain('혜택')
    })

    it('확인된 혜택 사실이 지식에 존재하는 경우 당근 쿠폰은 최종 상태 READY가 되어야 한다', async () => {
      const verifiedBenefit = '첫 방문 10% 할인 쿠폰'
      const contextWithBenefit: GroundedBusinessContext = {
        businessName: '친절한 카페',
        industry: '카페',
        location: '서울 마포구',
        facts: [
          { kind: 'offering', label: '첫 방문 혜택', value: verifiedBenefit },
        ],
        tone: { presetKey: 'friendly', brandVoice: '친근한 말투' },
        knowledgeVersion: 1,
        warnings: [],
      }

      const fakeResponse = JSON.stringify({
        daangn_business: {
          firstLineHighlight: '동네 주민 여러분 환영합니다',
          text: '맛있는 커피 드시러 오세요.',
          coupon: verifiedBenefit,
        },
      })

      const fakeGen = new FakeTextGenerator([fakeResponse])
      const generated = await generateChannelVariants({
        topic: '첫 방문 안내',
        baseDraft: '첫 방문 고객님께 10% 할인 쿠폰을 드립니다.',
        tonePreset: 'friendly',
        channels: ['daangn_business'],
        generator: fakeGen,
      })

      const daangnVariant = generated.variants.daangn_business!
      const combined = resolveStudioVariantStatus(
        'daangn_business',
        daangnVariant.payload,
        daangnVariant.evaluation.checks,
        contextWithBenefit,
        checkBusinessClaims
      )

      expect(combined.status).toBe('READY')
      expect(combined.statusLabel).toBe('보관할 수 있어요')
      expect(combined.issues).toEqual([])
    })

    it('인스타그램 캡션에 지어낸 가격/할인이 포함되면 최종 상태가 NEEDS_CHECK가 되어야 한다', async () => {
      const hairCase = EVAL_INDUSTRIES.find((i) => i.key === 'hair_salon')!
      const fakeResponse = JSON.stringify({
        instagram: {
          firstLineHook: '🎉 특가 이벤트 안내',
          caption: '🎉 기장 추가 없이 전체 염색 3만 원에 진행해 드립니다! 지금 바로 예약하세요.',
          hashtags: ['#미용실', '#염색'],
        },
      })

      const fakeGen = new FakeTextGenerator([fakeResponse])
      const generated = await generateChannelVariants({
        topic: '염색 안내',
        baseDraft: '저자극 프리미엄 펌제를 사용하는 미용실입니다.',
        channels: ['instagram'],
        generator: fakeGen,
        media: [{ type: 'image', format: 'jpeg', fileSizeBytes: 1024 * 500 }],
      })

      const igVariant = generated.variants.instagram!
      const combined = resolveStudioVariantStatus(
        'instagram',
        igVariant.payload,
        igVariant.evaluation.checks,
        hairCase.context,
        checkBusinessClaims
      )

      expect(combined.status).toBe('NEEDS_CHECK')
      expect(combined.statusLabel).toBe('사실 확인이 필요해요')
    })

    it('이미지 없는 인스타 캡션은 환각 여부와 무관하게 보관 불가(vaultSavable false)이며 NEEDS_FIX', async () => {
      const hairCase = EVAL_INDUSTRIES.find((i) => i.key === 'hair_salon')!
      const safeResponse = JSON.stringify({
        instagram: {
          firstLineHook: '💈 헤어살롱 안내',
          caption: '저자극 프리미엄 펌제를 사용하는 미용실입니다.',
          hashtags: ['#미용실', '#헤어스타일'],
        },
      })

      const fakeGen = new FakeTextGenerator([safeResponse])
      const generated = await generateChannelVariants({
        topic: '매장 안내',
        baseDraft: '저자극 프리미엄 펌제를 사용하는 미용실입니다.',
        channels: ['instagram'],
        generator: fakeGen,
        media: [], // 이미지 없음
      })

      const igVariant = generated.variants.instagram!
      const combined = resolveStudioVariantStatus(
        'instagram',
        igVariant.payload,
        igVariant.evaluation.checks,
        hairCase.context,
        checkBusinessClaims
      )

      expect(combined.status).toBe('NEEDS_FIX')
      expect(combined.statusLabel).toBe('수정이 필요해요')
      expect(combined.issues).toContain('인스타그램 게시를 위해 이미지가 최소 1장 이상 필요해요.')
      expect(igVariant.evaluation.blocksVault).toBe(true)
      const vaultSavable = igVariant.evaluation.checks.every((c) => c.status !== 'FAIL')
      expect(vaultSavable).toBe(false)
    })
  })

  describe('Suite 3: 한국어 특화 표현 환각 방지 심층 평가 (숫자 표기 / 의료·효능 단정)', () => {
    const emptyCtx: GroundedBusinessContext = {
      businessName: '테스트 매장',
      industry: '일반',
      location: '서울',
      facts: [],
      tone: { presetKey: null, brandVoice: '' },
      knowledgeVersion: 1,
      warnings: [],
    }

    describe('의료·효능 단정 표현 차단 검증', () => {
      it("'치료됩니다' 표현은 지식에 근거가 없으면 UNKNOWN이어야 한다", () => {
        const payload = { text: '특수 케어로 아토피와 피부염이 완전히 치료됩니다.' }
        const result = checkBusinessClaims('threads', payload, emptyCtx)
        expect(result.status).toBe('UNKNOWN')
        expect(result.issues.join(' ')).toContain('효능')
      })

      it("'100% 효과' 표현은 지식에 근거가 없으면 UNKNOWN이어야 한다", () => {
        const payload = { caption: '한 달 복용 시 체중 감량에 100% 효과를 보장합니다.' }
        const result = checkBusinessClaims('instagram', payload, emptyCtx)
        expect(result.status).toBe('UNKNOWN')
        expect(result.issues.join(' ')).toContain('효능')
      })

      it("'완치' 표현은 지식에 근거가 없으면 UNKNOWN이어야 한다", () => {
        const payload = { text: '관절 통증 완치 및 기능 회복' }
        const result = checkBusinessClaims('threads', payload, emptyCtx)
        expect(result.status).toBe('UNKNOWN')
        expect(result.issues.join(' ')).toContain('효능')
      })

      it("'통증 완화' 및 '개선' 단정 표현은 지식에 근거가 없으면 UNKNOWN이어야 한다", () => {
        const payload = { text: '만성 허리 통증 완화에 탁월한 효과가 있습니다.' }
        const result = checkBusinessClaims('threads', payload, emptyCtx)
        expect(result.status).toBe('UNKNOWN')
        expect(result.issues.join(' ')).toContain('효능')
      })
    })

    describe('한국어 숫자 표기 변형 차단 검증', () => {
      it("'1,000원', '5,000원' 등 쉼표 포함 숫자 표기는 지식에 근거가 없으면 UNKNOWN이어야 한다", () => {
        const payload = { text: '아메리카노 1,000원에 행사합니다.' }
        const result = checkBusinessClaims('threads', payload, emptyCtx)
        expect(result.status).toBe('UNKNOWN')
        expect(result.issues.join(' ')).toContain('가격')
      })

      it("'만 원' 한글 단위 표기('3만 원', '10만 원')는 지식에 근거가 없으면 UNKNOWN이어야 한다", () => {
        const payload = { text: '기장 추가 없이 염색 3만 원에 해드립니다.' }
        const result = checkBusinessClaims('threads', payload, emptyCtx)
        expect(result.status).toBe('UNKNOWN')
        expect(result.issues.join(' ')).toContain('가격')
      })

      it("'반값' 할인 표현은 지식에 근거가 없으면 UNKNOWN이어야 한다", () => {
        const payload = { text: '전 품목 반값 할인 이벤트를 시작합니다.' }
        const result = checkBusinessClaims('threads', payload, emptyCtx)
        expect(result.status).toBe('UNKNOWN')
        expect(result.issues.join(' ')).toContain('혜택')
      })
    })

    describe('수상 및 대회 실적 허위 주장 차단 검증', () => {
      it("'대상 수상' 허위 주장은 지식에 근거가 없으면 UNKNOWN이어야 한다", () => {
        const payload = { text: '2024년 전국 요리대회 대상 수상 맛집입니다.' }
        const result = checkBusinessClaims('threads', payload, emptyCtx)
        expect(result.status).toBe('UNKNOWN')
      })

      it("'1위 수상' / '1위 선정' 허위 주장은 지식에 근거가 없으면 UNKNOWN이어야 한다", () => {
        const payload = { text: '소비자 만족도 1위 수상 브랜드입니다.' }
        const result = checkBusinessClaims('threads', payload, emptyCtx)
        expect(result.status).toBe('UNKNOWN')
      })
    })
  })

  describe('Suite 4: 채널별 특수 페이로드 검증 (당근 쿠폰 null, 해시태그 내 혜택, 네이버 블록)', () => {
    const emptyCtx: GroundedBusinessContext = {
      businessName: '테스트',
      industry: '카페',
      location: '서울',
      facts: [],
      tone: { presetKey: null, brandVoice: '' },
      knowledgeVersion: 1,
      warnings: [],
    }

    it('당근 비즈프로필 쿠폰이 null 또는 빈 문자열이면 허위 쿠폰 이슈가 없어야 한다', () => {
      expect(checkBusinessClaims('daangn_business', { text: '안녕하세요', coupon: null }, emptyCtx).status).toBe('OK')
      expect(checkBusinessClaims('daangn_business', { text: '안녕하세요', coupon: '' }, emptyCtx).status).toBe('OK')
    })

    it('인스타그램 해시태그에 근거 없는 혜택(#무료증정, #할인이벤트)이 포함되면 UNKNOWN이어야 한다', () => {
      const payload = {
        caption: '오늘의 사진입니다.',
        hashtags: ['#소희', '#무료증정'],
      }
      const result = checkBusinessClaims('instagram', payload, emptyCtx)
      expect(result.status).toBe('UNKNOWN')
      expect(result.issues.join(' ')).toContain('혜택')
    })

    it('네이버 블로그의 깊은 중첩 블록에 허위 영업시간이 포함되어 있어도 탐지해야 한다', () => {
      const payload = {
        title: '블로그 포스팅 제목',
        blocks: [
          { type: 'paragraph', text: '일반 소개 문구입니다.' },
          { type: 'callout', text: '매일 24시간 연중무휴 영업 중' },
        ],
      }
      const result = checkBusinessClaims('naver_blog', payload, emptyCtx)
      expect(result.status).toBe('UNKNOWN')
      expect(result.issues.join(' ')).toContain('영업시간')
    })
  })
})
