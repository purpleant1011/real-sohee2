// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import HelpPage from './page'

vi.mock('next/navigation', () => ({
  usePathname: () => '/app/help',
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

describe('HelpPage (도움말)', () => {
  it('자주 묻는 질문 6~8개를 사장님 말로 렌더링한다', () => {
    render(<HelpPage />)

    expect(screen.getByRole('heading', { name: '도움말' })).toBeInTheDocument()

    // 6~8개 필수 질문 키워드 확인
    expect(screen.getByText(/채널 연결은 어떻게 하나요\?/)).toBeInTheDocument()
    expect(screen.getByText(/글은 언제 올라가나요\?/)).toBeInTheDocument()
    expect(screen.getByText(/게시 전에 왜 승인이 필요한가요\?/)).toBeInTheDocument()
    expect(screen.getByText(/요금과 해지는 어떻게 문의하나요\?/)).toBeInTheDocument()
    expect(screen.getByText(/궁금한 점은 어디로 문의하나요\?/)).toBeInTheDocument()
    expect(screen.getByText(/소희가 작성한 글을 수정할 수 있나요\?/)).toBeInTheDocument()
    expect(screen.getByText(/고객 예약 알림은 어떻게 받나요\?/)).toBeInTheDocument()
  })

  it('실제 연락 가능한 고객센터 이메일(support@example.com)과 전화 문의 CTA를 제공한다', () => {
    render(<HelpPage />)

    const emailLink = screen.getByRole('link', { name: /이메일 문의하기/ })
    expect(emailLink).toBeInTheDocument()
    expect(emailLink.getAttribute('href')).toContain('mailto:support@example.com')

    const phoneLink = screen.getByRole('link', { name: /전화 문의하기/ })
    expect(phoneLink).toBeInTheDocument()
    expect(phoneLink.getAttribute('href')).toMatch(/^tel:010-?5885-?4855/)
  })

  it('더보기로 돌아가는 링크가 존재한다', () => {
    render(<HelpPage />)
    const backLinks = screen.getAllByRole('link', { name: /더보기/ })
    expect(backLinks.some((link) => link.getAttribute('href') === '/app/system')).toBe(true)
  })
})
