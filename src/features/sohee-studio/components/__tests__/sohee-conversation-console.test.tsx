import React from 'react'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { SoheeConversationConsole } from '../sohee-conversation-console'
import type { CuriosityItem, KnowledgeView, StudioTurnMessage } from '../../types'

describe('SoheeConversationConsole Component Tests', () => {
  const workspaceId = 'ws-test-123'
  const onFactOrGoalConfirmed = vi.fn()

  const mockExistingTurns: StudioTurnMessage[] = [
    {
      id: 'turn-1',
      sender: 'user',
      content: '영업 시간은 매일 오전 10시부터 오후 8시까지야.',
      timestamp: new Date().toISOString(),
      clientMessageId: 'client-msg-1',
      status: 'completed',
    },
    {
      id: 'turn-2',
      sender: 'sohee',
      content: '네, 영업 시간을 매일 오전 10시~오후 8시로 기억해 둘게요!',
      timestamp: new Date().toISOString(),
      status: 'completed',
    },
  ]

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('1. 마운트 시 GET /turns를 호출하여 이전 대화 턴을 복원한다', async () => {
    global.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes('/sohee-studio/turns')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({ success: true, data: mockExistingTurns }),
        })
      }
      return Promise.resolve({ ok: true, status: 200, json: async () => ({}) })
    })

    render(
      <SoheeConversationConsole
        workspaceId={workspaceId}
        onFactOrGoalConfirmed={onFactOrGoalConfirmed}
      />
    )

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        `/api/workspaces/${workspaceId}/sohee-studio/turns`
      )
      expect(
        screen.getByText('영업 시간은 매일 오전 10시부터 오후 8시까지야.')
      ).toBeInTheDocument()
      expect(
        screen.getByText('네, 영업 시간을 매일 오전 10시~오후 8시로 기억해 둘게요!')
      ).toBeInTheDocument()
    })
  })

  it('2. 메시지 전송 시 UUID clientMessageId와 기본 teach focus를 전달한다', async () => {
    let postBody: any = null
    global.fetch = vi.fn().mockImplementation((url: string, init?: any) => {
      if (url.includes('/sohee-studio/turns')) {
        if (init?.method === 'POST') {
          postBody = JSON.parse(init.body)
          return Promise.resolve({
            ok: true,
            status: 200,
            json: async () => ({
              success: true,
              data: {
                id: 'turn-sohee-new',
                sender: 'sohee',
                content: '잘 알겠습니다 사장님!',
                timestamp: new Date().toISOString(),
                status: 'completed',
              },
            }),
          })
        }
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({ success: true, data: [] }),
        })
      }
      return Promise.resolve({ ok: true, status: 200, json: async () => ({}) })
    })

    render(
      <SoheeConversationConsole
        workspaceId={workspaceId}
        onFactOrGoalConfirmed={onFactOrGoalConfirmed}
      />
    )

    await waitFor(() => {
      expect(screen.getByPlaceholderText(/소희에게 무엇이든 말해보세요/)).toBeInTheDocument()
    })

    const input = screen.getByPlaceholderText(/소희에게 무엇이든 말해보세요/)
    fireEvent.change(input, { target: { value: '주차 공간이 2대 가능해.' } })

    const sendButton = screen.getByRole('button', { name: /전송/ })
    fireEvent.click(sendButton)

    await waitFor(() => {
      expect(postBody).not.toBeNull()
      expect(postBody.content).toBe('주차 공간이 2대 가능해.')
      expect(postBody.clientMessageId).toBeDefined()
      expect(postBody.focus).toBe('teach')
      expect(screen.getByText('잘 알겠습니다 사장님!')).toBeInTheDocument()
    })
  })

  it('3. 호기심 질문에 답변할 때는 focus curiosity와 relatedEntityId를 전달한다', async () => {
    let postBody: any = null
    const mockCuriosity: CuriosityItem = {
      id: 'q-123',
      workspaceId,
      kind: 'missing',
      question: '주차 지원 여부를 알고 싶어요',
      reason: '고객 문의 빈발',
      expectedOutcome: '안내 정확도 상승',
      relatedFactIds: [],
      evidence: [],
      status: 'open',
      priority: 'important',
      createdAt: new Date().toISOString(),
    }

    global.fetch = vi.fn().mockImplementation((url: string, init?: any) => {
      if (url.includes('/sohee-studio/turns')) {
        if (init?.method === 'POST') {
          postBody = JSON.parse(init.body)
          return Promise.resolve({
            ok: true,
            status: 200,
            json: async () => ({
              success: true,
              data: {
                id: 'turn-reply-q',
                sender: 'sohee',
                content: '주차 정보 접수 완료했어요!',
                timestamp: new Date().toISOString(),
                status: 'completed',
              },
            }),
          })
        }
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({ success: true, data: [] }),
        })
      }
      return Promise.resolve({ ok: true, status: 200, json: async () => ({}) })
    })

    const onClearCuriosity = vi.fn()
    render(
      <SoheeConversationConsole
        workspaceId={workspaceId}
        onFactOrGoalConfirmed={onFactOrGoalConfirmed}
        selectedCuriosityForAnswer={mockCuriosity}
        onClearSelectedCuriosity={onClearCuriosity}
      />
    )

    const sendButton = screen.getByRole('button', { name: /전송/ })
    fireEvent.click(sendButton)

    await waitFor(() => {
      expect(postBody).not.toBeNull()
      expect(postBody.focus).toBe('curiosity')
      expect(postBody.relatedEntityId).toBe('q-123')
      expect(onClearCuriosity).toHaveBeenCalled()
    })
  })

  it('4. 잘못된 지식 교정 시에는 focus inspect와 relatedEntityId를 전달한다', async () => {
    let postBody: any = null
    const mockFact: KnowledgeView = {
      id: 'fact-456',
      category: 'PRICE',
      content: '기본 요금 10,000원',
      status: 'active',
      source: { kind: 'owner_statement', sourceId: 'src-1' },
      approvedAt: new Date().toISOString(),
      validFrom: new Date().toISOString(),
      usedBy: ['content'],
      createdAt: new Date().toISOString(),
      versionTimestamp: new Date().toISOString(),
    }

    global.fetch = vi.fn().mockImplementation((url: string, init?: any) => {
      if (url.includes('/sohee-studio/turns')) {
        if (init?.method === 'POST') {
          postBody = JSON.parse(init.body)
          return Promise.resolve({
            ok: true,
            status: 200,
            json: async () => ({
              success: true,
              data: {
                id: 'turn-reply-inspect',
                sender: 'sohee',
                content: '수정 반영 제안을 생성했어요.',
                timestamp: new Date().toISOString(),
                status: 'completed',
              },
            }),
          })
        }
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({ success: true, data: [] }),
        })
      }
      return Promise.resolve({ ok: true, status: 200, json: async () => ({}) })
    })

    const onClearCorrection = vi.fn()
    render(
      <SoheeConversationConsole
        workspaceId={workspaceId}
        onFactOrGoalConfirmed={onFactOrGoalConfirmed}
        selectedKnowledgeForCorrection={mockFact}
        onClearSelectedCorrection={onClearCorrection}
      />
    )

    const sendButton = screen.getByRole('button', { name: /전송/ })
    fireEvent.click(sendButton)

    await waitFor(() => {
      expect(postBody).not.toBeNull()
      expect(postBody.focus).toBe('inspect')
      expect(postBody.relatedEntityId).toBe('fact-456')
      expect(onClearCorrection).toHaveBeenCalled()
    })
  })

  it('5. 요청 실패 시 원문이 보존되고 다시 시도 버튼을 통해 재전송할 수 있다', async () => {
    let callCount = 0
    global.fetch = vi.fn().mockImplementation((url: string, init?: any) => {
      if (url.includes('/sohee-studio/turns')) {
        if (init?.method === 'POST') {
          callCount++
          if (callCount === 1) {
            return Promise.resolve({
              ok: false,
              status: 503,
              json: async () => ({ success: false, error: 'AI_UNAVAILABLE' }),
            })
          }
          return Promise.resolve({
            ok: true,
            status: 200,
            json: async () => ({
              success: true,
              data: {
                id: 'turn-success-retry',
                sender: 'sohee',
                content: '재시도 성공!',
                timestamp: new Date().toISOString(),
                status: 'completed',
              },
            }),
          })
        }
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({ success: true, data: [] }),
        })
      }
      return Promise.resolve({ ok: true, status: 200, json: async () => ({}) })
    })

    render(
      <SoheeConversationConsole
        workspaceId={workspaceId}
        onFactOrGoalConfirmed={onFactOrGoalConfirmed}
      />
    )

    await waitFor(() => {
      expect(screen.getByPlaceholderText(/소희에게 무엇이든 말해보세요/)).toBeInTheDocument()
    })

    const input = screen.getByPlaceholderText(/소희에게 무엇이든 말해보세요/)
    fireEvent.change(input, { target: { value: '네트워크 에러 테스트' } })
    fireEvent.click(screen.getByRole('button', { name: /전송/ }))

    await waitFor(() => {
      expect(screen.getByText('네트워크 에러 테스트')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /다시 시도/ })).toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole('button', { name: /다시 시도/ }))

    await waitFor(() => {
      expect(callCount).toBe(2)
      expect(screen.getByText('재시도 성공!')).toBeInTheDocument()
    })
  })

  it('6. goalRequestToken 변경 시 목표 지시 프리셋이 입력되고 focus가 goal로 설정된다', async () => {
    let postBody: any = null
    global.fetch = vi.fn().mockImplementation((url: string, init?: any) => {
      if (url.includes('/sohee-studio/turns')) {
        if (init?.method === 'POST') {
          postBody = JSON.parse(init.body)
          return Promise.resolve({
            ok: true,
            status: 200,
            json: async () => ({
              success: true,
              data: {
                id: 'turn-goal-reply',
                sender: 'sohee',
                content: '목표 접수 완료!',
                status: 'completed',
              },
            }),
          })
        }
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({ success: true, data: [] }),
        })
      }
      return Promise.resolve({ ok: true, status: 200, json: async () => ({}) })
    })

    const { rerender } = render(
      <SoheeConversationConsole
        workspaceId={workspaceId}
        onFactOrGoalConfirmed={onFactOrGoalConfirmed}
        goalRequestToken={0}
      />
    )

    const textarea = screen.getByRole('textbox', { name: /소희에게 메시지 입력/ })
    expect((textarea as HTMLTextAreaElement).value).toBe('')

    // goalRequestToken 증가 시 prefill 설정
    rerender(
      <SoheeConversationConsole
        workspaceId={workspaceId}
        onFactOrGoalConfirmed={onFactOrGoalConfirmed}
        goalRequestToken={1}
      />
    )

    expect((textarea as HTMLTextAreaElement).value).toContain('이번 달에는 이런 목표를 꼭 달성하고 싶어:')

    // 추가 입력 후 전송 시 focus: 'goal' 전달 검증
    fireEvent.change(textarea, {
      target: { value: '이번 달에는 이런 목표를 꼭 달성하고 싶어: 신규 예약 30% 증가' },
    })
    fireEvent.click(screen.getByRole('button', { name: /전송/ }))

    await waitFor(() => {
      expect(postBody).not.toBeNull()
      expect(postBody.focus).toBe('goal')
      expect(postBody.content).toContain('신규 예약 30% 증가')
    })
  })
})
