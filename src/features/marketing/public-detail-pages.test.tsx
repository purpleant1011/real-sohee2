import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import ProductPage from '@/app/(public)/product/page'
import PricingPage from '@/app/(public)/pricing/page'
import RefundPage from '@/app/(public)/refund/page'
import ChannelsPage from '@/app/(public)/channels/page'
import IndustryPage from '@/app/(public)/industries/[industry]/page'

describe('V0.85 public detail pages', () => {
  it('제품 상세가 고객 성장 흐름을 설명한다', () => {
    render(<ProductPage />)
    expect(screen.getByRole('heading', { name: '고객 반응에서 다음 성장 행동까지.' })).toBeInTheDocument()
    expect(screen.getByText('신호 포착')).toBeInTheDocument()
    expect(screen.getByText('예약과 재방문')).toBeInTheDocument()
  })

  it('요금 상세가 결과와 결제 경계를 함께 설명한다', () => {
    render(<PricingPage />)
    expect(screen.getByRole('heading', { name: '내 매장의 운영 범위에 맞춰 시작하세요.' })).toBeInTheDocument()
    expect(screen.getByText(/결제는 아직 연결되지 않았습니다/)).toBeInTheDocument()
  })

  it('구독은 지급 크레딧 없이 기능 이용권으로 안내하고 미확정 결제를 차단한다', () => {
    const { container } = render(<PricingPage />)
    for (const name of ['기본 마케팅 직원', '고성장 전담 직원', '최상위 총괄']) {
      expect(screen.getByRole('heading', { name })).toBeInTheDocument()
    }
    expect(screen.getByText(/월 구독에 크레딧을 지급하지 않습니다/)).toBeInTheDocument()
    expect(screen.getByText(/별도 상품/)).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: '결제 준비 중' })).toHaveLength(3)
    for (const button of screen.getAllByRole('button', { name: '결제 준비 중' })) expect(button).toBeDisabled()
    expect(screen.getAllByText('부가가치세(VAT) 포함')).toHaveLength(3)
    expect(screen.getAllByText('결제일부터 1개월')).toHaveLength(3)
    expect(screen.getAllByText('다음 갱신부터 해지')).toHaveLength(3)
    expect(screen.getByText(/법령에 따른 권리를 제한하지 않습니다/)).toBeInTheDocument()
    expect(screen.getByText(/다음 달에 같은 날짜가 없으면 말일/)).toBeInTheDocument()
    expect(container.textContent).not.toContain('제공기간·갱신·해지 조건 확정 전')
    for (const amount of ['월 150,000원', '월 300,000원', '월 500,000원']) expect(screen.getByText(amount)).toBeInTheDocument()
    expect(container.textContent).not.toMatch(/165,000|330,000|550,000|최종 결제금액이 아닙니다|부가가치세 포함 여부/)
    expect(screen.getByRole('link', { name: '해지·환불 안내' })).toHaveAttribute('href', '/refund')
    expect(container.textContent).not.toMatch(/VAT 별도|\\d[\\d,]* Energy|월 기본량|전체 지원 채널/)
  })

  it('해지 안내는 현재 기간 보존·다음 결제 중단과 법정 환불 권리를 함께 밝힌다', () => {
    const { container } = render(<RefundPage />)
    expect(screen.getByRole('heading', { name: '해지·환불 안내' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '다음 갱신부터 해지' })).toBeInTheDocument()
    expect(screen.getByText(/현재 결제된 이용기간은 유지/)).toBeInTheDocument()
    expect(screen.getByText(/법령에 따른 권리를 제한하지 않습니다/)).toBeInTheDocument()
    expect(screen.getByText(/온라인 해지·환불 요청 기능은 아직 제공하지 않습니다/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'support@example.com' })).toHaveAttribute('href', 'mailto:support@example.com')
    expect(container.textContent).not.toMatch(/환불 불가|환불불가|해지 완료|환불 완료/)
  })

  it('채널 상세가 사용자 최종 게시 경계를 보여준다', () => {
    render(<ChannelsPage />)
    expect(screen.getByText('사용자 최종 게시 흐름 검증 완료')).toBeInTheDocument()
  })

  it('교육 업종 상세가 체험과 등록 결과를 설명한다', async () => {
    const view = await IndustryPage({ params: Promise.resolve({ industry: 'education' }) })
    render(view)
    expect(screen.getByRole('heading', { name: '과정 문의에서 체험과 등록까지' })).toBeInTheDocument()
  })
})
