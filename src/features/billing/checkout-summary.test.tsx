import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { CheckoutSummary } from './checkout-summary'

describe('CheckoutSummary', () => {
  it('does not call a pending checkout paid', () => {
    render(<CheckoutSummary intent={{ id: '10000000-0000-4000-8000-000000000001', workspaceId: '20000000-0000-4000-8000-000000000001', billingPlanId: '30000000-0000-4000-8000-000000000001', idempotencyKey: 'x', state: 'provider_pending', providerReference: null, createdAt: '2026-08-19T00:00:00.000Z' }} />)
    expect(screen.getByText('결제 기능 연결 대기')).toBeVisible()
    expect(screen.queryByText('결제 완료')).not.toBeInTheDocument()
  })
})
