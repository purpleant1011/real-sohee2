import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { Metric } from './metric'

describe('Metric', () => {
  it('does not present collecting data as zero', () => {
    render(<Metric label="고객 반응" state="collecting" value={null} />)

    expect(screen.getByText('수집 중')).toBeInTheDocument()
    expect(screen.queryByText('0')).not.toBeInTheDocument()
  })

  it('labels a confirmed zero as a usable value', () => {
    render(<Metric label="예약" state="confirmed_zero" value={0} />)

    expect(screen.getByText('0')).toBeInTheDocument()
    expect(screen.getByText('확인된 0건')).toBeInTheDocument()
  })
})
