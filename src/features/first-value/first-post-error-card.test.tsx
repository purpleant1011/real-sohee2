import React from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { FirstPostErrorCard } from './first-post-error-card'
import { resolveFirstPostErrorGuidance } from './first-post-error-guidance'

describe('FirstPostErrorCard', () => {
  it('renders role="alert" with title, description, and primary retry action for transient error', () => {
    const onRetry = vi.fn()
    const guidance = resolveFirstPostErrorGuidance({
      code: 'CREDIT_RESERVE_FAILED',
      status: 503,
    })

    render(<FirstPostErrorCard guidance={guidance} onRetry={onRetry} />)

    const alert = screen.getByRole('alert')
    expect(alert).toBeInTheDocument()
    expect(screen.getByText('잠시 문제가 생겼어요')).toBeInTheDocument()
    expect(screen.getByText('작성하신 내용은 그대로예요. 잠시 후 다시 시도해 주세요.')).toBeInTheDocument()

    const retryBtn = screen.getByRole('button', { name: '다시 시도' })
    fireEvent.click(retryBtn)
    expect(onRetry).toHaveBeenCalledTimes(1)
  })

  it('renders navigation links for insufficient credits error', () => {
    const guidance = resolveFirstPostErrorGuidance({
      code: 'INSUFFICIENT_CREDITS',
      status: 402,
    })

    render(<FirstPostErrorCard guidance={guidance} />)

    expect(screen.getByRole('alert')).toBeInTheDocument()
    expect(screen.getByText('첫 포스팅에 쓸 포인트가 없어요')).toBeInTheDocument()

    const channelLink = screen.getByRole('link', { name: '채널 연결하기' })
    expect(channelLink).toHaveAttribute('href', '/start?step=channels')

    const businessLink = screen.getByRole('link', { name: '사업자 인증하기' })
    expect(businessLink).toHaveAttribute('href', '/onboarding/business')
  })

  it('renders business onboarding button for trial limit reached', () => {
    const guidance = resolveFirstPostErrorGuidance({
      code: 'TRIAL_FIRST_POST_LIMIT_REACHED',
      status: 403,
    })

    render(<FirstPostErrorCard guidance={guidance} />)

    expect(screen.getByText('첫 포스팅 2건을 모두 사용했어요')).toBeInTheDocument()
    const businessLink = screen.getByRole('link', { name: '사업자 인증하기' })
    expect(businessLink).toHaveAttribute('href', '/onboarding/business')
  })
})
