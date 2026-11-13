import React from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { MarketingCalendar, buildMonthGrid, todayString, toDateString } from './marketing-calendar'

describe('MarketingCalendar — 날짜 기본값을 지어내지 않는다', () => {
  it('기본 선택 날짜는 과거 고정값이 아니라 오늘이다', () => {
    render(<MarketingCalendar today="2026-10-23" />)

    fireEvent.click(screen.getByRole('button', { name: '일간 (Day)' }))

    expect(screen.getByText(/2026년 10월 23일 금요일 \(오늘\)/)).toBeInTheDocument()
  })

  it('헤더 월 표시도 오늘 기준이다', () => {
    render(<MarketingCalendar today="2026-10-23" />)

    expect(screen.getByText('2026년 10월')).toBeInTheDocument()
    expect(screen.queryByText('2026년 8월 ~ 9월')).not.toBeInTheDocument()
  })

  it('과거 날짜를 고르면 "지난 날짜" 라벨이 붙는다', () => {
    render(<MarketingCalendar today="2026-10-23" />)

    // 10월 그리드에서 1일(과거)을 선택한다.
    fireEvent.click(screen.getAllByText('1')[0])
    fireEvent.click(screen.getByRole('button', { name: '일간 (Day)' }))

    expect(screen.getByText(/지난 날짜/)).toBeInTheDocument()
  })

  it('일정 건수는 실제 항목 수에서 센다 (2건 하드코딩 없음)', () => {
    render(<MarketingCalendar today="2026-10-23" />)

    fireEvent.click(screen.getByRole('button', { name: '일간 (Day)' }))

    expect(screen.getByText('일정 없음')).toBeInTheDocument()
    expect(screen.queryByText(/총 2건의 마케팅 일정/)).not.toBeInTheDocument()
  })

  it('오늘 문자열 헬퍼는 로컬 날짜를 YYYY-MM-DD 로 만든다', () => {
    expect(toDateString(new Date(2026, 9, 23))).toBe('2026-10-23')
    expect(todayString(new Date(2026, 0, 5))).toBe('2026-01-05')
  })

  it('buildMonthGrid 는 넘긴 오늘 날짜로 isToday 를 판정한다', () => {
    const cells = buildMonthGrid(2026, 10, [], '2026-10-23')
    const todayCells = cells.filter(cell => cell.isToday)

    expect(todayCells).toHaveLength(1)
    expect(todayCells[0].dateStr).toBe('2026-10-23')
  })
})
