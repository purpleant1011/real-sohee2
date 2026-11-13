import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

const mockRequireOperator = vi.fn(async () => ({ userId: '10000000-0000-4000-8000-000000000001' }))
vi.mock('@/features/operator-auth/require-operator', () => ({
  requireOperator: () => mockRequireOperator(),
}))

const mockFrom = vi.fn()
vi.mock('@/lib/supabase/admin', () => ({
  createAdminSupabaseClient: () => ({
    from: mockFrom,
  }),
}))

import Page from './page'

describe('AdminMissionsListPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('checks publish.read scope and renders LoadErrorNotice on DB error', async () => {
    mockFrom.mockReturnValue({
      select: () => ({
        order: () => ({
          limit: async () => ({ data: null, error: { message: 'DB connection error' } }),
        }),
      }),
    })

    const view = await Page()
    render(view)

    expect(mockRequireOperator).toHaveBeenCalled()
    expect(screen.getByRole('alert')).toBeVisible()
    expect(screen.getByText(/마케팅 미션 목록을\(를\) 불러오지 못했어요/)).toBeVisible()
  })

  it('renders EmptyNotice when mission list is empty', async () => {
    mockFrom.mockReturnValue({
      select: () => ({
        order: () => ({
          limit: async () => ({ data: [], error: null }),
        }),
      }),
    })

    const view = await Page()
    render(view)

    expect(screen.getByText('등록된 마케팅 미션이 없습니다')).toBeVisible()
  })

  it('hides a trailing English translation in the mission goal', async () => {
    mockFrom.mockReturnValue({
      select: () => ({
        order: () => ({
          limit: async () => ({
            data: [{ id: '12345678-abcd-1234-abcd-1234567890ab', goal: '첫 게시물 발행 미션 (First Post Guided Mission)', target_channel: 'instagram', status: 'ACTIVE', created_at: '2026-10-08T10:00:00.000Z' }],
            error: null,
          }),
        }),
      }),
    })
    render(await Page())
    expect(screen.getByText('첫 게시물 발행 미션')).toBeVisible()
    expect(screen.queryByText(/First Post Guided Mission/)).not.toBeInTheDocument()
  })

  it('renders mission row with Korean labels and short reference code', async () => {
    mockFrom.mockReturnValue({
      select: () => ({
        order: () => ({
          limit: async () => ({
            data: [
              {
                id: '12345678-abcd-1234-abcd-1234567890ab',
                goal: '가을 립스틱 홍보',
                target_channel: 'instagram',
                status: 'COMPLETED',
                created_at: '2026-10-08T10:00:00.000Z',
              },
            ],
            error: null,
          }),
        }),
      }),
    })

    const view = await Page()
    render(view)

    expect(screen.getByText('12345678')).toBeVisible()
    expect(screen.getByText('가을 립스틱 홍보')).toBeVisible()
    expect(screen.getByText('인스타그램')).toBeVisible()
    expect(screen.getByText('완료됨')).toBeVisible()
    expect(screen.getByRole('link', { name: /트레이스 탐색/i })).toHaveAttribute(
      'href',
      '/admin/missions/12345678-abcd-1234-abcd-1234567890ab'
    )
  })

  it('displays separated execution_state and outcome_state without promoting legacy COMPLETED to ACHIEVED', async () => {
    mockFrom.mockReturnValue({
      select: () => ({
        order: () => ({
          limit: async () => ({
            data: [
              {
                id: '12345678-abcd-1234-abcd-1234567890ab',
                goal: '가을 립스틱 홍보',
                target_channel: 'instagram',
                status: 'COMPLETED',
                metadata: {},
                created_at: '2026-10-08T10:00:00.000Z',
              },
            ],
            error: null,
          }),
        }),
      }),
    })

    const view = await Page()
    render(view)

    // Table header should have separated headers
    expect(screen.getByText('작업 상태')).toBeVisible()
    expect(screen.getByText('성과 상태')).toBeVisible()

    // Row should show separated dual state
    expect(screen.getByText('작업 종료')).toBeVisible()
    expect(screen.getByText('관측 대기/진행')).toBeVisible()
    // Invariant: Legacy COMPLETED must never be inferred as ACHIEVED without proof
    expect(screen.queryByText(/목표 달성/)).not.toBeInTheDocument()
  })

  it('aggregates metrics based on resolved executionState rather than legacy status', async () => {
    mockFrom.mockReturnValue({
      select: () => ({
        order: () => ({
          limit: async () => ({
            data: [
              {
                id: 'm-1',
                goal: '미션 1',
                target_channel: 'instagram',
                status: 'NEXT_ACTION_READY', // Should map to OBSERVING, not CLOSED
                metadata: {},
                created_at: '2026-10-08T10:00:00.000Z',
              },
              {
                id: 'm-2',
                goal: '미션 2',
                target_channel: 'instagram',
                status: 'COMPLETED', // Maps to CLOSED
                metadata: {},
                created_at: '2026-10-08T10:00:00.000Z',
              },
            ],
            error: null,
          }),
        }),
      }),
    })

    const view = await Page()
    render(view)

    // Completed tile must be 1 (only m-2), not 2
    const metricCards = screen.getAllByText(/완료된 미션/)
    expect(metricCards.length).toBeGreaterThan(0)
    // m-1 should display OBSERVING ('성과 관측')
    expect(screen.getByText('성과 관측')).toBeVisible()
    // m-2 should display CLOSED ('작업 종료')
    expect(screen.getByText('작업 종료')).toBeVisible()
  })
})
