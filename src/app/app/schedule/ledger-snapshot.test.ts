import { describe, expect, it } from 'vitest'
import { entryDisplay } from '@/features/mobile-inbox/ledger-model'
import {
  LEDGER_QUERY_LIMIT, buildLedgerSnapshot, collectSlotIds,
  type ReservationLedgerRow, type SlotInterval,
} from './ledger-snapshot'

const WS = '11111111-1111-4111-8111-111111111111'
const CHECKED = '2026-10-24T05:00:00.000Z'

function row(overrides: Partial<ReservationLedgerRow> = {}): ReservationLedgerRow {
  return {
    id: 'res_1',
    workspace_id: WS,
    customer_name: '김민지',
    service_name: '속눈썹 연장',
    status: 'CONFIRMED',
    confirmed_at: '2026-10-23T10:00:00.000Z',
    metadata: {
      source: 'booking_recovery',
      caseId: 'case_1',
      startsAt: '2026-10-24T05:00:00.000Z',
      endsAt: '2026-10-24T06:30:00.000Z',
    },
    ...overrides,
  }
}

const build = (
  rows: ReservationLedgerRow[] | null,
  error: { message?: string } | null = null,
  limit?: number,
  slotIntervals?: ReadonlyMap<string, SlotInterval> | null,
  datasetMode: string | null = 'ACTUAL',
) => buildLedgerSnapshot({ workspaceId: WS, timeZone: 'Asia/Seoul', rows, error, checkedAt: CHECKED, limit, slotIntervals, datasetMode })

describe('M15 장부 스냅샷 — 원장 값을 그대로 옮긴다', () => {
  it('고객 수락으로 만들어진 예약은 시작/종료 시각과 근거를 함께 옮긴다', () => {
    const [entry] = build([row()]).entries
    expect(entry).toMatchObject({
      id: 'res_1',
      workspaceId: WS,
      customerName: '김민지',
      serviceLabel: '속눈썹 연장',
      startsAt: '2026-10-24T05:00:00.000Z',
      endsAt: '2026-10-24T06:30:00.000Z',
      status: 'confirmed',
      source: 'customer_accepted',
      ledgerVerifiedAt: CHECKED,
      otherSurfaceStatus: null,
    })
    expect(entryDisplay(entry)).toBe('confirmed')
  })

  it('종료 시각이 없는 예약은 종료 시각을 만들지 않는다', () => {
    const [entry] = build([row({
      metadata: { dmThreadId: 'thread_1', bookingStartsAt: '2026-10-24T05:00:00.000Z' },
    })]).entries
    expect(entry.startsAt).toBe('2026-10-24T05:00:00.000Z')
    expect(entry.endsAt).toBe('')
  })

  it('맨 dmThreadId 만으로는 고객 수락 근거가 되지 않는다', () => {
    const [entry] = build([row({
      metadata: { dmThreadId: 'thread_1', bookingStartsAt: '2026-10-24T05:00:00.000Z' },
    })]).entries
    expect(entry.source).toBe('unverified')
    expect(entryDisplay(entry)).not.toBe('confirmed')
  })

  it('metadata.source 가 owner_created 면 사장님 확정으로 옮긴다', () => {
    const [entry] = build([row({ metadata: { source: 'owner_created' } })]).entries
    expect(entry.source).toBe('owner_confirmed')
    expect(entryDisplay(entry)).toBe('confirmed')
  })

  it('모르는 metadata.source 문자열은 근거로 인정하지 않는다', () => {
    const [entry] = build([row({ metadata: { source: 'someone_said_so' } })]).entries
    expect(entry.source).toBe('unverified')
    expect(entryDisplay(entry)).not.toBe('confirmed')
  })

  it('슬롯 표의 지금 시각이 있으면 metadata 의 생성 시각보다 우선한다', () => {
    const slotIntervals = new Map<string, SlotInterval>([
      ['slot_9', { startsAt: '2026-10-25T01:00:00.000Z', endsAt: '2026-10-25T02:30:00.000Z' }],
    ])
    const [entry] = build([row({ slot_id: 'slot_9' })], null, undefined, slotIntervals).entries
    expect(entry.startsAt).toBe('2026-10-25T01:00:00.000Z')
    expect(entry.endsAt).toBe('2026-10-25T02:30:00.000Z')
  })

  it('슬롯 시각이 없으면 metadata 로 폴백하고 시각을 만들지 않는다', () => {
    const slotIntervals = new Map<string, SlotInterval>([
      ['slot_9', { startsAt: null, endsAt: null }],
    ])
    const [entry] = build([row({ slot_id: 'slot_9' })], null, undefined, slotIntervals).entries
    expect(entry.startsAt).toBe('')
    expect(entry.endsAt).toBe('')
  })

  it('collectSlotIds 는 비어 있지 않은 슬롯 id 만 중복 없이 모은다', () => {
    expect(collectSlotIds([
      row({ id: 'res_1', slot_id: 'slot_a' }),
      row({ id: 'res_2', slot_id: 'slot_a' }),
      row({ id: 'res_3', slot_id: 'slot_b' }),
      row({ id: 'res_4', slot_id: null }),
      row({ id: 'res_5' }),
    ])).toEqual(['slot_a', 'slot_b'])
  })

  it('시각 근거가 아예 없으면 빈 문자열로 남겨 화면이 시각 미확인으로 그리게 한다', () => {
    const [entry] = build([row({ metadata: null })]).entries
    expect(entry.startsAt).toBe('')
    expect(entry.endsAt).toBe('')
    expect(entry.source).toBe('unverified')
  })

  it('확정 상태라도 confirmed_at 근거가 없으면 확정으로 그리지 않는다', () => {
    const [entry] = build([row({ confirmed_at: null })]).entries
    expect(entry.status).toBe('confirmed')
    expect(entry.ledgerVerifiedAt).toBeNull()
    expect(entryDisplay(entry)).toBe('unverified')
  })

  it.each([
    ['PROPOSED', 'pending_confirmation'],
    ['AWAITING_CONFIRMATION', 'pending_confirmation'],
    ['CONFIRMED', 'confirmed'],
    ['COMPLETED', 'completed'],
    ['CANCELLED', 'cancelled'],
    ['SOMETHING_NEW', 'pending_confirmation'],
  ])('원장 상태 %s 는 %s 로 옮긴다', (status, expected) => {
    const [entry] = build([row({ status })]).entries
    expect(entry.status).toBe(expected)
  })

  it('다른 테넌트 행이 한 행이라도 섞이면 그 조회를 믿지 않고 error 로 닫는다', () => {
    const snapshot = build([
      row(),
      row({ id: 'res_other', workspace_id: '22222222-2222-4222-8222-222222222222' }),
    ])
    expect(snapshot.loadState).toBe('error')
    expect(snapshot.entries).toEqual([])
    expect(snapshot.complete).toBe(false)
    expect(snapshot.checkedAt).toBeNull()
  })

  it('다른 테넌트 행만 있어도 정상과 같은 가게 행을 골라 그리지 않는다', () => {
    const snapshot = build([
      row({ id: 'res_other', workspace_id: '22222222-2222-4222-8222-222222222222' }),
    ])
    expect(snapshot.loadState).toBe('error')
    expect(snapshot.entries).toEqual([])
  })

  it('같은 가게 행만 있으면 상한 처리까지 그대로 통과시킨다', () => {
    const rows = Array.from({ length: 3 }, (_, index) => row({ id: `res_${index}` }))
    const snapshot = build(rows, null, 2)
    expect(snapshot.loadState).toBe('ready')
    expect(snapshot.entries.map(entry => entry.id)).toEqual(['res_0', 'res_1', 'res_2'])
    expect(snapshot.complete).toBe(false)
  })

  it.each([
    { mode: null, label: 'null' },
    { mode: 'UNKNOWN', label: 'UNKNOWN' },
    { mode: 'CANARY', label: 'CANARY' },
    { mode: 'SHOWCASE_DEMO', label: 'SHOWCASE_DEMO' },
    { mode: 'TEST', label: 'TEST' },
    { mode: 'SOMETHING_ELSE', label: '미상' },
  ])('datasetMode 가 $label 이면 error 로 fail-closed 한다 (ACTUAL 만 허용)', ({ mode }) => {
    const res = build([row()], null, undefined, null, mode)
    expect(res.loadState).toBe('error')
    expect(res.entries).toEqual([])
    expect(res.complete).toBe(false)
    expect(res.checkedAt).toBeNull()
  })

  it('datasetMode 가 missing(생략)이면 error 로 fail-closed 한다', () => {
    const res = buildLedgerSnapshot({
      workspaceId: WS,
      timeZone: 'Asia/Seoul',
      rows: [row()],
      error: null,
      checkedAt: CHECKED,
    })
    expect(res.loadState).toBe('error')
    expect(res.entries).toEqual([])
    expect(res.complete).toBe(false)
    expect(res.checkedAt).toBeNull()
  })

  it('datasetMode 가 ACTUAL 이면 정상적으로 ready 스냅샷을 생성한다', () => {
    const actual = build([row()], null, undefined, null, 'ACTUAL')
    expect(actual.loadState).toBe('ready')
    expect(actual.entries).toHaveLength(1)
  })

  it('읽은 시각을 화면 기준 시각과 확인 시각으로 함께 넘긴다', () => {
    const snapshot = build([row()])
    expect(snapshot.now).toBe(CHECKED)
    expect(snapshot.checkedAt).toBe(CHECKED)
    expect(snapshot.loadState).toBe('ready')
  })
})

describe('M15 장부 스냅샷 — 조회 실패·잘림을 숨기지 않는다', () => {
  it('조회 오류는 빈 목록이 아니라 error 로 내려보낸다', () => {
    const snapshot = build([], { message: 'connection reset' })
    expect(snapshot.loadState).toBe('error')
    expect(snapshot.entries).toEqual([])
    expect(snapshot.checkedAt).toBeNull()
  })

  it('행 자체가 없으면(error 와 구분) error 로 내려보낸다', () => {
    expect(build(null).loadState).toBe('error')
  })

  it('상한만큼 읽혔으면 complete=false — 더 있을 수 있는 목록이다', () => {
    const rows = Array.from({ length: 3 }, (_, index) => row({ id: `res_${index}` }))
    expect(build(rows, null, 3).complete).toBe(false)
    expect(build(rows, null, 4).complete).toBe(true)
    expect(build(rows).complete).toBe(true)
    expect(LEDGER_QUERY_LIMIT).toBeGreaterThan(0)
  })

  it('취소된 예약도 지운 것처럼 감추지 않고 취소로 내려보낸다', () => {
    const [entry] = build([row({ status: 'CANCELLED' })]).entries
    expect(entry.status).toBe('cancelled')
    expect(entryDisplay(entry)).toBe('cancelled')
  })
})
