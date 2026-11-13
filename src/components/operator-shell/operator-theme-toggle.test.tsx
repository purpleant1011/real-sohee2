import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { OperatorThemeToggle } from './operator-theme-toggle'

const mockSetTheme = vi.fn()
let currentTheme = 'light'

vi.mock('@/components/theme-provider', () => ({
  useTheme: () => ({
    theme: currentTheme,
    resolvedTheme: currentTheme === 'system' ? 'light' : currentTheme,
    setTheme: (t: string) => {
      currentTheme = t
      mockSetTheme(t)
    },
  }),
}))

describe('OperatorThemeToggle', () => {
  it('renders theme toggle button and switches theme on click', () => {
    currentTheme = 'light'
    render(<OperatorThemeToggle />)

    const button = screen.getByRole('button', { name: /라이트 모드/i })
    expect(button).toBeInTheDocument()

    fireEvent.click(button)
    expect(mockSetTheme).toHaveBeenCalledWith('dark')
  })
})
