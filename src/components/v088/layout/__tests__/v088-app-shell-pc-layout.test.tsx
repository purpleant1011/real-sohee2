import React from 'react'
import { describe, it, expect, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
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

describe('S3-W1 PC 셸 레이아웃 규약', () => {
  it('사이드바에 5개 주 메뉴(오늘, 작업, 고객, 성과, 더보기)와 보조 메뉴(소통함, 승인 대기, 예약 일정, 보관함, 설정/도움말)가 존재한다', () => {
    render(
      <V088AppShell workspaceId="ws-test">
        <div>Content Area</div>
      </V088AppShell>
    )

    const sidebar = screen.getByTestId('business-world-pane')
    expect(sidebar).toBeInTheDocument()

    // 주 메뉴 5개
    expect(within(sidebar).getByRole('link', { name: /오늘/ })).toBeInTheDocument()
    expect(within(sidebar).getByRole('link', { name: /작업/ })).toBeInTheDocument()
    expect(within(sidebar).getByRole('link', { name: /고객/ })).toBeInTheDocument()
    expect(within(sidebar).getByRole('link', { name: /성과/ })).toBeInTheDocument()
    expect(within(sidebar).getByRole('link', { name: /더보기/ })).toBeInTheDocument()

    // 보조 메뉴 5개
    expect(within(sidebar).getByRole('link', { name: /소통함/ })).toBeInTheDocument()
    expect(within(sidebar).getByRole('link', { name: /승인 대기/ })).toBeInTheDocument()
    expect(within(sidebar).getByRole('link', { name: /예약 일정/ })).toBeInTheDocument()
    expect(within(sidebar).getByRole('link', { name: /보관함/ })).toBeInTheDocument()
    expect(within(sidebar).getByRole('link', { name: /설정\/도움말|설정/ })).toBeInTheDocument()
  })

  it('활성화된 현재 위치 메뉴에 aria-current="page"가 설정된다', () => {
    render(
      <V088AppShell workspaceId="ws-test">
        <div>Content Area</div>
      </V088AppShell>
    )

    const sidebar = screen.getByTestId('business-world-pane')
    const activeLink = within(sidebar).getByRole('link', { name: /오늘/ })
    expect(activeLink).toHaveAttribute('aria-current', 'page')
  })

  it('로그아웃 버튼 옆에 영문 장식 문구(EXIT)를 두지 않는다', () => {
    render(
      <V088AppShell workspaceId="ws-test">
        <div>본문</div>
      </V088AppShell>,
    )
    expect(screen.queryByText('EXIT')).toBeNull()
  })

  it('현재 위치 메뉴는 글자가 배경에 묻히지 않도록 같은 색 채움을 쓰지 않는다', () => {
    render(
      <V088AppShell workspaceId="ws-test">
        <div>본문</div>
      </V088AppShell>,
    )
    const current = screen.getAllByRole('link').filter((el) => el.getAttribute('aria-current') === 'page')
    expect(current.length).toBeGreaterThan(0)
    for (const link of current) {
      expect(link.className).not.toContain('bg-primary/90')
    }
  })

  it('본문 건너뛰기 링크(skip link)와 main#main-content 랜드마크가 제공된다', () => {
    render(
      <V088AppShell workspaceId="ws-test">
        <div>Content Area</div>
      </V088AppShell>
    )

    const skipLink = screen.getByRole('link', { name: '본문으로 건너뛰기' })
    expect(skipLink).toBeInTheDocument()
    expect(skipLink).toHaveAttribute('href', '#main-content')

    const main = screen.getByRole('main')
    expect(main).toHaveAttribute('id', 'main-content')
  })

  it('사이드바는 1024~1279px에서 반응형으로 좁아지는 lg:w-20 xl:w-72 클래스를 갖는다', () => {
    render(
      <V088AppShell workspaceId="ws-test">
        <div>Content Area</div>
      </V088AppShell>
    )

    const sidebar = screen.getByTestId('business-world-pane')
    expect(sidebar.className).toContain('lg:w-20')
    expect(sidebar.className).toContain('xl:w-72')
  })

  it('본문 영역은 max-w-[1200px] 및 mx-auto로 중앙 정렬된다', () => {
    render(
      <V088AppShell workspaceId="ws-test">
        <div data-testid="test-content">본문 내용</div>
      </V088AppShell>
    )

    const contentWrapper = screen.getByTestId('test-content').parentElement
    expect(contentWrapper?.className).toContain('max-w-[1200px]')
    expect(contentWrapper?.className).toContain('mx-auto')
  })

  it('상단 헤더에 현재 화면 제목과 whitespace-nowrap 소희와 대화 버튼이 렌더된다', () => {
    render(
      <V088AppShell workspaceId="ws-test">
        <div>Content Area</div>
      </V088AppShell>
    )

    const chatButton = screen.getByRole('button', { name: '소희와 대화하기' })
    expect(chatButton).toBeInTheDocument()
    expect(chatButton).toHaveClass('whitespace-nowrap')

    // 상단 헤더에 현재 화면 제목(오늘)이 렌더됨
    expect(screen.getByRole('heading', { level: 1, name: '오늘' })).toBeInTheDocument()
  })

  it('1024~1279px 좁은 사이드바 모드에서도 테마 전환 버튼이 사라지지 않고 렌더된다', () => {
    render(
      <V088AppShell workspaceId="ws-test">
        <div>Content Area</div>
      </V088AppShell>
    )

    const sidebar = screen.getByTestId('business-world-pane')
    const themeToggle = within(sidebar).getByRole('button', { name: '테마 전환' })
    expect(themeToggle).toBeInTheDocument()
    // hidden xl:flex 대신 md 이상에서 항상 접근 가능해야 함
    expect(themeToggle.className).not.toContain('hidden xl:flex')
  })

  it('주 메뉴 및 보조 메뉴 아이템들은 좁은 사이드바 모드(80px)를 위해 툴팁(title)과 텍스트 반응형 클래스를 갖는다', () => {
    render(
      <V088AppShell workspaceId="ws-test">
        <div>Content Area</div>
      </V088AppShell>
    )

    const sidebar = screen.getByTestId('business-world-pane')
    const primaryLinks = within(sidebar).getAllByRole('link')

    // 각 링크에 title 속성이 존재하여 80px 아이콘 모드에서도 브라우저 툴팁 제공
    for (const link of primaryLinks) {
      expect(link.getAttribute('title')).toBeTruthy()
    }
  })

  it('모든 사이드바 네비게이션 링크와 로그아웃 버튼에 포커스 링(focus-visible:ring)이 적용된다', () => {
    render(
      <V088AppShell workspaceId="ws-test">
        <div>Content Area</div>
      </V088AppShell>
    )

    const sidebar = screen.getByTestId('business-world-pane')
    const interactiveElements = within(sidebar).getAllByRole('link')
    const logoutBtn = within(sidebar).getByRole('button', { name: '로그아웃' })

    for (const el of interactiveElements) {
      expect(el.className).toContain('focus-visible:ring')
    }
    expect(logoutBtn.className).toContain('focus-visible:ring')
  })
})
