import type { StateChipKind } from '@/components/mobile-ui'
import type { ReportingPeriod } from '@/features/reporting/observation'
import type { KpiId } from './results-model'

/**
 * M20 근거 드릴다운(`/app/results/:id`)의 판정 모듈.
 *
 * `:id` 는 **지표 키**다. 성과 화면의 숫자마다 '어디서 확인했나요?'로 들어오는 상세이고,
 * 주간 리포트에 저장된 보고서 id 는 없다(조회할 때마다 집계). 그래서 기간 id 를 지어내지 않는다.
 *
 * 원칙: 서버가 확인해 준 사실(값·출처·기간)만 말한다. 확인 못 한 것은 숫자 대신 이유를 말한다.
 * 조회 실패(ERROR)와 근거 미연결(NOT_OBSERVED·CONNECTION_REQUIRED)과 빈 주소(missing)를 뭉개지 않는다.
 */

/** 주간 요약은 조회할 때마다 다시 집계한다. 1시간 넘게 지난 응답은 '이전에 확인한 내용'으로 본다. */
export const RESULTS_DRILLDOWN_STALE_AFTER_MINUTES = 60

export type ResultsDrilldownLoadKind = 'loading' | 'ready' | 'missing' | 'unauthorized' | 'offline' | 'error'

/** 서버 관측 상태(`ReportingObservation.state`)와 같은 어휘. 화면에서 다시 정의하지 않는다. */
export type ResultsDrilldownMetricState = 'OBSERVED' | 'NOT_OBSERVED' | 'CONNECTION_REQUIRED' | 'ERROR'

export interface ResultsDrilldownStateChip {
  kind: StateChipKind
  label?: string
}

export interface ResultsDrilldownChipInput {
  loadKind: ResultsDrilldownLoadKind
  /** 서버가 준 지표 관측 상태. 지표 자체가 없는 KPI(inquiries)는 null. */
  metricState?: ResultsDrilldownMetricState | null
  /** 지표 원천이 연결되어 있는지. false 면 '집계하지 않는다'고 말한다. */
  metricConnected?: boolean
  /** 리포트가 ACTUAL 데이터셋인지. 아니면 숫자를 보여주지 않는다(fail-closed). */
  datasetVerified?: boolean
  /** 리포트 생성 시각. 오래됐으면 숫자를 최신으로 보여주지 않는다. */
  generatedAt?: string | null
  now?: number
  staleAfterMinutes?: number
}

/** 드릴다운이 존재하는 지표 키. 이 밖의 주소는 없는 화면이다(빈 화면으로 뭉개지 않는다). */
export const RESULTS_DRILLDOWN_KEYS: readonly KpiId[] = ['published', 'inquiries', 'bookings', 'deposits']

export function isResultsDrilldownKey(id: string): id is KpiId {
  return (RESULTS_DRILLDOWN_KEYS as readonly string[]).includes(id)
}

/** 생성 시각이 기준을 넘었는지. 시각이 없거나 읽을 수 없으면 stale 로 단정하지 않는다. */
export function isResultsDrilldownStale(
  generatedAt: string | null | undefined,
  now: number,
  staleAfterMinutes: number = RESULTS_DRILLDOWN_STALE_AFTER_MINUTES,
): boolean {
  if (!generatedAt) return false
  const generated = Date.parse(generatedAt)
  if (Number.isNaN(generated)) return false
  return now - generated > staleAfterMinutes * 60_000
}

/**
 * 관측 출처를 사장님이 읽을 수 있는 이름으로 옮긴다.
 * 내부 문자열(`reservations.created_at/current_status`)은 화면에 그대로 내보내지 않는다.
 */
export function resultsDrilldownSourceLabel(source: string): string {
  if (source.startsWith('reservations.')) return '예약 장부'
  if (source.startsWith('external_action_receipts.')) {
    if (source.includes('publish_attempts')) return '외부 확인 영수증 및 공식 게시 링크 기록'
    return source.includes('independent_publish_readback') ? '게시 확인 근거 기록' : '게시 확인 대기 기록'
  }
  if (source.startsWith('publish_attempts.')) return '공식 게시 링크 확인 기록'
  if (source.startsWith('social_comments.')) return '저장된 댓글 기록'
  return '확인 근거 기록'
}

/** 기간 표시는 한국 시간 기준으로 통일해 안내한다. */
export function resultsDrilldownPeriodLabel(period: ReportingPeriod): string {
  const day = (iso: string) => iso.slice(0, 10).replaceAll('-', '.')
  return `${day(period.start)} ~ ${day(period.end)} (한국 시간 기준)`
}

/**
 * 5상태 칩. 없으면 `null` = '확인된 전체'.
 * 우선순위: 연결 끊김/조회 중/조회 실패 → (ready) 근거 미연결 → 오래된 응답 → 칩 없음.
 * `missing`(없는 지표 주소)과 `unauthorized` 는 서버 판정이므로 실패 칩을 붙이지 않는다.
 */
export function resultsDrilldownStateChip(input: ResultsDrilldownChipInput): ResultsDrilldownStateChip | null {
  switch (input.loadKind) {
    case 'offline':
      return { kind: 'offline' }
    case 'loading':
      return { kind: 'loading' }
    case 'error':
      return { kind: 'error' }
    case 'missing':
      return null
    case 'unauthorized':
      return null
    case 'ready':
      break
  }

  // 1) 실제 기록이 아니면 숫자 자체를 보여주지 않는다.
  if (input.datasetVerified === false) return { kind: 'partial', label: '실제 기록이 아니에요' }
  // 2) 애초에 집계하지 않는 지표(고객 문의 ← 댓글 수)는 '연결 안 됨'과도 다르다.
  if (input.metricConnected === false) return { kind: 'partial', label: '이 숫자는 집계하지 않아요' }
  // 3) 조회 실패는 0건이 아니다.
  if (input.metricState === 'ERROR') return { kind: 'error' }
  // 4) 원천이 연결되지 않은 것은 조회 실패가 아니라 '아직 근거 없음'이다.
  if (input.metricState === 'CONNECTION_REQUIRED') return { kind: 'partial', label: '채널 연결 후 확인할 수 있어요' }
  if (input.metricState !== 'OBSERVED') return { kind: 'partial', label: '근거가 연결되지 않았어요' }
  // 5) 근거는 있으나 응답이 오래됐다.
  if (isResultsDrilldownStale(input.generatedAt, input.now ?? Date.now(), input.staleAfterMinutes)) {
    return { kind: 'stale' }
  }
  return null
}
