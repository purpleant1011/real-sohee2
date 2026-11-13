import { describe, it, expect } from 'vitest'
import { openAIHarnessAnalyzer } from './openai-harness-analyzer'

describe('OpenAIHarnessAnalyzer (v1.1 OpenAI integration)', () => {
  it('extracts structured 5-modular harness schema with core DNA', async () => {
    const res = await openAIHarnessAnalyzer.analyzeHarness({
      platform: 'instagram',
      sourceUrl: 'https://instagram.com/studio_by.reum',
      sourceHandle: 'studio_by.reum',
      captions: [
        '아침마다 양쪽 눈썹 그리느라 15분씩 씨름하셨나요?',
        '공장식 시술이 아닌 1:1 퍼스널 골격 진단 디자인',
        '시술 직후에도 짱구 눈썹 없이 자연스러운 일상 복귀'
      ],
      commentSamples: ['가격 문의드립니다', '주말 예약 가능한가요?']
    })

    expect(res).toBeDefined()
    expect(res.coreDna.length).toBe(3)
    expect(res.textJson.hookPatterns.length).toBeGreaterThan(0)
    expect(res.visualJson.subjectTypes.length).toBeGreaterThan(0)
    expect(res.operationsJson.contentMixRatios.expertDiagnosis).toBeGreaterThan(0)
    expect(res.communityJson.questionTaxonomy.length).toBeGreaterThan(0)
    expect(res.platformJson.compatibleTargets).toContain('instagram')

    // Rule-level provenance checks
    const hookRule = res.rules.find(r => r.ruleKey === 'hook_style')
    expect(hookRule?.evidenceState).toBe('OBSERVED')

    const toneRule = res.rules.find(r => r.ruleKey === 'tone_vector')
    expect(toneRule?.evidenceState).toBe('RECOMMENDED_DEFAULT')
  })
})
