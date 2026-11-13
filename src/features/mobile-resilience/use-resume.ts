'use client'

import { useEffect, useRef } from 'react'

/**
 * 화면이 다시 보이거나(visibilitychange) bfcache 복귀(pageshow), 네트워크가 돌아오면(online) 콜백을 부른다.
 * 콜백은 서버 재확인을 해야 하며 이 훅은 아무 데이터도 캐시하지 않는다.
 */
export function useResumeRevalidation(onResume: (info: { hiddenAt: string | null }) => void): void {
  const cb = useRef(onResume)
  useEffect(() => { cb.current = onResume })
  useEffect(() => {
    let hiddenAt: string | null = null
    const fire = () => { cb.current({ hiddenAt }); hiddenAt = null }
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') hiddenAt = new Date().toISOString()
      else fire()
    }
    const onPageShow = (e: PageTransitionEvent) => { if (e.persisted) fire() }
    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('pageshow', onPageShow)
    window.addEventListener('online', fire)
    return () => {
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('pageshow', onPageShow)
      window.removeEventListener('online', fire)
    }
  }, [])
}
