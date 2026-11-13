import type { DatasetMode, LoadState } from '@/features/mobile-decision/contracts'

/**
 * 화면이 보여줄 수 있는 데이터셋.
 *
 * `EXAMPLE` 은 `/dev/mobile-r2` 예시 화면 전용 값이다. 서버 DTO 계약(`DatasetMode`)에는
 * 이 값이 없으므로 실라우트의 DTO 파서는 이 값을 만들 수 없고, 실라우트 스냅샷은
 * `datasetMode` 를 `ACTUAL` 로 두고 `EXAMPLE` 지표를 섞어 넣어도 숫자가 그려지지 않는다
 * (kpiDisplay 가 지표 단위로 fail-closed).
 */
export type ResultsDatasetMode = DatasetMode | 'EXAMPLE'

export type KpiId = 'published' | 'inquiries' | 'bookings' | 'deposits'
export interface Period { start: string; end: string; timeZone: string }
export interface MobileKpi {
  id: KpiId
  value: number | null
  state: LoadState
  datasetMode: ResultsDatasetMode
  period: Period | null
  evidenceRef: string | null
  observedAt: string | null
  /**
   * 숫자를 읽은 출처(어느 연동·원장인지). 숫자를 그릴 수 있는 지표에만 채운다.
   * 확인하지 못한 지표에 출처를 붙이면 '확인된 값'처럼 보이므로 null 로 남긴다.
   */
  source?: string | null
}

export type KpiDisplay =
  | { kind: 'value'; text: string; evidenceRef: string }
  | { kind: 'unverified'; text: string }
  | { kind: 'error'; text: string }
  | { kind: 'loading'; text: string }
  | { kind: 'stale'; text: string; observedAt: string | null }

export const KPI_LABEL: Record<KpiId, string> = {
  published: '게시 확인',
  inquiries: '고객 문의',
  bookings: '예약 확정',
  deposits: '확인된 매출',
}

export const KPI_EXPLANATION: Record<KpiId, string> = {
  published: '정상 게시된 홍보예요',
  inquiries: '소통함으로 들어온 문의예요',
  bookings: '예약이 확정된 건수예요',
  deposits: '입금까지 확인된 금액이에요',
}

/** 예시 숫자에 붙는 표시. 영문 코드(EXAMPLE)를 화면에 내보내지 않는다. */
export const EXAMPLE_BADGE_LABEL = '예시'

/** 이 데이터셋이면 숫자를 그린다. ACTUAL 규칙은 그대로이고 EXAMPLE 은 예시 화면 전용이다. */
export function showsNumbers(mode: ResultsDatasetMode): boolean {
  return mode === 'ACTUAL' || mode === 'EXAMPLE'
}

/** 근거·기간·화면 데이터셋이 모두 맞을 때만 숫자를 보여준다. 그 외에는 0이 아니라 '미확인'. */
export function kpiDisplay(k: MobileKpi, mode: ResultsDatasetMode = 'ACTUAL'): KpiDisplay {
  if (k.state === 'loading') return { kind: 'loading', text: '기록을 확인하고 있어요' }
  if (k.state === 'error' || k.state === 'unknown') return { kind: 'error', text: '아직 확인 중이에요' }
  if (k.datasetMode !== mode) return { kind: 'unverified', text: '실제 기록이 아니라 숫자를 보여드리지 않아요' }
  if (k.state === 'stale') return { kind: 'stale', text: '이전 확인 내용이에요', observedAt: k.observedAt }
  if (k.value === null || !k.evidenceRef || !k.period) return { kind: 'unverified', text: '근거가 확인되면 보여드려요' }
  return { kind: 'value', text: `${k.value.toLocaleString('ko-KR')}건`, evidenceRef: k.evidenceRef }
}

/** 예약 매출(추정)과 입금 확인 금액은 합산하지 않는다. */
export function revenueRows(estimatedBooked: number | null, confirmedPaid: number | null) {
  return [
    { label: '예약 기준 예상 금액', value: estimatedBooked, isEstimate: true },
    { label: '입금 확인된 금액', value: confirmedPaid, isEstimate: false },
  ]
}

export type NextActionId = 'deposit-followup' | 'publish-check'
export interface NextAction {
  id: NextActionId
  text: string
  href?: string
  actionLabel?: string
}

/**
 * '다음에 할 일' 제안. 화면에 그린 숫자와 **같은 규칙**으로 확인된 값에서만 만든다.
 * 근거 없는 제안·ROI 표현은 만들지 않고, 만들 것이 없으면 빈 배열(카드 자체를 숨긴다).
 * ACTUAL 이 아니면 제안하지 않는다 — 예시·데모 숫자로 사장님께 할 일을 시키지 않는다.
 */
export function nextActions(kpis: readonly MobileKpi[], mode: ResultsDatasetMode): NextAction[] {
  if (mode !== 'ACTUAL') return []
  // kpiDisplay 와 같은 fail-closed 판정을 통과한 값만 쓴다(오류·미확인·stale·다른 데이터셋 제외).
  const measured = (id: KpiId): number | null => {
    const kpi = kpis.find(item => item.id === id)
    if (!kpi) return null
    return kpiDisplay(kpi, mode).kind === 'value' ? kpi.value : null
  }

  const published = measured('published')
  const bookings = measured('bookings')
  const deposits = measured('deposits')
  const actions: NextAction[] = []

  // 예약은 확인됐는데 예약금 입금 확인이 0건 — 두 측정값의 차이만 말한다.
  if (bookings !== null && bookings > 0 && deposits === 0) {
    actions.push({
      id: 'deposit-followup',
      text: `예약 확정 ${bookings.toLocaleString('ko-KR')}건 중 입금 확인은 0건이에요.`,
    })
  }
  // 게시가 확인된 홍보가 0건 — 게시 확인 요청. '0건'도 확인된 값일 때만 말한다.
  if (published === 0) {
    actions.push({
      id: 'publish-check',
      text: '게시가 확인된 홍보가 없어요. 새 홍보를 확인해 보세요.',
      href: '/app/content',
      actionLabel: '게시 확인하러 가기',
    })
  }

  return actions.slice(0, 2)
}

/** 모든 KPI는 같은 기간·사업장이어야 PC와 동치. 하나라도 다르면 비교 불가. */
export function samePeriod(kpis: MobileKpi[]): boolean {
  const withPeriod = kpis.filter((k): k is MobileKpi & { period: Period } => k.period !== null)
  if (!withPeriod.length) return false
  const [first, ...rest] = withPeriod
  return rest.every(k => k.period.start === first.period.start && k.period.end === first.period.end && k.period.timeZone === first.period.timeZone)
}

/** 도입 전후 시간 절감은 기준선과 측정 방법이 모두 있을 때만 산출. */
export function timeSaved(baselineMinutes: number | null, measuredMinutes: number | null, method: string | null): number | null {
  if (baselineMinutes === null || measuredMinutes === null || !method) return null
  return Math.max(0, baselineMinutes - measuredMinutes)
}
