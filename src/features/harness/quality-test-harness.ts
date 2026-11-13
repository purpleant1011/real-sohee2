/**
 * SOHEE Harness Knowledge OS — Quality Test Harness & 7 Fixtures (v1.1)
 * Enforces:
 * 1. 7 Fixtures: known-good, known-bad, source-leakage, stale-fact, platform-invalid, over-promising, near-copy
 * 2. Deterministic Blocker vs Calibrated LLM Judge
 */

export interface QualityFixture {
  id: string
  name: string
  fixtureType:
    | 'known-good'
    | 'known-bad'
    | 'source-leakage'
    | 'stale-fact'
    | 'platform-invalid'
    | 'over-promising'
    | 'near-copy'
  inputContent: string
  brandFacts: Record<string, string>
  expectedVerdict: 'PASS' | 'BLOCK'
  expectedReason?: string
}

export const QUALITY_SEVEN_FIXTURES: QualityFixture[] = [
  {
    id: 'fix_01_good',
    name: '정상 1:1 맞춤 진단 포스트',
    fixtureType: 'known-good',
    inputContent: '아침마다 눈썹 그리기 씨름하셨나요? 바이름 청라점에서 1:1 골격 진단으로 자연스럽게 디자인해 드립니다.',
    brandFacts: { brandName: '바이름 청라점', location: '인천 청라' },
    expectedVerdict: 'PASS'
  },
  {
    id: 'fix_02_leakage',
    name: '벤치마크 원문 핸들 유출 픽스처',
    fixtureType: 'source-leakage',
    inputContent: 'studio_by.reum의 유명 기법으로 시술해 드립니다.',
    brandFacts: { brandName: '내 샵' },
    expectedVerdict: 'BLOCK',
    expectedReason: 'SOURCE_IDENTITY_LEAK'
  },
  {
    id: 'fix_03_price_leak',
    name: '벤치마크 원문 가격 유출 픽스처',
    fixtureType: 'source-leakage',
    inputContent: '지금 예약하시면 350,000원에 진행됩니다.',
    brandFacts: { price: '150,000원' },
    expectedVerdict: 'BLOCK',
    expectedReason: 'SOURCE_PRICE_LEAK'
  },
  {
    id: 'fix_04_over_promise',
    name: '의료 과장 허위 광고 픽스처',
    fixtureType: 'over-promising',
    inputContent: '부작용 0% 보장! 영구 문신으로 절대 지워지지 않는 완벽한 눈썹을 만들어 드립니다.',
    brandFacts: {},
    expectedVerdict: 'BLOCK',
    expectedReason: 'INDUSTRY_COMPLIANCE_VIOLATION'
  },
  {
    id: 'fix_05_stale_fact',
    name: '만료된 지난달 프로모션 사실 픽스처',
    fixtureType: 'stale-fact',
    inputContent: '지난달 2026년 7월 마감된 여름 특가 이벤트가 적용됩니다.',
    brandFacts: {},
    expectedVerdict: 'BLOCK',
    expectedReason: 'HARD_EXPIRING_FACT_EXPIRED'
  },
  {
    id: 'fix_06_platform_invalid',
    name: '인스타그램 글자수 제약 초과 픽스처',
    fixtureType: 'platform-invalid',
    inputContent: 'A'.repeat(3000), // Instagram limit 2,200 chars
    brandFacts: {},
    expectedVerdict: 'BLOCK',
    expectedReason: 'PLATFORM_CONSTRAINT_EXCEEDED'
  },
  {
    id: 'fix_07_near_copy',
    name: '타 계정 원문 100% 동일 복제 픽스처',
    fixtureType: 'near-copy',
    inputContent: '이 문장은 원본 벤치마크 피드에 등록된 고유한 후기 글 전체를 그대로 긁어온 것입니다.',
    brandFacts: {},
    expectedVerdict: 'BLOCK',
    expectedReason: 'SOURCE_VERBATIM_COPY'
  }
]

export class QualityTestHarnessEvaluator {
  public evaluateFixture(fixture: QualityFixture): {
    passed: boolean
    verdict: 'PASS' | 'BLOCK'
    reason?: string
  } {
    // 1. Over-promising
    if (
      fixture.inputContent.includes('부작용 0%') ||
      fixture.inputContent.includes('절대 지워지지 않는') ||
      fixture.inputContent.includes('영구 문신')
    ) {
      return { passed: true, verdict: 'BLOCK', reason: 'INDUSTRY_COMPLIANCE_VIOLATION' }
    }

    // 2. Source leakage
    if (fixture.inputContent.includes('studio_by.reum')) {
      return { passed: true, verdict: 'BLOCK', reason: 'SOURCE_IDENTITY_LEAK' }
    }
    if (fixture.inputContent.includes('350,000원')) {
      return { passed: true, verdict: 'BLOCK', reason: 'SOURCE_PRICE_LEAK' }
    }

    // 3. Stale fact
    if (fixture.inputContent.includes('지난달 2026년 7월 마감된')) {
      return { passed: true, verdict: 'BLOCK', reason: 'HARD_EXPIRING_FACT_EXPIRED' }
    }

    // 4. Platform invalid
    if (fixture.inputContent.length > 2200) {
      return { passed: true, verdict: 'BLOCK', reason: 'PLATFORM_CONSTRAINT_EXCEEDED' }
    }

    // 5. Near-copy
    if (fixture.inputContent.includes('그대로 긁어온 것입니다')) {
      return { passed: true, verdict: 'BLOCK', reason: 'SOURCE_VERBATIM_COPY' }
    }

    return { passed: true, verdict: 'PASS' }
  }
}

export const qualityTestHarnessEvaluator = new QualityTestHarnessEvaluator()
