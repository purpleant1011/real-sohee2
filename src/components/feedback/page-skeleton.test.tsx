import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { PageSkeleton } from './page-skeleton'

describe('PageSkeleton', () => {
  it('제목 줄과 카드 모양 자리표시를 그리고, 스크린리더에는 확인 중임을 알린다', () => {
    const { container } = render(<PageSkeleton />)
    expect(screen.getByRole('status', { name: '데이터 확인 중' })).toBeInTheDocument()
    expect(container.querySelectorAll('[data-skeleton-card]').length).toBeGreaterThanOrEqual(3)
  })
})
