import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest'
import {
  ConversationBrain,
  formatUnknownSafeResponse,
  formatBlockedResponse,
  isOperationalControlCommand,
  FORBIDDEN_OPTIMISTIC_PHRASES,
} from '@/lib/ai/conversation-brain'

describe('ANI-965: ConversationBrain Unknown-Safe & Operational Control Contract', () => {
  const workspaceId = 'ws_conv_test'

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

  describe('1. Elimination of False Reassurance Copy on Model/Runtime Failure', () => {
    it('never outputs ungrounded optimistic copy when OpenAI call fails (catch fallback)', async () => {
      // Force fetch to reject to simulate network/API crash
      vi.spyOn(global, 'fetch').mockRejectedValue(new Error('Network connection timeout to AI Gateway'))

      const res = await ConversationBrain.generateResponse({
        workspaceId,
        messages: [{ role: 'user', content: '오늘 점심 예약 현황 확인해줘' }],
        traceId: 'trace_test_err_001',
      })

      // Invariant: Zero false reassurance copy
      for (const forbidden of FORBIDDEN_OPTIMISTIC_PHRASES) {
        expect(res.content).not.toContain(forbidden)
      }

      // Invariant: Unknown-Safe structure
      expect(res.isUnknownSafe).toBe(true)
      expect(res.traceId).toBe('trace_test_err_001')
      expect(res.errorCode).toBeDefined()
      expect(res.reconcileCTA).toBeDefined()

      // Content must clearly state truth: unconfirmed / unknown state
      expect(res.content).toContain('실행 결과를 확인하지 못했어요')
      expect(res.content).not.toContain('trace_test_err_001')
      expect(res.content).toContain('다시 실행하지')
      expect(res.content).not.toContain('작업을 재시도')
    })

    it('generates a deterministic unknown-safe response with formatUnknownSafeResponse', () => {
      const formatted = formatUnknownSafeResponse({
        errorCode: 'PROVIDER_TIMEOUT',
        traceId: 'trace_prov_999',
        reconcileCTA: '채널 관리 메뉴에서 게시글 목록을 새로고침해 주세요.',
        channel: 'NAVER_BLOG',
      })

      // Strict checks
      expect(formatted).toContain('실행 결과를 확인하지 못했어요')
      expect(formatted).not.toMatch(/RESULT_UNKNOWN|PROVIDER_TIMEOUT|trace_prov_999/)
      expect(formatted).toContain('다시 실행하지')

      for (const forbidden of FORBIDDEN_OPTIMISTIC_PHRASES) {
        expect(formatted).not.toContain(forbidden)
      }
    })
  })

  describe('2. Blocked / RESULT_UNKNOWN State Handling', () => {
    it('preserves a top-level unknown loop result even without an individual tool receipt', async () => {
      vi.spyOn(global, 'fetch').mockResolvedValue({ ok: true,
        json: async () => ({ choices: [{ message: { content: '모든 작업을 완료했어요.' } }], usage: { total_tokens: 10 } }),
      } as Response)
      const result = await ConversationBrain.generateResponse({ workspaceId,
        messages: [{ role: 'user', content: '방금 작업 결과를 알려줘' }], loopStatus: 'RESULT_UNKNOWN' })
      expect(result.isUnknownSafe).toBe(true)
      expect(result.content).toContain('실행 결과를 확인하지 못했어요')
      expect(result.content).not.toContain('모든 작업을 완료했어요')
    })
    it('prohibits safe/normal copy and returns structured blocked message when loopStatus is BLOCKED', async () => {
      vi.spyOn(global, 'fetch').mockResolvedValue({
        ok: false,
        status: 500,
        text: vi.fn().mockResolvedValue('Internal Server Error'),
      } as any)

      const res = await ConversationBrain.generateResponse({
        workspaceId,
        messages: [{ role: 'user', content: '신규 상품 인스타에 즉시 발행해줘' }],
        loopStatus: 'BLOCKED',
        traceId: 'trace_blocked_101',
        toolExecutionResult: {
          errorCode: 'KILL_SWITCH_ENGAGED',
          statusMessage: '긴급 킬스위치로 인해 외부 발행이 차단되었습니다.',
        },
      })

      expect(res.isUnknownSafe).toBe(true)
      for (const forbidden of FORBIDDEN_OPTIMISTIC_PHRASES) {
        expect(res.content).not.toContain(forbidden)
      }

      expect(res.content).toContain('외부 실행이 일시 중지')
      expect(res.errorCode).toBe('KILL_SWITCH_ENGAGED')
      expect(res.traceId).toBe('trace_blocked_101')
      expect(res.content).not.toMatch(/BLOCKED|KILL_SWITCH_ENGAGED|trace_blocked_101/)
    })

    it('formats a blocked response template clearly presenting cause and recovery CTA', () => {
      const formatted = formatBlockedResponse({
        errorCode: 'MISSING_APPROVED_ASSET',
        traceId: 'trace_asset_block',
        reconcileCTA: '승인된 정품 에셋 이미지를 등록한 후 다시 요청해 주세요.',
      })

      expect(formatted).not.toMatch(/BLOCKED|MISSING_APPROVED_ASSET|trace_asset_block/)
      expect(formatted).toContain('원고와 사진')
      expect(formatted).toContain('최종 내용을 승인')

      for (const forbidden of FORBIDDEN_OPTIMISTIC_PHRASES) {
        expect(formatted).not.toContain(forbidden)
      }
    })

    it('sanitizes model output if model erroneously outputs optimistic reassurance while in BLOCKED or RESULT_UNKNOWN state', async () => {
      // Simulate an LLM that hallucinates an optimistic reassuring sentence despite being BLOCKED
      vi.spyOn(global, 'fetch').mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({
          choices: [
            {
              message: {
                content: '사장님 걱정 마세요! 소희가 매장 상태를 안전하게 지키고 있습니다. 모든 시스템이 정상 가동 중입니다.',
              },
            },
          ],
          usage: { total_tokens: 150 },
        }),
      } as any)

      const res = await ConversationBrain.generateResponse({
        workspaceId,
        messages: [{ role: 'user', content: '어떻게 됐어?' }],
        loopStatus: 'BLOCKED',
        traceId: 'trace_hallucination_guard',
        toolExecutionResult: {
          stage: 'RESULT_UNKNOWN',
          errorCode: 'READBACK_FAILED',
        },
      })

      // Hallucinated reassuring phrases must be sanitized / blocked
      for (const forbidden of FORBIDDEN_OPTIMISTIC_PHRASES) {
        expect(res.content).not.toContain(forbidden)
      }
      expect(res.content).toContain('실행 결과를 확인하지 못했어요')
      expect(res.content).toContain('다시 실행하지')
      expect(res.content).not.toContain('아직 시작하지 않았어요')
    })
  })

  describe('3. Operational Control Commands vs 4-Stage CoT Marketing Consulting', () => {
    it('correctly identifies operational control commands (PAUSE, RESUME, STATUS)', () => {
      expect(isOperationalControlCommand('PAUSE')).toBe(true)
      expect(isOperationalControlCommand('일시 정지해줘')).toBe(true)
      expect(isOperationalControlCommand('지금 바로 멈춰')).toBe(true)
      expect(isOperationalControlCommand('RESUME')).toBe(true)
      expect(isOperationalControlCommand('다시 시작해')).toBe(true)
      expect(isOperationalControlCommand('STATUS')).toBe(true)
      expect(isOperationalControlCommand('현재 가동 상태 조회')).toBe(true)

      // Marketing queries must return false
      expect(isOperationalControlCommand('인스타그램 가을 신메뉴 홍보 피드 작성해줘')).toBe(false)
      expect(isOperationalControlCommand('예약이 줄었는데 마케팅 조언 좀 해줘')).toBe(false)
    })

    it('skips 4-stage marketing CoT and provides concise factual briefing for operational commands', async () => {
      let capturedRequestBody: any = null
      vi.spyOn(global, 'fetch').mockImplementation(async (_url, init: any) => {
        capturedRequestBody = JSON.parse(init.body)
        return {
          ok: true,
          json: async () => ({
            candidates: [{ content: { parts: [{ text: '사장님, 지시하신 대로 자율 가동 업무를 일시 정지(PAUSED)했습니다. 추가 발행이나 예약 변경이 멈춘 상태입니다.' }] } }],
            usageMetadata: { totalTokenCount: 80 },
          }),
        } as any
      })

      const res = await ConversationBrain.generateResponse({
        workspaceId,
        messages: [{ role: 'user', content: '잠깐 멈춰봐. 일시정지해줘.' }],
      })

      // Operational briefing should not have the 4-stage marketing persona
      const systemText = capturedRequestBody.systemInstruction?.parts?.map((p: any) => p.text).join('\n') ?? ''
      expect(systemText).not.toContain('🎯 [1단계: 현상 진단 & 고객 심리 분석]')
      expect(systemText).toContain('운영 제어')

      expect(res.content).not.toContain('🎯 [1단계')
      expect(res.content).not.toContain('💡 [2단계')
      expect(res.content).toContain('일시 정지')
    })
  })
})
