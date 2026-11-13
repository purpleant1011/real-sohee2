import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ saveCheckoutIntentAction: vi.fn() }))

vi.mock('./actions/save-checkout-intent', () => ({ saveCheckoutIntentAction: mocks.saveCheckoutIntentAction }))

import { BillingPlanSelector } from './billing-plan-selector'

describe('BillingPlanSelector', () => {
  it('shows all four plan tiers with price while hiding weekly credit amounts and keeping payment activation explicitly pending', () => {
    render(<BillingPlanSelector canSelect />)

    for (const label of ['스타터', '그로스', '운영', '포커스']) {
      expect(screen.getByRole('heading', { name: label })).toBeInTheDocument()
    }
    expect(screen.getByText('월 0원')).toBeInTheDocument()
    expect(screen.getByText('월 15만원')).toBeInTheDocument()
    expect(screen.getByText('월 30만원')).toBeInTheDocument()
    expect(screen.getByText('월 50만원')).toBeInTheDocument()
    expect(screen.queryByText(/주간 .* 크레딧/)).not.toBeInTheDocument()
    expect(screen.queryByText('포함 크레딧 정책 확정 전')).not.toBeInTheDocument()
    expect(screen.queryByText(/PG 연결 전/)).not.toBeInTheDocument()
    expect(screen.getAllByText('결제 기능 준비 중 · 원하는 요금제를 미리 찜해둘 수 있어요.')).toHaveLength(4)
    expect(screen.getByText('요금제를 선택해도 결제 또는 활성화가 완료되지는 않습니다.')).toBeInTheDocument()
  })

  it('saves a plan selection only as provider pending intent', async () => {
    mocks.saveCheckoutIntentAction.mockResolvedValue({
      data: { checkoutIntentId: '30000000-0000-4000-8000-000000000001', state: 'provider_pending' },
    })
    render(<BillingPlanSelector canSelect />)

    fireEvent.click(screen.getByRole('button', { name: '그로스 선택 저장' }))

    await waitFor(() => expect(mocks.saveCheckoutIntentAction).toHaveBeenCalledWith(expect.objectContaining({ planCode: 'growth' })))
    expect(await screen.findByText('그로스 선택을 저장했습니다. 결제와 활성화는 아직 시작되지 않았습니다.')).toBeVisible()
    expect(screen.queryByText('결제 완료')).not.toBeInTheDocument()
  })
})
