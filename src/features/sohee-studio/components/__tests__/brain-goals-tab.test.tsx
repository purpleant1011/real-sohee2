import React from 'react'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { BrainGoalsTab } from '../brain-goals-tab'
import type { SoheeGoal } from '../../types'

describe('BrainGoalsTab Component Tests', () => {
  const workspaceId = 'ws-test-123'
  const onTellGoal = vi.fn()

  const mockGoals: SoheeGoal[] = [
    {
      id: 'goal-1',
      workspaceId,
      title: '단골 고객 만족도 제고',
      desiredOutcome: '재방문 주기 단축 및 긍정 후기 증가',
      priority: 'high',
      status: 'active',
      version: 2,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
  ]

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('1. 목표 카드에 미션 연동이나 캠페인 가동 중 등의 허위 주장이 없어야 한다', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ success: true, data: mockGoals }),
    })

    render(
      <BrainGoalsTab workspaceId={workspaceId} onTellGoal={onTellGoal} />
    )

    await waitFor(() => {
      expect(screen.getByText('단골 고객 만족도 제고')).toBeInTheDocument()
    })

    expect(screen.queryByText(/미션 연동/)).not.toBeInTheDocument()
    expect(screen.queryByText(/가동 중/)).not.toBeInTheDocument()
    expect(screen.queryByText(/핵심 미션/)).not.toBeInTheDocument()
  })

  it('2. 일시중지 버튼 클릭 시 PATCH /goals/:id에 expectedVersion과 status: paused를 전달한다', async () => {
    let patchUrl = ''
    let patchBody: any = null

    global.fetch = vi.fn().mockImplementation((url: string, init?: any) => {
      if (init?.method === 'PATCH') {
        patchUrl = url
        patchBody = JSON.parse(init.body)
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({
            success: true,
            data: { ...mockGoals[0], status: 'paused', version: 3 },
          }),
        })
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({ success: true, data: mockGoals }),
      })
    })

    render(
      <BrainGoalsTab workspaceId={workspaceId} onTellGoal={onTellGoal} />
    )

    await waitFor(() => {
      expect(screen.getByText('단골 고객 만족도 제고')).toBeInTheDocument()
    })

    const pauseButton = screen.getByRole('button', { name: /일시중지/ })
    fireEvent.click(pauseButton)

    await waitFor(() => {
      expect(patchUrl).toBe(`/api/workspaces/${workspaceId}/sohee-studio/goals/goal-1`)
      expect(patchBody).toEqual(
        expect.objectContaining({
          expectedVersion: 2,
          status: 'paused',
        })
      )
    })
  })

  it('3. 목표 조회 실패 시 빈 목록이 아니라 오류 메시지와 다시 시도 버튼을 노출한다', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({ success: false, error: 'DB_ERROR' }),
    })

    render(
      <BrainGoalsTab workspaceId={workspaceId} onTellGoal={onTellGoal} />
    )

    await waitFor(() => {
      expect(screen.getByText(/목표 목록을 불러오지 못했습니다/)).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /다시 시도/ })).toBeInTheDocument()
    })
  })
})
