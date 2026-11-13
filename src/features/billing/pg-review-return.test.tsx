import { render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { PgReviewReturn } from './pg-review-return'
import { metadata as pageMetadata } from '@/app/(public)/pg-review/return/page'

describe('PgReviewReturn', () => {
  const originalFetch = globalThis.fetch
  const originalLocation = window.location
  const originalReplaceState = window.history.replaceState

  beforeEach(() => {
    vi.clearAllMocks()
    globalThis.fetch = vi.fn()
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
    ;(window as any).location = originalLocation
    window.history.replaceState = originalReplaceState
  })

  it('immediately removes query/hash from URL and sends billingKey to verify endpoint without user confirmation', async () => {
    const sensitiveKey = 'test-redirect-billing-key-secret-999'
    delete (window as any).location
    window.location = new URL(`http://localhost:3000/pg-review/return?billingKey=${sensitiveKey}&transactionType=ISSUE_BILLING_KEY`) as any

    const replaceStateSpy = vi.fn()
    window.history.replaceState = replaceStateSpy

    ;(globalThis.fetch as any).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        status: 'verified_test_billing_key',
        paymentCharged: false,
        subscriptionActivated: false,
      }),
    })

    const { container } = render(<PgReviewReturn />)

    // URL cleaning must happen immediately
    expect(replaceStateSpy).toHaveBeenCalledWith({}, document.title, '/pg-review/return')

    // Verification must run without user confirm button
    await waitFor(() => {
      expect(globalThis.fetch).toHaveBeenCalledWith('/api/payments/review/billing-key/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ billingKey: sensitiveKey }),
      })
    })

    expect(await screen.findByText('TEST 등록 서버 확인(결제 아님)')).toBeInTheDocument()

    // Key must not leak into DOM or storage
    expect(container.textContent).not.toContain(sensitiveKey)
    expect(window.localStorage.getItem('billingKey')).toBeNull()
    expect(window.sessionStorage.getItem('billingKey')).toBeNull()
  })

  it('handles query failure/cancellation without displaying raw codes or error messages', async () => {
    delete (window as any).location
    window.location = new URL('http://localhost:3000/pg-review/return?code=USER_CANCEL&message=User+cancelled+popup') as any

    const replaceStateSpy = vi.fn()
    window.history.replaceState = replaceStateSpy

    const { container } = render(<PgReviewReturn />)

    expect(replaceStateSpy).toHaveBeenCalledWith({}, document.title, '/pg-review/return')
    expect(globalThis.fetch).not.toHaveBeenCalled()

    expect(await screen.findByText(/인증키 등록 및 청구가 실행되지 않았습니다/)).toBeInTheDocument()
    expect(container.textContent).not.toContain('USER_CANCEL')
    expect(container.textContent).not.toContain('User cancelled popup')
  })

  it('handles missing return parameters safely', async () => {
    delete (window as any).location
    window.location = new URL('http://localhost:3000/pg-review/return') as any

    render(<PgReviewReturn />)

    expect(await screen.findByText('유효한 TEST 복귀 정보가 없습니다.')).toBeInTheDocument()
    expect(screen.getByText(/실제 청구 및 구독 활성화는 진행되지 않습니다/)).toBeInTheDocument()
    expect(globalThis.fetch).not.toHaveBeenCalled()
  })

  it('handles server verification rejection or failure', async () => {
    delete (window as any).location
    window.location = new URL('http://localhost:3000/pg-review/return?billingKey=some-unverified-key') as any

    window.history.replaceState = vi.fn()

    ;(globalThis.fetch as any).mockResolvedValueOnce({
      ok: false,
      status: 400,
      json: async () => ({ error: 'Verification failed' }),
    })

    render(<PgReviewReturn />)

    expect(await screen.findByText('확인하지 못했습니다. 결제나 구독 활성화는 진행되지 않았습니다.')).toBeInTheDocument()
    expect(screen.queryByText(/결제 완료/)).not.toBeInTheDocument()
  })

  it('has no-referrer in return page metadata to prevent leaking URL query', () => {
    expect(pageMetadata.referrer).toBe('no-referrer')
  })
})
