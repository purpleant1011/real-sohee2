import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  requestIssueBillingKey: vi.fn(),
}))

vi.mock('@portone/browser-sdk/v2', () => ({
  requestIssueBillingKey: mocks.requestIssueBillingKey,
}))

import { PgReviewCheckout } from './pg-review-checkout'
import { metadata as pageMetadata } from '@/app/(public)/pg-review/page'

describe('PgReviewCheckout', () => {
  const originalFetch = globalThis.fetch

  beforeEach(() => {
    vi.clearAllMocks()
    globalThis.fetch = vi.fn()
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  it('renders explicit TEST notices, plans, form inputs, and real document links', () => {
    render(<PgReviewCheckout />)

    expect(screen.getByRole('heading', { name: '심사용 TEST 카드등록창 확인' })).toBeInTheDocument()
    expect(screen.getByText(/실제 청구 및 구독 활성화는 진행되지 않습니다/)).toBeInTheDocument()
    expect(screen.getByText(/최종 카드등록, 본인인증, 실출금 행위는 금지/)).toBeInTheDocument()

    // 3 offers
    expect(screen.getByLabelText(/기본 마케팅 직원/)).toBeInTheDocument()
    expect(screen.getByLabelText(/고성장 전담 직원/)).toBeInTheDocument()
    expect(screen.getByLabelText(/최상위 총괄/)).toBeInTheDocument()

    // Form inputs
    expect(screen.getByLabelText(/워크스페이스 식별자/)).toBeInTheDocument()
    expect(screen.getByLabelText(/담당자 이름/)).toBeInTheDocument()
    expect(screen.getByLabelText(/담당자 이메일/)).toBeInTheDocument()
    expect(screen.getByLabelText(/담당자 전화번호/)).toBeInTheDocument()

    // Real document links
    const termsLink = screen.getByRole('link', { name: '이용약관' })
    const privacyLink = screen.getByRole('link', { name: '개인정보 처리방침' })
    const refundLink = screen.getByRole('link', { name: '해지·환불 안내' })

    expect(termsLink).toHaveAttribute('href', '/terms')
    expect(privacyLink).toHaveAttribute('href', '/privacy')
    expect(refundLink).toHaveAttribute('href', '/refund')

    // Submit button
    expect(screen.getByRole('button', { name: 'TEST 카드등록창 열기' })).toBeEnabled()

    // Ensure no SDK or external calls before submission
    expect(mocks.requestIssueBillingKey).not.toHaveBeenCalled()
    expect(globalThis.fetch).not.toHaveBeenCalled()
  })

  it('blocks duplicate pending submissions while request is ongoing', async () => {
    let resolveFetch: (value: any) => void
    ;(globalThis.fetch as any).mockReturnValue(
      new Promise((res) => {
        resolveFetch = res
      }),
    )

    render(<PgReviewCheckout />)

    fireEvent.change(screen.getByLabelText(/워크스페이스 식별자/), {
      target: { value: '11111111-1111-4111-8111-111111111111' },
    })
    fireEvent.change(screen.getByLabelText(/담당자 이름/), {
      target: { value: '심사관' },
    })
    fireEvent.change(screen.getByLabelText(/담당자 이메일/), {
      target: { value: 'reviewer@example.com' },
    })
    fireEvent.change(screen.getByLabelText(/담당자 전화번호/), {
      target: { value: '010-1234-5678' },
    })

    fireEvent.click(screen.getByLabelText(/이용약관 동의/))
    fireEvent.click(screen.getByLabelText(/개인정보 처리방침 동의/))
    fireEvent.click(screen.getByLabelText(/심사용 TEST 카드등록 확인 동의/))

    const submitBtn = screen.getByRole('button', { name: 'TEST 카드등록창 열기' })
    fireEvent.click(submitBtn)

    expect(submitBtn).toBeDisabled()
    expect(screen.getByRole('button', { name: '요청 처리 중...' })).toBeDisabled()

    // Second click should be blocked
    fireEvent.click(submitBtn)
    expect(globalThis.fetch).toHaveBeenCalledTimes(1)

    // Cleanup
    resolveFetch!({
      ok: false,
      status: 500,
      json: async () => ({ error: 'test' }),
    })
  })

  it('validates required fields and consent before making network call', async () => {
    render(<PgReviewCheckout />)

    const submitBtn = screen.getByRole('button', { name: 'TEST 카드등록창 열기' })
    fireEvent.click(submitBtn)

    expect(await screen.findByText(/모든 필수 항목을 입력하고 동의해 주세요/)).toBeInTheDocument()
    expect(globalThis.fetch).not.toHaveBeenCalled()
  })

  it('handles server failure with safe Korean error message without raw codes', async () => {
    ;(globalThis.fetch as any).mockResolvedValueOnce({
      ok: false,
      status: 500,
      json: async () => ({ code: 'INTERNAL_RAW_LEAK', message: 'Stack trace raw' }),
    })

    render(<PgReviewCheckout />)

    fireEvent.change(screen.getByLabelText(/워크스페이스 식별자/), {
      target: { value: '11111111-1111-4111-8111-111111111111' },
    })
    fireEvent.change(screen.getByLabelText(/담당자 이름/), {
      target: { value: '심사관' },
    })
    fireEvent.change(screen.getByLabelText(/담당자 이메일/), {
      target: { value: 'reviewer@example.com' },
    })
    fireEvent.change(screen.getByLabelText(/담당자 전화번호/), {
      target: { value: '010-1234-5678' },
    })

    fireEvent.click(screen.getByLabelText(/이용약관 동의/))
    fireEvent.click(screen.getByLabelText(/개인정보 처리방침 동의/))
    fireEvent.click(screen.getByLabelText(/심사용 TEST 카드등록 확인 동의/))

    fireEvent.click(screen.getByRole('button', { name: 'TEST 카드등록창 열기' }))

    expect(await screen.findByText('요청 처리 중 오류가 발생했습니다. 입력 정보를 확인하고 다시 시도해 주세요.')).toBeInTheDocument()
    expect(screen.queryByText('INTERNAL_RAW_LEAK')).not.toBeInTheDocument()
    expect(screen.queryByText('Stack trace raw')).not.toBeInTheDocument()
    expect(mocks.requestIssueBillingKey).not.toHaveBeenCalled()
  })

  it('rejects response if mode is not TEST or store/channel mismatch', async () => {
    ;(globalThis.fetch as any).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        mode: 'LIVE', // INVALID!
        request: {
          storeId: 'store-42cc855c-71b9-4fd7-99c9-4ef1a8a29f63',
          channelKey: 'channel-key-a54326f5-27c7-4e36-95a1-3e2a3f28355b',
          billingKeyMethod: 'CARD',
          displayAmount: 150000,
          redirectUrl: `${window.location.origin}/pg-review/return`,
        },
      }),
    })

    render(<PgReviewCheckout />)

    fireEvent.change(screen.getByLabelText(/워크스페이스 식별자/), {
      target: { value: '11111111-1111-4111-8111-111111111111' },
    })
    fireEvent.change(screen.getByLabelText(/담당자 이름/), {
      target: { value: '심사관' },
    })
    fireEvent.change(screen.getByLabelText(/담당자 이메일/), {
      target: { value: 'reviewer@example.com' },
    })
    fireEvent.change(screen.getByLabelText(/담당자 전화번호/), {
      target: { value: '010-1234-5678' },
    })

    fireEvent.click(screen.getByLabelText(/이용약관 동의/))
    fireEvent.click(screen.getByLabelText(/개인정보 처리방침 동의/))
    fireEvent.click(screen.getByLabelText(/심사용 TEST 카드등록 확인 동의/))

    fireEvent.click(screen.getByRole('button', { name: 'TEST 카드등록창 열기' }))

    expect(await screen.findByText('보안 정책에 따라 테스트 연동 요청이 거부되었습니다.')).toBeInTheDocument()
    expect(mocks.requestIssueBillingKey).not.toHaveBeenCalled()
  })

  it('handles SDK cancellation/close notice without showing payment success', async () => {
    ;(globalThis.fetch as any).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        mode: 'TEST',
        request: {
          storeId: 'store-42cc855c-71b9-4fd7-99c9-4ef1a8a29f63',
          channelKey: 'channel-key-a54326f5-27c7-4e36-95a1-3e2a3f28355b',
          billingKeyMethod: 'CARD',
          displayAmount: 150000,
          redirectUrl: `${window.location.origin}/pg-review/return`,
        },
      }),
    })
    mocks.requestIssueBillingKey.mockResolvedValueOnce(undefined) // closed or cancelled

    render(<PgReviewCheckout />)

    fireEvent.change(screen.getByLabelText(/워크스페이스 식별자/), {
      target: { value: '11111111-1111-4111-8111-111111111111' },
    })
    fireEvent.change(screen.getByLabelText(/담당자 이름/), {
      target: { value: '심사관' },
    })
    fireEvent.change(screen.getByLabelText(/담당자 이메일/), {
      target: { value: 'reviewer@example.com' },
    })
    fireEvent.change(screen.getByLabelText(/담당자 전화번호/), {
      target: { value: '010-1234-5678' },
    })

    fireEvent.click(screen.getByLabelText(/이용약관 동의/))
    fireEvent.click(screen.getByLabelText(/개인정보 처리방침 동의/))
    fireEvent.click(screen.getByLabelText(/심사용 TEST 카드등록 확인 동의/))

    fireEvent.click(screen.getByRole('button', { name: 'TEST 카드등록창 열기' }))

    expect(await screen.findByText('빌링키 발급 창이 취소되었거나 닫혔습니다. 결제나 카드 등록은 진행되지 않았습니다.')).toBeInTheDocument()
    expect(screen.queryByText('결제 완료')).not.toBeInTheDocument()
    expect(screen.queryByText('구독 활성화 완료')).not.toBeInTheDocument()
  })

  it('sends billingKey to verify API and displays server verified status without exposing billingKey', async () => {
    const sensitiveKey = 'test-billing-key-secret-12345'

    ;(globalThis.fetch as any)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          mode: 'TEST',
          request: {
            storeId: 'store-42cc855c-71b9-4fd7-99c9-4ef1a8a29f63',
            channelKey: 'channel-key-a54326f5-27c7-4e36-95a1-3e2a3f28355b',
            billingKeyMethod: 'CARD',
            displayAmount: 150000,
            redirectUrl: `${window.location.origin}/pg-review/return`,
          },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          status: 'verified_test_billing_key',
          paymentCharged: false,
          subscriptionActivated: false,
        }),
      })

    mocks.requestIssueBillingKey.mockResolvedValueOnce({
      transactionType: 'ISSUE_BILLING_KEY',
      billingKey: sensitiveKey,
    })

    const { container } = render(<PgReviewCheckout />)

    fireEvent.change(screen.getByLabelText(/워크스페이스 식별자/), {
      target: { value: '11111111-1111-4111-8111-111111111111' },
    })
    fireEvent.change(screen.getByLabelText(/담당자 이름/), {
      target: { value: '심사관' },
    })
    fireEvent.change(screen.getByLabelText(/담당자 이메일/), {
      target: { value: 'reviewer@example.com' },
    })
    fireEvent.change(screen.getByLabelText(/담당자 전화번호/), {
      target: { value: '010-1234-5678' },
    })

    fireEvent.click(screen.getByLabelText(/이용약관 동의/))
    fireEvent.click(screen.getByLabelText(/개인정보 처리방침 동의/))
    fireEvent.click(screen.getByLabelText(/심사용 TEST 카드등록 확인 동의/))

    fireEvent.click(screen.getByRole('button', { name: 'TEST 카드등록창 열기' }))

    expect(await screen.findByText('TEST 등록 서버 확인(결제 아님)')).toBeInTheDocument()

    // Verify verification call
    expect(globalThis.fetch).toHaveBeenCalledWith('/api/payments/review/billing-key/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ billingKey: sensitiveKey }),
    })

    // CRITICAL: Ensure sensitive billingKey is NEVER rendered in DOM or storage
    expect(container.textContent).not.toContain(sensitiveKey)
    expect(window.localStorage.getItem('billingKey')).toBeNull()
    expect(window.sessionStorage.getItem('billingKey')).toBeNull()
  })

  it('has no-referrer in page metadata to prevent leaking sensitive URLs', () => {
    expect(pageMetadata.referrer).toBe('no-referrer')
  })

  it('handles SDK response with neither billingKey nor code with fallback message', async () => {
    ;(globalThis.fetch as any).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        mode: 'TEST',
        request: {
          storeId: 'store-42cc855c-71b9-4fd7-99c9-4ef1a8a29f63',
          channelKey: 'channel-key-a54326f5-27c7-4e36-95a1-3e2a3f28355b',
          billingKeyMethod: 'CARD',
          displayAmount: 150000,
          redirectUrl: `${window.location.origin}/pg-review/return`,
        },
      }),
    })
    mocks.requestIssueBillingKey.mockResolvedValueOnce({
      transactionType: 'ISSUE_BILLING_KEY',
    } as any) // neither billingKey nor code

    render(<PgReviewCheckout />)

    fireEvent.change(screen.getByLabelText(/워크스페이스 식별자/), {
      target: { value: '11111111-1111-4111-8111-111111111111' },
    })
    fireEvent.change(screen.getByLabelText(/담당자 이름/), {
      target: { value: '심사관' },
    })
    fireEvent.change(screen.getByLabelText(/담당자 이메일/), {
      target: { value: 'reviewer@example.com' },
    })
    fireEvent.change(screen.getByLabelText(/담당자 전화번호/), {
      target: { value: '010-1234-5678' },
    })

    fireEvent.click(screen.getByLabelText(/이용약관 동의/))
    fireEvent.click(screen.getByLabelText(/개인정보 처리방침 동의/))
    fireEvent.click(screen.getByLabelText(/심사용 TEST 카드등록 확인 동의/))

    fireEvent.click(screen.getByRole('button', { name: 'TEST 카드등록창 열기' }))

    expect(
      await screen.findByText('결과를 확인하지 못했습니다. 결제나 카드 등록은 진행되지 않았습니다.'),
    ).toBeInTheDocument()
    expect(screen.queryByText('결제 완료')).not.toBeInTheDocument()
  })
})
