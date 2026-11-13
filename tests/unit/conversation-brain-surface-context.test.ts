import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest'
import { ConversationBrain, DRAFT_HONESTY_INSTRUCTION } from '@/lib/ai/conversation-brain'

describe('ConversationBrain Surface Context Awareness (Gemini & OpenAI)', () => {
  const workspaceId = 'ws_surface_test'
  const origProvider = process.env.AI_CONVERSATION_PROVIDER
  const origGeminiKey = process.env.GEMINI_API_KEY

  beforeEach(() => {
    vi.restoreAllMocks()
    process.env.AI_CONVERSATION_PROVIDER = 'gemini'
    process.env.GEMINI_API_KEY = 'mock-gemini-key'
  })

  afterAll(() => {
    process.env.AI_CONVERSATION_PROVIDER = origProvider
    process.env.GEMINI_API_KEY = origGeminiKey
  })

  it('injects surface context into system instruction when provided', async () => {
    let capturedRequestBody: any = null
    vi.spyOn(global, 'fetch').mockImplementation(async (_url, init: any) => {
      capturedRequestBody = JSON.parse(init.body)
      return {
        ok: true,
        json: async () => ({
          candidates: [
            {
              content: {
                parts: [
                  {
                    text: '사장님, 현재 홈 워크벤치를 보고 계시네요! 아직 발행된 소식이 없어 올린 글이 0으로 표시됩니다.',
                  },
                ],
              },
            },
          ],
          usageMetadata: { totalTokenCount: 120 },
        }),
      } as any
    })

    const surfaceContext = {
      route: '/app',
      routeName: 'home' as const,
      tab: 'overview',
    }

    const res = await ConversationBrain.generateResponse({
      workspaceId,
      messages: [{ role: 'user', content: '여기에 있는 숫자가 왜 0이야?' }],
      surfaceContext,
    })

    expect(res.content).toContain('홈 워크벤치')

    // Verify system instruction sent to Gemini contains surface context
    expect(capturedRequestBody).toBeDefined()
    const allSystemText = capturedRequestBody.systemInstruction?.parts
      ?.map((p: any) => p.text)
      .join('\n')
    expect(allSystemText).toBeDefined()
    expect(allSystemText).toContain('[현재 사장님 화면 위치 및 기능 맥락]')
    expect(allSystemText).toContain('홈 워크벤치')
    expect(allSystemText).toContain('/app')

    // [결함 1 검증]
    // (1) 프롬프트에 '0으로' 단정 유도 문구가 없어야 함
    expect(allSystemText).not.toContain('0으로 나오는 경우')
    expect(allSystemText).not.toContain('0으로 표시되며')

    // (2) 원칙 (a), (b), (c) 핵심 문구 포함 검증
    // (a) 제공되지 않은 숫자는 추측/가정하지 말고 화면 카드에서 확인 안내
    expect(allSystemText).toContain('정확한 숫자는 화면의 해당 카드에서 확인해 주세요')
    // (b) 4단계 컨설팅/홍보 카피 작성 금지, 3~5문장으로 짧고 직접적 답변
    expect(allSystemText).toContain('3~5문장')
    // (c) 인스타그램, 스레드 및 네이버 블로그는 실발행 가능, 당근은 미리보기(준비 중)
    expect(allSystemText).toContain('인스타그램, 스레드')
    expect(allSystemText).toContain('네이버 블로그')
    expect(allSystemText).toContain('미리보기')
  })

  describe('Draft Honesty Rules in Tool Execution Prompts', () => {
    const draftHonestyPhrase = DRAFT_HONESTY_INSTRUCTION

    it('never forbids reporting a publish that the tool result confirms (no blanket gag)', () => {
      // 실제 발행(publish)이 성공·확인된 경우까지 "발행했다고 말하지 마세요"라고 막으면 거짓을 강요하게 된다.
      expect(DRAFT_HONESTY_INSTRUCTION).not.toContain('발행/게시/예약했다고 말하지 마세요')
      expect(DRAFT_HONESTY_INSTRUCTION).toContain('성공과 게시 확인이 명시된 경우에만')
      // 초안은 콘텐츠 센터(4채널 글 만들기)에서 확인 가능하므로 '아직 등록되지 않았다'를 포함하지 않고, '4채널 글 만들기' 안내를 포함해야 한다.
      expect(DRAFT_HONESTY_INSTRUCTION).not.toContain('아직 등록되지 않았다')
      expect(DRAFT_HONESTY_INSTRUCTION).toContain('4채널 글 만들기')
      expect(DRAFT_HONESTY_INSTRUCTION).toContain('보관함')
      expect(DRAFT_HONESTY_INSTRUCTION).toContain('needsAttention이 참이거나 needsCheck가 참이면')
      expect(DRAFT_HONESTY_INSTRUCTION).toContain('statusLabel과 issues를 먼저 알리고 보관할 수 있다고 말하지 마세요')
    })

    it('injects draft honesty rule into Gemini prompt for toolExecutionResult and actionGraph', async () => {
      let capturedBody: any = null
      vi.spyOn(global, 'fetch').mockImplementation(async (_url, init: any) => {
        capturedBody = JSON.parse(init.body)
        return {
          ok: true,
          json: async () => ({
            candidates: [{ content: { parts: [{ text: '답변입니다.' }] } }],
            usageMetadata: { totalTokenCount: 100 },
          }),
        } as any
      })

      // 1) Single toolExecutionResult
      await ConversationBrain.generateResponse({
        workspaceId,
        messages: [{ role: 'user', content: '글 초안 만들어줘' }],
        toolExecutionResult: { success: true, tool: 'content.generate' },
      })
      let systemText = capturedBody.systemInstruction?.parts?.map((p: any) => p.text).join('\n')
      expect(systemText).toContain('[방금 실행된 MCP 도구 실제 결과 (Truth)]')
      expect(systemText).toContain(draftHonestyPhrase)

      // 2) Sequential / actionGraph
      await ConversationBrain.generateResponse({
        workspaceId,
        messages: [{ role: 'user', content: '글 초안 만들어줘' }],
        toolExecutionResults: [{ success: true, tool: 'content.generate' }],
        actionGraph: { rootRunId: 'run-1', actions: [] } as any,
      })
      systemText = capturedBody.systemInstruction?.parts?.map((p: any) => p.text).join('\n')
      expect(systemText).toContain('[실행된 도구 순차 결과 및 액션 그래프 (Real Truth)]')
      expect(systemText).toContain(draftHonestyPhrase)
    })
  })
})
