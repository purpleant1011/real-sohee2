import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

const mockNotFound = vi.fn()
vi.mock('next/navigation', () => ({
  notFound: () => mockNotFound(),
}))

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

const mockProjectMissionTrace = vi.fn()
vi.mock('@/features/admin/mission-trace-projection', () => ({
  AdminMissionTraceProjection: class {
    projectMissionTrace = mockProjectMissionTrace
  },
}))

const mockBuildTenantIdentityBar = vi.fn()
vi.mock('@/features/admin/customer-360-canonical-service', () => ({
  Customer360CanonicalService: class {
    buildTenantIdentityBar = mockBuildTenantIdentityBar
  },
}))

import Page from './page'

describe('AdminMissionTracePage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('surfaces DB error via LoadErrorNotice instead of notFound', async () => {
    mockFrom.mockReturnValue({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({ data: null, error: { message: 'DB connection failure' } }),
        }),
      }),
    })

    const view = await Page({ params: Promise.resolve({ missionId: 'm-123' }) })
    render(view)

    expect(mockNotFound).not.toHaveBeenCalled()
    expect(screen.getByRole('alert')).toBeVisible()
    expect(screen.getByText(/미션 상세 정보을\(를\) 불러오지 못했어요/)).toBeVisible()
  })

  it('triggers notFound only when mission row is missing without error', async () => {
    mockFrom.mockReturnValue({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({ data: null, error: null }),
        }),
      }),
    })

    await Page({ params: Promise.resolve({ missionId: 'missing-id' }) })
    expect(mockNotFound).toHaveBeenCalled()
  })

  it('renders MissionTraceExplorerView when mission is found', async () => {
    mockFrom.mockReturnValue({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({
            data: { id: 'm-123', workspace_id: 'ws-123' },
            error: null,
          }),
        }),
      }),
    })

    mockProjectMissionTrace.mockResolvedValue({
      missionId: 'm-123',
      workspaceId: 'ws-123',
      traceId: 'tr-12345678',
      overallStatus: 'COMPLETED',
      goal: '신제품 홍보 (New Product Launch)',
      stages: [],
      totalObservedStages: 0,
      generatedAt: '2026-10-08T10:00:00.000Z',
    })

    mockBuildTenantIdentityBar.mockResolvedValue({
      workspaceId: 'ws-123',
      displayName: '홍길동 뷰티',
      ownerEmail: 'owner@example.com',
      isProduction: false,
      badgeLabel: 'DEMO_SANDBOX',
      status: 'ACTIVE',
    })

    const view = await Page({ params: Promise.resolve({ missionId: 'm-123' }) })
    render(view)

    expect(screen.getByText(/신제품 홍보/)).toBeVisible()
    expect(screen.queryByText(/New Product Launch/)).not.toBeInTheDocument()
    expect(screen.getByText(/완료됨/)).toBeVisible()
    expect(screen.getByText('홍길동 뷰티')).toBeVisible()
    expect(screen.getByText('테스트 매장')).toBeVisible()
  })
})
