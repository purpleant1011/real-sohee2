import { describe, expect, it } from 'vitest'
import { buildDepositsSnapshot, type ReservationDepositRow } from './deposits-snapshot'

const WS = '11111111-1111-4111-8111-111111111111'
const CHECKED_AT = '2026-10-24T00:00:00.000Z'

const row = (o: Partial<ReservationDepositRow> = {}): ReservationDepositRow => ({
  id: 'res_1',
  workspace_id: WS,
  deposit_krw: 30000,
  status: 'CONFIRMED',
  ...o,
})

const build = (
  rows: readonly ReservationDepositRow[] | null,
  error: { message?: string } | null = null,
  datasetMode: string | null = 'ACTUAL',
) => buildDepositsSnapshot({ workspaceId: WS, rows, error, checkedAt: CHECKED_AT, datasetMode })

describe('M16 예약금 스냅샷', () => {
  it('조회 실패는 빈 목록이 아니라 error 로 남긴다', () => {
    expect(build(null, { message: 'boom' })).toEqual({ loadState: 'error', deposits: [], checkedAt: null })
    expect(build(null).loadState).toBe('error')
  })

  it.each([
    { mode: null, label: 'null' },
    { mode: 'UNKNOWN', label: 'UNKNOWN' },
    { mode: 'CANARY', label: 'CANARY' },
    { mode: 'SHOWCASE_DEMO', label: 'SHOWCASE_DEMO' },
    { mode: 'TEST', label: 'TEST' },
    { mode: 'SOMETHING_ELSE', label: '미상' },
  ])('datasetMode 가 $label 이면 error 로 fail-closed 한다 (ACTUAL 만 허용)', ({ mode }) => {
    const res = build([row()], null, mode)
    expect(res.loadState).toBe('error')
    expect(res.deposits).toEqual([])
    expect(res.checkedAt).toBeNull()
  })

  it('datasetMode 가 missing(생략)이면 error 로 fail-closed 한다', () => {
    const res = buildDepositsSnapshot({
      workspaceId: WS,
      rows: [row()],
      error: null,
      checkedAt: CHECKED_AT,
    })
    expect(res.loadState).toBe('error')
    expect(res.deposits).toEqual([])
    expect(res.checkedAt).toBeNull()
  })

  it('datasetMode 가 ACTUAL 이면 정상적으로 ready 스냅샷을 생성한다', () => {
    const actual = build([row()], null, 'ACTUAL')
    expect(actual.loadState).toBe('ready')
    expect(actual.deposits).toHaveLength(1)
  })

  it('확인해 본 빈 목록은 ready + 0건으로 남긴다(실패와 구분)', () => {
    expect(build([])).toEqual({ loadState: 'ready', deposits: [], checkedAt: CHECKED_AT })
  })

  it('예약 장부의 예약금 금액만 결제 예정으로 옮긴다', () => {
    const snapshot = build([row()])
    expect(snapshot.deposits).toHaveLength(1)
    expect(snapshot.deposits[0]).toMatchObject({
      workspaceId: WS,
      bookingId: 'res_1',
      availability: 'supported',
      amount: 30000,
      currency: 'KRW',
      transport: 'not_started',
      providerAccepted: null,
      receiptRef: null,
      refund: null,
    })
  })

  it('결제사가 연결되지 않았으므로 provider none · readback unavailable 로 남긴다', () => {
    const [record] = build([row()]).deposits
    expect(record.provider).toBe('none')
    // 서버 영수증 재조회 경로가 없다. pending(확인 중)으로 위장하지 않는다.
    expect(record.readback).toBe('unavailable')
    // 동의 기록을 읽을 원장이 없으므로 동의한 것으로 그리지 않는다.
    expect(record.termsAcceptedAt).toBeNull()
    expect(record.idempotencyKey).toBeNull()
  })

  it('다른 가게 행이 섞이면 부분 목록을 그리지 않고 error 로 닫는다', () => {
    const snapshot = build([row(), row({ id: 'res_2', workspace_id: 'other-workspace' })])
    expect(snapshot).toEqual({ loadState: 'error', deposits: [], checkedAt: null })
  })

  it('모든 행이 다른 가게 것이면 확인된 0건이 아니라 error 다', () => {
    const snapshot = build([row({ id: 'res_2', workspace_id: 'other-workspace' })])
    expect(snapshot.loadState).toBe('error')
    expect(snapshot.deposits).toEqual([])
    expect(snapshot.checkedAt).toBeNull()
  })

  it('읽은 예약금 레코드는 모두 이 가게 행이다(경계 라벨 유지)', () => {
    const deposits = build([row(), row({ id: 'res_2' })]).deposits
    expect(deposits).toHaveLength(2)
    expect(deposits.every(record => record.workspaceId === WS)).toBe(true)
    expect(deposits.map(record => record.bookingId)).toEqual(['res_1', 'res_2'])
  })

  it('금액을 확인할 수 없는 행은 예약금 지원으로 그리지 않는다', () => {
    const [record] = build([row({ deposit_krw: null })]).deposits
    expect(record.availability).toBe('not_supported')
    expect(record.amount).toBeNull()
  })
})
