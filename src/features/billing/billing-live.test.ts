import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { BILLING_NOT_LIVE_NOTICE, isBillingLive } from './billing-live'

describe('isBillingLive', () => {
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

  it('기본값은 false 이다', () => {
    expect(isBillingLive()).toBe(false)
  })

  it('환경변수가 0이면 false 이다', () => {
    process.env.NEXT_PUBLIC_BILLING_LIVE = '0'
    expect(isBillingLive()).toBe(false)
  })

  it('환경변수가 1일 때만 true 이다', () => {
    process.env.NEXT_PUBLIC_BILLING_LIVE = '1'
    expect(isBillingLive()).toBe(true)
  })

  it('안내 문구 정본을 제공한다', () => {
    expect(BILLING_NOT_LIVE_NOTICE).toBe('결제 기능을 곧 열어요')
  })
})
