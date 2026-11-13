import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import RefundPage from '@/app/(public)/refund/page'
import { subscriptionOfferPolicy } from '@/features/billing/subscription-offers'

describe('RefundPage - 해지·환불 안내 페이지', () => {
  it('제목과 필수 섹션 heading을 렌더링한다', () => {
    render(<RefundPage />)

    expect(screen.getByRole('heading', { level: 1, name: '해지·환불 안내' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 2, name: '다음 갱신부터 해지' })).toBeInTheDocument()
  })

  it('Task 1 cancellation 공유 정본의 notice와 refundNotice를 온전히 노출한다', () => {
    render(<RefundPage />)

    expect(screen.getByText(subscriptionOfferPolicy.cancellation.notice)).toBeInTheDocument()
    expect(screen.getByText(subscriptionOfferPolicy.cancellation.refundNotice)).toBeInTheDocument()
    expect(screen.getByText(/현재 결제된 이용기간은 유지/)).toBeInTheDocument()
    expect(screen.getByText(/법령에 따른 권리를 제한하지 않습니다/)).toBeInTheDocument()
  })

  it('온라인 해지·환불 기능 미제공 및 환불 계산식/기한 미확정·유료판매 차단 사실을 명시한다', () => {
    render(<RefundPage />)

    expect(screen.getByText(/온라인 해지·환불 요청 기능은 아직 제공하지 않습니다/)).toBeInTheDocument()
    expect(screen.getByText(/환불 계산식과 처리기한은 아직 확정되지 않았습니다/)).toBeInTheDocument()
    expect(screen.getByText(/유료 플랜 판매 및 자동청구가 차단된 상태입니다/)).toBeInTheDocument()
  })

  it('지원 이메일 mailto 및 pricing, terms 링크를 올바르게 제공한다', () => {
    render(<RefundPage />)

    const mailLink = screen.getByRole('link', { name: 'support@example.com' })
    expect(mailLink).toHaveAttribute('href', 'mailto:support@example.com')

    const pricingLink = screen.getByRole('link', { name: '요금 안내' })
    expect(pricingLink).toHaveAttribute('href', '/pricing')

    const termsLink = screen.getByRole('link', { name: '이용약관' })
    expect(termsLink).toHaveAttribute('href', '/terms')
  })

  it('작동하지 않는 요청 버튼이나 임의의 환불불가·완료 문구가 존재하지 않는다', () => {
    const { container } = render(<RefundPage />)

    expect(screen.queryAllByRole('button')).toHaveLength(0)
    expect(container.textContent).not.toMatch(/환불 불가|환불불가|해지 완료|환불 완료/)
  })
})
