// @vitest-environment node
import { describe, expect, it } from 'vitest'
import type { ReportingObservation } from '@/features/reporting/observation'
import type { WeeklyCeoReportData } from '@/features/reporting/weekly-ceo-report-service'
import { KPI_METRIC, toResultsSnapshot } from './results-snapshot'

const WS = '11111111-1111-4111-8111-111111111111'
const PERIOD = { start: '2026-10-17T00:00:00.000Z', end: '2026-10-24T00:00:00.000Z' }

function observed(value: number, evidenceIds: string[] = [`ev-${value}`]): ReportingObservation {
  return { value, state: 'OBSERVED', source: 'test', period: PERIOD, observedAt: '2026-10-24T01:00:00.000Z', evidenceIds }
}
function notObserved(state: 'ERROR' | 'NOT_OBSERVED' | 'CONNECTION_REQUIRED' = 'NOT_OBSERVED'): ReportingObservation {
  return { value: null, state, source: 'test', period: PERIOD, observedAt: null, evidenceIds: [] }
}

function report(overrides: Partial<WeeklyCeoReportData> = {}): WeeklyCeoReportData {
  const metric = observed(3)
  return {
    workspaceId: WS,
    datasetMode: 'ACTUAL',
    periodLabel: '10월 17일 ~ 10월 23일',
    period: PERIOD,
    hoursSaved: 2,
    costSavedWon: null,
    confirmedBookingsCount: 3,
    totalRevenueWon: 150000,
    publishedPostsCount: 3,
    engagementCount: null,
    metrics: {
      bookingConfirmed: observed(3),
      bookingCanceled: observed(1),
      verifiedPublishedPosts: observed(4, ['receipt-1', 'receipt-2']),
      publicationPending: observed(2),
      storedComments: observed(9),
      paymentCapturedVerified: observed(2, ['pay-1']),
      revenue: observed(150000, ['pay-1']),
      visitCompletedVerified: observed(1),
      hoursSaved: metric,
      costSavedWon: metric,
    },
    executiveSummary: '이번 주 기록',
    generatedAt: '2026-10-24T01:00:00.000Z',
    ...overrides,
  }
}

describe('주간 리포트 → 성과 화면 어댑터', () => {
  it('확인된 기록만 숫자로 옮기고 근거 참조를 남긴다', () => {
    const snapshot = toResultsSnapshot(report(), WS)
    expect(snapshot.loadState).toBe('ready')
    expect(snapshot.datasetMode).toBe('ACTUAL')

    const published = snapshot.kpis.find(k => k.id === 'published')!
    expect(published.value).toBe(4)
    expect(published.state).toBe('ready')
    expect(published.evidenceRef).toBe('receipt-1')
    expect(published.period).toEqual({ ...PERIOD, timeZone: 'UTC' })

    const bookings = snapshot.kpis.find(k => k.id === 'bookings')!
    expect(bookings.value).toBe(3)
    const deposits = snapshot.kpis.find(k => k.id === 'deposits')!
    expect(deposits.value).toBe(2)
  })

  it('저장된 댓글을 고객 문의로 바꾸지 않는다(원천 미연결 = 숫자 없음)', () => {
    expect(KPI_METRIC.inquiries).toBeNull()
    const inquiries = toResultsSnapshot(report(), WS).kpis.find(k => k.id === 'inquiries')!
    expect(inquiries.value).toBeNull()
    expect(inquiries.evidenceRef).toBeNull()
    expect(inquiries.state).toBe('ready')
    // 원천이 연결되지 않은 지표에는 출처도 붙이지 않는다.
    expect(inquiries.source).toBeNull()
  })

  it('숫자를 그리는 지표는 읽은 출처를 함께 남긴다', () => {
    const snapshot = toResultsSnapshot(report(), WS)
    const published = snapshot.kpis.find(k => k.id === 'published')!
    const bookings = snapshot.kpis.find(k => k.id === 'bookings')!
    const deposits = snapshot.kpis.find(k => k.id === 'deposits')!

    expect(published.source).toBe('test')
    expect(bookings.source).toBe('test')
    expect(deposits.source).toBe('test')
  })

  it('출처가 비어 있으면 숫자를 그리지 않는다(출처 없는 값은 근거 없음)', () => {
    const base = report()
    const snapshot = toResultsSnapshot({
      ...base,
      metrics: { ...base.metrics, bookingConfirmed: { ...observed(3), source: '   ' } },
    }, WS)
    const bookings = snapshot.kpis.find(k => k.id === 'bookings')!
    expect(bookings.value).toBeNull()
    expect(bookings.state).toBe('unknown')
    expect(bookings.source).toBeNull()
    expect(bookings.evidenceRef).toBeNull()
  })

  it('출처 없는 수납·매출 관측은 금액으로 옮기지 않는다', () => {
    const base = report()
    const snapshot = toResultsSnapshot({
      ...base,
      metrics: {
        ...base.metrics,
        paymentCapturedVerified: { ...observed(2, ['pay-1']), source: '' },
        revenue: { ...observed(150000, ['pay-1']), source: '  ' },
      },
    }, WS)

    const deposits = snapshot.kpis.find(k => k.id === 'deposits')!
    expect(deposits.value).toBeNull()
    expect(deposits.state).toBe('unknown')
    expect(deposits.source).toBeNull()
    expect(snapshot.confirmedPaidKrw).toBeNull()
  })

  it('조회 실패·근거 미확인 지표에는 출처를 붙이지 않는다', () => {
    const base = report()
    const snapshot = toResultsSnapshot({
      ...base,
      metrics: { ...base.metrics, bookingConfirmed: notObserved('ERROR'), paymentCapturedVerified: notObserved('CONNECTION_REQUIRED') },
    }, WS)
    expect(snapshot.kpis.find(k => k.id === 'bookings')!.source).toBeNull()
    expect(snapshot.kpis.find(k => k.id === 'deposits')!.source).toBeNull()
  })

  it('0건 조회는 기간을 근거 참조로 남긴다(근거 없는 0 금지)', () => {
    const base = report()
    const snapshot = toResultsSnapshot(
      { ...base, metrics: { ...base.metrics, verifiedPublishedPosts: observed(0, []) } },
      WS,
    )
    const published = snapshot.kpis.find(k => k.id === 'published')!
    expect(published.value).toBe(0)
    expect(published.evidenceRef).toBe(`weekly-report:${PERIOD.start}~${PERIOD.end}`)
  })

  it('조회 실패 지표는 error, 근거 미확인 지표는 unknown 으로 남기고 숫자를 만들지 않는다', () => {
    const base = report()
    const snapshot = toResultsSnapshot({
      ...base,
      metrics: { ...base.metrics, bookingConfirmed: notObserved('ERROR'), paymentCapturedVerified: notObserved('CONNECTION_REQUIRED') },
    }, WS)
    const bookings = snapshot.kpis.find(k => k.id === 'bookings')!
    expect(bookings.state).toBe('error')
    expect(bookings.value).toBeNull()
    const deposits = snapshot.kpis.find(k => k.id === 'deposits')!
    expect(deposits.state).toBe('unknown')
    expect(deposits.value).toBeNull()
  })

  it('예약 금액으로 매출을 추정하지 않고, 입금 확인 금액만 쓴다', () => {
    const snapshot = toResultsSnapshot(report(), WS)
    expect(snapshot.estimatedBookedKrw).toBeNull()
    expect(snapshot.confirmedPaidKrw).toBe(150000)

    const base = report()
    const unverified = toResultsSnapshot({ ...base, metrics: { ...base.metrics, revenue: notObserved() } }, WS)
    expect(unverified.confirmedPaidKrw).toBeNull()
  })

  it('절감 시간은 기준선·측정 방법이 없으므로 산출하지 않는다', () => {
    const snapshot = toResultsSnapshot(report(), WS)
    expect(snapshot.timeSavedBaselineMinutes).toBeNull()
    expect(snapshot.timeSavedMeasuredMinutes).toBeNull()
    expect(snapshot.timeSavedMethod).toBeNull()
  })

  it('다른 가게 스냅샷은 값·근거·출처를 하나도 남기지 않고 error 로 닫는다', () => {
    const snapshot = toResultsSnapshot(report(), '22222222-2222-4222-8222-222222222222')
    expect(snapshot.loadState).toBe('error')
    expect(snapshot.kpis).toEqual([])
    expect(snapshot.datasetMode).toBe('UNKNOWN')
    expect(snapshot.confirmedPaidKrw).toBeNull()
    expect(snapshot.checkedAt).toBeNull()
  })

  it('workspaceId 가 비어 있는 리포트도 그리지 않는다(경계 값 부정)', () => {
    const snapshot = toResultsSnapshot(report(), '')
    expect(snapshot.loadState).toBe('error')
    expect(snapshot.kpis).toEqual([])
  })

  it('ACTUAL 이 아닌 데이터셋은 DEMO 로 표시해 화면이 숫자를 숨기게 한다', () => {
    const snapshot = toResultsSnapshot(report({ datasetMode: 'EXCLUDED' }), WS)
    expect(snapshot.datasetMode).toBe('DEMO')
    expect(snapshot.kpis.every(k => k.datasetMode === 'DEMO')).toBe(true)
  })

  it('생성 시각이 깨진 리포트는 숫자를 그리지 않는다', () => {
    const snapshot = toResultsSnapshot(report({ generatedAt: 'not-a-date' }), WS)
    expect(snapshot.loadState).toBe('error')
    expect(snapshot.kpis).toEqual([])
  })
})
