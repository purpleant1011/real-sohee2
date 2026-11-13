import { describe, expect, it } from 'vitest'
import { buildFunnelReport, type FunnelEvent } from './funnel'

const t = (m: number) => new Date(Date.UTC(2026, 9, 23, 9, m)).toISOString()
const all: FunnelEvent[] = [
  { step: 'SIGNUP', at: t(0) },
  { step: 'SHOP_INFO', at: t(1) },
  { step: 'PHOTO', at: t(3) },
  { step: 'RIGHTS', at: t(4) },
  { step: 'PREVIEW', at: t(6) },
  { step: 'APPROVAL', at: t(8) },
  { step: 'FIRST_VALUE', at: t(9), source: 'PROVIDER_READBACK' },
]

describe('buildFunnelReport', () => {
  it('10분 안에 독립 readback 으로 끝나면 예산 이내다', () => {
    const r = buildFunnelReport(all)
    expect(r.totalMs).toBe(9 * 60_000)
    expect(r.withinBudget).toBe(true)
    expect(r.stoppedBefore).toBeNull()
  })

  it('API 응답·수동 근거의 첫 가치는 인정하지 않는다', () => {
    const r = buildFunnelReport(all.map((e) => (e.step === 'FIRST_VALUE' ? { ...e, source: 'API_RESPONSE' as const } : e)))
    expect(r.stoppedBefore).toBe('FIRST_VALUE')
    expect(r.withinBudget).toBeNull()
  })

  it('10분을 넘기면 false', () => {
    const r = buildFunnelReport(all.map((e) => (e.step === 'FIRST_VALUE' ? { ...e, at: t(12) } : e)))
    expect(r.withinBudget).toBe(false)
  })

  it('시각을 읽을 수 없으면 0초가 아니라 측정 불가(null)다', () => {
    const r = buildFunnelReport(all.map((e) => (e.step === 'PHOTO' ? { ...e, at: 'x' } : e)))
    expect(r.steps.find((s) => s.step === 'PHOTO')?.sinceMs).toBeNull()
    expect(r.withinBudget).toBe(true)
    expect(buildFunnelReport(all.map((e) => (e.step === 'SIGNUP' ? { ...e, at: '' } : e))).withinBudget).toBeNull()
  })

  it('중간에서 멈추면 이탈 지점을 알려준다', () => {
    const r = buildFunnelReport(all.slice(0, 3))
    expect(r.stoppedBefore).toBe('RIGHTS')
    expect(r.totalMs).toBeNull()
  })
})
