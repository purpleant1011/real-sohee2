import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import SystemSettingsPage from '../system-view'

vi.mock('@/hooks/use-workspace-context', () => ({
  useWorkspaceId: vi.fn(() => 'ws-test-commercial'),
  useWorkspaceContext: vi.fn(() => ({ workspaceId: 'ws-test-commercial' })),
  useOptionalWorkspaceContext: vi.fn(() => ({ workspaceId: 'ws-test-commercial' })),
}))

vi.mock('next/navigation', () => ({
  usePathname: () => '/app/system',
  useSearchParams: () => new URLSearchParams(),
}))

vi.mock('@/components/v088/layout/v088-app-shell', () => ({
  V088AppShell: ({ children }: { children: React.ReactNode }) => <div data-testid="app-shell">{children}</div>,
}))

vi.mock('@/lib/supabase/client', () => ({
  createBrowserSupabaseClient: vi.fn(() => ({
    auth: {
      getUser: vi.fn(async () => ({ data: { user: { email: 'owner@byreum.com' } } })),
    },
  })),
}))

const mockUseCreditBalance = vi.fn()
vi.mock('@/hooks/use-credit-balance', () => ({
  useCreditBalance: () => mockUseCreditBalance(),
}))

describe('SystemSettingsPage V0.9 Commercial Truth & Billing Section Replacement', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders single billing entry point linking to /app/account/billing without legacy 4-tier cards or fake payment methods', () => {
    render(<SystemSettingsPage />)

    // 1. Fake credit card and payment method state must NOT be present
    expect(screen.queryByText('****-****-****-3042')).toBeNull()
    expect(screen.queryByText('현대카드 (개인)')).toBeNull()
    expect(screen.queryByText('등록된 결제 수단')).toBeNull()
    expect(screen.queryByText('등록된 결제 수단 없음')).toBeNull()
    expect(screen.queryByText('정기 구독 카드 정상 활성')).toBeNull()
    expect(screen.queryByText('카드 등록')).toBeNull()
    expect(screen.queryByText('카드 변경')).toBeNull()

    // 2. Fake paid invoice/receipt and receipts download must NOT be present
    expect(screen.queryByText('최근 결제 영수증')).toBeNull()
    expect(screen.queryByText('유료 결제 내역 없음')).toBeNull()
    expect(screen.queryByText('2026.08.07 (₩150,000 결제완료)')).toBeNull()

    // 3. Legacy 4-tier plan comparison cards must NOT exist
    expect(screen.queryByText('요금제 플랜 구성')).toBeNull()
    expect(screen.queryByText('스타터')).toBeNull()
    expect(screen.queryByText('그로스')).toBeNull()
    expect(screen.queryByText('운영')).toBeNull()
    expect(screen.queryByText('포커스')).toBeNull()
    expect(screen.queryByText('14일 무료 체험')).toBeNull()
    expect(screen.queryByText('0원 무료 체험')).toBeNull()
    expect(screen.queryByText('플랜 업그레이드')).toBeNull()
    expect(screen.queryByText('플랜 구독하기')).toBeNull()

    // 4. Must not expose ₩ prices or Energy vocabulary in this view
    expect(screen.queryByText(/₩150,000/)).toBeNull()
    expect(screen.queryByText(/₩300,000/)).toBeNull()
    expect(screen.queryByText(/₩500,000/)).toBeNull()
    expect(screen.queryByText(/Energy/i)).toBeNull()

    // 5. Must render single canonical billing link to /app/account/billing without duplicate CTA cards
    const billingLinks = screen.getAllByRole('link', { name: /^요금제 및 결제$/ })
    expect(billingLinks).toHaveLength(1)
    expect(billingLinks[0]).toHaveAttribute('href', '/app/account/billing')
    expect(screen.queryByRole('link', { name: '요금제와 결제 보기' })).toBeNull()
  })

  it('does not mount ProofOfWorkPaywallModal or show paywall dialog', () => {
    render(<SystemSettingsPage />)

    // Paywall dialog must NOT exist
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.queryByText('소희 월 구독 안내')).toBeNull()
  })
})
