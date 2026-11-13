import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { subscriptionOffers, subscriptionOfferPolicy } from '@/features/billing/subscription-offers'
import PaymentInfoPage from './page'

describe('PaymentInfoPage', () => {
  it('결제 안내 문서 구조와 초안 배너를 렌더링한다', () => {
    render(<PaymentInfoPage />)

    expect(screen.getByRole('heading', { level: 1, name: '결제 안내' })).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('초안 — 법률 검토 전')
    expect(screen.getByRole('navigation', { name: '목차' })).toBeInTheDocument()
  })

  it('현재 결제 미연결 상태 사실과 부가세(VAT 포함)를 정본 기준으로 명시한다', () => {
    render(<PaymentInfoPage />)

    const article1 = screen.getByRole('heading', {
      level: 2,
      name: /제1조\s*\(요금제 및 부가가치세\)/,
    })
    expect(article1).toBeInTheDocument()
    const section1 = article1.closest('section')
    expect(section1).toHaveTextContent('결제는 아직 연결되지 않았습니다')
    expect(section1).toHaveTextContent('부가가치세(VAT)를 포함한 최종 결제금액')
    expect(section1).not.toHaveTextContent('VAT 별도')
    expect(section1).not.toHaveTextContent('부가가치세(VAT) 별도')
    expect(section1).not.toHaveTextContent('KG이니시스')
    expect(section1).not.toHaveTextContent('PortOne')

    // 확정 플랜 이름과 금액 렌더링 확인
    for (const plan of subscriptionOffers) {
      expect(section1).toHaveTextContent(plan.name)
      expect(section1).toHaveTextContent(`${plan.monthlyTotalPriceKrw.toLocaleString('ko-KR')}원`)
    }

    // 레거시 플랜명 제거 확인
    expect(section1).not.toHaveTextContent('시작: 월 150,000원')
    expect(section1).not.toHaveTextContent('성장: 월 300,000원')
    expect(section1).not.toHaveTextContent('운영: 월 500,000원')

    // 크레딧 미지급 공지 확인
    expect(section1).toHaveTextContent(subscriptionOfferPolicy.notice)
    expect(section1).toHaveTextContent(subscriptionOfferPolicy.creditNotice)
  })

  it('지원 결제 수단, 서비스 제공기간, 해지 기준 및 영수증/세금계산서 신청 방법을 명시한다', () => {
    render(<PaymentInfoPage />)

    const article2 = screen.getByRole('heading', {
      level: 2,
      name: /제2조\s*\(지원 결제 수단\)/,
    })
    expect(article2).toBeInTheDocument()

    const article3 = screen.getByRole('heading', {
      level: 2,
      name: /제3조\s*\(제공기간·청구 주기·해지 기준\)/,
    })
    expect(article3).toBeInTheDocument()
    const section3 = article3.closest('section')
    expect(section3).toHaveTextContent(subscriptionOfferPolicy.servicePeriod.label)
    expect(section3).toHaveTextContent(subscriptionOfferPolicy.servicePeriod.boundaryNotice)
    expect(section3).toHaveTextContent(subscriptionOfferPolicy.cancellation.label)
    expect(section3).toHaveTextContent(subscriptionOfferPolicy.cancellation.notice)
    expect(section3).toHaveTextContent(subscriptionOfferPolicy.cancellation.refundNotice)
    const refundLink = screen.getByRole('link', { name: /해지·환불 안내/ })
    expect(refundLink).toHaveAttribute('href', '/refund')

    const article4 = screen.getByRole('heading', {
      level: 2,
      name: /제4조\s*\(영수증 및 세금계산서 신청\)/,
    })
    expect(article4).toBeInTheDocument()
    const section4 = article4.closest('section')
    expect(section4).toHaveTextContent('세금계산서')
    expect(section4).toHaveTextContent('매출전표')
  })

  it('미확정 결제 수단 및 발급 일정에 대해 [운영자 확정 필요] 표식을 렌더링한다', () => {
    render(<PaymentInfoPage />)

    const notes = screen.getAllByRole('note', { name: /운영자 확정 필요/ })
    expect(notes.length).toBeGreaterThanOrEqual(3)
  })

  it('문의 창구로 support@example.com을 안내한다', () => {
    render(<PaymentInfoPage />)

    const mailtoLinks = screen.getAllByRole('link', { name: 'support@example.com' })
    expect(mailtoLinks.length).toBeGreaterThanOrEqual(1)
    for (const link of mailtoLinks) {
      expect(link).toHaveAttribute('href', 'mailto:support@example.com')
    }
  })
})
