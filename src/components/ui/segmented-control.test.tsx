import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { SegmentedControl } from './segmented-control'

describe('SegmentedControl', () => {
  it('announces the selected option as a radio choice', () => {
    render(
      <SegmentedControl
        ariaLabel="일정 보기"
        items={[{ id: 'all', label: '전체' }, { id: 'content', label: '콘텐츠' }]}
        onChange={vi.fn()}
        value="all"
      />,
    )

    expect(screen.getByRole('radiogroup', { name: '일정 보기' })).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: '전체' })).toBeChecked()
  })
})
