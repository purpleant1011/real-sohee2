import { describe, expect, it } from 'vitest'
import {
  recommendBookingSlots,
  extractTargetDateFromMessage,
  formatHourToKorean,
} from '../dm-slot-recommender'

describe('dm-slot-recommender', () => {
  it('detects booking intent and recommends open available slots', () => {
    const fixedBaseDate = new Date('2026-10-15T09:00:00Z') // Thursday

    const result = recommendBookingSlots({
      messageText: '내일 오후에 방문 상담 예약 가능한가요?',
      existingBookingTimes: ['2026-10-16 14:00'], // 14:00 is booked
      baseDate: fixedBaseDate,
    })

    expect(result.hasBookingIntent).toBe(true)
    expect(result.dayLabel).toBe('내일')
    expect(result.targetDateStr).toBe('2026-10-16')

    // 14:00 should be excluded, other default hours [10, 12, 16, 18] should be available
    const availableHours = result.availableSlots.map((s) => s.timeStr)
    expect(availableHours).toContain('10:00')
    expect(availableHours).toContain('12:00')
    expect(availableHours).toContain('16:00')
    expect(availableHours).not.toContain('14:00')

    expect(result.suggestedReplyText).toContain('내일')
    expect(result.suggestedReplyText).toContain('오전 10시')
  })

  it('detects specific day of week like 토요일 and formats Korean hours accurately', () => {
    const fixedBaseDate = new Date('2026-10-15T09:00:00Z') // Thursday (day 4)
    // Upcoming Saturday is 2026-10-17

    const result = recommendBookingSlots({
      messageText: '이번 주 토요일 비어있는 시간 언제 되나요?',
      existingBookingTimes: [],
      baseDate: fixedBaseDate,
    })

    expect(result.hasBookingIntent).toBe(true)
    expect(result.dayLabel).toBe('토요일')
    expect(result.targetDateStr).toBe('2026-10-17')
    expect(result.availableSlots.length).toBe(5)
  })

  it('formats hours properly into Korean AM/PM strings', () => {
    expect(formatHourToKorean(10)).toBe('오전 10시')
    expect(formatHourToKorean(12)).toBe('오후 12시')
    expect(formatHourToKorean(14)).toBe('오후 2시')
    expect(formatHourToKorean(18)).toBe('오후 6시')
  })
})
