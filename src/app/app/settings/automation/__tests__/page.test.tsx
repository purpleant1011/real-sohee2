import { describe, it, expect } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import AutomationSettingsPage from '../page'

describe('AutomationSettingsPage (settings/automation)', () => {
  it('displays friendly merchant wording instead of engineering kill switch terms', () => {
    render(<AutomationSettingsPage />)

    // Initial state: normal operation
    const toggleButton = screen.getByRole('button', { name: /자동 작업 켜져 있어요/i })
    expect(toggleButton).toBeInTheDocument()
    expect(screen.queryByText(/정상 가동 중/)).toBeNull()

    // Click to pause
    fireEvent.click(toggleButton)
    expect(screen.getByText('자동 작업이 멈춰 있어요')).toBeInTheDocument()
    expect(screen.queryByText(/🚨 킬스위치 작동 중/)).toBeNull()
  })
})
