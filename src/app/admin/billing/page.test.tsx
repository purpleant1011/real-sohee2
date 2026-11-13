import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

vi.mock('../../../features/operator-auth/require-operator', () => ({
  requireOperatorAnyScope: vi.fn(async () => ({ userId: '10000000-0000-4000-8000-000000000001' })),
}))
vi.mock('../../../features/operator-billing/billing-read-repository', () => ({
  listOperatorBillingOverviewForFormalMembers: vi.fn(async () => ({ data: { items: [], summary: { state: 'empty', workspaceCount: null, sourceTimestamp: '2026-08-23T03:00:00.000Z' } }, error: null })),
}))

import { requireOperatorAnyScope } from '../../../features/operator-auth/require-operator'
import { listOperatorBillingOverviewForFormalMembers } from '../../../features/operator-billing/billing-read-repository'
import Page from './page'

describe('OperatorBillingPage', () => {
  it('guards billing directly and renders the billing operations view', async () => {
    const view = await Page()
    expect(requireOperatorAnyScope).toHaveBeenCalledWith('billing.read')
    const text = JSON.stringify(view)
    expect(text).toContain('items')
    expect(text).toContain('workspaceCount')
    expect(text).not.toContain('10000000-0000-4000-8000-000000000001')
    expect(text).not.toMatch(/12,800,000|284,300|680,000|9,088,700|71%/)
  })

  it('renders load error notice with Korean header when billing read fails', async () => {
    vi.mocked(listOperatorBillingOverviewForFormalMembers).mockResolvedValueOnce({ data: null, error: 'BILLING_READ_UNAVAILABLE' })
    render(await Page())
    expect(screen.getByText('결제·구독')).toBeInTheDocument()
    expect(screen.getByText('고객사별 구독 요금제, 크레딧 잔액 및 결제 상태를 확인합니다.')).toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent('결제·구독 정보')
    expect(screen.getByRole('alert')).toHaveTextContent('불러오지 못했어요')
  })

  it('shows the authentication action when billing read requires MFA', async () => {
    vi.mocked(listOperatorBillingOverviewForFormalMembers).mockResolvedValueOnce({ data: null, error: 'MFA_REQUIRED' })
    render(await Page())
    expect(screen.getByRole('alert')).toHaveTextContent('추가 인증(2단계)')
    expect(screen.getByRole('link', { name: '추가 인증하러 가기' })).toHaveAttribute('href', '/auth/admin-setup')
  })
})
