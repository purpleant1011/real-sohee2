import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { StatusBadge } from '@/components/status/status-badge'
import { PageHeader } from './page-header'

describe('PageHeader', () => {
  it('renders one page heading with optional status and actions', () => {
    render(
      <PageHeader
        eyebrow="현재 작업공간"
        title="일정"
        description="다음 결정을 확인해요"
        status={<StatusBadge tone="review" label="확인 필요" />}
        actions={<button type="button">일정 만들기</button>}
      />,
    )

    expect(screen.getAllByRole('heading', { level: 1, name: '일정' })).toHaveLength(1)
    expect(screen.getByText('현재 작업공간')).toBeVisible()
    expect(screen.getByText('다음 결정을 확인해요')).toBeVisible()
    expect(screen.getByText('확인 필요')).toBeVisible()
    expect(screen.getByRole('button', { name: '일정 만들기' })).toBeVisible()
  })

  it('does not render empty optional regions', () => {
    const { container } = render(<PageHeader title="리포트" />)

    expect(screen.getByRole('heading', { level: 1, name: '리포트' })).toBeVisible()
    expect(container.querySelector('[data-slot="page-header-status"]')).not.toBeInTheDocument()
    expect(container.querySelector('[data-slot="page-header-actions"]')).not.toBeInTheDocument()
  })
})
