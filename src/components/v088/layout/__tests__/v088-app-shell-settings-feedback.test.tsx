import React from 'react'
import { describe, it, expect, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { V088AppShell } from '../v088-app-shell'

vi.mock('next/navigation', () => ({
  usePathname: () => '/app/settings/brand',
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

describe('PC 설정 화면에서 의견 보내기 버튼이 본문을 밀어내지 않는다', () => {
  it('PC 사이드바 안에 의견 보내기가 있다(콘텐츠 위에 떠 있지 않다)', () => {
    render(
      <V088AppShell workspaceId="ws-test">
        <div>설정 본문</div>
      </V088AppShell>,
    )
    const sidebar = screen.getByTestId('business-world-pane')
    const feedback = within(sidebar).getByRole('button', { name: '의견 보내기' })
    expect(feedback).toBeInTheDocument()
    // 메뉴 바로 아래: 로그아웃 버튼보다 앞(문서 순서)에 있어 긴 화면에서도 맨 아래로 밀리지 않는다
    const logout = within(sidebar).getByRole('button', { name: '로그아웃' })
    expect(feedback.compareDocumentPosition(logout) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('설정 하위 화면에서는 의견 버튼이 본문 영역 안쪽에 놓인다(본문 옆 열을 차지하지 않는다)', () => {
    render(
      <V088AppShell workspaceId="ws-test">
        <div>설정 본문</div>
      </V088AppShell>,
    )
    const main = screen.getByRole('main')
    expect(within(main).getByText('설정 본문')).toBeInTheDocument()
    expect(within(main).getByRole('button', { name: '의견 보내기' })).toBeInTheDocument()
    // 사이드바(PC)와 본문(모바일 전용) 한 개씩 — 떠 있는(fixed) 버튼은 없다
    const buttons = screen.getAllByRole('button', { name: '의견 보내기' })
    expect(buttons).toHaveLength(2)
    for (const b of buttons) expect(b).not.toHaveClass('fixed')
  })

  it('설정과 더보기가 동시에 현재 위치로 표시되지 않는다', () => {
    render(
      <V088AppShell workspaceId="ws-test">
        <div>설정 본문</div>
      </V088AppShell>,
    )
    const current = screen.getAllByRole('link').filter((el) => el.getAttribute('aria-current') === 'page')
    const names = current.map((el) => el.textContent ?? '')
    expect(names.some((t) => t.includes('더보기'))).toBe(true)
    expect(names.some((t) => t.includes('설정/도움말') || t.includes('설정'))).toBe(false)
  })
})
