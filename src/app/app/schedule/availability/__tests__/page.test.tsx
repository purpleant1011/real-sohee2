import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { notFound } from 'next/navigation'

const getCurrentWorkspaceContext = vi.fn()
const isRecoveryEnabled = vi.fn()

vi.mock('next/navigation', () => ({
  notFound: vi.fn(),
  redirect: vi.fn(),
}))

vi.mock('@/components/v088/layout/v088-app-shell', () => ({
  V088AppShell: ({ children }: { children: React.ReactNode }) => <div data-testid="pc-shell">{children}</div>,
}))

vi.mock('@/features/auth/current-workspace', () => ({
  getCurrentWorkspaceContext: () => getCurrentWorkspaceContext(),
}))

vi.mock('@/features/booking-recovery/production', () => ({
  isRecoveryEnabled: (workspaceId: string) => isRecoveryEnabled(workspaceId),
}))

vi.mock('@/lib/supabase/server', () => ({
  createServerSupabaseClient: async () => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({ data: { timezone: 'Asia/Seoul' } }),
        }),
      }),
    }),
  }),
}))

vi.mock('../availability-panel', () => ({
  AvailabilityPanel: ({ workspaceId }: { workspaceId: string }) => (
    <div data-testid="availability-panel">panel:{workspaceId}</div>
  ),
}))

import ScheduleAvailabilityPage from '../page'

const WORKSPACE_ID = '11111111-1111-4111-8111-111111111111'

describe('ANI-1610 /app/schedule/availability gate', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getCurrentWorkspaceContext.mockResolvedValue({
      workspaceId: WORKSPACE_ID,
      role: 'owner',
      status: 'active',
    })
  })

  it('shows friendly StateView ("아직 준비 중이에요") and back button instead of 404 when gate is off', async () => {
    isRecoveryEnabled.mockReturnValue(false)

    render(await ScheduleAvailabilityPage())

    expect(isRecoveryEnabled).toHaveBeenCalledWith(WORKSPACE_ID)
    expect(notFound).not.toHaveBeenCalled()
    expect(screen.getByText('아직 준비 중이에요')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /돌아가기/ })).toHaveAttribute('href', '/app/schedule')
    expect(screen.getByTestId('pc-shell')).toBeInTheDocument()
    expect(screen.queryByTestId('availability-panel')).toBeNull()
  })

  it('renders the availability panel only when the gate allows this workspace', async () => {
    isRecoveryEnabled.mockReturnValue(true)

    render(await ScheduleAvailabilityPage())

    expect(notFound).not.toHaveBeenCalled()
    expect(screen.getByTestId('pc-shell')).toBeInTheDocument()
    expect(screen.getByTestId('availability-panel')).toHaveTextContent(WORKSPACE_ID)
  })
})
