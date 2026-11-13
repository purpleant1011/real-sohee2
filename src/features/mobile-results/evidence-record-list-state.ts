import type { StateChipKind } from '@/components/mobile-ui'
import type { EvidenceRecordBoundary } from './server/evidence-record-boundary'
import type { EvidenceRecordSummary } from './server/evidence-record-dto'
import { isResultsDrilldownStale, resultsDrilldownPeriodLabel } from './results-drilldown-state'

/**
 * M20 근거 기록 목록의 화면 판정(ANI-1783 2단계).
 *
 * 경계(`evidenceRecordBoundary`)가 이미 "무엇을 믿을 수 있는가"를 정했다. 이 모듈은 그 결론을
 * 화면 문구·목록 표시 여부·칩으로 옮기기만 한다. 숫자를 만들지 않고, 실패를 0건으로 바꾸지 않는다.
 *
 * 설계 §5.2 우선순위: 실제 기록 아님 → 집계 안 함 → 확인 실패 → 원천 미연결 → 미관측 →
 * 확인된 0건(이때만 0) → 목록. 모르는 종류는 세어서 함께 말한다.
 */

/** 목록 최소 높이(터치 목표). 44px. */
export const EVIDENCE_RECORD_ROW_MIN_HEIGHT = 44

export type EvidenceRecordListStateKind = 'loading' | EvidenceRecordBoundary['kind']

export const EVIDENCE_RECORD_LIST_NOTICE = {
  excluded: '실제 기록이 아니라서 근거 기록을 보여드리지 않아요.',
  metricDisconnected: '이 숫자는 집계하지 않아서 근거 기록을 보여드리지 않아요.',
  error: '아직 확인 중이에요. 없는 것이 아니라 확인에 실패한 상태예요.',
  connectionRequired: '채널을 연결하면 근거 기록을 확인할 수 있어요.',
  notObserved: '이 지표의 근거 기록이 아직 연결되지 않았어요.',
  empty: '이 기간에 확인된 기록이 없어요.',
  session: '로그인이 만료됐어요. 다시 로그인해 주세요.',
  permission: '이 기록을 볼 권한이 없어요.',
  missing: '그런 기록을 찾지 못했어요.',
  offline: '네트워크에 연결할 수 없어요. 다시 확인해 주세요.',
  stale: '마지막 확인이 오래돼서 기록을 보여드리지 않아요. 다시 확인해 주세요.',
  unknownCheckedAt: '확인 시각을 읽지 못했어요.',
} as const

export interface EvidenceRecordListSnapshot {
  kind: EvidenceRecordListStateKind
  /** 화면 제목에 쓰는 지표 이름. 서버 DTO 가 아니라 드릴다운과 같은 표기를 쓴다. */
  metricLabel: string
  /** 목록을 그리지 않는 상태의 안내 문구. 목록이 있으면 null. */
  notice: string | null
  records: readonly EvidenceRecordSummary[]
  totalCount: number | null
  hasMore: boolean
  omittedUnknownCount: number
  /** "3건" · "25건 중 최근 20건". 그릴 수 없으면 null. */
  countText: string | null
  /** 잘라낸 사실·모르는 종류를 말하는 한 줄. 없으면 null. */
  omittedText: string | null
  /** 확인 시각을 읽지 못했을 때의 한 줄. 목록은 그대로 보여 준다. */
  checkedAtNotice: string | null
  checkedAt: string | null
  periodLabel: string | null
  stale: boolean
  /** 목록을 그려도 되는가. stale·실패·미관측에서는 절대 true 가 아니다. */
  showRecords: boolean
  /** 401(세션 만료)과 403(권한 없음)을 화면이 다시 판정하지 않게 서버 결론을 그대로 넘긴다. */
  unauthorizedReason: 'session' | 'permission' | null
  chip: { kind: StateChipKind; label?: string } | null
}

/** 기록이 만들어진 시각. 읽을 수 없으면 null — 시각을 지어내지 않는다. */
export function evidenceRecordOccurredLabel(occurredAt: string): string | null {
  const ms = Date.parse(occurredAt)
  if (Number.isNaN(ms)) return null
  const at = new Date(ms)
  const hour = String(at.getUTCHours()).padStart(2, '0')
  const minute = String(at.getUTCMinutes()).padStart(2, '0')
  return `${at.getUTCMonth() + 1}월 ${at.getUTCDate()}일 ${hour}:${minute} (한국 시간 기준)`
}

/** "만들어진 시각"과 "서버가 확인한 시각"을 같은 줄에서 뭉개지 않는다(설계 §4). */
export function evidenceRecordCountText(totalCount: number, visible: number, hasMore: boolean): string {
  if (hasMore) return `${totalCount}건 중 최근 ${visible}건`
  return `${totalCount}건`
}

export function evidenceRecordOmittedText(omittedUnknownCount: number): string | null {
  if (omittedUnknownCount <= 0) return null
  return `확인하지 못한 종류 ${omittedUnknownCount}건은 표시하지 않았어요.`
}

function noticeFor(boundary: EvidenceRecordBoundary): string | null {
  switch (boundary.kind) {
    case 'ready':
      return null
    case 'confirmed_empty':
      return EVIDENCE_RECORD_LIST_NOTICE.empty
    case 'metric_disconnected':
      return EVIDENCE_RECORD_LIST_NOTICE.metricDisconnected
    case 'not_observed':
      return EVIDENCE_RECORD_LIST_NOTICE.notObserved
    case 'connection_required':
      return EVIDENCE_RECORD_LIST_NOTICE.connectionRequired
    case 'excluded':
      return EVIDENCE_RECORD_LIST_NOTICE.excluded
    case 'missing':
      return EVIDENCE_RECORD_LIST_NOTICE.missing
    case 'offline':
      return EVIDENCE_RECORD_LIST_NOTICE.offline
    case 'unauthorized':
      return boundary.reason === 'session'
        ? EVIDENCE_RECORD_LIST_NOTICE.session
        : EVIDENCE_RECORD_LIST_NOTICE.permission
    case 'error':
      return EVIDENCE_RECORD_LIST_NOTICE.error
  }
}

function chipFor(kind: EvidenceRecordListStateKind, stale: boolean): EvidenceRecordListSnapshot['chip'] {
  if (stale) return { kind: 'stale' }
  if (kind === 'loading') return { kind: 'loading' }
  if (kind === 'offline') return { kind: 'offline' }
  if (kind === 'error') return { kind: 'error' }
  return null
}

const EMPTY_SNAPSHOT: Omit<EvidenceRecordListSnapshot, 'kind' | 'metricLabel' | 'notice' | 'chip'> = {
  records: [],
  totalCount: null,
  hasMore: true,
  omittedUnknownCount: 0,
  countText: null,
  omittedText: null,
  checkedAtNotice: null,
  checkedAt: null,
  periodLabel: null,
  stale: false,
  showRecords: false,
  unauthorizedReason: null,
}

/**
 * 경계 결론 → 화면 스냅샷.
 *
 * `boundary` 가 null 이면 아직 조회 중이라는 뜻이다(0건이 아니다).
 */
export function evidenceRecordListSnapshot(input: {
  boundary: EvidenceRecordBoundary | null
  metricLabel: string
  now?: number
  staleAfterMinutes?: number
}): EvidenceRecordListSnapshot {
  const { boundary, metricLabel } = input
  if (!boundary) {
    return { ...EMPTY_SNAPSHOT, kind: 'loading', metricLabel, notice: null, chip: chipFor('loading', false) }
  }

  const data = boundary.data
  const stale = boundary.kind === 'ready'
    && isResultsDrilldownStale(data.checkedAt, input.now ?? Date.now(), input.staleAfterMinutes)
  const showRecords = boundary.kind === 'ready' && !stale
  const checkedAt = typeof data.checkedAt === 'string' && !Number.isNaN(Date.parse(data.checkedAt))
    ? data.checkedAt
    : null
  const periodLabel = data.period.start && data.period.end
    ? resultsDrilldownPeriodLabel(data.period)
    : null

  return {
    kind: boundary.kind,
    metricLabel,
    notice: stale ? EVIDENCE_RECORD_LIST_NOTICE.stale : noticeFor(boundary),
    records: showRecords ? data.records : [],
    totalCount: data.totalCount,
    hasMore: data.hasMore,
    omittedUnknownCount: data.omittedUnknownCount,
    countText: showRecords && data.totalCount !== null
      ? evidenceRecordCountText(data.totalCount, data.records.length, data.hasMore)
      : null,
    omittedText: showRecords ? evidenceRecordOmittedText(data.omittedUnknownCount) : null,
    // 확인 시각을 읽지 못한 것은 stale 과 다르다 — 목록을 숨기지 않고 표기만 한다.
    checkedAtNotice: showRecords && checkedAt === null ? EVIDENCE_RECORD_LIST_NOTICE.unknownCheckedAt : null,
    checkedAt,
    periodLabel,
    stale,
    showRecords,
    unauthorizedReason: boundary.kind === 'unauthorized' ? boundary.reason : null,
    chip: chipFor(boundary.kind, stale),
  }
}
