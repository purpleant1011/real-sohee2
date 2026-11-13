'use client'

/**
 * 앱 복귀 재검증 (ANI-1725).
 *
 * 백그라운드에 있던 앱이 다시 앞으로 나오면 화면 데이터가 오래됐을 수 있다.
 * 다만 매번 새로 고치면 입력 중인 흐름을 방해하므로, 오래 숨겨져 있던 경우에만
 * 그리고 연결이 있을 때만 서버 데이터를 다시 확인한다. 복귀 자체는 아무 것도
 * 자동 전송하지 않는다 — 조회만 다시 한다.
 */

/** 이 시간보다 짧게 숨겨졌다면 그대로 둔다. */
export const RESUME_STALE_MS = 60_000

const APP_PATH = /^\/(?:app|start)(?:\/|$)/

export type ResumeInfo = {
  /** 화면이 숨겨져 있던 시간(ms). bfcache 복귀는 알 수 없으므로 Infinity. */
  hiddenMs: number
  source: 'visibility' | 'pageshow'
}

export function shouldRevalidateOnResume(input: {
  hiddenMs: number
  online: boolean
  pathname: string
}): boolean {
  if (!input.online) return false
  if (!(input.hiddenMs >= RESUME_STALE_MS)) return false
  return APP_PATH.test(input.pathname)
}

export function isDocumentHidden(): boolean {
  if (typeof document === 'undefined') return false
  return document.visibilityState === 'hidden'
}

/**
 * 복귀 알림을 구독한다. 돌려받은 함수로 반드시 해제한다.
 * `visibilitychange` 로 잡히지 않는 bfcache 복귀는 `pageshow(persisted)` 로 잡는다.
 */
export function subscribeToAppResume(
  onResume: (info: ResumeInfo) => void,
  options: { now?: () => number } = {},
): () => void {
  if (typeof document === 'undefined' || typeof window === 'undefined') return () => {}

  const now = options.now ?? (() => Date.now())
  let hiddenSince: number | null = isDocumentHidden() ? now() : null

  const onVisibilityChange = () => {
    if (document.visibilityState === 'hidden') {
      hiddenSince = now()
      return
    }
    if (hiddenSince === null) return
    const hiddenMs = Math.max(0, now() - hiddenSince)
    hiddenSince = null
    onResume({ hiddenMs, source: 'visibility' })
  }

  const onPageShow = (event: Event) => {
    if (!(event as PageTransitionEvent).persisted) return
    hiddenSince = null
    onResume({ hiddenMs: Number.POSITIVE_INFINITY, source: 'pageshow' })
  }

  document.addEventListener('visibilitychange', onVisibilityChange)
  window.addEventListener('pageshow', onPageShow)

  return () => {
    document.removeEventListener('visibilitychange', onVisibilityChange)
    window.removeEventListener('pageshow', onPageShow)
  }
}
