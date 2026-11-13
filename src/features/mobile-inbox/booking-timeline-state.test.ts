import { describe, expect, it } from 'vitest'
import {
  BOOKING_TIMELINE_STALE_AFTER_MINUTES,
  bookingTimelineStateChip,
  isBookingTimelineStale,
} from './booking-timeline-state'

const NOW = Date.parse('2026-10-24T05:00:00.000Z')
const FRESH = '2026-10-24T04:58:00.000Z'

describe('bookingTimelineStateChip — 5상태 칩', () => {
  it('조회 실패는 확인 실패, 오프라인은 오프라인으로 구분한다', () => {
    expect(bookingTimelineStateChip({ loadKind: 'error' })).toEqual({ kind: 'error' })
    expect(bookingTimelineStateChip({ loadKind: 'offline' })).toEqual({ kind: 'offline' })
    expect(bookingTimelineStateChip({ loadKind: 'loading' })).toEqual({ kind: 'loading' })
  })

  it('빈 상태(404)와 권한 없음(403)에는 실패 칩을 붙이지 않는다', () => {
    // 서버가 확인해 준 사실이므로 '확인 실패'로 뭉개면 ERROR/EMPTY 구분이 깨진다.
    expect(bookingTimelineStateChip({ loadKind: 'missing' })).toBeNull()
    expect(bookingTimelineStateChip({ loadKind: 'unauthorized' })).toBeNull()
  })

  it('모두 확인된 타임라인에는 칩이 없다', () => {
    expect(
      bookingTimelineStateChip({
        loadKind: 'ready',
        observedAt: FRESH,
        identityVerified: true,
        outcomeUnresolved: false,
        now: NOW,
      }),
    ).toBeNull()
  })

  it('대화에서 고객 이름을 확인하지 못하면 일부만 확인으로 표시한다', () => {
    expect(
      bookingTimelineStateChip({
        loadKind: 'ready',
        observedAt: FRESH,
        identityVerified: false,
        now: NOW,
      }),
    ).toEqual({ kind: 'partial', label: '고객 정보 일부만 확인' })
  })

  it('서버가 전송 결과를 확정하지 못한 단계는 성공으로 읽히지 않게 표시한다', () => {
    expect(
      bookingTimelineStateChip({
        loadKind: 'ready',
        observedAt: FRESH,
        identityVerified: true,
        outcomeUnresolved: true,
        now: NOW,
      }),
    ).toEqual({ kind: 'partial', label: '전송 결과 미확인' })
  })

  it('오래된 관측은 stale 이고, 고객 정보 미확인보다 우선한다', () => {
    const old = '2026-10-24T04:00:00.000Z'
    expect(
      bookingTimelineStateChip({ loadKind: 'ready', observedAt: old, identityVerified: true, now: NOW }),
    ).toEqual({ kind: 'stale' })
    expect(
      bookingTimelineStateChip({ loadKind: 'ready', observedAt: old, identityVerified: false, now: NOW }),
    ).toEqual({ kind: 'stale' })
  })

  it('결과 미확정은 stale 보다 먼저 알린다', () => {
    expect(
      bookingTimelineStateChip({
        loadKind: 'ready',
        observedAt: '2026-10-24T04:00:00.000Z',
        identityVerified: true,
        outcomeUnresolved: true,
        now: NOW,
      }),
    ).toEqual({ kind: 'partial', label: '전송 결과 미확인' })
  })
})

describe('isBookingTimelineStale', () => {
  it('기준 시간을 넘으면 stale 이다', () => {
    expect(isBookingTimelineStale(FRESH, NOW)).toBe(false)
    expect(isBookingTimelineStale('2026-10-24T04:49:00.000Z', NOW)).toBe(true)
  })

  it('시각이 없거나 읽을 수 없으면 stale 로 단정하지 않는다', () => {
    expect(isBookingTimelineStale(null, NOW)).toBe(false)
    expect(isBookingTimelineStale('어제쯤', NOW)).toBe(false)
  })

  it('임계값을 바꿀 수 있다', () => {
    expect(isBookingTimelineStale('2026-10-24T04:40:00.000Z', NOW, 30)).toBe(false)
    expect(BOOKING_TIMELINE_STALE_AFTER_MINUTES).toBe(10)
  })
})
