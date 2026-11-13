import type { TabId } from './types'

export interface ShellTab { id: TabId; label: string; href: string }

/** 5탭 고정. 여섯 번째 탭 추가 금지. '소희에게 맡기기'는 헤더 명령(탭 아님). */
export const SHELL_TABS: ReadonlyArray<ShellTab> = [
  { id: 'today', label: '오늘', href: '/app' },
  { id: 'work', label: '작업', href: '/app/content' },
  { id: 'customers', label: '고객', href: '/app/customers' },
  { id: 'results', label: '성과', href: '/app/results' },
  { id: 'more', label: '더보기', href: '/app/system' },
]

export function tabRootHref(tab: TabId): string {
  return SHELL_TABS.find(t => t.id === tab)!.href
}
