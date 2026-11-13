import { render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { BillingCancellationCard } from './billing-cancellation-card'

describe('BillingCancellationCard', () => {
  const originalEnv = process.env.NEXT_PUBLIC_BILLING_LIVE

  beforeEach(() => {
    delete process.env.NEXT_PUBLIC_BILLING_LIVE
  })

  afterEach(() => {
    if (originalEnv !== undefined) {
      process.env.NEXT_PUBLIC_BILLING_LIVE = originalEnv
    } else {
      delete process.env.NEXT_PUBLIC_BILLING_LIVE
    }
  })

  it('"다음 갱신부터 해지" 기준 문구를 노출하고 "언제든 해지" 같은 단정 문구가 없어야 한다', () => {
    render(<BillingCancellationCard />)

    // "다음 갱신부터 해지" 기준 문구 노출
    expect(screen.getByRole('heading', { name: '다음 갱신부터 해지' })).toBeInTheDocument()
    expect(screen.getByText(/해지 시 현재 결제된 이용기간은 유지되며 다음 갱신 결제 중단이 적용됩니다/)).toBeInTheDocument()

    // "언제든 해지" 같은 단정 삭제 확인
    expect(screen.queryByText(/언제든 해지/)).not.toBeInTheDocument()

    // 환불 링크
    const refundLink = screen.getByRole('link', { name: /환불/ })
    expect(refundLink).toHaveAttribute('href', '/refund')
  })

  it('셀프 해지 버튼은 항상 비활성 상태를 유지한다', () => {
    const { rerender } = render(<BillingCancellationCard />)

    const btn1 = screen.getByRole('button', { name: '결제 준비 중' })
    expect(btn1).toBeDisabled()

    // live 가 1이어도 셀프 해지 버튼은 비활성 유지
    process.env.NEXT_PUBLIC_BILLING_LIVE = '1'
    rerender(<BillingCancellationCard />)
    const btn2 = screen.getByRole('button', { name: '결제 준비 중' })
    expect(btn2).toBeDisabled()
  })
})
