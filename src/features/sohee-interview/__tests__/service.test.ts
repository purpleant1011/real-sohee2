import { describe, expect, it, vi } from 'vitest'
import { confirmInterviewFact } from '../service'
import type { ConfirmInterviewFactInput } from '../types'

describe('confirmInterviewFact', () => {
  const validInput: ConfirmInterviewFactInput = {
    workspaceId: 'ws-test-123',
    userId: 'user-owner-1',
    questionId: 'q_menu',
    category: 'MENU',
    key: 'menu',
    rawAnswer: '수제 크루아상, 드립 커피',
    summarizedContent: '대표 메뉴는 [수제 크루아상, 드립 커피]입니다.',
  }

  it('필수 입력값이 누락되면 에러를 던진다', async () => {
    const mockClient = { rpc: vi.fn() }

    await expect(
      confirmInterviewFact({ ...validInput, workspaceId: '', client: mockClient as any }),
    ).rejects.toThrow('workspaceId is required')

    await expect(
      confirmInterviewFact({ ...validInput, userId: '', client: mockClient as any }),
    ).rejects.toThrow('userId is required')

    await expect(
      confirmInterviewFact({ ...validInput, category: '', client: mockClient as any }),
    ).rejects.toThrow('category is required')

    await expect(
      confirmInterviewFact({ ...validInput, summarizedContent: '', client: mockClient as any }),
    ).rejects.toThrow('summarizedContent is required')

    expect(mockClient.rpc).not.toHaveBeenCalled()
  })

  it('RPC를 올바른 인자로 단일 호출하고 성공 시 factId를 반환한다', async () => {
    const mockRpc = vi.fn().mockResolvedValue({
      data: 'fact-uuid-1234',
      error: null,
    })
    const mockClient = { rpc: mockRpc }

    const result = await confirmInterviewFact({
      ...validInput,
      client: mockClient as any,
    })

    expect(mockRpc).toHaveBeenCalledTimes(1)
    expect(mockRpc).toHaveBeenCalledWith('confirm_interview_fact', {
      p_workspace_id: 'ws-test-123',
      p_user_id: 'user-owner-1',
      p_question_id: 'q_menu',
      p_category: 'MENU',
      p_key: 'menu',
      p_raw_answer: '수제 크루아상, 드립 커피',
      p_content: '대표 메뉴는 [수제 크루아상, 드립 커피]입니다.',
    })

    expect(result).toEqual({
      factId: 'fact-uuid-1234',
      category: 'MENU',
      content: '대표 메뉴는 [수제 크루아상, 드립 커피]입니다.',
    })
  })

  it('content 12000자, rawAnswer 2000자, category 120자 제한을 초과하면 잘라서 RPC에 전달한다', async () => {
    const mockRpc = vi.fn().mockResolvedValue({
      data: 'fact-uuid-5678',
      error: null,
    })
    const mockClient = { rpc: mockRpc }

    const longCategory = 'C'.repeat(200)
    const longContent = 'A'.repeat(15000)
    const longAnswer = 'B'.repeat(3000)

    const result = await confirmInterviewFact({
      ...validInput,
      category: longCategory,
      rawAnswer: longAnswer,
      summarizedContent: longContent,
      client: mockClient as any,
    })

    expect(mockRpc).toHaveBeenCalledTimes(1)
    const calledArgs = mockRpc.mock.calls[0][1]
    expect(calledArgs.p_category).toHaveLength(120)
    expect(calledArgs.p_content).toHaveLength(12000)
    expect(calledArgs.p_raw_answer).toHaveLength(2000)

    expect(result.category).toHaveLength(120)
    expect(result.content).toHaveLength(12000)
  })

  it('RPC 호출이 에러를 반환하면 에러 메시지를 포함하여 예외를 던진다', async () => {
    const mockRpc = vi.fn().mockResolvedValue({
      data: null,
      error: { message: 'db transaction deadlocked' },
    })
    const mockClient = { rpc: mockRpc }

    await expect(
      confirmInterviewFact({ ...validInput, client: mockClient as any }),
    ).rejects.toThrow('confirm_interview_fact_failed: db transaction deadlocked')
  })

  it('RPC 응답에 data가 없으면 실패 예외를 던진다', async () => {
    const mockRpc = vi.fn().mockResolvedValue({
      data: null,
      error: null,
    })
    const mockClient = { rpc: mockRpc }

    await expect(
      confirmInterviewFact({ ...validInput, client: mockClient as any }),
    ).rejects.toThrow('confirm_interview_fact_failed: unknown error')
  })
})
