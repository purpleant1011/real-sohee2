import React from 'react'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { BrainCuriosityTab } from '../brain-curiosity-tab'
import type { CuriosityItem } from '../../types'

describe('BrainCuriosityTab Component Tests', () => {
  const workspaceId = 'ws-test-123'
  const onAnswerQuestion = vi.fn()

  const mockQuestions: CuriosityItem[] = [
    {
      id: 'q-1',
      workspaceId,
      kind: 'missing',
      question: '주차 지원 여부를 알고 싶어요',
      reason: '고객 방문 문의 대비',
      expectedOutcome: '안내 정확도 향상',
      relatedFactIds: [],
      evidence: [],
      status: 'open',
      priority: 'important',
      createdAt: new Date().toISOString(),
    },
  ]

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('1. 나중에(snooze) 클릭 시 성공해야만 해당 질문이 목록에서 제거된다', async () => {
    let postBody: any = null
    global.fetch = vi.fn().mockImplementation((url: string, init?: any) => {
      if (init?.method === 'POST') {
        postBody = JSON.parse(init.body)
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({ success: true, data: { status: 'snoozed' } }),
        })
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({ success: true, data: mockQuestions }),
      })
    })

    render(
      <BrainCuriosityTab
        workspaceId={workspaceId}
        onAnswerQuestion={onAnswerQuestion}
      />
    )

    await waitFor(() => {
      expect(screen.getByText('“주차 지원 여부를 알고 싶어요”')).toBeInTheDocument()
    })

    const snoozeButton = screen.getByRole('button', { name: /나중에/ })
    fireEvent.click(snoozeButton)

    await waitFor(() => {
      expect(postBody).toEqual({ status: 'snoozed' })
      expect(screen.queryByText('“주차 지원 여부를 알고 싶어요”')).not.toBeInTheDocument()
    })
  })

  it('2. snooze 실패 시 목록에서 질문을 삭제하지 않고 에러를 표시한다', async () => {
    global.fetch = vi.fn().mockImplementation((_url: string, init?: any) => {
      if (init?.method === 'POST') {
        return Promise.resolve({
          ok: false,
          status: 500,
          json: async () => ({ success: false, error: 'SERVER_ERROR' }),
        })
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({ success: true, data: mockQuestions }),
      })
    })

    render(
      <BrainCuriosityTab
        workspaceId={workspaceId}
        onAnswerQuestion={onAnswerQuestion}
      />
    )

    await waitFor(() => {
      expect(screen.getByText('“주차 지원 여부를 알고 싶어요”')).toBeInTheDocument()
    })

    const snoozeButton = screen.getByRole('button', { name: /나중에/ })
    fireEvent.click(snoozeButton)

    await waitFor(() => {
      expect(screen.getByText('“주차 지원 여부를 알고 싶어요”')).toBeInTheDocument()
      expect(screen.getByText(/보류 처리에 실패/)).toBeInTheDocument()
    })
  })

  it('3. 질문 조회 실패 시 빈 목록이 아닌 오류 메시지와 다시 시도 버튼을 노출한다', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({ success: false, error: 'DB_ERROR' }),
    })

    render(
      <BrainCuriosityTab
        workspaceId={workspaceId}
        onAnswerQuestion={onAnswerQuestion}
      />
    )

    await waitFor(() => {
      expect(screen.getByText(/질문 목록을 불러오지 못했습니다/)).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /다시 시도/ })).toBeInTheDocument()
    })
  })
})
