import { describe, expect, it } from 'vitest'
import { normalizeBookingStartsAtKst } from './normalize-booking-time'

describe('normalizeBookingStartsAtKst', () => {
  it('시간대 없는 YYYY-MM-DD HH:mm 입력을 KST(+09:00) ISO로 정규화한다', () => {
    expect(normalizeBookingStartsAtKst('2026-10-20 14:00')).toBe(
      '2026-10-20T14:00:00+09:00'
    )
  })

  it('시간대 없는 YYYY-MM-DDTHH:mm 입력을 KST(+09:00) ISO로 정규화한다', () => {
    expect(normalizeBookingStartsAtKst('2026-10-20T14:00')).toBe(
      '2026-10-20T14:00:00+09:00'
    )
  })

  it('시간대 없는 YYYY-MM-DD HH:mm:ss 입력을 KST(+09:00) ISO로 정규화한다', () => {
    expect(normalizeBookingStartsAtKst('2026-10-20 14:00:30')).toBe(
      '2026-10-20T14:00:30+09:00'
    )
  })

  it('시간대 없는 YYYY-MM-DDTHH:mm:ss 입력을 KST(+09:00) ISO로 정규화한다', () => {
    expect(normalizeBookingStartsAtKst('2026-10-20T14:00:30')).toBe(
      '2026-10-20T14:00:30+09:00'
    )
  })

  it('Z 표기나 타임존 오프셋이 이미 있으면 그대로 유지한다', () => {
    expect(normalizeBookingStartsAtKst('2026-10-20T14:00:00+09:00')).toBe(
      '2026-10-20T14:00:00+09:00'
    )
    expect(normalizeBookingStartsAtKst('2026-10-20T05:00:00Z')).toBe(
      '2026-10-20T05:00:00Z'
    )
    expect(normalizeBookingStartsAtKst('2026-10-20T14:00:00.000Z')).toBe(
      '2026-10-20T14:00:00.000Z'
    )
    expect(normalizeBookingStartsAtKst('2026-10-20T05:00:00+00:00')).toBe(
      '2026-10-20T05:00:00+00:00'
    )
  })

  it('윤년을 정확히 검증한다 (2024년은 윤년, 2026년은 평년)', () => {
    expect(normalizeBookingStartsAtKst('2024-02-29 14:00')).toBe(
      '2024-02-29T14:00:00+09:00'
    )
    expect(normalizeBookingStartsAtKst('2026-02-29 14:00')).toBeNull()
  })

  it('유효하지 않은 날짜는 null을 반환한다 (2026-02-31, 2026-04-31, 2026-13-01 등)', () => {
    expect(normalizeBookingStartsAtKst('2026-02-31 14:00')).toBeNull()
    expect(normalizeBookingStartsAtKst('2026-04-31 14:00')).toBeNull()
    expect(normalizeBookingStartsAtKst('2026-13-01 14:00')).toBeNull()
    expect(normalizeBookingStartsAtKst('2026-00-10 14:00')).toBeNull()
    expect(normalizeBookingStartsAtKst('2026-10-00 14:00')).toBeNull()
    expect(normalizeBookingStartsAtKst('2026-10-32 14:00')).toBeNull()
  })

  it('유효하지 않은 시간은 null을 반환한다', () => {
    expect(normalizeBookingStartsAtKst('2026-10-20 24:00')).toBeNull()
    expect(normalizeBookingStartsAtKst('2026-10-20 14:60')).toBeNull()
    expect(normalizeBookingStartsAtKst('2026-10-20 14:00:60')).toBeNull()
  })

  it('오프셋이 있더라도 날짜가 유효하지 않으면 null을 반환한다', () => {
    expect(normalizeBookingStartsAtKst('2026-02-31T14:00:00+09:00')).toBeNull()
    expect(normalizeBookingStartsAtKst('2026-02-31T05:00:00Z')).toBeNull()
  })

  it('문자열이 아니거나 빈 문자열, 잘못된 형식이면 null을 반환한다', () => {
    expect(normalizeBookingStartsAtKst('')).toBeNull()
    expect(normalizeBookingStartsAtKst('   ')).toBeNull()
    expect(normalizeBookingStartsAtKst('invalid-date')).toBeNull()
    expect(normalizeBookingStartsAtKst(null)).toBeNull()
    expect(normalizeBookingStartsAtKst(undefined)).toBeNull()
    expect(normalizeBookingStartsAtKst(123456789)).toBeNull()
  })
})
