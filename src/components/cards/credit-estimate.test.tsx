import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { CreditEstimate } from './credit-estimate'

describe('CreditEstimate', () => {
  it('renders null when credits are sufficient', () => {
    const { container } = render(<CreditEstimate estimatedCredits={68} availableCredits={124} />)

    expect(container).toBeEmptyDOMElement()
    expect(screen.queryByText(/크레딧/)).not.toBeInTheDocument()
    expect(screen.queryByText(/68/)).not.toBeInTheDocument()
    expect(screen.queryByText(/124/)).not.toBeInTheDocument()
  })

  it('shows limit notice without any credit numbers or purchase CTA when insufficient', () => {
    const { container } = render(<CreditEstimate estimatedCredits={120} availableCredits={20} />)

    expect(screen.getByText('이용 한도에 도달했어요')).toBeVisible()
    expect(screen.getByText('이번 주기의 이용 한도를 모두 사용했어요. 다음 갱신 주기에 다시 이용할 수 있어요. 더 많은 작업이 필요하면 플랜 변경을 문의해 주세요.')).toBeVisible()
    expect(container.textContent).not.toContain('크레딧')
    expect(container.textContent).not.toContain('120')
    expect(container.textContent).not.toContain('20')
    expect(container.textContent).not.toContain('100')
    expect(screen.queryByRole('button', { name: /충전|구매/ })).not.toBeInTheDocument()
  })

  it('renders null even when returnedCredits prop is provided if credits are sufficient', () => {
    const { container } = render(<CreditEstimate estimatedCredits={32} availableCredits={80} returnedCredits={7} />)

    expect(container).toBeEmptyDOMElement()
  })
})
