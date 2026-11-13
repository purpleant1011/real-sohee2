import { resolveRoute } from './routes'
import { tabRootHref } from './tabs'

/** open-redirect 방지: 앱 내부 경로(/app, /start)만 허용. */
export function safeReturnPath(raw: string | null | undefined): string | null {
  if (!raw || raw.length > 512) return null
  if (!/^\/(app|start)(\/|\?|#|$)/.test(raw)) return null
  if (raw.includes('//') || raw.includes('\\') || /[\u0000-\u001f]/.test(raw)) return null
  return raw
}

export type BackTarget = { kind: 'history' } | { kind: 'href'; href: string } | { kind: 'none' }

/**
 * 뒤로가기 우선순위(CONTRACT §5):
 * 1) 같은 앱 안에서 온 history 가 있으면 history.back (스크롤·필터 복원)
 * 2) `?from=` 이 안전한 내부 경로면 거기로
 * 3) 라우트 backFallback → 탭 루트
 * 4) 셸 밖/루트면 none
 */
export function resolveBack(input: { pathname: string; from?: string | null; hasInAppHistory: boolean }): BackTarget {
  if (input.hasInAppHistory) return { kind: 'history' }
  const from = safeReturnPath(input.from)
  if (from) return { kind: 'href', href: from }
  const route = resolveRoute(input.pathname)
  if (!route) return { kind: 'none' }
  if (route.backFallback) return { kind: 'href', href: route.backFallback }
  if (route.mode === 'BROWSE' && route.tab) return { kind: 'none' }
  return route.tab ? { kind: 'href', href: tabRootHref(route.tab) } : { kind: 'none' }
}

/** 상세로 보낼 때 돌아올 위치를 실어 보내는 URL 빌더. */
export function withFrom(href: string, current: string): string {
  const safe = safeReturnPath(current)
  if (!safe) return href
  const sep = href.includes('?') ? '&' : '?'
  return `${href}${sep}from=${encodeURIComponent(safe)}`
}
