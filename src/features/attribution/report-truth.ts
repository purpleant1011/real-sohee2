import { formatObservation, type ReportingObservation } from '@/features/reporting/observation'

/**
 * Attribution console display truth.
 *
 * The console must never invent revenue, receipt coverage, reservation counts or
 * conversion rates. Every number it shows is derived from the same weekly
 * reporting source the home, results and customers screens already use
 * (`GET /api/workspaces/:id/reports/weekly`), so the same workspace shows the
 * same figures everywhere. When the source has no observation the console says
 * so instead of printing 0, a percentage, or a "connected" claim.
 */

export type MetricKey =
  | 'bookingConfirmed'
  | 'bookingCanceled'
  | 'verifiedPublishedPosts'
  | 'publicationPending'
  | 'storedComments'
  | 'paymentCapturedVerified'
  | 'revenue'
  | 'visitCompletedVerified'

export interface ReportTruthSource {
  workspaceId?: string | null
  datasetMode?: string | null
  periodLabel?: string | null
  metrics?: Partial<Record<MetricKey, ReportingObservation>> | null
}

export const UNKNOWN_VALUE = '아직 확인할 수 없어요'
export const WAITING_LABEL = '연동 대기'

export interface MetricView {
  /** Text safe to render as the headline number. */
  value: string
  /** Badge that states how the number was obtained. */
  badge: string
  /** Short note under the number. */
  note: string
  /** True only when the reporting source actually observed the metric. */
  observed: boolean
}

function observed(metric: ReportingObservation | undefined): metric is ReportingObservation {
  return Boolean(metric) && metric!.state === 'OBSERVED' && metric!.value !== null
}

function won(value: number): string {
  return `₩${value.toLocaleString('ko-KR')}`
}

/** Revenue card: shows a won amount only when a verified revenue ledger was observed. */
export function revenueView(source: ReportTruthSource | null): MetricView {
  const metric = source?.metrics?.revenue
  if (!observed(metric)) {
    return {
      value: UNKNOWN_VALUE,
      badge: 'NO_PROOF',
      note: `확인된 매출 장부 ${WAITING_LABEL}`,
      observed: false,
    }
  }
  return {
    value: won(metric.value as number),
    badge: 'MEASURED',
    note: `확인된 매출 기록 ${metric.evidenceIds.length}건`,
    observed: true,
  }
}

/**
 * Receipt coverage label. It may only claim evidence when the revenue metric was
 * observed with at least one evidence id; otherwise it states that the ledger is
 * not connected yet. It never prints a fixed percentage.
 */
export function receiptCoverageLabel(source: ReportTruthSource | null): string {
  const metric = source?.metrics?.revenue
  if (!observed(metric) || metric.evidenceIds.length === 0) {
    return `영수증 결제 증빙 ${WAITING_LABEL}`
  }
  return `영수증 결제 증빙 ${metric.evidenceIds.length}건 확인`
}

/** Confirmed reservations, taken from the same metric the home screen prints. */
export function confirmedBookingView(source: ReportTruthSource | null): MetricView {
  const metric = source?.metrics?.bookingConfirmed
  if (!observed(metric)) {
    return {
      value: UNKNOWN_VALUE,
      badge: 'NO_PROOF',
      note: '예약 장부 확인 필요',
      observed: false,
    }
  }
  return {
    value: formatObservation(metric),
    badge: 'MEASURED',
    note: '주간 실제 기록의 확정 예약과 같은 기준',
    observed: true,
  }
}

export interface FunnelStep {
  step: string
  title: string
  desc: string
  badge: string
}

/**
 * Six-step closed loop. Steps whose upstream tracking is not wired state that
 * plainly. The reservation step reuses `bookingConfirmed` so it can never
 * disagree with the home, results and customers screens.
 */
export function buildConversionFunnel(source: ReportTruthSource | null): FunnelStep[] {
  const published = source?.metrics?.verifiedPublishedPosts
  const comments = source?.metrics?.storedComments
  const bookings = source?.metrics?.bookingConfirmed
  const revenue = source?.metrics?.revenue

  return [
    {
      step: '1',
      title: '1. 콘텐츠 도달',
      desc: observed(published) ? `게시 확인 ${formatObservation(published)}` : '게시 확인 기록 없음',
      badge: '도달',
    },
    {
      step: '2',
      title: '2. 프로필 유입',
      desc: '유입 추적 미연결',
      badge: '유입',
    },
    {
      step: '3',
      title: '3. 1:1 상담 문의',
      desc: observed(comments) ? `저장된 댓글 ${formatObservation(comments)}` : '저장된 댓글 기록 없음',
      badge: '문의',
    },
    {
      step: '4',
      title: '4. 스마트 예약',
      desc: observed(bookings) ? `확정 예약 ${formatObservation(bookings)}` : UNKNOWN_VALUE,
      badge: '예약',
    },
    {
      step: '5',
      title: '5. 영수증 결제',
      desc: observed(revenue) ? `확인된 매출 ${won(revenue.value as number)}` : UNKNOWN_VALUE,
      badge: '매출 확인',
    },
    {
      step: '6',
      title: '6. 가중치 학습',
      desc: '학습 데이터 대기',
      badge: '학습',
    },
  ]
}

/** Plain-language definition so a reader can tell the funnel apart from the weekly ledger. */
export const FUNNEL_DEFINITION =
  '4단계 예약은 주간 실제 기록의 확정 예약과 같은 값입니다. 1단계는 게시 확인 기록, 3단계는 저장된 댓글 수이며 문의 건수와는 다릅니다. 2단계 유입 추적과 6단계 학습은 아직 연결되지 않았습니다.'

export function hasAttributionEvidence(source: ReportTruthSource | null): boolean {
  const revenue = source?.metrics?.revenue
  return observed(revenue) && revenue.evidenceIds.length > 0
}
