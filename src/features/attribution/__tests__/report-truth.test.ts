import { describe, expect, it } from 'vitest'
import {
  FUNNEL_DEFINITION,
  UNKNOWN_VALUE,
  buildConversionFunnel,
  confirmedBookingView,
  hasAttributionEvidence,
  receiptCoverageLabel,
  revenueView,
} from '../report-truth'
import type { ReportingObservation } from '@/features/reporting/observation'

const period = { start: '2026-10-17T00:00:00.000Z', end: '2026-10-24T00:00:00.000Z' }

function metric(value: number | null, state: ReportingObservation['state'], evidenceIds: string[] = []): ReportingObservation {
  return { value, state, source: 'test-source', period, observedAt: state === 'OBSERVED' ? '2026-10-23T02:00:00.000Z' : null, evidenceIds }
}

const unobservedRevenue = metric(null, 'NOT_OBSERVED')
const observedRevenue = metric(120000, 'OBSERVED', ['receipt-1', 'receipt-2'])

describe('receipt coverage', () => {
  it('never claims a percentage or a connected receipt ledger when no payment evidence exists', () => {
    const label = receiptCoverageLabel({ metrics: { revenue: unobservedRevenue } })
    expect(label).not.toMatch(/100%/)
    expect(label).not.toMatch(/연동됨/)
    expect(label).toContain('연동 대기')
  })

  it('reports the number of receipt evidence ids when the ledger was observed', () => {
    expect(receiptCoverageLabel({ metrics: { revenue: observedRevenue } })).toBe('영수증 결제 증빙 2건 확인')
  })

  it('does not claim coverage when revenue was observed with zero evidence ids', () => {
    const label = receiptCoverageLabel({ metrics: { revenue: metric(0, 'OBSERVED', []) } })
    expect(label).toContain('연동 대기')
    expect(label).not.toMatch(/확인$/)
  })
})

describe('revenue view', () => {
  it('shows an honest placeholder instead of ₩0 when revenue was never observed', () => {
    const view = revenueView({ metrics: { revenue: unobservedRevenue } })
    expect(view.value).toBe(UNKNOWN_VALUE)
    expect(view.observed).toBe(false)
    expect(view.badge).toBe('NO_PROOF')
  })

  it('shows the observed amount and its evidence count', () => {
    const view = revenueView({ metrics: { revenue: observedRevenue } })
    expect(view.value).toBe('₩120,000')
    expect(view.note).toContain('2건')
    expect(view.observed).toBe(true)
  })

  it('survives a null source', () => {
    expect(revenueView(null).value).toBe(UNKNOWN_VALUE)
    expect(receiptCoverageLabel(null)).toContain('연동 대기')
  })
})

describe('confirmed booking view', () => {
  it('uses the same weekly metric the home screen prints', () => {
    const view = confirmedBookingView({ metrics: { bookingConfirmed: metric(1, 'OBSERVED', ['res-1']) } })
    expect(view.value).toBe('1건')
    expect(view.note).toContain('같은 기준')
  })

  it('does not turn a missing ledger into 0건', () => {
    expect(confirmedBookingView({ metrics: { bookingConfirmed: metric(null, 'NOT_OBSERVED') } }).value).toBe(UNKNOWN_VALUE)
  })
})

describe('conversion funnel', () => {
  it('prints the confirmed reservation count in step 4 instead of a fixed string', () => {
    const funnel = buildConversionFunnel({ metrics: { bookingConfirmed: metric(3, 'OBSERVED', ['res-1', 'res-2', 'res-3']) } })
    expect(funnel[3].title).toBe('4. 스마트 예약')
    expect(funnel[3].desc).toBe('확정 예약 3건')
    expect(funnel[3].desc).not.toBe('0건 예약')
  })

  it('states the reservation step is unknown when the ledger is not observed', () => {
    const funnel = buildConversionFunnel({ metrics: { bookingConfirmed: metric(null, 'NOT_OBSERVED') } })
    expect(funnel[3].desc).toBe(UNKNOWN_VALUE)
  })

  it('marks untracked steps as not connected rather than 0', () => {
    const funnel = buildConversionFunnel({ metrics: {} })
    expect(funnel[1].desc).toContain('미연결')
    expect(funnel[2].desc).toContain('기록 없음')
    expect(funnel.map((step) => step.desc).join(' ')).not.toMatch(/0명|0건 예약/)
  })

  it('explains how the funnel differs from the weekly ledger', () => {
    expect(FUNNEL_DEFINITION).toContain('같은 값')
    expect(FUNNEL_DEFINITION).toContain('문의 건수와는 다릅니다')
  })
})

describe('attribution evidence gate', () => {
  it('is false without receipt evidence, so no attribution numbers may render', () => {
    expect(hasAttributionEvidence({ metrics: { revenue: unobservedRevenue } })).toBe(false)
    expect(hasAttributionEvidence(null)).toBe(false)
  })

  it('is true only when revenue was observed with evidence ids', () => {
    expect(hasAttributionEvidence({ metrics: { revenue: observedRevenue } })).toBe(true)
  })
})
