'use client'

import { useEffect, useState } from 'react'

type Theme = 'system' | 'light' | 'dark'

export const themeStorageKey = 'sohee-theme'

function isTheme(value: string | null): value is Theme {
  return value === 'system' || value === 'light' || value === 'dark'
}

function applyTheme(theme: Theme) {
  if (typeof document === 'undefined') return
  if (theme === 'system') {
    document.documentElement.removeAttribute('data-theme')
  } else {
    document.documentElement.dataset.theme = theme
  }
}

function readStoredTheme(): Theme {
  if (typeof window === 'undefined') return 'system'

  try {
    const storedTheme = window.localStorage.getItem(themeStorageKey)
    return isTheme(storedTheme) ? storedTheme : 'system'
  } catch {
    return 'system'
  }
}

function saveTheme(theme: Theme) {
  if (typeof window === 'undefined') return

  try {
    window.localStorage.setItem(themeStorageKey, theme)
  } catch {
    // Storage can be blocked in private contexts. The active page theme still applies.
  }
}

const themeLabels: Record<Theme, string> = {
  system: '시스템 설정',
  light: '밝은 테마',
  dark: '어두운 테마',
}

const nextTheme: Record<Theme, Theme> = {
  system: 'light',
  light: 'dark',
  dark: 'system',
}

export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>('system')

  useEffect(() => {
    const initialTheme = readStoredTheme()
    applyTheme(initialTheme)
    const timer = window.setTimeout(() => setTheme(initialTheme), 0)

    return () => window.clearTimeout(timer)
  }, [])

  useEffect(() => {
    if (theme !== 'system' || typeof window.matchMedia !== 'function') return

    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)')
    const reflectSystemTheme = () => applyTheme('system')
    mediaQuery.addEventListener('change', reflectSystemTheme)

    return () => mediaQuery.removeEventListener('change', reflectSystemTheme)
  }, [theme])

  function changeTheme() {
    const updatedTheme = nextTheme[theme]
    setTheme(updatedTheme)
    applyTheme(updatedTheme)
    saveTheme(updatedTheme)
  }

  return (
    <button
      type="button"
      className="themeToggle"
      aria-label={`현재 테마: ${themeLabels[theme]}. 다음 테마로 변경`}
      onClick={changeTheme}
    >
      {themeLabels[theme]}
    </button>
  )
}
