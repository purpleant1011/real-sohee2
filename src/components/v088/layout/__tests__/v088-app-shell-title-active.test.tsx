import React from 'react'
import { describe, it, expect, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { V088AppShell } from '../v088-app-shell'

let mockPathname = '/app/help'

vi.mock('next/navigation', () => ({
  usePathname: () => mockPathname,
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}))

vi.mock('next/image', () => ({
  // eslint-disable-next-line @next/next/no-img-element
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
    planName: '소희 크레딧',
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
      getUser: vi.fn().mockResolvedValue({ data: { user: null } }),
    },
    from: () => ({
      select: () => ({
        limit: () => ({
          maybeSingle: vi.fn().mockResolvedValue({ data: null }),
        }),
        eq: () => ({
          maybeSingle: vi.fn().mockResolvedValue({ data: null }),
        }),
        in: () => ({
          limit: () => vi.fn().mockResolvedValue({ data: [] }),
        }),
      }),
    }),
  }),
}))

describe('V088AppShell PC 헤더 타이틀 및 설정/도움말 활성 네비게이션 검증', () => {
  it('/app/help 진입 시 상단 헤더 타이틀이 "설정/도움말"이어야 하고, "오늘"이 아니어야 한다', () => {
    mockPathname = '/app/help'
    render(
      <V088AppShell workspaceId="ws-test">
        <div>Help Content</div>
      </V088AppShell>
    )

    expect(screen.queryByRole('heading', { level: 1, name: '오늘' })).toBeNull()
    expect(screen.getByRole('heading', { level: 1, name: '설정/도움말' })).toBeInTheDocument()

    const sidebar = screen.getByTestId('business-world-pane')
    const helpLink = within(sidebar).getByRole('link', { name: /설정\/도움말|설정/ })
    expect(helpLink).toHaveAttribute('aria-current', 'page')
  })

  it('/app/settings/business 진입 시 주 메뉴의 더보기가 aria-current="page"로 활성화된다', () => {
    mockPathname = '/app/settings/business'
    render(
      <V088AppShell workspaceId="ws-test">
        <div>Settings Content</div>
      </V088AppShell>
    )

    const sidebar = screen.getByTestId('business-world-pane')
    const moreLink = within(sidebar).getByRole('link', { name: /더보기/ })
    expect(moreLink).toHaveAttribute('aria-current', 'page')

    const helpLink = within(sidebar).getByRole('link', { name: /설정\/도움말|설정/ })
    expect(helpLink).not.toHaveAttribute('aria-current', 'page')
  })

  it('/app/account 진입 시 주 메뉴의 더보기가 aria-current="page"로 활성화된다', () => {
    mockPathname = '/app/account'
    render(
      <V088AppShell workspaceId="ws-test">
        <div>Account Content</div>
      </V088AppShell>
    )

    const sidebar = screen.getByTestId('business-world-pane')
    const moreLink = within(sidebar).getByRole('link', { name: /더보기/ })
    expect(moreLink).toHaveAttribute('aria-current', 'page')

    const helpLink = within(sidebar).getByRole('link', { name: /설정\/도움말|설정/ })
    expect(helpLink).not.toHaveAttribute('aria-current', 'page')
  })

  it('/app/connectors 진입 시 상단 헤더 타이틀이 "업무 도구 연결"이고, 더보기가 활성화된다', () => {
    mockPathname = '/app/connectors'
    render(
      <V088AppShell workspaceId="ws-test">
        <div>Connectors Content</div>
      </V088AppShell>
    )

    expect(screen.getByRole('heading', { level: 1, name: '업무 도구 연결' })).toBeInTheDocument()
    const sidebar = screen.getByTestId('business-world-pane')
    const moreLink = within(sidebar).getByRole('link', { name: /더보기/ })
    expect(moreLink).toHaveAttribute('aria-current', 'page')
  })
})
