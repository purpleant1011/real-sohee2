import React from 'react'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ProposalCard } from '../proposal-card'
import type { KnowledgeProposal, SoheeGoal } from '../../types'

describe('ProposalCard Component Tests', () => {
  const workspaceId = 'ws-test-123'
  const mockProposal: KnowledgeProposal = {
    id: 'prop-1',
    workspaceId,
    threadId: 'th-1',
    sourceMessageId: 'msg-1',
    category: 'HOURS',
    proposedContent: '매주 월요일은 정기 휴무입니다.',
    evidence: [{ kind: 'owner_statement', sourceId: 'msg-1' }],
    status: 'proposed',
    createdAt: new Date().toISOString(),
  }

  const mockSuggestedGoal: SoheeGoal = {
    id: 'goal-1',
    proposalId: 'prop-goal-1',
    workspaceId,
    title: '단골 고객 재방문율 10% 증대',
    desiredOutcome: '재방문 고객이 늘어 안정적인 매출 유지',
    priority: 'normal',
    status: 'draft',
    version: 1,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('지식 제안 (KnowledgeProposal)', () => {
    it('확정 버튼 클릭 시 성공하면 반영 메시지를 표시하고 onDecided를 호출한다', async () => {
      const onDecided = vi.fn()
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ success: true, data: { status: 'confirmed' } }),
      })

      render(
        <ProposalCard
          workspaceId={workspaceId}
          proposal={mockProposal}
          onDecided={onDecided}
        />
      )

      expect(screen.getByText('“매주 월요일은 정기 휴무입니다.”')).toBeInTheDocument()
      const confirmButton = screen.getByRole('button', { name: /확정/ })
      fireEvent.click(confirmButton)

      await waitFor(() => {
        expect(global.fetch).toHaveBeenCalledWith(
          `/api/workspaces/${workspaceId}/sohee-studio/knowledge-proposals/prop-1/decide`,
          expect.objectContaining({
            method: 'POST',
            body: expect.stringContaining('"decision":"confirm"'),
          })
        )
        expect(screen.getByText(/소희의 두뇌에 안전하게 반영/)).toBeInTheDocument()
        expect(onDecided).toHaveBeenCalled()
      })
    })

    it('HTTP 오류 발생 시 절대 성공을 표시하지 않고 오류 안내 및 다시 시도를 노출한다', async () => {
      const onDecided = vi.fn()
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        json: async () => ({ success: false, error: 'SERVER_ERROR' }),
      })

      render(
        <ProposalCard
          workspaceId={workspaceId}
          proposal={mockProposal}
          onDecided={onDecided}
        />
      )

      const confirmButton = screen.getByRole('button', { name: /확정/ })
      fireEvent.click(confirmButton)

      await waitFor(() => {
        expect(screen.queryByText(/소희의 두뇌에 안전하게 반영/)).not.toBeInTheDocument()
        expect(screen.getByText(/실패|오류/)).toBeInTheDocument()
        expect(onDecided).not.toHaveBeenCalled()
      })
    })

    it('HTTP 200 응답이라도 json.success !== true (예: 빈 객체 {})이면 절대 성공 처리하지 않는다', async () => {
      const onDecided = vi.fn()
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({}), // Missing success: true
      })

      render(
        <ProposalCard
          workspaceId={workspaceId}
          proposal={mockProposal}
          onDecided={onDecided}
        />
      )

      const confirmButton = screen.getByRole('button', { name: /확정/ })
      fireEvent.click(confirmButton)

      await waitFor(() => {
        expect(screen.queryByText(/소희의 두뇌에 안전하게 반영/)).not.toBeInTheDocument()
        expect(screen.getByText(/실패|오류/)).toBeInTheDocument()
        expect(onDecided).not.toHaveBeenCalled()
      })
    })
  })

  describe('목표 제안 (suggestedGoal)', () => {
    it('목표 POST body는 {proposalId}만 전송해야 한다', async () => {
      const onDecided = vi.fn()
      let requestBody: any = null

      global.fetch = vi.fn().mockImplementation((_url: string, init?: any) => {
        requestBody = JSON.parse(init.body)
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({ success: true, data: { id: 'goal-real-1' } }),
        })
      })

      render(
        <ProposalCard
          workspaceId={workspaceId}
          suggestedGoal={mockSuggestedGoal}
          onDecided={onDecided}
        />
      )

      expect(screen.queryByText(/미션 연동/)).not.toBeInTheDocument()

      const saveGoalButton = screen.getByRole('button', { name: /목표로 저장/ })
      fireEvent.click(saveGoalButton)

      await waitFor(() => {
        expect(global.fetch).toHaveBeenCalledWith(
          `/api/workspaces/${workspaceId}/sohee-studio/goals`,
          expect.anything()
        )
        expect(requestBody).toEqual({ proposalId: 'prop-goal-1' })
        expect(screen.getByText(/소희의 두뇌에 안전하게 반영/)).toBeInTheDocument()
        expect(onDecided).toHaveBeenCalled()
      })
    })

    it('목표 저장 실패 시 성공을 표시하지 않고 에러를 표시한다', async () => {
      const onDecided = vi.fn()
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 409,
        json: async () => ({ success: false, error: 'CONFLICT' }),
      })

      render(
        <ProposalCard
          workspaceId={workspaceId}
          suggestedGoal={mockSuggestedGoal}
          onDecided={onDecided}
        />
      )

      const saveGoalButton = screen.getByRole('button', { name: /목표로 저장/ })
      fireEvent.click(saveGoalButton)

      await waitFor(() => {
        expect(screen.queryByText(/소희의 두뇌에 안전하게 반영/)).not.toBeInTheDocument()
        expect(screen.getByText(/실패|오류/)).toBeInTheDocument()
        expect(onDecided).not.toHaveBeenCalled()
      })
    })

    it('목표 제외 버튼 클릭 시 서버에 reject HTTP 요청을 전송하고 성공 시 onDecided를 호출한다', async () => {
      const onDecided = vi.fn()
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ success: true, data: { status: 'rejected' } }),
      })

      render(
        <ProposalCard
          workspaceId={workspaceId}
          suggestedGoal={mockSuggestedGoal}
          onDecided={onDecided}
        />
      )

      const rejectGoalButton = screen.getByRole('button', { name: '제외' })
      fireEvent.click(rejectGoalButton)

      await waitFor(() => {
        expect(global.fetch).toHaveBeenCalledWith(
          `/api/workspaces/${workspaceId}/sohee-studio/knowledge-proposals/prop-goal-1/decide`,
          expect.objectContaining({
            method: 'POST',
            body: expect.stringContaining('"decision":"reject"'),
          })
        )
        expect(screen.getByText(/반영하지 않고 제외했어요/)).toBeInTheDocument()
        expect(onDecided).toHaveBeenCalled()
      })
    })

    it('목표 제외 HTTP 실패 시 제외 성공 상태로 변경되지 않고 에러를 표시한다', async () => {
      const onDecided = vi.fn()
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        json: async () => ({ success: false, error: 'SERVER_ERROR' }),
      })

      render(
        <ProposalCard
          workspaceId={workspaceId}
          suggestedGoal={mockSuggestedGoal}
          onDecided={onDecided}
        />
      )

      const rejectGoalButton = screen.getByRole('button', { name: '제외' })
      fireEvent.click(rejectGoalButton)

      await waitFor(() => {
        expect(screen.queryByText(/반영하지 않고 제외했어요/)).not.toBeInTheDocument()
        expect(screen.getByText(/목표 제외에 실패했습니다/)).toBeInTheDocument()
        expect(onDecided).not.toHaveBeenCalled()
      })
    })
  })
})
