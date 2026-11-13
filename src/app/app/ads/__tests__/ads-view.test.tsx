import React from 'react'
import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { AdsView } from '../ads-view'

// Mock navigation & hooks
vi.mock('next/navigation', () => ({
  usePathname: () => '/app/ads',
  useSearchParams: () => ({ get: () => null }),
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
    balance: 84000,
    capacity: 100000,
    remainingPercentage: 84,
  }),
}))

vi.mock('@/hooks/use-sohee-autonomy', () => ({
  useSoheeAutonomy: () => ({
    isRunning: true,
    actualMode: 'RUNNING',
    killSwitchActive: false,
    isLoading: false,
    setAutonomy: vi.fn(),
  }),
}))

const createQueryBuilder = () => {
  const qb: any = {
    select: () => qb,
    eq: () => qb,
    in: () => qb,
    limit: () => qb,
    maybeSingle: vi.fn().mockResolvedValue({ data: null }),
    then: (resolve: any) => Promise.resolve({ data: [] }).then(resolve),
  }
  return qb
}

vi.mock('@/lib/supabase/client', () => ({
  createBrowserSupabaseClient: () => ({
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: {
          user: {
            id: 'u-1',
            email: 'test@example.com',
            user_metadata: { full_name: '바이름 원장님' },
          },
        },
      }),
    },
    from: () => createQueryBuilder(),
  }),
}))

describe('AdsView Route (ANI-887, Figma 37:1782, 38:2701)', () => {
  it('strictly separates core metrics: 플랜 권한, 외부 광고비 KRW while hiding 소희 크레딧 카드', () => {
    render(<AdsView isProviderConnected={true} actualAdSpendKrw={185000} />)

    expect(screen.getByText('1. 서비스 플랜 권한')).toBeDefined()
    expect(screen.queryByText('Pro 비즈니스 플랜')).toBeNull()
    expect(screen.getByText('광고 실행 권한 확인 필요')).toBeDefined()

    expect(screen.queryByText(/소희 크레딧 잔여/)).toBeNull()
    expect(screen.queryByText(/84,000 크레딧/)).toBeNull()

    expect(screen.getByText('2. 외부 광고비 (KRW 실집행)')).toBeDefined()
    expect(screen.getByText(/₩185,000/)).toBeDefined()
  })

  it('allows toggling between delegated autonomy and manual owner approval', () => {
    render(<AdsView isProviderConnected={true} />)

    const manualBtn = screen.getByText('사장님 직접 승인')
    fireEvent.click(manualBtn)

    const delegatedBtn = screen.getByText(/소희 위임 운영/)
    fireEvent.click(delegatedBtn)
  })

  it('provides 44px touch targets and clear aria-pressed toggle state with responsive wrap for 320px mobile', () => {
    render(<AdsView isProviderConnected={true} />)

    const delegatedBtn = screen.getByRole('button', { name: /소희 위임 운영 미리보기/ })
    const manualBtn = screen.getByRole('button', { name: /사장님 직접 승인/ })

    // 44px 터치 타깃 검증
    expect(delegatedBtn.className).toMatch(/min-h-(?:11|\[44px\])/)
    expect(manualBtn.className).toMatch(/min-h-(?:11|\[44px\])/)

    // 토글 컨테이너가 wrap/세로 대응 클래스(flex-wrap 또는 flex-col sm:flex-row)를 가짐
    const toggleGroup = screen.getByRole('group', { name: '운영 모드 선택' })
    expect(toggleGroup.className).toMatch(/flex-wrap|flex-col/)

    // 초기 상태: DELEGATED 활성
    expect(delegatedBtn).toHaveAttribute('aria-pressed', 'true')
    expect(manualBtn).toHaveAttribute('aria-pressed', 'false')

    // 직접 승인 클릭 시 상태 전환
    fireEvent.click(manualBtn)
    expect(delegatedBtn).toHaveAttribute('aria-pressed', 'false')
    expect(manualBtn).toHaveAttribute('aria-pressed', 'true')
  })

  it('does not claim saved guardrails when no persistence capability is connected', () => {
    render(<AdsView isProviderConnected={true} />)

    expect(screen.getByText(/Budget Guardrails & Stop-Loss/)).toBeDefined()
    expect(screen.queryByText(/즉각 자동 일시정지\(Stop-Loss\)/)).toBeNull()
    expect(screen.getByText(/이상 징후 알림/)).toBeInTheDocument()
    const saveBtn = screen.getByRole('button', { name: '가드레일 저장' })
    fireEvent.click(saveBtn)

    expect(saveBtn).toBeDisabled()
    expect(screen.queryByText('✅ 가드레일이 저장되었습니다')).toBeNull()
    expect(screen.getByText(/예산 설정은 아직 서버에 저장되지 않아요/)).toBeDefined()
  })

  it('provides organic boosting recommendation with delegation action', () => {
    render(<AdsView isProviderConnected={true} />)

    expect(screen.getByText(/오가닉 성과 기반 지능형 부스팅/)).toBeDefined()
  })
})
