import { describe, expect, it } from 'vitest'
import {
  DEFAULT_RESULTS_PERIOD,
  MAX_REPORTING_RANGE_DAYS,
  RESULTS_PERIOD_OPTIONS,
  RESULTS_RANGE_ERROR,
  isResultsPeriod,
  isResultsRange,
  parseResultsRange,
  resultsPeriodBaseDate,
  resultsPeriodSearch,
  resultsRangeIssue,
  resultsRangePeriod,
  resultsRangeProblem,
  resultsRangeSearch,
} from './results-period'

// ANI-1706 기간 선택: 새 API·쓰기 경로 없이 기존 주간 읽기 API 의 기준 시각만 옮긴다.
const DAY_MS = 24 * 60 * 60 * 1000

describe('M20 성과 기간 선택', () => {
  it('고를 수 있는 기간은 이번 주·지난주 두 가지다', () => {
    expect(RESULTS_PERIOD_OPTIONS.map(option => option.value)).toEqual(['current', 'previous'])
    expect(RESULTS_PERIOD_OPTIONS.map(option => option.label)).toEqual(['이번 주', '지난주'])
    expect(DEFAULT_RESULTS_PERIOD).toBe('current')
  })

  it('아는 값만 기간으로 인정한다', () => {
    expect(isResultsPeriod('current')).toBe(true)
    expect(isResultsPeriod('previous')).toBe(true)
    expect(isResultsPeriod(null)).toBe(false)
    expect(isResultsPeriod(undefined)).toBe(false)
    expect(isResultsPeriod('last-month')).toBe(false)
    expect(isResultsPeriod('')).toBe(false)
  })

  it('이번 주는 주소를 더럽히지 않고 지난주만 쿼리로 남긴다', () => {
    expect(resultsPeriodSearch('current')).toBe('')
    expect(resultsPeriodSearch('previous')).toBe('?period=previous')
  })

  it('이번 주 기준 시각은 주간 리포트의 기본값(다음 UTC 자정)과 같다', () => {
    const now = new Date('2026-10-24T13:05:00.000Z')
    const base = resultsPeriodBaseDate('current', now)
    expect(base.toISOString()).toBe('2026-10-25T00:00:00.000Z')
  })

  it('지난주는 이번 주 종료 시각에서 정확히 7일 전이다', () => {
    const now = new Date('2026-10-24T13:05:00.000Z')
    const current = resultsPeriodBaseDate('current', now).getTime()
    const previous = resultsPeriodBaseDate('previous', now).getTime()
    expect(current - previous).toBe(7 * DAY_MS)
    expect(new Date(previous).toISOString()).toBe('2026-10-18T00:00:00.000Z')
  })

  it('월 경계를 넘어도 7일 간격이 유지된다', () => {
    const now = new Date('2026-11-02T23:59:00.000Z')
    const current = resultsPeriodBaseDate('current', now)
    const previous = resultsPeriodBaseDate('previous', now)
    expect(current.toISOString()).toBe('2026-11-03T00:00:00.000Z')
    expect(previous.toISOString()).toBe('2026-10-27T00:00:00.000Z')
  })
})

// ANI-1782 직접 선택 구간(서버 측): 달력일 검증, 쿼리 조합, 반개구간 변환, 길이·미래 규칙.
describe('M20 직접 선택 구간', () => {
  const NOW = new Date('2026-10-24T13:05:00.000Z') // 이번 주 종료 = 2026-10-25T00:00Z
  const range = (start: string, end: string) => ({ start, end })

  it('존재하는 달력일만 구간으로 인정한다', () => {
    expect(isResultsRange(range('2026-10-01', '2026-10-31'))).toBe(true)
    expect(isResultsRange(range('2028-02-29', '2028-03-01'))).toBe(true)
    // Date 는 2026-02-30 을 3월 2일로 넘기므로 round-trip 으로 막아야 한다.
    expect(isResultsRange(range('2026-02-30', '2026-03-01'))).toBe(false)
    expect(isResultsRange(range('2026-02-29', '2026-03-01'))).toBe(false)
    expect(isResultsRange(range('2026-13-01', '2026-13-02'))).toBe(false)
    expect(isResultsRange(range('2026-10-00', '2026-10-03'))).toBe(false)
  })

  it('형식이 어긋나거나 구간 모양이 아니면 거절한다', () => {
    expect(isResultsRange(range('2026-1-01', '2026-10-03'))).toBe(false)
    expect(isResultsRange(range('2026-10-01T00:00:00.000Z', '2026-10-03'))).toBe(false)
    expect(isResultsRange(range('2026-10-01\n', '2026-10-03'))).toBe(false)
    expect(isResultsRange({ start: '2026-10-01' })).toBe(false)
    expect(isResultsRange('2026-10-01')).toBe(false)
    expect(isResultsRange(null)).toBe(false)
  })

  it('시작과 끝이 각각 한 번씩 있을 때만 주소에서 구간을 읽는다', () => {
    expect(parseResultsRange(new URLSearchParams('start=2026-10-01&end=2026-10-03')))
      .toEqual(range('2026-10-01', '2026-10-03'))
    expect(parseResultsRange(new URLSearchParams('start=2026-10-01'))).toBeNull()
    expect(parseResultsRange(new URLSearchParams('end=2026-10-03'))).toBeNull()
    expect(parseResultsRange(new URLSearchParams('start=2026-10-01&end=2026-02-30'))).toBeNull()
    expect(parseResultsRange(new URLSearchParams('start=&end='))).toBeNull()
    expect(parseResultsRange(new URLSearchParams('start=2026-10-01&start=2026-10-02&end=2026-10-03'))).toBeNull()
    expect(parseResultsRange(new URLSearchParams('period=previous'))).toBeNull()
  })

  it('구간 쿼리는 값이 없으면 비고, 있으면 start·end 만 남는다', () => {
    expect(resultsRangeSearch(null)).toBe('')
    expect(resultsRangeSearch(range('2026-10-01', '2026-10-03'))).toBe('?start=2026-10-01&end=2026-10-03')
  })

  it('구간이 있으면 period 는 쿼리에 붙지 않는다', () => {
    expect(resultsPeriodSearch('previous', range('2026-10-01', '2026-10-03'))).toBe('?start=2026-10-01&end=2026-10-03')
    expect(resultsPeriodSearch('current', range('2026-10-01', '2026-10-03'))).toBe('?start=2026-10-01&end=2026-10-03')
  })

  it('구간이 없으면 기존 프리셋 쿼리와 100% 같다', () => {
    expect(resultsPeriodSearch('current')).toBe('')
    expect(resultsPeriodSearch('previous')).toBe('?period=previous')
    expect(resultsPeriodSearch('current', null)).toBe('')
    expect(resultsPeriodSearch('previous', null)).toBe('?period=previous')
  })

  it('구간은 종료일 다음 날 0시를 배타 끝으로 하는 반개구간이다', () => {
    expect(resultsRangePeriod(range('2026-10-01', '2026-10-03'))).toEqual({
      start: '2026-10-01T00:00:00.000Z',
      end: '2026-10-04T00:00:00.000Z',
    })
    expect(resultsRangePeriod(range('2026-10-31', '2026-10-31')).end).toBe('2026-11-01T00:00:00.000Z')
  })

  it('1일 구간과 92일 경계는 허용하고 93일은 거절한다', () => {
    expect(MAX_REPORTING_RANGE_DAYS).toBe(92)
    expect(resultsRangeProblem(range('2026-10-24', '2026-10-24'), NOW)).toBeNull()
    expect(resultsRangeProblem(range('2026-07-01', '2026-09-30'), NOW)).toBeNull()
    expect(resultsRangeProblem(range('2026-07-01', '2026-10-01'), NOW)).toBe(RESULTS_RANGE_ERROR)
  })

  it('역순과 이번 주 종료 뒤로 넘어가는 구간은 거절하고, 오늘까지는 허용한다', () => {
    expect(resultsRangeProblem(range('2026-10-03', '2026-10-01'), NOW)).toBe(RESULTS_RANGE_ERROR)
    expect(resultsRangeProblem(range('2026-10-24', '2026-10-25'), NOW)).toBe(RESULTS_RANGE_ERROR)
    expect(resultsRangeProblem(range('2026-10-01', '2026-10-24'), NOW)).toBeNull()
  })

  it('존재하지 않는 날짜가 섞인 구간은 거절한다', () => {
    expect(resultsRangeProblem(range('2026-02-30', '2026-03-01'), NOW)).toBe(RESULTS_RANGE_ERROR)
  })

  // 화면은 400 문구 하나가 아니라 사유별 안내를 그린다. 서버 판정과 같은 규칙에서 나온 코드여야 한다.
  it('거절 사유를 코드로 구분한다(화면 안내 문구용)', () => {
    expect(resultsRangeIssue(range('2026-10-01', '2026-10-24'), NOW)).toBeNull()
    expect(resultsRangeIssue(range('2026-02-30', '2026-03-01'), NOW)).toBe('INVALID')
    expect(resultsRangeIssue(range('2026-10-03', '2026-10-01'), NOW)).toBe('REVERSED')
    expect(resultsRangeIssue(range('2026-07-01', '2026-10-01'), NOW)).toBe('TOO_LONG')
    expect(resultsRangeIssue(range('2026-10-24', '2026-10-25'), NOW)).toBe('FUTURE')
  })

  it('연도 0~99 구간도 달력일 수를 바르게 센다(Date.UTC 의 1900년대 해석 회피)', () => {
    // 0000년은 윤년이라 1월 1일~4월 2일이 93일이다. Date.UTC 로 세면 92일이 나와 경계를 잘못 판정한다.
    expect(isResultsRange(range('0000-02-29', '0000-02-29'))).toBe(true)
    expect(resultsRangeProblem(range('0000-01-01', '0000-04-02'), NOW)).toBe(RESULTS_RANGE_ERROR)
    expect(resultsRangeProblem(range('0000-01-01', '0000-04-01'), NOW)).toBeNull()
  })
})
