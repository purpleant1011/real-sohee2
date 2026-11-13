import { describe, expect, it } from 'vitest'
import {
  evaluateChatReliability,
  detectErrorLeak,
  detectHallucinatedClaims,
  CHAT_TEST_PROMPTS,
  type ChatTurnResultInput,
} from './chat-reliability-measure'

describe('ANI-1550 Chat Reliability Evaluator (evaluateChatReliability)', () => {
  const createMockTurns = (count = 20, overrides: Partial<ChatTurnResultInput> = {}): ChatTurnResultInput[] => {
    return Array.from({ length: count }, (_, i) => ({
      index: i + 1,
      category: CHAT_TEST_PROMPTS[i]?.category || 'test_category',
      prompt: CHAT_TEST_PROMPTS[i]?.prompt || '테스트 프롬프트',
      latencySeconds: 1.2 + (i % 5) * 0.1,
      modelId: 'gemini-3.5-flash-lite',
      content: `사장님 안녕하세요! 소희입니다. 매장 운영에 도움이 되는 마케팅 전략과 실행 방안을 제안해 드릴게요. (턴 ${i + 1})`,
      ...overrides,
    }))
  }

  it('1. 20회 정상 호출 시 모든 판정 항목과 overallStatus가 PASS여야 한다', () => {
    const turns = createMockTurns(20)
    const result = evaluateChatReliability(turns, 'gemini-3.5-flash-lite', 20)

    expect(result.overallStatus).toBe('PASS')
    expect(result.totalTurns).toBe(20)
    expect(result.measuredTurns).toBe(20)
    expect(result.successCount).toBe(20)
    expect(result.failureCount).toBe(0)
    expect(result.items.nonEmptyKorean.status).toBe('PASS')
    expect(result.items.noErrorLeak.status).toBe('PASS')
    expect(result.items.noHallucinatedClaims.status).toBe('PASS')
    expect(result.items.modelConsistency.status).toBe('PASS')
    expect(result.items.latency.status).toBe('PASS')
    expect(result.items.latency.averageSeconds).toBeGreaterThan(0)
  })

  it('2. 측정 데이터가 0건이면 모든 항목이 NOT_MEASURED여야 한다 (통과 위장 금지)', () => {
    const result = evaluateChatReliability([], 'gemini-3.5-flash-lite', 20)

    expect(result.overallStatus).toBe('NOT_MEASURED')
    expect(result.measuredTurns).toBe(0)
    expect(result.items.nonEmptyKorean.status).toBe('NOT_MEASURED')
    expect(result.items.noErrorLeak.status).toBe('NOT_MEASURED')
    expect(result.items.noHallucinatedClaims.status).toBe('NOT_MEASURED')
    expect(result.items.modelConsistency.status).toBe('NOT_MEASURED')
    expect(result.items.latency.status).toBe('NOT_MEASURED')
  })

  it('3. 20회 미만(예: 15회)만 측정되었을 경우 FAIL 판정이어야 한다', () => {
    const turns = createMockTurns(15)
    const result = evaluateChatReliability(turns, 'gemini-3.5-flash-lite', 20)

    expect(result.overallStatus).toBe('FAIL')
    expect(result.measuredTurns).toBe(15)
    expect(result.items.nonEmptyKorean.status).toBe('FAIL')
    expect(result.failureCount).toBeGreaterThanOrEqual(5)
  })

  it('4. 빈 응답 또는 한국어가 누락된 응답이 포함되면 nonEmptyKorean FAIL이어야 한다', () => {
    const turns = createMockTurns(20)
    turns[3].content = '   ' // 빈 응답
    turns[7].content = 'Hello world! Only English response here.' // 한국어 누락

    const result = evaluateChatReliability(turns, 'gemini-3.5-flash-lite', 20)

    expect(result.overallStatus).toBe('FAIL')
    expect(result.items.nonEmptyKorean.status).toBe('FAIL')
    expect(result.items.nonEmptyKorean.violationCount).toBe(2)
    expect(result.successCount).toBe(18)
    expect(result.failureCount).toBe(2)
  })

  it('5. 영문 에러/스택/undefined/[object Object] 노출 시 noErrorLeak FAIL이어야 한다', () => {
    const turns = createMockTurns(20)
    turns[2].content = '사장님 안내입니다 undefined 값이 발생했습니다.'
    turns[5].content = '결과: [object Object] 입니다.'
    turns[8].content = 'Error: Internal Model Execution Failure at Object.run (app.ts:12:34)'

    const result = evaluateChatReliability(turns, 'gemini-3.5-flash-lite', 20)

    expect(result.overallStatus).toBe('FAIL')
    expect(result.items.noErrorLeak.status).toBe('FAIL')
    expect(result.items.noErrorLeak.violationCount).toBe(3)
  })

  it('6. 시스템 오류 fallback(isUnknownSafe=true 또는 errorCode) 발생 시 noErrorLeak FAIL이어야 한다', () => {
    const turns = createMockTurns(20)
    turns[10].isUnknownSafe = true
    turns[10].errorCode = 'MODEL_FAILURE'

    const result = evaluateChatReliability(turns, 'gemini-3.5-flash-lite', 20)

    expect(result.overallStatus).toBe('FAIL')
    expect(result.items.noErrorLeak.status).toBe('FAIL')
    expect(result.items.noErrorLeak.violationCount).toBe(1)
  })

  it('7. 지어낸 과대 효능(10년 젊어짐, 5kg 무조건 감량 등) 단정 시 noHallucinatedClaims FAIL이어야 한다', () => {
    const turns = createMockTurns(20)
    turns[18].content = '이 크림을 바르면 10년 젊어집니다! 주름이 다 펴집니다.'
    turns[19].content = '이 한약을 드시면 일주일에 5kg 무조건 빠집니다!'

    const result = evaluateChatReliability(turns, 'gemini-3.5-flash-lite', 20)

    expect(result.overallStatus).toBe('FAIL')
    expect(result.items.noHallucinatedClaims.status).toBe('FAIL')
    expect(result.items.noHallucinatedClaims.violationCount).toBe(2)
  })

  it('8. 지어낸 가격 단정(얼마로 결정하세요 등) 시 noHallucinatedClaims FAIL이어야 한다', () => {
    const turns = createMockTurns(20)
    turns[16].content = '아메리카노는 4500원으로 정하시면 됩니다.'

    const result = evaluateChatReliability(turns, 'gemini-3.5-flash-lite', 20)

    expect(result.overallStatus).toBe('FAIL')
    expect(result.items.noHallucinatedClaims.status).toBe('FAIL')
    expect(result.items.noHallucinatedClaims.violationCount).toBe(1)
  })

  it('9. 대상 모델(gemini-3.5-flash-lite)과 다른 모델이 반환되면 modelConsistency FAIL이어야 한다', () => {
    const turns = createMockTurns(20)
    turns[0].modelId = 'gpt-4o'

    const result = evaluateChatReliability(turns, 'gemini-3.5-flash-lite', 20)

    expect(result.overallStatus).toBe('FAIL')
    expect(result.items.modelConsistency.status).toBe('FAIL')
    expect(result.items.modelConsistency.violationCount).toBe(1)
  })

  it('10. 응답 원문 전체를 기록에 남기지 않고 앞 80자 스니펫 및 길이만 보존해야 한다', () => {
    const longText = '가'.repeat(200)
    const turns = createMockTurns(20)
    turns[0].content = longText

    const result = evaluateChatReliability(turns, 'gemini-3.5-flash-lite', 20)
    const firstRecord = result.turnRecords[0]

    expect(firstRecord.contentLength).toBe(200)
    expect(firstRecord.contentSnippet.length).toBeLessThanOrEqual(80)
    expect(firstRecord).not.toHaveProperty('content')
  })

  it('11. 지연 시간(평균, 최대, 최소)이 올바르게 계산되어야 한다', () => {
    const turns = createMockTurns(20)
    turns[0].latencySeconds = 1.0
    turns[1].latencySeconds = 2.0
    for (let i = 2; i < 20; i++) turns[i].latencySeconds = 1.5

    const result = evaluateChatReliability(turns, 'gemini-3.5-flash-lite', 20)

    expect(result.items.latency.minSeconds).toBe(1.0)
    expect(result.items.latency.maxSeconds).toBe(2.0)
    expect(result.items.latency.averageSeconds).toBeCloseTo(1.5, 1)
  })
})

describe('ANI-1550 Leak & Hallucination Pattern Detectors', () => {
  it('detectErrorLeak는 각종 에러 패턴을 정확히 검출한다', () => {
    expect(detectErrorLeak('정상 한국어 응답입니다', { index: 1, category: 'c', prompt: 'p', latencySeconds: 1, modelId: 'm' }).leaked).toBe(false)
    expect(detectErrorLeak('값이 undefined로 출력됨', { index: 1, category: 'c', prompt: 'p', latencySeconds: 1, modelId: 'm' }).leaked).toBe(true)
    expect(detectErrorLeak('[object Object] 확인', { index: 1, category: 'c', prompt: 'p', latencySeconds: 1, modelId: 'm' }).leaked).toBe(true)
    expect(detectErrorLeak('Error: something failed', { index: 1, category: 'c', prompt: 'p', latencySeconds: 1, modelId: 'm' }).leaked).toBe(true)
    expect(detectErrorLeak('정상', { index: 1, category: 'c', prompt: 'p', latencySeconds: 1, modelId: 'm', isUnknownSafe: true }).leaked).toBe(true)
  })

  it('detectHallucinatedClaims는 단정적 효능/가격 과대 표현을 정확히 검출한다', () => {
    expect(detectHallucinatedClaims('매장 상황과 원가를 고려하여 가격을 책정하시는 것을 권장합니다.').hasClaim).toBe(false)
    expect(detectHallucinatedClaims('10년 젊어집니다!').hasClaim).toBe(true)
    expect(detectHallucinatedClaims('무조건 빠집니다').hasClaim).toBe(true)
    expect(detectHallucinatedClaims('주름이 다 펴집니다').hasClaim).toBe(true)
    expect(detectHallucinatedClaims('50,000원으로 정하시면 됩니다.').hasClaim).toBe(true)
  })
})
