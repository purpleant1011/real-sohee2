import { describe, expect, it } from 'vitest'
import {
  formatKoreanDateTime,
  formatKoreanDay,
  formatKoreanMonthDayTime,
  formatKoreanTime,
} from './format-display-date'

describe('deterministic display dates', () => {
  it('formats the same Korean labels without locale-specific AM or PM tokens', () => {
    const value = '2026-08-14T02:42:00.000Z'

    expect(formatKoreanDateTime(value)).toBe('2026.08.14 11:42')
    expect(formatKoreanDay(value)).toBe('8월 14일 (금)')
    expect(formatKoreanMonthDayTime(value)).toBe('8월 14일 11:42')
    expect(formatKoreanTime(value)).toBe('11:42')
  })
})
