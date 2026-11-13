import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { BillingView } from './billing-view'

describe('BillingView', () => {
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

  it('신규 월 구독 상품 3종, 결제 진행 골격, 결제 내역, 증빙 안내, 다음 갱신부터 해지 카드를 렌더링하고 레거시 카탈로그 선택기는 노출하지 않는다', () => {
    render(<BillingView intents={[]} />)

    // 1. 신규 구독 상품 비교 (subscriptionOffers 3종)
    expect(screen.getByText('요금제 비교')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '기본 마케팅 직원' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '고성장 전담 직원' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '최상위 총괄' })).toBeInTheDocument()
    expect(screen.getAllByText('월 150,000원 · 부가세 포함').length).toBeGreaterThanOrEqual(1)
    expect(screen.getAllByText('월 300,000원 · 부가세 포함').length).toBeGreaterThanOrEqual(1)
    expect(screen.getAllByText('월 500,000원 · 부가세 포함').length).toBeGreaterThanOrEqual(1)

    // 레거시 카탈로그 및 선택기 미노출 확인
    expect(screen.queryByText('스타터')).not.toBeInTheDocument()
    expect(screen.queryByText('그로스')).not.toBeInTheDocument()
    expect(screen.queryByText('포커스')).not.toBeInTheDocument()
    expect(screen.queryByText('무료 진단')).not.toBeInTheDocument()

    // 2. 결제 진행 골격 (3단계)
    expect(screen.getByText('1. 플랜 확인')).toBeInTheDocument()
    expect(screen.getByText('2. 결제 수단')).toBeInTheDocument()
    expect(screen.getByText('3. 확인')).toBeInTheDocument()

    // 3. 결제 내역 (비어 있을 때 StateView)
    expect(screen.getByText('결제 내역')).toBeInTheDocument()
    expect(screen.getByText('아직 결제 내역이 없어요')).toBeInTheDocument()

    // 4. 영수증 안내 카드
    expect(screen.getByText('영수증 및 증빙 안내')).toBeInTheDocument()

    // 5. 다음 갱신부터 해지 카드 (단정 문구 "언제든 해지" 배제)
    expect(screen.getByRole('heading', { name: '다음 갱신부터 해지' })).toBeInTheDocument()
    expect(screen.queryByText(/언제든 해지/)).not.toBeInTheDocument()
  })

  it('live 일 때 다른 구독 상품을 클릭하면 결제 진행 골격의 상품이 변경된다', () => {
    process.env.NEXT_PUBLIC_BILLING_LIVE = '1'
    render(<BillingView intents={[]} />)

    const growthBtn = screen.getByRole('button', { name: '고성장 전담 직원 선택' })
    fireEvent.click(growthBtn)

    // 결제 진행 골격에 '고성장 전담 직원' 상품이 반영됨
    const matches = screen.getAllByText('고성장 전담 직원')
    expect(matches.length).toBeGreaterThanOrEqual(1)
    expect(screen.getAllByText('월 300,000원 · 부가세 포함').length).toBeGreaterThanOrEqual(1)
  })
})
