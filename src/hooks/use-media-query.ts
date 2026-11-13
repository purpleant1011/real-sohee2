'use client'

import { useSyncExternalStore } from 'react'

function hasMatchMedia(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function'
}

/**
 * @param serverDefault matchMedia를 쓸 수 없을 때(SSR, jsdom) 돌려줄 값
 */
export function useMediaQuery(query: string, serverDefault = false): boolean {
  return useSyncExternalStore(
    (onChange) => {
      if (!hasMatchMedia()) return () => {}
      const mq = window.matchMedia(query)
      mq.addEventListener('change', onChange)
      return () => mq.removeEventListener('change', onChange)
    },
    () => (hasMatchMedia() ? window.matchMedia(query).matches : serverDefault),
    () => serverDefault,
  )
}
