import { describe, expect, it, vi } from 'vitest'
import { answerFirstTurn } from './first-reply'

describe('첫 질문 보장 응답', () => {
  it('20개 신규 대화에서 모델 성공·타임아웃·DB 쓰기 실패에도 응답하며 실패를 성공으로 가장하지 않는다', async () => {
    for (let i = 0; i < 20; i++) {
      const result = await answerFirstTurn({
        answer: i % 3 === 0 ? async () => '정상 답변' : async () => { throw Object.assign(new Error('injected'), { code: i % 3 === 1 ? '42501' : 'TIMEOUT' }) },
      })
      if (i % 3 === 0) {
        expect(result).toEqual({ content: '정상 답변', fallback: false, suggestedQuestions: [] })
      } else {
        expect(result.fallback).toBe(true)
        expect(result.content).toContain('잠시 후 다시')
        expect(result.content).toContain('문의하기')
        expect(result.content).toContain('소희가 할 수 있는 일')
        expect(result.suggestedQuestions).toHaveLength(3)
        expect(result.content).not.toContain('injected')
      }
    }
  })

  it('빈 답과 멈춘 모델도 제한 시간에 정적 안내를 반환한다', async () => {
    vi.useFakeTimers()
    try {
      const pending = answerFirstTurn({ answer: () => new Promise<string>(() => {}), timeoutMs: 100 })
      await vi.advanceTimersByTimeAsync(100)
      expect((await pending).fallback).toBe(true)
      expect((await answerFirstTurn({ answer: async () => '  ' })).fallback).toBe(true)
    } finally { vi.useRealTimers() }
  })
})
