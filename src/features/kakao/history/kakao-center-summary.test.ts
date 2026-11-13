import { describe, it, expect } from 'vitest'
import type { KakaoHistoryItem } from './contract'
import {
  computeKakaoSummaryCounts,
  filterKakaoHistoryItems,
} from './kakao-center-summary'

describe('computeKakaoSummaryCounts', () => {
  const fixtureItems: KakaoHistoryItem[] = [
    {
      id: '1',
      reservationId: 'r1',
      event: 'BOOKING_CONFIRMED',
      eventLabel: '예약 확정 안내',
      status: 'DELIVERED',
      statusLabel: '도착 확인',
      detailLabel: null,
      dueAt: '2026-11-09T01:00:00Z',
      updatedAt: '2026-11-09T01:05:00Z',
    },
    {
      id: '2',
      reservationId: 'r2',
      event: 'REMINDER_24H',
      eventLabel: '방문 하루 전 안내',
      status: 'SENT',
      statusLabel: '보냈어요',
      detailLabel: '도착 여부를 확인하고 있어요.',
      dueAt: '2026-11-09T02:00:00Z',
      updatedAt: '2026-11-09T02:01:00Z',
    },
    {
      id: '3',
      reservationId: 'r3',
      event: 'BOOKING_CHANGED',
      eventLabel: '예약 변경 안내',
      status: 'NEEDS_CHECK',
      statusLabel: '확인이 필요해요',
      detailLabel: '발송 결과를 확인하지 못했어요.',
      dueAt: '2026-11-09T03:00:00Z',
      updatedAt: '2026-11-09T03:01:00Z',
    },
    {
      id: '4',
      reservationId: 'r4',
      event: 'BOOKING_CONFIRMED',
      eventLabel: '예약 확정 안내',
      status: 'FAILED',
      statusLabel: '전달 실패',
      detailLabel: '발송에 실패했어요.',
      dueAt: '2026-11-09T04:00:00Z',
      updatedAt: '2026-11-09T04:01:00Z',
    },
    {
      id: '5',
      reservationId: 'r5',
      event: 'REMINDER_2H',
      eventLabel: '방문 2시간 전 안내',
      status: 'HELD',
      statusLabel: '보내지 않았어요',
      detailLabel: '조건이 맞지 않아 보내지 않았어요.',
      dueAt: '2026-11-09T05:00:00Z',
      updatedAt: '2026-11-09T05:01:00Z',
    },
    {
      id: '6',
      reservationId: 'r6',
      event: 'BOOKING_CANCELLED',
      eventLabel: '예약 취소 안내',
      status: 'CANCELLED',
      statusLabel: '취소됐어요',
      detailLabel: '예약 일정이 바뀌어 이 안내는 취소됐어요.',
      dueAt: '2026-11-09T06:00:00Z',
      updatedAt: '2026-11-09T06:01:00Z',
    },
  ]

  it('상태별 건수를 정확히 집계한다', () => {
    const counts = computeKakaoSummaryCounts(fixtureItems)
    expect(counts.delivered).toBe(1)
    expect(counts.sent).toBe(1)
    expect(counts.needsCheck).toBe(2) // NEEDS_CHECK + FAILED
    expect(counts.held).toBe(1)
    expect(counts.cancelled).toBe(1)
    expect(counts.total).toBe(6)
  })

  it('빈 목록은 모든 건수를 0으로 집계한다', () => {
    const counts = computeKakaoSummaryCounts([])
    expect(counts.delivered).toBe(0)
    expect(counts.sent).toBe(0)
    expect(counts.needsCheck).toBe(0)
    expect(counts.held).toBe(0)
    expect(counts.cancelled).toBe(0)
    expect(counts.total).toBe(0)
  })
})

describe('filterKakaoHistoryItems', () => {
  const items: KakaoHistoryItem[] = [
    { id: '1', reservationId: 'r1', event: 'BOOKING_CONFIRMED', eventLabel: '확정', status: 'DELIVERED', statusLabel: '', detailLabel: null, dueAt: '', updatedAt: '' },
    { id: '2', reservationId: 'r2', event: 'BOOKING_CONFIRMED', eventLabel: '확정', status: 'SENT', statusLabel: '', detailLabel: null, dueAt: '', updatedAt: '' },
    { id: '3', reservationId: 'r3', event: 'BOOKING_CONFIRMED', eventLabel: '확정', status: 'NEEDS_CHECK', statusLabel: '', detailLabel: null, dueAt: '', updatedAt: '' },
    { id: '4', reservationId: 'r4', event: 'BOOKING_CONFIRMED', eventLabel: '확정', status: 'FAILED', statusLabel: '', detailLabel: null, dueAt: '', updatedAt: '' },
    { id: '5', reservationId: 'r5', event: 'BOOKING_CONFIRMED', eventLabel: '확정', status: 'HELD', statusLabel: '', detailLabel: null, dueAt: '', updatedAt: '' },
    { id: '6', reservationId: 'r6', event: 'BOOKING_CONFIRMED', eventLabel: '확정', status: 'CANCELLED', statusLabel: '', detailLabel: null, dueAt: '', updatedAt: '' },
  ]

  it('전체(all) 탭은 모든 항목을 반환한다', () => {
    expect(filterKakaoHistoryItems(items, 'all')).toHaveLength(6)
  })

  it('보낸 것(sent) 탭은 DELIVERED와 SENT를 반환한다', () => {
    const result = filterKakaoHistoryItems(items, 'sent')
    expect(result.map(i => i.id)).toEqual(['1', '2'])
  })

  it('확인 필요(needs_check) 탭은 NEEDS_CHECK와 FAILED를 반환한다', () => {
    const result = filterKakaoHistoryItems(items, 'needs_check')
    expect(result.map(i => i.id)).toEqual(['3', '4'])
  })

  it('보내지 않은 것(held) 탭은 HELD와 CANCELLED를 반환한다', () => {
    const result = filterKakaoHistoryItems(items, 'held')
    expect(result.map(i => i.id)).toEqual(['5', '6'])
  })
})
