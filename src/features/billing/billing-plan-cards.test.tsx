import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { BillingPlanCards } from './billing-plan-cards'

describe('BillingPlanCards', () => {
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
    vi.restoreAllMocks()
  })

  it('subscriptionOffers 3종 카드와 상품 유형, 정본 가격, 확정 후 안내 문구를 렌더링한다', () => {
    render(<BillingPlanCards selectedOfferCode="STARTER_150K" />)

    // 3개 구독 상품 이름
    for (const name of ['기본 마케팅 직원', '고성장 전담 직원', '최상위 총괄']) {
      expect(screen.getByRole('heading', { name })).toBeInTheDocument()
    }

    // 정본 가격 라벨 (VAT 포함)
    expect(screen.getByText('월 150,000원 · 부가세 포함')).toBeInTheDocument()
    expect(screen.getByText('월 300,000원 · 부가세 포함')).toBeInTheDocument()
    expect(screen.getByText('월 500,000원 · 부가세 포함')).toBeInTheDocument()

    // 상품 유형
    const kindBadges = screen.getAllByText('AI 모델·기능 이용권')
    expect(kindBadges).toHaveLength(3)

    // 한 줄 설명 (새 문구 금지, 세부 범위는 확정 후 안내)
    const notices = screen.getAllByText('세부 범위는 확정 후 안내')
    expect(notices).toHaveLength(3)

    // 크레딧 숫자 노출 금지 확인
    expect(screen.queryByText(/크레딧/)).not.toBeInTheDocument()
  })

  it('isBillingLive false 일 때 모든 선택 버튼은 비활성 결제 준비 중 상태이다', () => {
    render(<BillingPlanCards selectedOfferCode="STARTER_150K" />)

    const buttons = screen.getAllByRole('button', { name: '결제 준비 중' })
    expect(buttons).toHaveLength(3)
    for (const btn of buttons) {
      expect(btn).toBeDisabled()
    }
  })

  it('isBillingLive true 일 때 상품 선택 버튼 클릭 시 콜백을 호출한다', () => {
    process.env.NEXT_PUBLIC_BILLING_LIVE = '1'
    const handleSelect = vi.fn()
    render(<BillingPlanCards selectedOfferCode="STARTER_150K" onSelectOffer={handleSelect} />)

    const growthButton = screen.getByRole('button', { name: '고성장 전담 직원 선택' })
    fireEvent.click(growthButton)

    expect(handleSelect).toHaveBeenCalledWith('GROWTH_300K')
  })

  it('플랜 변경 조건이 확정되기 전이라 "언제든 변경" 같은 약속을 하지 않는다', () => {
    const { container } = render(<BillingPlanCards />)
    expect(container).not.toHaveTextContent('언제든 변경')
  })
})
