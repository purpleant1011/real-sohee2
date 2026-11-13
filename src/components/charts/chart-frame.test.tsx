import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { ChartFrame } from './chart-frame'

describe('ChartFrame', () => {
  it('renders a chart summary and a table alternative', () => {
    render(
      <ChartFrame
        summary="저장 반응이 이전 기간보다 늘었어요."
        table={<table><tbody><tr><td>12</td></tr></tbody></table>}
        title="반응 추이"
      >
        <div>차트</div>
      </ChartFrame>,
    )

    expect(screen.getByText('저장 반응이 이전 기간보다 늘었어요.')).toBeInTheDocument()
    expect(screen.getByRole('table')).toBeInTheDocument()
  })
})
