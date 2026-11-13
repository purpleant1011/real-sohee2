import type { DatasetMode } from '@/features/mobile-decision/contracts'
import type { ReportingDatasetMode } from '@/features/reporting/dataset'
import { confirmedValue, observationTruth, type ReportingObservation } from '@/features/reporting/observation'
import type { WeeklyCeoReportData } from '@/features/reporting/weekly-ceo-report-service'
import type { KpiId, MobileKpi } from '../results-model'
import type { ResultsViewSnapshot } from '../results-view'

type MetricKey = keyof WeeklyCeoReportData['metrics']

/**
 * 성과 화면 KPI ← 주간 리포트 지표.
 * '고객 문의'는 저장된 댓글(storedComments)과 다른 값이므로 연결하지 않는다.
 * 댓글 수를 문의 수로 바꿔 보여주면 근거 없는 숫자가 되기 때문이다.
 */
export const KPI_METRIC: Record<KpiId, MetricKey | null> = {
  published: 'verifiedPublishedPosts',
  inquiries: null,
  bookings: 'bookingConfirmed',
  deposits: 'paymentCapturedVerified',
}

/** 리포트의 데이터셋 구분을 화면 구분으로 옮긴다. 모르는 값은 UNKNOWN(숫자 숨김)으로 닫는다. */
const DATASET_MODE: Record<ReportingDatasetMode, DatasetMode> = {
  ACTUAL: 'ACTUAL',
  EXCLUDED: 'DEMO',
  UNKNOWN: 'UNKNOWN',
}

/** 리포트 기간은 UTC 경계만 갖는다. 화면 DTO 는 timeZone 을 요구하므로 UTC 로 명시한다. */
const PERIOD_TIME_ZONE = 'UTC'

export const failedResultsSnapshot = (): ResultsViewSnapshot => ({
  loadState: 'error',
  kpis: [],
  datasetMode: 'UNKNOWN',
  estimatedBookedKrw: null,
  confirmedPaidKrw: null,
  timeSavedBaselineMinutes: null,
  timeSavedMeasuredMinutes: null,
  timeSavedMethod: null,
  checkedAt: null,
})

/** 기존 주간 리포트 응답인지 확인한다. 모양이 다르면 숫자를 그리지 않고 error 로 닫는다. */
export function isWeeklyReport(value: unknown): value is WeeklyCeoReportData {
  if (!value || typeof value !== 'object') return false
  const v = value as Record<string, unknown>
  return typeof v.workspaceId === 'string'
    && typeof v.datasetMode === 'string'
    && typeof v.generatedAt === 'string'
    && !!v.period && typeof v.period === 'object'
    && !!v.metrics && typeof v.metrics === 'object'
}

/**
 * 근거 참조. 실제 기록 id 가 있으면 그것을, 없으면(0건 조회) 이번 조회 창을 쓴다.
 * 어느 쪽이든 '어느 기간을 어떤 출처로 읽었는지'가 남는다.
 */
function evidenceRefOf(observation: ReportingObservation): string {
  const first = observation.evidenceIds[0]
  if (first) return first
  return `weekly-report:${observation.period.start}~${observation.period.end}`
}

function kpiFromObservation(id: KpiId, observation: ReportingObservation | undefined, mode: DatasetMode): MobileKpi {
  const base = { id, datasetMode: mode, source: null }
  // 원천이 없는 KPI 는 조회 실패가 아니라 '근거 없음'이다. value=null 이면 화면이 숫자를 그리지 않는다.
  if (!observation) return { ...base, value: null, state: 'ready', period: null, evidenceRef: null, observedAt: null }

  const period = { start: observation.period.start, end: observation.period.end, timeZone: PERIOD_TIME_ZONE }
  // 관측 성공만으로는 부족하다. 어느 원장·연동에서 읽었는지(source)까지 확인된 값만 숫자로 옮긴다.
  const truth = observationTruth(observation)
  if (truth.value !== null) {
    return {
      ...base,
      value: truth.value,
      state: 'ready',
      period,
      evidenceRef: evidenceRefOf(observation),
      observedAt: observation.observedAt,
      source: truth.source,
    }
  }
  // 출처 없는 관측은 근거가 없는 값이므로 숫자를 만들지 않는다. ERROR 만 조회 실패로, 나머지는 미확인으로 닫는다.
  return {
    ...base,
    value: null,
    state: observation.state === 'ERROR' ? 'error' : 'unknown',
    period,
    evidenceRef: null,
    observedAt: null,
    source: null,
  }
}

/**
 * 주간 리포트 → 성과 화면 스냅샷(읽기 전용 어댑터).
 * 다른 가게 스냅샷이거나 형식이 깨졌으면 숫자를 하나도 그리지 않고 error 로 닫는다.
 */
export function toResultsSnapshot(report: WeeklyCeoReportData, workspaceId: string): ResultsViewSnapshot {
  if (!report || report.workspaceId !== workspaceId) return failedResultsSnapshot()
  if (!report.period || !Number.isFinite(Date.parse(report.generatedAt))) return failedResultsSnapshot()

  const mode = DATASET_MODE[report.datasetMode] ?? 'UNKNOWN'
  const kpis = (Object.keys(KPI_METRIC) as KpiId[]).map(id => {
    const key = KPI_METRIC[id]
    return kpiFromObservation(id, key ? report.metrics?.[key] : undefined, mode)
  })

  const revenue = report.metrics?.revenue
  return {
    loadState: 'ready',
    kpis,
    datasetMode: mode,
    // 예약 금액으로 매출을 추정하지 않는다. 리포트도 예상 금액을 만들지 않는다.
    estimatedBookedKrw: null,
    // 입금이 확인된 금액만 실제 매출이다. 출처를 댈 수 없는 관측은 금액으로 옮기지 않는다.
    confirmedPaidKrw: confirmedValue(revenue),
    // 기준선·측정 방법이 없으므로 절감 시간은 산출하지 않는다.
    timeSavedBaselineMinutes: null,
    timeSavedMeasuredMinutes: null,
    timeSavedMethod: null,
    checkedAt: report.generatedAt,
  }
}
