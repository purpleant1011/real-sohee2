import React from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { INTERVIEW_QUESTIONS, summarizeAnswer } from '@/features/sohee-interview/questions'
import { InterviewEngine } from '../components/interview-engine'

describe('InterviewEngine', () => {
  const workspaceId = '00000000-0000-0000-0000-000000000001'
  let mockFetch: ReturnType<typeof vi.fn>

  beforeEach(() => {
    mockFetch = vi.fn().mockImplementation(async (url: string) => {
      if (url.includes('/knowledge/interview/progress')) {
        return {
          ok: true,
          json: async () => ({
            success: true,
            data: {
              totalQuestions: 8,
              answeredQuestionIds: [],
              nextQuestionId: 'q_menu',
              progressPercent: 0,
              isCompleted: false,
            },
          }),
        }
      }
      return {
        ok: true,
        json: async () => ({
          success: true,
          factId: 'fact-1',
          category: 'MENU',
          content: '대표 메뉴는 [시그니처 라떼]입니다.',
        }),
      }
    })
    vi.stubGlobal('fetch', mockFetch)
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('첫 번째 질문과 진행 표시(1/8)를 보여준다', () => {
    render(<InterviewEngine workspaceId={workspaceId} onFactConfirmed={vi.fn()} />)

    expect(screen.getByText('1/8')).toBeInTheDocument()
    expect(screen.getByText(INTERVIEW_QUESTIONS[0].prompt)).toBeInTheDocument()
    for (const chip of INTERVIEW_QUESTIONS[0].chips) {
      expect(screen.getByRole('button', { name: chip })).toBeInTheDocument()
    }
  })

  it('선택 칩을 누르면 입력창에 해당 텍스트가 반영된다', () => {
    render(<InterviewEngine workspaceId={workspaceId} onFactConfirmed={vi.fn()} />)

    const firstChip = INTERVIEW_QUESTIONS[0].chips[0]
    fireEvent.click(screen.getByRole('button', { name: firstChip }))

    const input = screen.getByRole('textbox') as HTMLInputElement
    expect(input.value).toBe(firstChip)
  })

  it('답변을 입력하고 전송하면 "이렇게 이해했어요" 확인 카드가 노출된다', () => {
    render(<InterviewEngine workspaceId={workspaceId} onFactConfirmed={vi.fn()} />)

    const input = screen.getByRole('textbox')
    fireEvent.change(input, { target: { value: '수제 크루아상' } })
    fireEvent.click(screen.getByRole('button', { name: '알려주기' }))

    expect(screen.getByText('이렇게 이해했어요')).toBeInTheDocument()
    const expectedSummary = summarizeAnswer(INTERVIEW_QUESTIONS[0], '수제 크루아상')
    expect(screen.getByText(expectedSummary)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '맞아요' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '고칠래요' })).toBeInTheDocument()
  })

  it('[맞아요]를 누르면 confirm API를 호출하고 성공 시 다음 질문으로 이동하며 onFactConfirmed를 부른다', async () => {
    const onFactConfirmed = vi.fn()
    render(<InterviewEngine workspaceId={workspaceId} onFactConfirmed={onFactConfirmed} />)

    const input = screen.getByRole('textbox')
    fireEvent.change(input, { target: { value: '수제 크루아상' } })
    fireEvent.click(screen.getByRole('button', { name: '알려주기' }))

    fireEvent.click(screen.getByRole('button', { name: '맞아요' }))

    await waitFor(() => {
      expect(onFactConfirmed).toHaveBeenCalledTimes(1)
      expect(screen.getByText('2/8')).toBeInTheDocument()
      expect(screen.getByText(INTERVIEW_QUESTIONS[1].prompt)).toBeInTheDocument()
    })

    expect(mockFetch).toHaveBeenCalledWith(
      `/api/workspaces/${workspaceId}/knowledge/interview/confirm`,
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          questionId: INTERVIEW_QUESTIONS[0].id,
          rawAnswer: '수제 크루아상',
        }),
      }),
    )
  })

  it('[고칠래요]를 누르면 확인 카드가 닫히고 입력창으로 복원된다', () => {
    render(<InterviewEngine workspaceId={workspaceId} onFactConfirmed={vi.fn()} />)

    const input = screen.getByRole('textbox')
    fireEvent.change(input, { target: { value: '수제 크루아상' } })
    fireEvent.click(screen.getByRole('button', { name: '알려주기' }))

    expect(screen.getByText('이렇게 이해했어요')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '고칠래요' }))

    expect(screen.queryByText('이렇게 이해했어요')).not.toBeInTheDocument()
    const restoredInput = screen.getByRole('textbox') as HTMLInputElement
    expect(restoredInput.value).toBe('수제 크루아상')
  })

  it('[건너뛰기]를 누르면 다음 질문으로 바로 이동한다', () => {
    render(<InterviewEngine workspaceId={workspaceId} onFactConfirmed={vi.fn()} />)

    expect(screen.getByText('1/8')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '건너뛰기' }))

    expect(screen.getByText('2/8')).toBeInTheDocument()
    expect(screen.getByText(INTERVIEW_QUESTIONS[1].prompt)).toBeInTheDocument()
  })

  it('모든 질문을 완료하거나 건너뛰면 완료 안내를 보여준다', () => {
    render(<InterviewEngine workspaceId={workspaceId} onFactConfirmed={vi.fn()} />)

    for (let i = 0; i < INTERVIEW_QUESTIONS.length; i++) {
      fireEvent.click(screen.getByRole('button', { name: '건너뛰기' }))
    }

    expect(screen.getByText('모든 인터뷰 질문을 마쳤어요')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '건너뛰기' })).not.toBeInTheDocument()
  })

  it('API 호출 실패 시 친절한 안내 문구를 보여주고 재시도할 수 있다', async () => {
    mockFetch.mockImplementation(async (url: string) => {
      if (url.includes('/knowledge/interview/progress')) {
        return {
          ok: true,
          json: async () => ({
            success: true,
            data: {
              totalQuestions: 8,
              answeredQuestionIds: [],
              nextQuestionId: 'q_menu',
              progressPercent: 0,
              isCompleted: false,
            },
          }),
        }
      }
      return {
        ok: false,
        json: async () => ({
          success: false,
          message: '일시적인 오류가 발생했습니다.',
        }),
      }
    })

    render(<InterviewEngine workspaceId={workspaceId} onFactConfirmed={vi.fn()} />)

    const input = screen.getByRole('textbox')
    fireEvent.change(input, { target: { value: '수제 크루아상' } })
    fireEvent.click(screen.getByRole('button', { name: '알려주기' }))
    fireEvent.click(screen.getByRole('button', { name: '맞아요' }))

    await waitFor(() => {
      expect(screen.getByText(/저장하지 못했어요/)).toBeInTheDocument()
    })

    // 재시도 시 성공 설정
    mockFetch.mockImplementation(async (url: string) => {
      if (url.includes('/knowledge/interview/progress')) {
        return {
          ok: true,
          json: async () => ({
            success: true,
            data: {
              totalQuestions: 8,
              answeredQuestionIds: [],
              nextQuestionId: 'q_menu',
              progressPercent: 0,
              isCompleted: false,
            },
          }),
        }
      }
      return {
        ok: true,
        json: async () => ({
          success: true,
          factId: 'fact-1',
        }),
      }
    })

    fireEvent.click(screen.getByRole('button', { name: '다시 시도' }))

    await waitFor(() => {
      expect(screen.getByText('2/8')).toBeInTheDocument()
    })
  })

  it('마운트 시 진행 상태를 조회하여 이미 답변한 질문(q_menu, q_price)을 건너뛰고 다음 질문(q_hours)을 띄운다', async () => {
    mockFetch.mockImplementation(async (url: string) => {
      if (url.includes('/knowledge/interview/progress')) {
        return {
          ok: true,
          json: async () => ({
            success: true,
            data: {
              totalQuestions: 8,
              answeredQuestionIds: ['q_menu', 'q_price'],
              nextQuestionId: 'q_hours',
              progressPercent: 25,
              isCompleted: false,
            },
          }),
        }
      }
      return { ok: true, json: async () => ({ success: true }) }
    })

    render(<InterviewEngine workspaceId={workspaceId} onFactConfirmed={vi.fn()} />)

    await waitFor(() => {
      expect(screen.getByText('3/8')).toBeInTheDocument()
      expect(screen.getByText(INTERVIEW_QUESTIONS[2].prompt)).toBeInTheDocument()
    })
  })

  it('모든 질문이 답변 완료 상태일 때 마운트 시 완료 화면을 보여준다', async () => {
    mockFetch.mockImplementation(async (url: string) => {
      if (url.includes('/knowledge/interview/progress')) {
        return {
          ok: true,
          json: async () => ({
            success: true,
            data: {
              totalQuestions: 8,
              answeredQuestionIds: INTERVIEW_QUESTIONS.map((q) => q.id),
              nextQuestionId: null,
              progressPercent: 100,
              isCompleted: true,
            },
          }),
        }
      }
      return { ok: true, json: async () => ({ success: true }) }
    })

    render(<InterviewEngine workspaceId={workspaceId} onFactConfirmed={vi.fn()} />)

    await waitFor(() => {
      expect(screen.getByText('모든 인터뷰 질문을 마쳤어요')).toBeInTheDocument()
    })
  })

  it('상단 질문 인디케이터 칩을 클릭하여 특정 질문으로 자유롭게 이동할 수 있다', async () => {
    render(<InterviewEngine workspaceId={workspaceId} onFactConfirmed={vi.fn()} />)

    expect(screen.getByText('1/8')).toBeInTheDocument()

    const chip4 = screen.getByRole('button', { name: '질문 4' })
    fireEvent.click(chip4)

    expect(screen.getByText('4/8')).toBeInTheDocument()
    expect(screen.getByText(INTERVIEW_QUESTIONS[3].prompt)).toBeInTheDocument()
  })

  it('답변 저장 성공 후 다음 미답변 질문으로 스마트 이동한다', async () => {
    mockFetch.mockImplementation(async (url: string) => {
      if (url.includes('/knowledge/interview/progress')) {
        return {
          ok: true,
          json: async () => ({
            success: true,
            data: {
              totalQuestions: 8,
              answeredQuestionIds: ['q_price'],
              nextQuestionId: 'q_menu',
              progressPercent: 13,
              isCompleted: false,
            },
          }),
        }
      }
      if (url.includes('/knowledge/interview/confirm')) {
        return {
          ok: true,
          json: async () => ({
            success: true,
            factId: 'fact-menu',
          }),
        }
      }
      return { ok: true, json: async () => ({ success: true }) }
    })

    render(<InterviewEngine workspaceId={workspaceId} onFactConfirmed={vi.fn()} />)

    await waitFor(() => {
      expect(screen.getByText('1/8')).toBeInTheDocument()
    })

    const input = screen.getByRole('textbox')
    fireEvent.change(input, { target: { value: '시그니처 바닐라 라떼' } })
    fireEvent.click(screen.getByRole('button', { name: '알려주기' }))
    fireEvent.click(screen.getByRole('button', { name: '맞아요' }))

    // q_price는 이미 답했으므로 q_hours(3번째 질문, 3/8)로 건너뛰어 이동
    await waitFor(() => {
      expect(screen.getByText('3/8')).toBeInTheDocument()
      expect(screen.getByText(INTERVIEW_QUESTIONS[2].prompt)).toBeInTheDocument()
    })
  })

  it('완료 화면에서도 인디케이터 칩을 클릭하여 이전 질문을 다시 확인할 수 있다', async () => {
    mockFetch.mockImplementation(async (url: string) => {
      if (url.includes('/knowledge/interview/progress')) {
        return {
          ok: true,
          json: async () => ({
            success: true,
            data: {
              totalQuestions: 8,
              answeredQuestionIds: INTERVIEW_QUESTIONS.map((q) => q.id),
              nextQuestionId: null,
              progressPercent: 100,
              isCompleted: true,
            },
          }),
        }
      }
      return { ok: true, json: async () => ({ success: true }) }
    })

    render(<InterviewEngine workspaceId={workspaceId} onFactConfirmed={vi.fn()} />)

    await waitFor(() => {
      expect(screen.getByText('모든 인터뷰 질문을 마쳤어요')).toBeInTheDocument()
    })

    const chip1 = screen.getByRole('button', { name: '질문 1' })
    fireEvent.click(chip1)

    expect(screen.getByText('1/8')).toBeInTheDocument()
    expect(screen.getByText(INTERVIEW_QUESTIONS[0].prompt)).toBeInTheDocument()
  })
})
