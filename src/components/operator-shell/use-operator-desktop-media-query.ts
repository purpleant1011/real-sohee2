'use client'

import { useEffect, useState } from 'react'

const desktopQuery = '(min-width: 1025px)'

export function useOperatorDesktopMediaQuery(): boolean | null {
  const [isDesktop, setIsDesktop] = useState<boolean | null>(null)

  useEffect(() => {
    const mediaQuery = window.matchMedia(desktopQuery)
    const update = () => setIsDesktop(mediaQuery.matches)
    update()
    mediaQuery.addEventListener('change', update)
    return () => mediaQuery.removeEventListener('change', update)
  }, [])

  return isDesktop
}
