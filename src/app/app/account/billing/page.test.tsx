import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import BillingPage from './page'
import { OPERATOR_INFO } from '@/features/marketing/operator-information'

vi.mock('@/features/auth/current-workspace', () => ({
  getCurrentWorkspaceContext: vi.fn(async () => ({
    workspaceId: 'ws-test-billing',
    role: 'owner',
  })),
}))

vi.mock('@/features/billing/repository', () => ({
  listCheckoutIntents: vi.fn(async () => ({
    data: [],
  })),
}))

vi.mock('@/components/v088/layout/v088-app-shell', () => ({
  V088AppShell: ({ children }: { children: React.ReactNode }) => <div data-testid="app-shell">{children}</div>,
}))

vi.mock('next/navigation', () => ({
  usePathname: () => '/app/account/billing',
  redirect: vi.fn(),
}))

describe('BillingPage (/app/account/billing)', () => {
  it('데스크톱 셸과 공통 설정 레이아웃 안에서 신규 구독 요금제 비교, 3단계 결제 골격, 결제 내역, 증빙 안내, 다음 갱신부터 해지 카드를 렌더링한다', async () => {
    const page = await BillingPage()
    const { container } = render(page)

    expect(screen.getByTestId('app-shell')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '요금제 및 결제' })).toBeInTheDocument()

    // 1. 신규 구독 상품 비교 (기본 마케팅 직원, 고성장 전담 직원, 최상위 총괄)
    expect(screen.getByText('요금제 비교')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '기본 마케팅 직원' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '고성장 전담 직원' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '최상위 총괄' })).toBeInTheDocument()

    // 2. 3단계 결제 진행 골격
    expect(screen.getByText('1. 플랜 확인')).toBeInTheDocument()
    expect(screen.getByText('2. 결제 수단')).toBeInTheDocument()
    expect(screen.getByText('3. 확인')).toBeInTheDocument()

    // 3. 결제 내역 및 빈 상태 StateView
    expect(screen.getByText('결제 내역')).toBeInTheDocument()
    expect(screen.getByText('아직 결제 내역이 없어요')).toBeInTheDocument()

    // 4. 영수증 및 증빙 안내 카드
    expect(screen.getByText('영수증 및 증빙 안내')).toBeInTheDocument()
    expect(screen.getAllByText(new RegExp(OPERATOR_INFO.phone)).length).toBeGreaterThanOrEqual(1)
    expect(screen.getAllByText(new RegExp(OPERATOR_INFO.supportEmail)).length).toBeGreaterThanOrEqual(1)

    // 5. 다음 갱신부터 해지 카드 (단정 문구 "언제든 해지" 배제)
    expect(screen.getByRole('heading', { name: '다음 갱신부터 해지' })).toBeInTheDocument()
    expect(screen.queryByText(/언제든 해지/)).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: /환불/ })).toHaveAttribute('href', '/refund')

    // 안전 가드: 카드번호 입력 필드가 없어야 함
    const textInputs = container.querySelectorAll('input[type="text"], input[type="password"], input[type="number"]')
    expect(textInputs.length).toBe(0)
  })
})
