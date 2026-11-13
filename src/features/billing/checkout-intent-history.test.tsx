import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { CheckoutIntentHistory } from './checkout-intent-history'

describe('CheckoutIntentHistory', () => {
  it('shows provider pending as a saved selection without payment, receipt, or activation success', () => {
    render(<CheckoutIntentHistory intents={[{ id: '1', workspaceId: 'w', billingPlanId: 'p', idempotencyKey: 'i', state: 'provider_pending', providerReference: null, createdAt: '2026-08-19T00:00:00.000Z' }]} />)
    expect(screen.getByText('결제 기능 연결 대기')).toBeVisible()
    expect(screen.getByText('선택 저장 · 결제 및 활성화 대기')).toBeVisible()
    expect(screen.queryByText('결제 완료')).not.toBeInTheDocument()
  })

  it('비어 있으면 StateView 로 아직 결제 내역이 없음을 안내한다', () => {
    render(<CheckoutIntentHistory intents={[]} />)
    expect(screen.getByText('아직 결제 내역이 없어요')).toBeInTheDocument()
  })
})
