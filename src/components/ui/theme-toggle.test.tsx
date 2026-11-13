import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ThemeToggle } from './theme-toggle'

type MediaChangeListener = (event: MediaQueryListEvent) => void

function createMatchMediaController(initialMatches = false) {
  let listener: MediaChangeListener | null = null
  const query = {
    matches: initialMatches,
    media: '(prefers-color-scheme: dark)',
    onchange: null,
    addEventListener: vi.fn((_type: string, callback: MediaChangeListener) => {
      listener = callback
    }),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }

  return {
    matchMedia: vi.fn(() => query),
    notify(matches: boolean) {
      query.matches = matches
      listener?.({ matches } as MediaQueryListEvent)
    },
  }
}

describe('ThemeToggle', () => {
  beforeEach(() => {
    window.localStorage.clear()
    document.documentElement.removeAttribute('data-theme')
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('uses a saved dark preference with an accurate next-action name and no aria-pressed', async () => {
    window.localStorage.setItem('sohee-theme', 'dark')
    render(<ThemeToggle />)

    const button = screen.getByRole('button')
    await waitFor(() => expect(button).toHaveAccessibleName('현재 테마: 어두운 테마. 다음 테마로 변경'))
    expect(button).not.toHaveAttribute('aria-pressed')
    expect(document.documentElement).toHaveAttribute('data-theme', 'dark')
  })

  it('falls back to system when storage is unavailable or contains an invalid value', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('blocked', 'SecurityError')
    })
    render(<ThemeToggle />)

    await waitFor(() => expect(screen.getByRole('button')).toHaveAccessibleName('현재 테마: 시스템 설정. 다음 테마로 변경'))
    expect(document.documentElement).not.toHaveAttribute('data-theme')
  })

  it('does not throw when a theme preference cannot be saved', async () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('blocked', 'SecurityError')
    })
    render(<ThemeToggle />)

    await waitFor(() => expect(screen.getByRole('button')).toHaveAccessibleName('현재 테마: 시스템 설정. 다음 테마로 변경'))
    expect(() => fireEvent.click(screen.getByRole('button'))).not.toThrow()
  })

  it('removes an invalid preference and tracks system preference changes', async () => {
    const controller = createMatchMediaController()
    vi.stubGlobal('matchMedia', controller.matchMedia)
    window.localStorage.setItem('sohee-theme', 'not-a-theme')
    render(<ThemeToggle />)

    await waitFor(() => expect(screen.getByRole('button')).toHaveAccessibleName('현재 테마: 시스템 설정. 다음 테마로 변경'))
    document.documentElement.dataset.theme = 'dark'
    controller.notify(true)
    expect(document.documentElement).not.toHaveAttribute('data-theme')
    expect(controller.matchMedia).toHaveBeenCalledWith('(prefers-color-scheme: dark)')
  })
})
