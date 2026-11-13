import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { BillingCheckoutFlow } from './billing-checkout-flow'

describe('BillingCheckoutFlow', () => {
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

  it('3단계 (플랜 확인 → 결제 수단 → 확인) 흐름을 제공하며 정본 구독 상품 정보를 표시한다', () => {
    render(<BillingCheckoutFlow offerCode="GROWTH_300K" />)

    // 단계 스텝퍼
    expect(screen.getByText('1. 플랜 확인')).toBeInTheDocument()
    expect(screen.getByText('2. 결제 수단')).toBeInTheDocument()
    expect(screen.getByText('3. 확인')).toBeInTheDocument()

    // 1단계: 구독 상품 정보
    expect(screen.getByText('고성장 전담 직원')).toBeInTheDocument()
    expect(screen.getByText('월 300,000원 · 부가세 포함')).toBeInTheDocument()
    expect(screen.getByText('AI 모델·기능 이용권')).toBeInTheDocument()
    expect(screen.getByText('세부 범위는 확정 후 안내')).toBeInTheDocument()
  })

  it('2단계 결제 수단: 안전 결제창 안내 문구 노출 및 카드번호 입력 필드가 없어야 한다', () => {
    const { container } = render(<BillingCheckoutFlow offerCode="GROWTH_300K" initialStep={2} />)

    expect(screen.getByText('카드·간편결제는 안전한 결제창에서 입력해요')).toBeInTheDocument()

    // 카드번호, 유효기간, CVC 등 민감 정보 입력 필드가 절대 없어야 함
    const inputs = container.querySelectorAll('input')
    expect(inputs.length).toBe(0)

    // isBillingLive 가 false 일 때 결제 수단 버튼 비활성 및 결제 준비 중 안내
    const disabledBtn = screen.getByRole('button', { name: '결제 준비 중' })
    expect(disabledBtn).toBeDisabled()
  })

  it('3단계 확인: 서비스 기간/해지 문구 재사용, 확정 후 안내, 이용약관/환불 동의 링크 및 자동갱신 동의 문구 배제를 검증한다', () => {
    render(<BillingCheckoutFlow offerCode="GROWTH_300K" initialStep={3} />)

    // 서비스 기간 및 해지 문구 (정본 정책 재사용)
    expect(screen.getByText('결제일부터 1개월')).toBeInTheDocument()
    expect(screen.getByText('다음 갱신부터 해지')).toBeInTheDocument()
    expect(screen.getByText(/해지 시 현재 결제된 이용기간은 유지되며 다음 갱신 결제 중단이 적용됩니다/)).toBeInTheDocument()

    // 자동갱신 조건 및 환불 세부: 확정 후 안내 (수치·영업일 없음)
    const pendingNotices = screen.getAllByText('확정 후 안내')
    expect(pendingNotices.length).toBeGreaterThanOrEqual(2)
    expect(screen.queryByText(/\d+일/)).not.toBeInTheDocument()
    expect(screen.queryByText(/영업일/)).not.toBeInTheDocument()

    // 자동갱신 동의 문구 절대 금지 확인
    expect(screen.queryByText(/자동 갱신에 동의/)).not.toBeInTheDocument()

    // 약관 및 환불 안내 링크
    const termsLink = screen.getByRole('link', { name: '이용약관' })
    const refundLink = screen.getByRole('link', { name: '환불 안내' })
    expect(termsLink).toHaveAttribute('href', '/terms')
    expect(refundLink).toHaveAttribute('href', '/refund')

    // 필수 동의 체크박스 라벨: "이용약관과 환불 안내를 확인했어요" (44px 클릭 영역)
    const consentLabel = screen.getByText('이용약관과 환불 안내를 확인했어요').closest('label')
    expect(consentLabel).toHaveClass('min-h-[44px]')
  })

  it('isBillingLive false 일 때 fetch 및 체크아웃 API 호출이 일어나지 않는다', () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    render(<BillingCheckoutFlow offerCode="GROWTH_300K" initialStep={3} />)

    // 동의 체크박스 클릭
    const checkbox = screen.getByRole('checkbox', { name: /이용약관과 환불 안내를 확인했어요/ })
    fireEvent.click(checkbox)
    expect(checkbox).toBeChecked()

    // isBillingLive 가 false 이므로 최종 버튼은 비활성 상태 유지
    const submitBtn = screen.getByRole('button', { name: '결제 준비 중' })
    expect(submitBtn).toBeDisabled()

    // 클릭 시도
    fireEvent.click(submitBtn)

    // fetch 호출이 전혀 없어야 함
    expect(fetchSpy).not.toHaveBeenCalled()
  })
})
