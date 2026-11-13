import type { StateKind } from '@/components/mobile-ui'
import type { LoadState } from '@/features/mobile-decision/contracts'
import type { WorkRow } from '@/features/mobile-hub/work-items'

/**
 * 5탭 허브(작업·더보기) 공통 모델.
 * 개수는 서버 정본에서 확인한 값만 쓴다. 확인하지 못했으면 value=null 이며 0 으로 바꾸지 않는다.
 */
export interface HubCount {
  /** 확인된 개수. null = 확인하지 못함(0건으로 표시 금지). */
  value: number | null
  /** 단위. 예: '건', '곳'. */
  unit: string
}

export interface HubEntry {
  id: string
  label: string
  /** 이 항목에서 무엇을 하는지 한 줄. 영문 코드·내부 용어를 쓰지 않는다. */
  description: string
  href: string
  /** null = 이 항목에는 개수 개념이 없다(설정 등). */
  count: HubCount | null
  /** 사장님이 먼저 봐야 하는 항목. 색만으로 알리지 않고 문구를 함께 준다. */
  needsAttention: boolean
}

/** 개수를 확인하지 못한 상태를 '0건'처럼 보이게 하지 않는다. */
export function countLabel(count: HubCount): string {
  return count.value === null ? '개수를 확인하지 못했어요' : `${count.value}${count.unit}`
}

/** 조회 상태를 화면 상태로 옮긴다. 실패를 빈 목록으로 바꾸지 않는다(fail-closed). */
export function hubStateKind(loadState: LoadState, entryCount: number): StateKind {
  if (loadState === 'loading') return 'loading'
  if (loadState === 'stale') return 'stale'
  if (loadState === 'error' || loadState === 'unknown') return 'error'
  if (entryCount === 0) return 'confirmed_empty'
  return 'ready'
}

/** 작업 탭 허브: 작업 목록·알림함 진입과 대화 시작, 최근 작업 몇 건. */
export interface WorkHubSnapshot {
  loadState: LoadState
  checkedAt: string | null
  entries: HubEntry[]
  /** 목록 화면(M11)과 같은 행 모델을 쓴다. 최근 항목만 넘긴다. */
  recent: WorkRow[]
}

/** 더보기 탭 허브: 채널·크레딧·가게 기억·설정 진입 리스트. */
export interface MoreHubSnapshot {
  loadState: LoadState
  checkedAt: string | null
  entries: HubEntry[]
}
