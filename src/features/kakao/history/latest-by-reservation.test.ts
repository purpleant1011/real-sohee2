import { describe, expect, it } from 'vitest'
import type { KakaoHistoryItem } from './contract'
import { getLatestKakaoByReservation } from './latest-by-reservation'

function makeItem(overrides: Partial<KakaoHistoryItem> = {}): KakaoHistoryItem {
  return {
    id: 'outbox-1',
    reservationId: 'res-1',
    event: 'BOOKING_CONFIRMED',
    eventLabel: '예약 확정 안내',
    status: 'DELIVERED',
    statusLabel: '도착 확인',
    detailLabel: null,
    dueAt: '2026-08-23T06:00:00.000Z',
    updatedAt: '2026-08-23T06:05:00.000Z',
    ...overrides,
  }
}

describe('getLatestKakaoByReservation', () => {
  it('빈 목록이면 빈 Map을 반환한다', () => {
    const result = getLatestKakaoByReservation([])
    expect(result.size).toBe(0)
  })

  it('reservationId가 없는 항목은 제외한다', () => {
    const itemWithoutRes = makeItem({ reservationId: '' })
    const result = getLatestKakaoByReservation([itemWithoutRes])
    expect(result.size).toBe(0)
  })

  it('단일 항목을 reservationId로 올바르게 매핑한다', () => {
    const item = makeItem({ reservationId: 'res-100', status: 'SENT' })
    const result = getLatestKakaoByReservation([item])
    expect(result.get('res-100')).toBe(item)
  })

  it('동일 reservationId에 여러 항목이 있을 때 더 최신(updatedAt) 항목을 선택한다', () => {
    const older = makeItem({
      id: 'outbox-old',
      reservationId: 'res-1',
      status: 'SCHEDULED',
      updatedAt: '2026-08-23T05:00:00.000Z',
    })
    const newer = makeItem({
      id: 'outbox-new',
      reservationId: 'res-1',
      status: 'DELIVERED',
      updatedAt: '2026-08-23T06:00:00.000Z',
    })

    const result = getLatestKakaoByReservation([older, newer])
    expect(result.get('res-1')).toBe(newer)

    // 순서가 반대여도 최신 항목이 선택되어야 함
    const resultReverse = getLatestKakaoByReservation([newer, older])
    expect(resultReverse.get('res-1')).toBe(newer)
  })

  it('updatedAt이 비어있으면 dueAt을 기준으로 최신 항목을 선택한다', () => {
    const older = makeItem({
      id: 'outbox-old',
      reservationId: 'res-1',
      status: 'SCHEDULED',
      updatedAt: '',
      dueAt: '2026-08-23T05:00:00.000Z',
    })
    const newer = makeItem({
      id: 'outbox-new',
      reservationId: 'res-1',
      status: 'DELIVERED',
      updatedAt: '',
      dueAt: '2026-08-23T07:00:00.000Z',
    })

    const result = getLatestKakaoByReservation([older, newer])
    expect(result.get('res-1')).toBe(newer)
  })

  it('서로 다른 reservationId는 각각 독립적으로 매핑된다', () => {
    const itemA = makeItem({ id: 'out-a', reservationId: 'res-a' })
    const itemB = makeItem({ id: 'out-b', reservationId: 'res-b' })

    const result = getLatestKakaoByReservation([itemA, itemB])
    expect(result.size).toBe(2)
    expect(result.get('res-a')).toBe(itemA)
    expect(result.get('res-b')).toBe(itemB)
  })
})
