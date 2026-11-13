import React from 'react'
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { V088AppShell } from '../v088-app-shell'

vi.mock('next/navigation', () => ({
  usePathname: () => '/app',
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}))

vi.mock('next/image', () => ({
  default: (props: any) => <img {...props} alt={props.alt || ''} />,
}))

vi.mock('@/components/theme-provider', () => ({
  useTheme: () => ({ theme: 'light', resolvedTheme: 'light', setTheme: vi.fn() }),
}))

vi.mock('@/hooks/use-credit-balance', () => ({
  useCreditBalance: () => ({
    capacity: 5000,
    balance: 5000,
    remainingPercentage: 100,
    available: 5000,
    spent: 0,
    usedCredits: 0,
    usagePercentage: 0,
    status: 'ACTIVE',
    planName: '소희 크레딧 (5,000 크레딧)',
    refillAt: '정기 충전',
    burnGovernorActive: false,
    isLoading: false,
    refreshCredits: vi.fn(),
    reserveCredit: vi.fn(),
    settleCredit: vi.fn(),
  }),
}))

vi.mock('@/hooks/use-sohee-autonomy', () => ({
  useSoheeAutonomy: () => ({
    isRunning: true,
    isPaused: false,
    actualMode: 'RUNNING',
    killSwitchActive: false,
    isLoading: false,
    setAutonomy: vi.fn(),
    toggleAutonomy: vi.fn(),
  }),
}))

vi.mock('@/lib/supabase/client', () => ({
  createBrowserSupabaseClient: () => ({
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: {
          user: {
            email: 'owner@business.kr',
            user_metadata: { full_name: '홍길동' },
          },
        },
      }),
    },
    from: () => ({
      select: () => ({
        limit: () => ({
          maybeSingle: vi.fn().mockResolvedValue({
            data: { business_name: '홍길동 뷰티스튜디오' },
          }),
        }),
        in: () => ({
          limit: () => vi.fn().mockResolvedValue({ data: [] }),
        }),
      }),
    }),
  }),
}))

describe('V088AppShell Agent OS Canonical Navigation Contract (ANI-887, ANI-896, S3-W1)', () => {
  it('renders canonical 5 primary navigation items and secondary items, and removes campaign/plugin', () => {
    render(
      <V088AppShell workspaceId="ws-test">
        <div>Content Area</div>
      </V088AppShell>
    )

    // 5 primary routes must exist
    expect(screen.getAllByText('오늘').length).toBeGreaterThanOrEqual(1)
    expect(screen.getAllByText('작업').length).toBeGreaterThanOrEqual(1)
    expect(screen.getAllByText('고객').length).toBeGreaterThanOrEqual(1)
    expect(screen.getAllByText('성과').length).toBeGreaterThanOrEqual(1)
    expect(screen.getAllByText('더보기').length).toBeGreaterThanOrEqual(1)

    // Secondary routes must exist in desktop sidebar
    expect(screen.getAllByText('소통함').length).toBeGreaterThanOrEqual(1)
    expect(screen.getAllByText('승인 대기').length).toBeGreaterThanOrEqual(1)
    expect(screen.getAllByText('예약 일정').length).toBeGreaterThanOrEqual(1)
    expect(screen.getAllByText('보관함').length).toBeGreaterThanOrEqual(1)
    expect(screen.getAllByText('광고 센터').length).toBeGreaterThanOrEqual(1)
    expect(screen.getAllByText(/설정\/도움말|설정/).length).toBeGreaterThanOrEqual(1)

    // Campaign and Plugin must NOT be in desktop or mobile navigation links
    const navs = screen.getAllByRole('navigation')
    expect(navs.length).toBeGreaterThanOrEqual(1)
    navs.forEach((nav) => {
      expect(nav.textContent).not.toContain('캠페인')
      expect(nav.textContent).not.toContain('플러그인')
    })
  })

  it('omits credit gauges, numbers, and labels in the Owner Console', () => {
    const { container } = render(
      <V088AppShell workspaceId="ws-test">
        <div>Content Area</div>
      </V088AppShell>
    )

    expect(screen.queryByText('소희 크레딧')).toBeNull()
    expect(screen.queryByText(/크레딧/)).toBeNull()
    expect(screen.queryByText('Agent Energy')).toBeNull()
    expect(screen.queryByText(/SC/)).toBeNull()
    expect(container.textContent).not.toContain('크레딧')
    expect(container.textContent).not.toContain('SC')
    expect(container.textContent).not.toContain('차감')
  })

  it('renders compact read-only autonomy status in sidebar', () => {
    render(
      <V088AppShell workspaceId="ws-test">
        <div>Content Area</div>
      </V088AppShell>
    )

    expect(screen.getByText(/자율근무 · RUNNING|근무 중/)).toBeDefined()
  })

  it('PC 상단 헤더에서 더미 검색창을 노출하지 않고 소희와 대화 버튼에 whitespace-nowrap이 적용된다', () => {
    render(
      <V088AppShell workspaceId="ws-test">
        <div>Content Area</div>
      </V088AppShell>
    )

    expect(screen.queryByPlaceholderText('미션, 고객, 마케팅 지시사항 검색...')).toBeNull()
    const chatBtn = screen.getByRole('button', { name: '소희와 대화하기' })
    expect(chatBtn).toHaveClass('whitespace-nowrap')
  })
})
