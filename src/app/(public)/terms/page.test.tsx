import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { subscriptionOffers, subscriptionOfferPolicy } from '@/features/billing/subscription-offers'
import { OPERATOR_INFO } from '@/features/marketing/operator-information'
import TermsPage from './page'

describe('TermsPage', () => {
  it('이용약관 문서 구조와 초안 배너를 렌더링한다', () => {
    render(<TermsPage />)

    expect(screen.getByRole('heading', { level: 1, name: '이용약관' })).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('초안 — 법률 검토 전')
    expect(screen.getByRole('navigation', { name: '목차' })).toBeInTheDocument()
  })

  it('제1조에 OPERATOR_INFO의 확정된 운영사 법적 정보를 명시한다', () => {
    render(<TermsPage />)

    const article1 = screen.getByRole('heading', { level: 2, name: /제1조\s*\(목적\)/ })
    expect(article1).toBeInTheDocument()

    const section = article1.closest('section')
    expect(section).toHaveTextContent(OPERATOR_INFO.companyName)
    expect(section).toHaveTextContent(OPERATOR_INFO.representative)
    expect(section).toHaveTextContent(OPERATOR_INFO.businessRegistrationNumber)
    expect(section).toHaveTextContent(OPERATOR_INFO.telecomRegistrationNumber)
    expect(section).toHaveTextContent(OPERATOR_INFO.address)
    expect(section).toHaveTextContent(OPERATOR_INFO.phone)
  })

  it('제4조 서비스 내용에 확인된 연동 채널(Instagram, Threads, Naver, Kakao, 당근)을 명시한다', () => {
    render(<TermsPage />)

    const article4 = screen.getByRole('heading', { level: 2, name: /제4조\s*\(서비스 내용\)/ })
    expect(article4).toBeInTheDocument()

    const section = article4.closest('section')
    expect(section).toHaveTextContent('Instagram')
    expect(section).toHaveTextContent('Threads')
    expect(section).toHaveTextContent('Naver')
    expect(section).toHaveTextContent('Kakao')
    expect(section).toHaveTextContent('당근')
  })

  it('제9조에 이용자(사장님)의 사전 승인 후에만 게시·발송한다는 사실과 승인자의 책임을 명시한다', () => {
    render(<TermsPage />)

    const article9 = screen.getByRole('heading', {
      level: 2,
      name: /제9조\s*\(게시·발송에 대한 이용자 승인과 책임\)/,
    })
    expect(article9).toBeInTheDocument()

    const section = article9.closest('section')
    expect(section).toHaveTextContent('승인')
    expect(section).toHaveTextContent('자율적으로 게시하지 않습니다')
  })

  it('제6조에 확정 요금제 이름/금액과 VAT 포함, 크레딧 미지급, 결제 미연결 사실을 명시한다', () => {
    render(<TermsPage />)

    const article6 = screen.getByRole('heading', {
      level: 2,
      name: /제6조\s*\(이용요금·정기결제·자동 갱신\)/,
    })
    expect(article6).toBeInTheDocument()

    const section = article6.closest('section')
    expect(section).toHaveTextContent('부가가치세(VAT)를 포함한 최종 결제금액')
    expect(section).not.toHaveTextContent('VAT 별도')
    expect(section).not.toHaveTextContent('부가가치세(VAT)는 별도')

    for (const plan of subscriptionOffers) {
      expect(section).toHaveTextContent(plan.name)
      expect(section).toHaveTextContent(`${plan.monthlyTotalPriceKrw.toLocaleString('ko-KR')}원`)
    }

    expect(section).toHaveTextContent(subscriptionOfferPolicy.notice)
    expect(section).toHaveTextContent(subscriptionOfferPolicy.servicePeriod.label)
    expect(section).toHaveTextContent(subscriptionOfferPolicy.cancellation.label)
    expect(section).toHaveTextContent(subscriptionOfferPolicy.cancellation.notice)
    expect(section).toHaveTextContent('결제는 아직 연결되지 않았습니다')
    expect(section).not.toHaveTextContent('이니시스')
    expect(section).not.toHaveTextContent('PortOne')
  })

  it('제7조에 환불 안내 페이지 링크와 법정 권리 보호 문구를 제공하고 임의 환불 기간·수치를 적지 않는다', () => {
    render(<TermsPage />)

    const article7 = screen.getByRole('heading', {
      level: 2,
      name: /제7조\s*\(청약철회·환불\)/,
    })
    expect(article7).toBeInTheDocument()

    const section = article7.closest('section')
    expect(section).toHaveTextContent(subscriptionOfferPolicy.cancellation.refundNotice)
    const refundLink = screen.getByRole('link', { name: /해지·환불 안내/ })
    expect(refundLink).toHaveAttribute('href', '/refund')

    // 임의 영업일이나 7일 등 수치 하드코딩 없음
    expect(section).not.toHaveTextContent('7일')
    expect(section).not.toHaveTextContent('3영업일')
  })

  it('운영자가 채워야 할 미확정 사항에 대해 [운영자 확정 필요] 표식을 렌더링한다', () => {
    render(<TermsPage />)

    const notes = screen.getAllByRole('note', { name: /운영자 확정 필요/ })
    expect(notes.length).toBeGreaterThanOrEqual(3)
  })

  it('문의 창구로 support@example.com을 안내한다', () => {
    render(<TermsPage />)

    const mailtoLinks = screen.getAllByRole('link', { name: 'support@example.com' })
    expect(mailtoLinks.length).toBeGreaterThanOrEqual(1)
    for (const link of mailtoLinks) {
      expect(link).toHaveAttribute('href', 'mailto:support@example.com')
    }
  })
})
