import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { TodaySignalsCard } from './today-signals-card'

describe('TodaySignalsCard', () => {
  it('renders all 3 priority marketing signals', () => {
    render(<TodaySignalsCard />)

    expect(screen.getByTestId('today-signals-card')).toBeInTheDocument()
    expect(screen.getByTestId('signal-customer')).toBeInTheDocument()
    expect(screen.getByTestId('signal-content')).toBeInTheDocument()
    expect(screen.getByTestId('signal-schedule')).toBeInTheDocument()
  })

  it('links correctly to customer, content, and schedule workspaces', () => {
    render(<TodaySignalsCard />)

    expect(screen.getByTestId('signal-customer')).toHaveAttribute('href', '/app/customers')
    expect(screen.getByTestId('signal-content')).toHaveAttribute('href', '/app/content')
    expect(screen.getByTestId('signal-schedule')).toHaveAttribute('href', '/app/schedule')
  })
})
