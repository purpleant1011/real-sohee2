import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { CreditUsageDetailList } from './credit-usage-detail'

describe('CreditUsageDetailList', () => {
  it('shows actual token counters and reservation settlement without provider secrets', () => {
    render(<CreditUsageDetailList entries={[{
      occurredAt: '2026-08-23T03:10:00.000Z',
      operation: 'image_generation', usageSource: 'actual',
      textInputTokens: 1438, cachedTextInputTokens: 0, textOutputTokens: 0,
      imageInputTokens: 0, imageOutputTokens: 1372, providerTotalTokens: 3689,
      requestedCredits: 45, settledCredits: 11, releasedCredits: 34,
      policyVersion: 'v08-test-2000-1',
    }]} />)

    expect(screen.getByRole('heading', { name: 'API 사용량' })).toBeInTheDocument()
    expect(screen.getByText('실제 측정')).toBeInTheDocument()
    expect(screen.getByText('이미지 생성')).toBeInTheDocument()
    expect(screen.getByText(/텍스트 입력 1,438/u)).toBeInTheDocument()
    expect(screen.getByText(/이미지 출력 1,372/u)).toBeInTheDocument()
    expect(screen.queryByText(/예약 45/)).not.toBeInTheDocument()
    expect(screen.queryByText(/크레딧/)).not.toBeInTheDocument()
    expect(screen.getByText('정책 v08-test-2000-1')).toBeInTheDocument()
    expect(screen.queryByText(/provider request/i)).not.toBeInTheDocument()
  })

  it('distinguishes estimated usage from actual provider usage', () => {
    render(<CreditUsageDetailList entries={[{
      occurredAt: '2026-08-23T03:10:00.000Z',
      operation: 'text_response', usageSource: 'estimated_missing_usage',
      textInputTokens: 1000, cachedTextInputTokens: 0, textOutputTokens: 500,
      imageInputTokens: 0, imageOutputTokens: 0, providerTotalTokens: 1500,
      requestedCredits: 20, settledCredits: 1, releasedCredits: 19,
      policyVersion: 'v08-test-2000-1',
    }]} />)

    expect(screen.getByText('추정 사용량')).toBeInTheDocument()
  })
})
