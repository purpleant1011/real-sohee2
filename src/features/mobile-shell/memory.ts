import type { TabId } from './types'
import { normalizePath, resolveRoute } from './routes'
import { safeReturnPath } from './back'

const SCROLL_PREFIX = 'sohee.shell.scroll:'
const TAB_PREFIX = 'sohee.shell.tab:'

type Store = Pick<Storage, 'getItem' | 'setItem'>

/**
 * store 를 생략하면 sessionStorage, null 이면 저장하지 않는다(테스트·SSR).
 * scope 는 workspace 식별자이며 생략하면 기존 키 체계(무스코프)를 그대로 쓴다.
 */
export type MemoryOptions = { store?: Store | null; scope?: string | null }

function resolveStore(options: MemoryOptions): Store | null {
  return options.store === undefined ? session() : options.store
}

/**
 * workspace 별 복원 상태 분리(CONTRACT §4). 스코프가 없으면 기존 키 체계를 유지한다.
 * workspace 가 바뀌면 다른 스코프의 키를 읽지 않으므로 이전 workspace 의 위치가 새지 않는다.
 */
function scoped(prefix: string, key: string, scope: string | null | undefined): string {
  const token = (scope ?? '').trim()
  return token ? `${prefix}${encodeURIComponent(token)}:${key}` : prefix + key
}

function session(): Store | null {
  try { return typeof window !== 'undefined' ? window.sessionStorage : null } catch { return null }
}

/**
 * 스크롤 위치는 표현 보조일 뿐(정본 아님). 키 = 경로+쿼리 → 필터가 다르면 위치도 다르다.
 * 개인정보를 담지 않는다(좌표 숫자만).
 */
export function saveScroll(key: string, top: number, options: MemoryOptions = {}): void {
  try { resolveStore(options)?.setItem(scoped(SCROLL_PREFIX, key, options.scope), String(Math.max(0, Math.round(top)))) } catch { /* 저장 불가는 무시 */ }
}
export function readScroll(key: string, options: MemoryOptions = {}): number {
  try {
    const n = Number(resolveStore(options)?.getItem(scoped(SCROLL_PREFIX, key, options.scope)))
    return Number.isFinite(n) && n > 0 ? n : 0
  } catch { return 0 }
}

/** 탭별 마지막 위치. 탭을 다시 누르면 그 위치로(네이티브 앱 방식), 이미 그 탭이면 루트. */
export function rememberTabLocation(tab: TabId, href: string, options: MemoryOptions = {}): void {
  try { resolveStore(options)?.setItem(scoped(TAB_PREFIX, tab, options.scope), href) } catch { /* noop */ }
}
export function lastTabLocation(tab: TabId, options: MemoryOptions = {}): string | null {
  try { return resolveStore(options)?.getItem(scoped(TAB_PREFIX, tab, options.scope)) ?? null } catch { return null }
}

/** 탭 눌림의 목적지 결정(순수). */
export function resolveTabPress(input: { tab: TabId; currentTab: TabId | null; currentHref: string; rootHref: string; last: string | null }):
  | { action: 'scroll-top' } | { action: 'go'; href: string } {
  const atRoot = normalizePath(input.currentHref) === normalizePath(input.rootHref)
  if (input.currentTab === input.tab) return atRoot ? { action: 'scroll-top' } : { action: 'go', href: input.rootHref }
  const last = safeReturnPath(input.last)
  return { action: 'go', href: last && resolveRoute(last)?.tab === input.tab ? last : input.rootHref }
}
