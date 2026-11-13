import { describe, expect, it, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { BusyModeSwitch } from './busy-mode-switch'

describe('BusyModeSwitch', () => {
  it('toggles busy treatment mode on click', () => {
    const onToggle = vi.fn()
    render(<BusyModeSwitch onToggle={onToggle} />)

    const btn = screen.getByText('💆 시술 집중 모드')
    expect(btn).toBeInTheDocument()

    fireEvent.click(btn)

    expect(screen.getByText(/시술 집중 모드 가동 중/)).toBeInTheDocument()
    expect(onToggle).toHaveBeenCalledWith(true)
  })
})
