// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { ConversationBrain } from '@/lib/ai/conversation-brain'
import { generateMarketingPlanWithGemini } from '@/lib/outcome-os/runtime/gemini-planner-service'
import { DefaultOpenAIImageClient } from '@/features/creative/openai-image-client'

// 실제 유료 API 를 호출하므로 SOHEE_LIVE_PROVIDER_TESTS=1 로 명시했을 때만 실행한다.
describe.skipIf(process.env.SOHEE_LIVE_PROVIDER_TESTS !== '1')('소희 13차 수정: 실전 라이브 프로바이더 호출 검증 (Gemini & OpenAI Image 2.5)', () => {
  // 실제 API 호출이므로 타임아웃을 60초로 설정
  it('1. [실제 대화 테스트] Gemini 3.5 Flash Lite로 사장님 맞춤 대화가 정상 생성되어야 한다', async () => {
    const res = await ConversationBrain.generateResponse({
      messages: [
        { role: 'user', content: '소희야 안녕! 오늘 인스타그램에 우리 매장(바이름) 이벤트 소식 올리고 싶은데 어떻게 할까?' }
      ],
      workspaceId: 'ws-live-test',
    })

    expect(res.modelId).toBe('gemini-3.5-flash-lite')
    expect(res.role).toBe('conversation')
    expect(res.totalTokens).toBeGreaterThan(50)
    expect(res.content.length).toBeGreaterThan(30)
    expect(res.content).toContain('사장님')
    console.log('[Live Test 1] Gemini 3.5 Flash Lite Response Snippet:\n', res.content.slice(0, 150))
  }, 30000)

  it('2. [실제 에이전트 수행 테스트] Gemini 3.8 Flash로 1회 원자적 마케팅 계획(JSON)을 완결해야 한다', async () => {
    const planRes = await generateMarketingPlanWithGemini({
      workspaceId: 'ws-live-test',
      businessName: '바이름',
      businessCategory: '자연눈썹 뷰티 스튜디오',
      connectedChannels: ['instagram'],
      isFreeTaste: true,
    })

    expect(planRes.success).toBe(true)
    expect(planRes.trace.model).toBe('gemini-3.8-flash')
    expect(planRes.plan).toBeDefined()
    expect(planRes.plan?.missions?.length).toBeGreaterThanOrEqual(1)
    console.log('[Live Test 2] Gemini 3.8 Flash Plan Strategy:', planRes.plan?.strategyName)
  }, 30000)

  it('3. [실제 이미지 생성 테스트 - Flare] OpenAI 2.5 image (gpt-image-2.5-flare)로 무드/분위기 이미지가 생성되어야 한다', async () => {
    const client = new DefaultOpenAIImageClient(undefined, 'gpt-image-2.5-flare')
    const result = await client.generateImage({
      prompt: '바이름 뷰티 스튜디오의 따뜻한 오후 햇살과 감성적인 인테리어 전경',
      model: 'gpt-image-2.5-flare',
      stylePreset: 'flare',
      size: '1024x1024',
    })

    expect(result.bytes.length).toBeGreaterThan(10000)
    expect(result.mimeType).toBe('image/png')
    expect(result.sha256Digest).toHaveLength(64)
    expect(result.model).toBe('gpt-image-2.5-flare')
    expect(result.stylePreset).toBe('flare')
    console.log('[Live Test 3] OpenAI gpt-image-2.5 Flare bytes:', result.bytes.length, 'SHA:', result.sha256Digest.slice(0, 16))
  }, 90000)

  it('4. [실제 이미지 생성 테스트 - Sunburst] OpenAI 2.5 image (gpt-image-2.5-sunburst)로 실사 인물 이미지가 생성되어야 한다', async () => {
    const client = new DefaultOpenAIImageClient()
    const result = await client.generateImage({
      prompt: '바이름 스튜디오에서 전문적인 상담을 진행 중인 단정한 30대 한국인 여성 원장의 실사 포트레이트',
      stylePreset: 'sunburst',
      size: '1024x1024',
    })

    expect(result.bytes.length).toBeGreaterThan(10000)
    expect(result.mimeType).toBe('image/png')
    expect(result.sha256Digest).toHaveLength(64)
    expect(result.model).toBe('gpt-image-2.5-sunburst')
    expect(result.stylePreset).toBe('sunburst')
    console.log('[Live Test 4] OpenAI gpt-image-2.5 Sunburst bytes:', result.bytes.length, 'SHA:', result.sha256Digest.slice(0, 16))
  }, 90000)
})
