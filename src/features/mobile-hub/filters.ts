import type { LoadState } from '../mobile-decision/contracts'

export type WorkStatus = 'draft' | 'review' | 'scheduled' | 'verifying' | 'confirmed'
export interface WorkItem { id: string; title: string; status: WorkStatus }
export type WorkSegment = 'all' | WorkStatus

export function filterWork<T extends WorkItem>(items: readonly T[], f: { segment: WorkSegment; query: string }): T[] {
  const q = f.query.trim().toLocaleLowerCase('ko-KR')
  return items.filter(i => (f.segment === 'all' || i.status === f.segment) && (!q || i.title.toLocaleLowerCase('ko-KR').includes(q)))
}

export type ListViewState = 'loading' | 'error' | 'stale' | 'partial' | 'confirmed_empty' | 'no_match' | 'ready'
/** 조회 실패·미확인을 0건으로 바꾸지 않는다. */
export function listViewState(s: { loadState: LoadState; complete: boolean; items: readonly unknown[]; matched?: number }): ListViewState {
  if (s.loadState === 'loading') return 'loading'
  if (s.loadState === 'error' || s.loadState === 'unknown') return 'error'
  if (s.loadState === 'stale') return 'stale'
  if (!s.complete) return 'partial'
  if (s.items.length === 0) return 'confirmed_empty'
  return s.matched === 0 ? 'no_match' : 'ready'
}
