import { describe, it, expect } from 'vitest'
import { getModelProfile } from '@/lib/ai/model-profiles'
import { applyCreativeStylePreset } from '@/features/creative/openai-image-client'
import { parseGeminiTextConfig } from '@/lib/openai/server-env'
import { getAgentBuild } from '@/lib/outcome-os/runtime/gemini-planner-registry'

describe('소희 13차 수정: Gemini LLM 전면 전환 & OpenAI Image 2.5(Flare/Sunburst) 분기 검증', () => {
  it('1. 대화 모델 프로파일은 Google Gemini 저가 가성비 모델(gemini-3.5-flash-lite)이어야 한다', () => {
    const convProfile = getModelProfile('conversation')
    expect(convProfile.provider).toBe('gemini')
    expect(convProfile.modelId).toBe('gemini-3.5-flash-lite')
    expect(convProfile.costPer1kTokensWon).toBeLessThanOrEqual(5)
  })

  it('2. 에이전트 액션 및 업무 완결 프로파일은 Google Gemini 3.8 Flash이어야 한다', () => {
    const actionProfile = getModelProfile('action')
    expect(actionProfile.provider).toBe('gemini')
    expect(actionProfile.modelId).toBe('gemini-3.8-flash')
  })

  it('3. 에이전트 빌드 레지스트리의 플래너 모델도 gemini-3.8-flash로 등록되어 있어야 한다', () => {
    const build = getAgentBuild('v0.9.0-gemini-flash-prod')
    expect(build.primaryPlannerModel).toBe('gemini-3.8-flash')
  })

  it('4. 이미지 생성 프로파일은 OpenAI gpt-image-2.5-sunburst 전용이어야 한다', () => {
    const imageProfile = getModelProfile('image')
    expect(imageProfile.provider).toBe('openai')
    expect(imageProfile.modelId).toBe('gpt-image-2.5-sunburst')
  })

  it('5. Flare 스타일 프리셋은 인물을 배제하고 매장 분위기/로고/감성을 강조해야 한다', () => {
    const prompt = '아늑한 뷰티 스튜디오의 전경'
    const transformed = applyCreativeStylePreset(prompt, 'flare')
    expect(transformed).toContain('Flare')
    expect(transformed).toContain('No humans')
    expect(transformed).toContain('branding mood')
  })

  it('6. Sunburst 스타일 프리셋은 실사 인물과 자연스러운 피부/채광을 강조해야 한다', () => {
    const prompt = '원장님의 친절한 상담 모습'
    const transformed = applyCreativeStylePreset(prompt, 'sunburst')
    expect(transformed).toContain('Sunburst')
    expect(transformed).toContain('Authentic Korean person')
    expect(transformed).toContain('Hyper-realistic natural skin texture')
  })

  it('7. parseGeminiTextConfig가 신규 GEMINI_API_KEY와 모델 스펙을 정확히 파싱해야 한다', () => {
    const config = parseGeminiTextConfig({
      GEMINI_API_KEY: 'synthetic-gemini-cutover-key-0000000001',
      GEMINI_CONVERSATION_MODEL: 'gemini-3.5-flash-lite',
      GEMINI_ACTION_MODEL: 'gemini-3.8-flash',
    })
    expect(config.apiKey).toBe('synthetic-gemini-cutover-key-0000000001')
    expect(config.conversationModel).toBe('gemini-3.5-flash-lite')
    expect(config.actionModel).toBe('gemini-3.8-flash')
  })
})
