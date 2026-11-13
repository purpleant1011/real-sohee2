import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import SystemSettingsPage from '../system-view'

let searchString = ''

vi.mock('@/hooks/use-workspace-context', () => ({
  useWorkspaceId: vi.fn(() => 'ws-test-system-view'),
  useWorkspaceContext: vi.fn(() => ({ workspaceId: 'ws-test-system-view' })),
  useOptionalWorkspaceContext: vi.fn(() => ({ workspaceId: 'ws-test-system-view' })),
}))

vi.mock('@/components/v088/layout/v088-app-shell', () => ({
  V088AppShell: ({ children }: { children: React.ReactNode }) => <div data-testid="app-shell">{children}</div>,
}))

vi.mock('next/navigation', () => ({
  usePathname: () => '/app/system',
  useSearchParams: () => new URLSearchParams(searchString),
}))

vi.mock('@/lib/supabase/client', () => ({
  createBrowserSupabaseClient: vi.fn(() => ({
    auth: {
      getUser: vi.fn(async () => ({ data: { user: { email: 'owner@byreum.com' } } })),
    },
  })),
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

describe('SystemSettingsPage (/app/system 홈 및 상세 라우팅)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    searchString = ''
    delete (window as any).location
    window.location = new URL('http://localhost:3000/app/system') as any
  })

  it('기본 진입 시(쿼리 없음) PC 설정 홈(SettingsOverview)을 렌더링하고 중복 세로 메뉴가 없다', () => {
    render(<SystemSettingsPage />)

    // 설정 홈 헤더 및 5대 그룹 확인
    expect(screen.getByRole('heading', { level: 1, name: '설정' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 2, name: '우리 가게' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 2, name: '연결' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 2, name: '요금·결제' })).toBeInTheDocument()

    // 상세 화면의 중복 세로 메뉴 navigation이 없어야 함
    expect(screen.queryByRole('navigation', { name: '설정 메뉴' })).toBeNull()
  })

  it('?section=status 딥링크 진입 시 운영 현황/보안 상세 뷰와 설정 홈 복귀 링크를 렌더링한다', () => {
    searchString = 'section=status'
    window.location = new URL('http://localhost:3000/app/system?section=status') as any

    render(<SystemSettingsPage />)

    // 설정 홈 복귀 링크 제공
    const backLink = screen.getByRole('link', { name: /설정 홈/ })
    expect(backLink).toBeInTheDocument()
    expect(backLink).toHaveAttribute('href', '/app/system')

    // 상세 헤더 및 시스템 탭들 렌더링
    expect(screen.getByText('소희 활동과 안전 설정')).toBeInTheDocument()
    expect(screen.getByText('소희 서비스 정상 작동 여부')).toBeInTheDocument()
  })

  it('?section=credits 딥링크 진입 시 요금제 및 크레딧 탭을 활성화하여 렌더링한다', () => {
    searchString = 'section=credits'
    window.location = new URL('http://localhost:3000/app/system?section=credits') as any

    render(<SystemSettingsPage />)

    // 상세 뷰에 요금제 및 이용 현황 노출
    expect(screen.getByText('요금제 및 이용 현황')).toBeInTheDocument()
    expect(screen.getByText('외부 매체 광고비 분리 기록 (원)')).toBeInTheDocument()
  })

  it('동일 /system 화면 내에서 query가 section=status에서 section=credits로 변경 시 선택 탭이 갱신된다', () => {
    searchString = 'section=status'
    window.location = new URL('http://localhost:3000/app/system?section=status') as any

    const { rerender } = render(<SystemSettingsPage />)
    expect(screen.getByText('소희 서비스 정상 작동 여부')).toBeInTheDocument()
    expect(screen.queryByText('외부 매체 광고비 분리 기록 (원)')).toBeNull()

    // 쿼리 변경 후 재렌더링
    searchString = 'section=credits'
    window.location = new URL('http://localhost:3000/app/system?section=credits') as any

    rerender(<SystemSettingsPage />)
    expect(screen.getByText('외부 매체 광고비 분리 기록 (원)')).toBeInTheDocument()
  })
})
