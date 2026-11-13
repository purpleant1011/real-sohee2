import { describe, expect, it } from 'vitest'
import { kpiDisplay, nextActions, samePeriod, showsNumbers, timeSaved, type MobileKpi } from './results-model'

const p = { start: '2026-10-19', end: '2026-10-25', timeZone: 'Asia/Seoul' }
const k = (o: Partial<MobileKpi> = {}): MobileKpi => ({ id: 'bookings', value: 1, state: 'ready', datasetMode: 'ACTUAL', period: p, evidenceRef: 'ledger:1', observedAt: '2026-10-22T00:00:00Z', ...o })

describe('성과 KPI 표시', () => {
  it('근거·기간 있는 ACTUAL만 숫자', () => expect(kpiDisplay(k())).toMatchObject({ kind: 'value', text: '1건' }))
  it('근거 없으면 숫자 대신 미확인', () => expect(kpiDisplay(k({ evidenceRef: null })).kind).toBe('unverified'))
  it('조회 오류는 0건이 아니다', () => {
    const d = kpiDisplay(k({ state: 'error', value: null }))
    expect(d.kind).toBe('error'); expect(d.text).not.toMatch(/0건/)
  })
  it('SHOWCASE/TEST 데이터는 ACTUAL에서 차단', () => {
    expect(kpiDisplay(k({ datasetMode: 'DEMO' })).kind).toBe('unverified')
    expect(kpiDisplay(k({ datasetMode: 'TEST' })).kind).toBe('unverified')
  })
  it('stale은 실시간 값으로 보이지 않음', () => expect(kpiDisplay(k({ state: 'stale' })).kind).toBe('stale'))
  it('확정 0건은 0건으로 표시', () => expect(kpiDisplay(k({ value: 0 }))).toMatchObject({ kind: 'value', text: '0건' }))
})
describe('EXAMPLE 데이터셋', () => {
  it('ACTUAL·EXAMPLE 만 숫자를 그린다', () => {
    expect(showsNumbers('ACTUAL')).toBe(true)
    expect(showsNumbers('EXAMPLE')).toBe(true)
    expect(showsNumbers('DEMO')).toBe(false)
    expect(showsNumbers('TEST')).toBe(false)
    expect(showsNumbers('UNKNOWN')).toBe(false)
  })
  it('EXAMPLE 화면은 EXAMPLE 지표를 숫자로 그린다', () => {
    expect(kpiDisplay(k({ datasetMode: 'EXAMPLE' }), 'EXAMPLE')).toMatchObject({ kind: 'value', text: '1건' })
  })
  it('EXAMPLE 지표는 ACTUAL 화면에서 차단된다', () => {
    expect(kpiDisplay(k({ datasetMode: 'EXAMPLE' }), 'ACTUAL').kind).toBe('unverified')
  })
  it('EXAMPLE 화면도 근거 없는 지표는 숫자로 그리지 않는다', () => {
    expect(kpiDisplay(k({ datasetMode: 'EXAMPLE', evidenceRef: null }), 'EXAMPLE').kind).toBe('unverified')
  })
})
describe('기간·절감', () => {
  it('기간 불일치면 동치 아님', () => expect(samePeriod([k(), k({ period: { ...p, end: '2026-10-26' } })])).toBe(false))
  it('기준선 없으면 미산출', () => expect(timeSaved(null, 10, '측정')).toBeNull())
  it('기준선+방법 있으면 산출', () => expect(timeSaved(60, 10, '측정')).toBe(50))
})

// '다음에 할 일' — 측정된 사실에서만. 근거가 없으면 카드 자체를 만들지 않는다.
describe('다음에 할 일 제안', () => {
  const measured = (id: MobileKpi['id'], value: number | null, overrides: Partial<MobileKpi> = {}) =>
    k({ id, value, ...overrides })

  it('예약은 확인됐는데 입금 확인이 0건이면 두 값만 말한다', () => {
    const actions = nextActions([measured('bookings', 2), measured('deposits', 0)], 'ACTUAL')
    expect(actions).toHaveLength(1)
    expect(actions[0].text).toContain('예약 확정 2건')
    expect(actions[0].text).toContain('0건')
  })

  it('입금 확인 값을 모르면(미확인) 제안하지 않는다', () => {
    const actions = nextActions([measured('bookings', 2), measured('deposits', null)], 'ACTUAL')
    expect(actions).toHaveLength(0)
  })

  it('입금 조회가 실패한 것도 0건으로 치환해 제안하지 않는다', () => {
    const actions = nextActions([measured('bookings', 2), measured('deposits', null, { state: 'error' })], 'ACTUAL')
    expect(actions).toHaveLength(0)
  })

  it('게시 확인된 홍보가 확인된 0건이면 게시 확인을 제안한다', () => {
    const actions = nextActions([measured('published', 0)], 'ACTUAL')
    expect(actions.map(a => a.id)).toEqual(['publish-check'])
  })

  it('게시 확인 값을 모르면 제안하지 않는다', () => {
    expect(nextActions([measured('published', null)], 'ACTUAL')).toEqual([])
    expect(nextActions([measured('published', 0, { evidenceRef: null })], 'ACTUAL')).toEqual([])
  })

  it('stale·다른 데이터셋 지표로는 제안하지 않는다', () => {
    expect(nextActions([measured('published', 0, { state: 'stale' })], 'ACTUAL')).toEqual([])
    expect(nextActions([measured('published', 0, { datasetMode: 'DEMO' })], 'ACTUAL')).toEqual([])
  })

  it('예시·데모 화면에서는 제안하지 않는다', () => {
    expect(nextActions([measured('published', 0, { datasetMode: 'EXAMPLE' })], 'EXAMPLE')).toEqual([])
    expect(nextActions([measured('published', 0)], 'DEMO')).toEqual([])
  })

  it('예약이 0건이면 입금 독촉 제안을 만들지 않는다', () => {
    expect(nextActions([measured('bookings', 0), measured('deposits', 0)], 'ACTUAL')).toEqual([])
  })

  it('두 조건이 모두 맞으면 최대 2개까지만 만든다', () => {
    const actions = nextActions([
      measured('bookings', 3), measured('deposits', 0), measured('published', 0),
    ], 'ACTUAL')
    expect(actions.map(a => a.id)).toEqual(['deposit-followup', 'publish-check'])
  })
})
