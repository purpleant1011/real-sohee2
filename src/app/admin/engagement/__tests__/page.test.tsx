import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import OperatorEngagementPage from '../page'
import { OperatorAccessError } from '@/features/operator-auth/current-operator'

vi.mock('@/features/operator-auth/require-operator', () => ({
  requireOperatorAnyScope: vi.fn(),
}))

vi.mock('@/features/operator-engagement/engagement-repository', () => ({
  getOperatorEngagementOverview: vi.fn(),
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    refresh: vi.fn(),
    push: vi.fn(),
  }),
}))

import { requireOperatorAnyScope } from '@/features/operator-auth/require-operator'
import { getOperatorEngagementOverview } from '@/features/operator-engagement/engagement-repository'

describe('OperatorEngagementPage', () => {
  it('renders MfaRequiredNotice when MFA is required', async () => {
    vi.mocked(requireOperatorAnyScope).mockRejectedValueOnce(
      new OperatorAccessError('MFA_REQUIRED'),
    )

    const jsx = await OperatorEngagementPage()
    render(jsx)

    expect(screen.getByText(/추가 인증\(2단계\)을 마친 뒤에 볼 수 있어요/i)).toBeInTheDocument()
  })

  it('renders LoadErrorNotice when overview fetch fails', async () => {
    vi.mocked(requireOperatorAnyScope).mockResolvedValueOnce({} as any)
    vi.mocked(getOperatorEngagementOverview).mockResolvedValueOnce({
      data: null,
      error: 'DB_ERROR',
    })

    const jsx = await OperatorEngagementPage()
    render(jsx)

    expect(screen.getByText(/소통함 관제 데이터을\(를\) 불러오지 못했어요/i)).toBeInTheDocument()
  })

  it('renders EngagementView when overview fetch succeeds', async () => {
    vi.mocked(requireOperatorAnyScope).mockResolvedValueOnce({} as any)
    vi.mocked(getOperatorEngagementOverview).mockResolvedValueOnce({
      data: {
        autonomy: { l1Manual: 3, l2Assisted: 2, l3Autonomous: 1, totalConfigured: 6, pausedCount: 0 },
        expiringDms: [],
        expiringCriticalCount: 0,
        stats24h: { windowHours: 24, totalAttempts: 10, successfulReplies: 10, failedReplies: 0, successRatePercent: 100 },
        recentAudits: [],
        asOf: '2026-10-14T10:00:00.000Z',
      },
      error: null,
    })

    const jsx = await OperatorEngagementPage()
    render(jsx)

    expect(screen.getByRole('heading', { level: 1, name: '소통함 관제' })).toBeInTheDocument()
  })
})
