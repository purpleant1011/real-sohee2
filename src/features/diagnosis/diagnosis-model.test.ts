import { describe, expect, it } from 'vitest'
import { buildPreliminaryDiagnosis } from './diagnosis-model'

describe('buildPreliminaryDiagnosis', () => {
  it('미용 예약 문제에 사업 언어의 예비 진단을 만든다', () => {
    const result = buildPreliminaryDiagnosis({ businessName: '별빛 헤어', industry: 'beauty', problem: 'booking', channel: 'instagram' })
    expect(result.evidenceState).toBe('input_based_preliminary')
    expect(result.customerQuestions).toContain('주말 예약이 가능한가요?')
    expect(result.recommendedTopics).toHaveLength(3)
  })
})
