import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { CreditEstimateCard } from './credit-estimate-card'
import { MobileR2Provider } from '@/features/mobile-shell/r2-gate'

describe('CreditEstimateCard', () => {
  it('renders limit notice without credit numbers on desktop when insufficient', () => {
    const { container } = render(<CreditEstimateCard artifact={{
      id: '10000000-0000-4000-8000-000000000001', catalogVersion: 1, estimatedCredits: 54,
      availableCredits: 20, expectedRemainingCredits: -34, status: 'insufficient',
      adjustments: [{ kind: 'reduce_images', label: '이미지 수 줄이기' }, { kind: 'priority_first', label: '중요한 콘텐츠부터 만들기' }],
    }} />)
    expect(screen.getByText('이용 한도에 도달했어요')).toBeVisible()
    expect(screen.getByText('이번 주기의 이용 한도를 모두 사용했어요. 다음 갱신 주기에 다시 이용할 수 있어요. 더 많은 작업이 필요하면 플랜 변경을 문의해 주세요.')).toBeVisible()
    expect(screen.getByText('이미지 수 줄이기')).toBeVisible()
    expect(screen.getByText('중요한 콘텐츠부터 만들기')).toBeVisible()
    expect(container.textContent).not.toContain('34 크레딧 부족')
    expect(container.textContent).not.toContain('현재 20')
    expect(container.textContent).not.toContain('단가 정책')
    expect(container.textContent).not.toContain('54')
  })

  it('renders limit notice without credit numbers on mobile when insufficient', () => {
    const { container } = render(
      <MobileR2Provider enabled={true} forceMobile={true}>
        <CreditEstimateCard artifact={{
          id: '10000000-0000-4000-8000-000000000001', catalogVersion: 1, estimatedCredits: 54,
          availableCredits: 20, expectedRemainingCredits: -34, status: 'insufficient',
          adjustments: [{ kind: 'reduce_images', label: '이미지 수 줄이기' }],
        }} />
      </MobileR2Provider>,
    )
    expect(screen.getByText('이용 한도에 도달했어요')).toBeInTheDocument()
    expect(screen.getByText('이번 주기의 이용 한도를 모두 사용했어요. 다음 갱신 주기에 다시 이용할 수 있어요. 더 많은 작업이 필요하면 플랜 변경을 문의해 주세요.')).toBeInTheDocument()
    expect(screen.getByText('이미지 수 줄이기')).toBeInTheDocument()
    expect(container.textContent).not.toContain('크레딧이 부족해요')
    expect(screen.queryByText(/54 크레딧/)).not.toBeInTheDocument()
    expect(screen.queryByText(/34 크레딧 부족/)).not.toBeInTheDocument()
  })

  it('renders nothing on mobile when status is ready', () => {
    const { container } = render(
      <MobileR2Provider enabled={true} forceMobile={true}>
        <CreditEstimateCard artifact={{
          id: '10000000-0000-4000-8000-000000000001', catalogVersion: 1, estimatedCredits: 54,
          availableCredits: 100, expectedRemainingCredits: 46, status: 'ready',
          adjustments: [],
        }} />
      </MobileR2Provider>,
    )
    expect(container).toBeEmptyDOMElement()
  })

  it('renders nothing on desktop when status is ready', () => {
    const { container } = render(
      <CreditEstimateCard artifact={{
        id: '10000000-0000-4000-8000-000000000001', catalogVersion: 1, estimatedCredits: 54,
        availableCredits: 100, expectedRemainingCredits: 46, status: 'ready',
        adjustments: [],
      }} />,
    )
    expect(container).toBeEmptyDOMElement()
  })
})
