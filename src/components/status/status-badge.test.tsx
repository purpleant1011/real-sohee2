import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { StatusBadge } from './status-badge'

describe('StatusBadge', () => {
  it('keeps internal readiness and externally confirmed success visibly distinct', () => {
    const { rerender } = render(<StatusBadge tone="ready" label="게시 준비" />)

    expect(screen.getByText('게시 준비')).toHaveAttribute('data-tone', 'ready')
    expect(screen.queryByText('외부 참조 123')).not.toBeInTheDocument()

    rerender(<StatusBadge tone="success" label="게시 완료" detail="외부 참조 123" />)

    expect(screen.getByText('게시 완료')).toHaveAttribute('data-tone', 'success')
    expect(screen.getByText('외부 참조 123')).toBeVisible()
  })

  it('announces only when the caller requests a live status', () => {
    const { rerender } = render(<StatusBadge tone="review" label="확인 필요" />)
    expect(screen.queryByRole('status')).not.toBeInTheDocument()

    rerender(<StatusBadge tone="review" label="확인 필요" live />)
    expect(screen.getByRole('status')).toHaveAccessibleName('확인 필요')
  })
})
