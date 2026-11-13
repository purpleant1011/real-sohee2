import type { WorkSegment } from './filters'

export interface HubRestoreState {
  query: string
  segment: WorkSegment
  scrollY: number
}

const DEFAULT: HubRestoreState = { query: '', segment: 'all', scrollY: 0 }
const SEGMENTS: readonly WorkSegment[] = ['all', 'draft', 'review', 'scheduled', 'verifying', 'confirmed']

export function hubStorageKey(workspaceId: string): string {
  return `sohee:mobile-hub:${workspaceId}`
}

export function parseHubRestore(serialized: string | null): HubRestoreState {
  if (!serialized) return DEFAULT
  try {
    const raw = JSON.parse(serialized) as Partial<HubRestoreState>
    const segment = SEGMENTS.includes(raw.segment as WorkSegment) ? raw.segment as WorkSegment : 'all'
    return {
      query: typeof raw.query === 'string' ? raw.query.slice(0, 80) : '',
      segment,
      scrollY: typeof raw.scrollY === 'number' && Number.isFinite(raw.scrollY) && raw.scrollY > 0 ? raw.scrollY : 0,
    }
  } catch {
    return DEFAULT
  }
}

export function serializeHubRestore(state: HubRestoreState): string {
  return JSON.stringify({ query: state.query.slice(0, 80), segment: SEGMENTS.includes(state.segment) ? state.segment : 'all', scrollY: Math.max(0, Math.round(state.scrollY)) })
}

/** 정규화 전 원본 문자열. useSyncExternalStore 스냅샷처럼 참조가 안정적이어야 하는 곳에서 쓴다. */
export function readHubRestoreSnapshot(storage: Pick<Storage, 'getItem'>, workspaceId: string): string | null {
  try { return storage.getItem(hubStorageKey(workspaceId)) } catch { return null }
}

export function readHubRestore(storage: Pick<Storage, 'getItem'>, workspaceId: string): HubRestoreState {
  return parseHubRestore(readHubRestoreSnapshot(storage, workspaceId))
}

export function writeHubRestore(storage: Pick<Storage, 'setItem'>, workspaceId: string, state: HubRestoreState): void {
  try { storage.setItem(hubStorageKey(workspaceId), serializeHubRestore(state)) } catch { /* 저장소 차단 시 복원만 생략한다. */ }
}
