import { describe, expect, it, vi } from 'vitest'
import { INTERVIEW_QUESTIONS } from '../questions'
import { getInterviewProgress } from '../progress-service'

describe('getInterviewProgress', () => {
  const workspaceId = '00000000-0000-0000-0000-000000000001'

  it('workspaceId가 비어있으면 에러를 던진다', async () => {
    await expect(getInterviewProgress('')).rejects.toThrow('workspaceId is required')
    await expect(getInterviewProgress('   ')).rejects.toThrow('workspaceId is required')
  })

  it('DB 조회 실패 시 명확한 에러를 던진다', async () => {
    const mockClient = {
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockResolvedValue({
              data: null,
              error: { message: 'Database connection error' },
            }),
          }),
        }),
      }),
    }

    await expect(getInterviewProgress(workspaceId, mockClient as any)).rejects.toThrow(
      'Database connection error',
    )
  })

  it('답변한 지식이 없으면 progress 0%와 첫 번째 질문 id를 반환한다', async () => {
    const mockClient = {
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockResolvedValue({
              data: [],
              error: null,
            }),
          }),
        }),
      }),
    }

    const result = await getInterviewProgress(workspaceId, mockClient as any)

    expect(result).toEqual({
      totalQuestions: INTERVIEW_QUESTIONS.length,
      answeredQuestionIds: [],
      nextQuestionId: INTERVIEW_QUESTIONS[0].id,
      progressPercent: 0,
      isCompleted: false,
    })
  })

  it('일부 질문에 답변한 경우 진행률과 다음 질문을 올바르게 계산한다', async () => {
    const mockClient = {
      from: vi.fn().mockImplementation((table: string) => {
        if (table === 'knowledge_facts') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                eq: vi.fn().mockResolvedValue({
                  data: [
                    { id: 'fact-1', source_candidate_id: 'cand-1' },
                    { id: 'fact-2', source_candidate_id: 'cand-2' },
                  ],
                  error: null,
                }),
              }),
            }),
          }
        }
        if (table === 'knowledge_candidates') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                in: vi.fn().mockResolvedValue({
                  data: [
                    { id: 'cand-1', source_location: 'interview:q_menu' },
                    { id: 'cand-2', source_location: 'interview:q_price' },
                  ],
                  error: null,
                }),
              }),
            }),
          }
        }
        return {}
      }),
    }

    const result = await getInterviewProgress(workspaceId, mockClient as any)

    expect(result.totalQuestions).toBe(INTERVIEW_QUESTIONS.length)
    expect(result.answeredQuestionIds).toEqual(['q_menu', 'q_price'])
    expect(result.nextQuestionId).toBe('q_hours')
    // 2 / 8 = 25%
    expect(result.progressPercent).toBe(25)
    expect(result.isCompleted).toBe(false)
  })

  it('모든 질문에 답변한 경우 isCompleted가 true이고 nextQuestionId는 null이다', async () => {
    const allAnsweredFacts = INTERVIEW_QUESTIONS.map((q, idx) => ({
      id: `fact-${idx}`,
      source_candidate_id: `cand-${idx}`,
    }))
    const allAnsweredCandidates = INTERVIEW_QUESTIONS.map((q, idx) => ({
      id: `cand-${idx}`,
      source_location: `interview:${q.id}`,
    }))

    const mockClient = {
      from: vi.fn().mockImplementation((table: string) => {
        if (table === 'knowledge_facts') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                eq: vi.fn().mockResolvedValue({
                  data: allAnsweredFacts,
                  error: null,
                }),
              }),
            }),
          }
        }
        if (table === 'knowledge_candidates') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                in: vi.fn().mockResolvedValue({
                  data: allAnsweredCandidates,
                  error: null,
                }),
              }),
            }),
          }
        }
        return {}
      }),
    }

    const result = await getInterviewProgress(workspaceId, mockClient as any)

    expect(result.totalQuestions).toBe(INTERVIEW_QUESTIONS.length)
    expect(result.answeredQuestionIds).toHaveLength(INTERVIEW_QUESTIONS.length)
    expect(result.nextQuestionId).toBeNull()
    expect(result.progressPercent).toBe(100)
    expect(result.isCompleted).toBe(true)
  })

  it('중복 답변이나 interview 형식이 아닌 소스, 유효하지 않은 질문 ID는 걸러낸다', async () => {
    const mockClient = {
      from: vi.fn().mockImplementation((table: string) => {
        if (table === 'knowledge_facts') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                eq: vi.fn().mockResolvedValue({
                  data: [
                    { id: 'fact-1', source_candidate_id: 'cand-1' },
                    { id: 'fact-2', source_candidate_id: 'cand-2' },
                    { id: 'fact-3', source_candidate_id: 'cand-3' },
                    { id: 'fact-4', source_candidate_id: 'cand-4' },
                    { id: 'fact-5', source_candidate_id: null },
                  ],
                  error: null,
                }),
              }),
            }),
          }
        }
        if (table === 'knowledge_candidates') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                in: vi.fn().mockResolvedValue({
                  data: [
                    { id: 'cand-1', source_location: 'interview:q_menu' },
                    { id: 'cand-2', source_location: 'interview:q_menu' }, // 중복
                    { id: 'cand-3', source_location: 'interview:invalid_non_existent' }, // 미등록 질문
                    { id: 'cand-4', source_location: 'manual_upload:file.pdf' }, // 다른 소스
                  ],
                  error: null,
                }),
              }),
            }),
          }
        }
        return {}
      }),
    }

    const result = await getInterviewProgress(workspaceId, mockClient as any)

    expect(result.answeredQuestionIds).toEqual(['q_menu'])
    expect(result.nextQuestionId).toBe('q_price')
    expect(result.progressPercent).toBe(13)
  })
})
