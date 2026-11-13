import { describe, expect, it, vi } from 'vitest'
import { ConversationBrain, formatBlockedResponse, formatUnknownSafeResponse } from '@/lib/ai/conversation-brain'
describe('원인별 차단 복구 안내', () => {
  it('원고 준비 누락을 안전정책 위반으로 말하지 않는다', () => {
    const text = formatBlockedResponse({ errorCode: 'ARTIFACT_REVIEW_REQUIRED', traceId: 'private_trace', reconcileCTA: '' })
    expect(text).toContain('원고')
    expect(text).toContain('/app/work/new')
    expect(text).not.toMatch(/안전 규칙|안전 정책|BLOCKED|private_trace|ARTIFACT_REVIEW_REQUIRED/)
  })
  it('불확실한 결과에 재시도를 권하지 않는다', () => {
    const text = formatUnknownSafeResponse({ errorCode: 'RESULT_UNKNOWN', traceId: 'private_trace', reconcileCTA: '작업을 재시도해 주세요.' })
    expect(text).toContain('다시 실행하지')
    expect(text).not.toContain('재시도해')
  })
  it('첫 성공 도구 뒤의 nested error를 실제 차단 사유로 선택한다', async () => {
    vi.stubEnv('AI_CONVERSATION_PROVIDER', 'openai')
    vi.stubEnv('OPENAI_API_KEY', 'test')
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('offline'))
    const result = await ConversationBrain.generateResponse({ workspaceId: 'ws', messages: [], loopStatus: 'BLOCKED', toolExecutionResults: [{ status: 'COMPLETED' }, { status: 'BLOCKED', error: { code: 'ARTIFACT_REVIEW_REQUIRED', message: 'internal raw message' } }] })
    expect(result.errorCode).toBe('ARTIFACT_REVIEW_REQUIRED')
    expect(result.content).toContain('원고')
    vi.unstubAllEnvs(); vi.restoreAllMocks()
  })
})
