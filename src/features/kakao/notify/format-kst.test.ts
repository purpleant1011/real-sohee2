import { describe, expect, it } from 'vitest'
import { formatKstDateTime } from './format-kst'

describe('formatKstDateTime', () => {
  it('자정(00:00 KST)을 오전 12:00 형식으로 변환한다', () => {
    expect(formatKstDateTime('2026-11-09T00:00:00+09:00')).toBe(
      '2026년 11월 9일(월) 오전 12:00',
    )
  })

  it('정오(12:00 KST)를 오후 12:00 형식으로 변환한다', () => {
    expect(formatKstDateTime('2026-11-09T12:00:00+09:00')).toBe(
      '2026년 11월 9일(월) 오후 12:00',
    )
  })

  it('15:16(+09:00)을 오후 3:16 형식으로 변환한다', () => {
    expect(formatKstDateTime('2026-11-09T15:16:37+09:00')).toBe(
      '2026년 11월 9일(월) 오후 3:16',
    )
  })

  it('한 자릿수 분은 항상 2자리(0-padded)로 표시한다', () => {
    expect(formatKstDateTime('2026-11-09T09:05:00+09:00')).toBe(
      '2026년 11월 9일(월) 오전 9:05',
    )
  })

  it('Z(UTC) 입력을 +9시간 시차 적용하여 KST로 정확히 변환한다', () => {
    // 06:16:37Z -> 15:16:37 KST
    expect(formatKstDateTime('2026-11-09T06:16:37Z')).toBe(
      '2026년 11월 9일(월) 오후 3:16',
    )
  })

  it('Z 변환 시 날짜가 다음 날로 넘어가는 경우 날짜와 요일을 정확히 반영한다', () => {
    // 2026-11-08 15:00:00Z -> 2026-11-09 00:00:00 KST
    expect(formatKstDateTime('2026-11-08T15:00:00Z')).toBe(
      '2026년 11월 9일(월) 오전 12:00',
    )
    // 2026-11-08 23:00:00Z -> 2026-11-09 08:00:00 KST
    expect(formatKstDateTime('2026-11-08T23:00:00Z')).toBe(
      '2026년 11월 9일(월) 오전 8:00',
    )
    // 연도 넘김: 2026-12-31 16:00:00Z -> 2027-01-01 01:00:00 KST
    expect(formatKstDateTime('2026-12-31T16:00:00Z')).toBe(
      '2027년 1월 1일(금) 오전 1:00',
    )
  })

  it('모든 요일(일~토)을 정확히 계산한다', () => {
    expect(formatKstDateTime('2026-11-08T10:00:00+09:00')).toContain('(일)')
    expect(formatKstDateTime('2026-11-09T10:00:00+09:00')).toContain('(월)')
    expect(formatKstDateTime('2026-11-10T10:00:00+09:00')).toContain('(화)')
    expect(formatKstDateTime('2026-11-11T10:00:00+09:00')).toContain('(수)')
    expect(formatKstDateTime('2026-11-12T10:00:00+09:00')).toContain('(목)')
    expect(formatKstDateTime('2026-11-13T10:00:00+09:00')).toContain('(금)')
    expect(formatKstDateTime('2026-11-14T10:00:00+09:00')).toContain('(토)')
  })

  it('잘못된 입력은 null을 반환한다', () => {
    expect(formatKstDateTime(null)).toBeNull()
    expect(formatKstDateTime(undefined)).toBeNull()
    expect(formatKstDateTime('')).toBeNull()
    expect(formatKstDateTime('   ')).toBeNull()
    expect(formatKstDateTime('not-a-date')).toBeNull()
    expect(formatKstDateTime('2026-11-09')).toBeNull() // 타임존 오프셋 누락
    expect(formatKstDateTime('2026-11-09 15:16:00')).toBeNull() // 타임존 오프셋 누락
    expect(formatKstDateTime('2026-02-30T10:00:00Z')).toBeNull() // 유효하지 않은 일자
    expect(formatKstDateTime('2026-13-01T10:00:00Z')).toBeNull() // 유효하지 않은 월
    expect(formatKstDateTime('2026-11-09T25:00:00Z')).toBeNull() // 유효하지 않은 시간
    expect(formatKstDateTime(123456789)).toBeNull()
  })
})
