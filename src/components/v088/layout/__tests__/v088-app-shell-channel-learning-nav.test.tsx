import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, within, fireEvent } from '@testing-library/react'
import { V088AppShell } from '../v088-app-shell'
import { MobileMoreMenuSheet } from '../mobile-more-menu-sheet'

let mockPathname = '/app'

vi.mock('next/navigation', () => ({
  usePathname: () => mockPathname,
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
            data: { business_name: '홍길동 매장' },
          }),
        }),
        in: () => ({
          limit: () => vi.fn().mockResolvedValue({ data: [] }),
        }),
      }),
    }),
  }),
}))

describe('V088AppShell 및 MobileMoreMenuSheet 채널 연결 내비게이션 검증', () => {
  beforeEach(() => {
    mockPathname = '/app'
  })

  describe('V088AppShell', () => {
    it('사이드바 보조 메뉴에 "채널 연결" (/app/channels) 링크가 올바른 href로 렌더링된다', () => {
      render(
        <V088AppShell workspaceId="ws-test">
          <div>본문 콘텐츠</div>
        </V088AppShell>
      )

      const sidebar = screen.getByTestId('business-world-pane')
      expect(sidebar).toBeInTheDocument()

      const channelLink = within(sidebar).getByRole('link', { name: /채널 연결/ })
      expect(channelLink).toBeInTheDocument()
      expect(channelLink).toHaveAttribute('href', '/app/channels')
    })

    it('경로가 /app/channels일 때 사이드바 링크에 aria-current="page"가 적용되고 헤더 타이틀이 "채널 연결"으로 표시된다', () => {
      mockPathname = '/app/channels'

      render(
        <V088AppShell workspaceId="ws-test">
          <div>채널 연결 본문</div>
        </V088AppShell>
      )

      const sidebar = screen.getByTestId('business-world-pane')
      const channelLink = within(sidebar).getByRole('link', { name: /채널 연결/ })
      expect(channelLink).toHaveAttribute('aria-current', 'page')

      const headerHeading = screen.getByRole('heading', { level: 1, name: '채널 연결' })
      expect(headerHeading).toBeInTheDocument()
    })
  })

  describe('MobileMoreMenuSheet', () => {
    it('메뉴를 열었을 때 도구 및 센터 메뉴에 "채널 연결" (/app/channels) 링크가 렌더링된다', () => {
      render(
        <MobileMoreMenuSheet
          workspaceName="홍길동 매장"
          userName="홍길동"
          userEmail="owner@business.kr"
          onOpenActivityLog={vi.fn()}
          onOpenGuide={vi.fn()}
          onLogout={vi.fn()}
          isLoggingOut={false}
        />
      )

      // 초기에는 시트가 닫혀 있음
      expect(screen.queryByRole('dialog')).toBeNull()

      // 더보기 메뉴 열기 버튼 클릭
      const openButton = screen.getByRole('button', { name: '더보기 메뉴 열기' })
      fireEvent.click(openButton)

      // 다이얼로그 열림 확인
      const dialog = screen.getByRole('dialog', { name: '더보기 메뉴' })
      expect(dialog).toBeInTheDocument()

      // "도구 및 센터" 섹션 텍스트 확인
      expect(within(dialog).getByText('도구 및 센터')).toBeInTheDocument()

      // "채널 연결" 링크 확인
      const channelLink = within(dialog).getByRole('link', { name: /채널 연결/ })
      expect(channelLink).toBeInTheDocument()
      expect(channelLink).toHaveAttribute('href', '/app/channels')
    })
  })
})
