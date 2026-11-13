'use client'

import React, { useState } from 'react'
import { 
  Calendar as CalendarIcon, 
  ChevronLeft, 
  ChevronRight, 
  Clock, 
  Sparkles, 
  Plus,
  CheckCircle2,
  AlertTriangle,
  Layers
} from 'lucide-react'

type CalendarViewMode = 'month' | 'week' | 'day'

interface MarketingScheduleEvent {
  id: string
  title: string
  channel: 'naver_blog' | 'instagram' | 'threads' | 'daangn'
  date: string // YYYY-MM-DD
  time: string // HH:mm
  status: 'published' | 'scheduled' | 'needs_approval' | 'draft'
  expectedInquiries?: number
}

export interface CalendarCell {
  dayNum: number
  dateStr: string
  isCurrentMonth: boolean
  isToday: boolean
  events: MarketingScheduleEvent[]
}

/** 로컬 기준 YYYY-MM-DD. 달력의 '오늘' 판정과 기본 선택값에 쓴다. */
export function toDateString(date: Date): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

export function todayString(now: Date = new Date()): string {
  return toDateString(now)
}

function parseDateString(value: string): Date {
  const [y, m, d] = value.split('-').map(Number)
  return new Date(y, (m ?? 1) - 1, d ?? 1)
}

const WEEKDAY_NAMES = ['일', '월', '화', '수', '목', '금', '토'] as const

/**
 * Builds a Gregorian calendar grid with exact month boundaries and padding.
 * Guarantees zero invalid dates like Sep 31, 32, 33, 34.
 */
export function buildMonthGrid(
  year: number,
  month: number,
  events: MarketingScheduleEvent[] = [],
  todayStr = todayString()
): CalendarCell[] {
  const firstDay = new Date(Date.UTC(year, month - 1, 1))
  const firstDayOfWeek = firstDay.getUTCDay() // 0 = Sun .. 6 = Sat
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate()
  const prevMonthLastDay = new Date(Date.UTC(year, month - 1, 0)).getUTCDate()

  const cells: CalendarCell[] = []

  // 1. Previous month padding
  for (let i = firstDayOfWeek - 1; i >= 0; i--) {
    const day = prevMonthLastDay - i
    const prevMonth = month === 1 ? 12 : month - 1
    const prevYear = month === 1 ? year - 1 : year
    const dateStr = `${prevYear}-${String(prevMonth).padStart(2, '0')}-${String(day).padStart(2, '0')}`
    cells.push({
      dayNum: day,
      dateStr,
      isCurrentMonth: false,
      isToday: dateStr === todayStr,
      events: events.filter(e => e.date === dateStr),
    })
  }

  // 2. Current month days
  for (let d = 1; d <= daysInMonth; d++) {
    const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`
    cells.push({
      dayNum: d,
      dateStr,
      isCurrentMonth: true,
      isToday: dateStr === todayStr,
      events: events.filter(e => e.date === dateStr),
    })
  }

  // 3. Next month padding to reach 35 cells
  const totalCellsNeeded = cells.length <= 35 ? 35 : 42
  const remaining = totalCellsNeeded - cells.length
  for (let d = 1; d <= remaining; d++) {
    const nextMonth = month === 12 ? 1 : month + 1
    const nextYear = month === 12 ? year + 1 : year
    const dateStr = `${nextYear}-${String(nextMonth).padStart(2, '0')}-${String(d).padStart(2, '0')}`
    cells.push({
      dayNum: d,
      dateStr,
      isCurrentMonth: false,
      isToday: dateStr === todayStr,
      events: events.filter(e => e.date === dateStr),
    })
  }

  return cells
}

const SAMPLE_EVENTS: MarketingScheduleEvent[] = [
  {
    id: 'evt-1',
    title: '네이버 블로그: 봄맞이 매장 신메뉴/서비스 안내',
    channel: 'naver_blog',
    date: '2026-08-31',
    time: '14:00',
    status: 'needs_approval',
    expectedInquiries: 5
  },
  {
    id: 'evt-2',
    title: '인스타그램 릴스: 대표 서비스 1:1 맞춤 전후 비교',
    channel: 'instagram',
    date: '2026-09-01',
    time: '11:30',
    status: 'scheduled',
    expectedInquiries: 3
  },
  {
    id: 'evt-3',
    title: '당근마켓 소식: 화/수 첫 방문 15% 할인 쿠폰',
    channel: 'daangn',
    date: '2026-09-02',
    time: '10:00',
    status: 'scheduled',
    expectedInquiries: 4
  },
  {
    id: 'evt-4',
    title: '스레드: 서비스 이용 후 3일차 관리 팁 4가지',
    channel: 'threads',
    date: '2026-08-30',
    time: '19:00',
    status: 'published',
    expectedInquiries: 2
  }
]

interface MarketingCalendarProps {
  onSelectEvent?: (eventId: string) => void
  isTestAccount?: boolean
  initialEvents?: MarketingScheduleEvent[]
  /** 오늘 날짜(YYYY-MM-DD). 테스트에서 고정할 때만 넘긴다. */
  today?: string
}

/** 예시 일정은 테스트 계정에서만 보여야 하므로 기본값을 false 로 둔다(명시적으로 켜야 노출). */
export function MarketingCalendar({ onSelectEvent, isTestAccount = false, initialEvents, today }: MarketingCalendarProps = {}) {
  const todayStr = today ?? todayString()
  const [viewMode, setViewMode] = useState<CalendarViewMode>('month')
  const [selectedDate, setSelectedDate] = useState<string>(todayStr)
  const [events, setEvents] = useState<MarketingScheduleEvent[]>(
    initialEvents || (isTestAccount ? SAMPLE_EVENTS : [])
  )

  const getChannelColor = (channel: MarketingScheduleEvent['channel']) => {
    switch (channel) {
      case 'naver_blog':
        return 'bg-state-ok-soft text-state-ok dark:bg-state-ok dark:text-state-ok border-state-ok/40'
      case 'instagram':
        return 'bg-primary/10 text-foreground dark:bg-primary dark:text-primary border-primary/40'
      case 'threads':
        return 'bg-neutral-100 text-neutral-800 dark:bg-neutral-800 dark:text-neutral-200 border-neutral-300'
      case 'daangn':
        return 'bg-state-warn-soft text-state-warn dark:bg-state-warn dark:text-state-warn border-state-warn/40'
    }
  }

  const getChannelName = (channel: MarketingScheduleEvent['channel']) => {
    switch (channel) {
      case 'naver_blog': return '네이버 블로그'
      case 'instagram': return '인스타그램'
      case 'threads': return '스레드'
      case 'daangn': return '당근마켓'
    }
  }

  // Week view: 오늘이 속한 주(월~일). 고정 날짜를 쓰지 않는다.
  const todayDate = parseDateString(todayStr)
  const mondayOffset = (todayDate.getDay() + 6) % 7 // 월=0 … 일=6
  const weekDays = Array.from({ length: 7 }, (_, index) => {
    const date = new Date(todayDate)
    date.setDate(todayDate.getDate() - mondayOffset + index)
    const dateStr = toDateString(date)
    return {
      name: WEEKDAY_NAMES[date.getDay()],
      date: dateStr,
      dayNum: date.getDate(),
      isToday: dateStr === todayStr,
    }
  })

  // Month view: 오늘이 속한 달. 고정 연·월을 쓰지 않는다.
  const monthCells = buildMonthGrid(todayDate.getFullYear(), todayDate.getMonth() + 1, events, todayStr)
  const monthLabel = `${todayDate.getFullYear()}년 ${todayDate.getMonth() + 1}월`

  const selectedDateObj = parseDateString(selectedDate)
  const selectedLabel = `${selectedDateObj.getFullYear()}년 ${selectedDateObj.getMonth() + 1}월 ${selectedDateObj.getDate()}일 ${WEEKDAY_NAMES[selectedDateObj.getDay()]}요일`
  const isSelectedPast = selectedDate < todayStr
  const selectedDayEvents = events.filter(e => e.date === selectedDate)

  return (
    <div className="p-6 rounded-2xl bg-[var(--v088-surface)] border border-[var(--v088-border)] shadow-xs space-y-6">
      {/* Calendar Header & View Mode Switch */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5 text-lg font-bold text-[var(--v088-ink)]">
            <CalendarIcon className="w-5 h-5 text-primary" />
            <span>{monthLabel}</span>
          </div>

          <div className="flex items-center border border-[var(--v088-border)] rounded-xl bg-[var(--v088-surface-subtle)] p-0.5">
            <button className="p-1 rounded-lg hover:bg-[var(--v088-surface)] text-[var(--v088-muted)]">
              <ChevronLeft className="w-4 h-4" />
            </button>
            <button className="px-2.5 py-0.5 text-xs font-bold text-primary hover:bg-[var(--v088-surface)] rounded-lg">
              오늘
            </button>
            <button className="p-1 rounded-lg hover:bg-[var(--v088-surface)] text-[var(--v088-muted)]">
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* View Mode Toggle (월간 / 주간 / 일간) */}
        <div className="flex items-center p-1 rounded-xl bg-[var(--v088-surface-subtle)] border border-[var(--v088-border-subtle)] text-xs font-bold">
          <button
            onClick={() => setViewMode('month')}
            className={`px-3 py-1.5 rounded-lg transition-all cursor-pointer ${
              viewMode === 'month' ? 'bg-primary text-white shadow-xs' : 'text-[var(--v088-muted)]'
            }`}
          >
            월간 (Month)
          </button>
          <button
            onClick={() => setViewMode('week')}
            className={`px-3 py-1.5 rounded-lg transition-all cursor-pointer ${
              viewMode === 'week' ? 'bg-primary text-white shadow-xs' : 'text-[var(--v088-muted)]'
            }`}
          >
            주간 (Week)
          </button>
          <button
            onClick={() => setViewMode('day')}
            className={`px-3 py-1.5 rounded-lg transition-all cursor-pointer ${
              viewMode === 'day' ? 'bg-primary text-white shadow-xs' : 'text-[var(--v088-muted)]'
            }`}
          >
            일간 (Day)
          </button>
        </div>
      </div>

      {/* 1. MONTH VIEW */}
      {viewMode === 'month' && (
        <div className="space-y-2">
          {/* Weekday headers */}
          <div className="grid grid-cols-7 text-center text-xs font-bold text-[var(--v088-muted)] pb-2 border-b border-[var(--v088-border)]">
            <span className="text-state-danger">일</span>
            <span>월</span>
            <span>화</span>
            <span>수</span>
            <span>목</span>
            <span>금</span>
            <span className="text-state-wait">토</span>
          </div>

          {/* Month grid */}
          <div className="grid grid-cols-7 gap-1.5">
            {monthCells.map((cell, idx) => (
              <div
                key={idx}
                onClick={() => setSelectedDate(cell.dateStr)}
                className={`min-h-[100px] p-2 rounded-xl border transition-all cursor-pointer flex flex-col justify-between ${
                  cell.isToday
                    ? 'border-primary/50 bg-primary/40'
                    : 'border-[var(--v088-border-subtle)] bg-[var(--v088-surface-subtle)]/40 hover:border-primary/40'
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className={`text-xs font-bold ${cell.isToday ? 'text-primary font-black' : 'text-[var(--v088-ink)]'}`}>
                    {cell.dayNum}
                  </span>
                  {cell.isToday && (
                    <span className="text-[9px] px-1 rounded bg-primary text-white font-bold">오늘</span>
                  )}
                </div>

                <div className="space-y-1 mt-1 flex-1">
                  {cell.events.map((evt) => (
                    <div
                      key={evt.id}
                      onClick={(e) => {
                        e.stopPropagation()
                        onSelectEvent?.(evt.id)
                      }}
                      className={`p-1 rounded-md text-[10px] font-semibold truncate border transition-transform hover:scale-102 cursor-pointer shadow-2xs ${getChannelColor(evt.channel)}`}
                      title="클릭하여 상세 실사 시안 확인"
                    >
                      <span className="font-mono text-[9px] mr-1">{evt.time}</span>
                      {evt.title}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 2. WEEK VIEW */}
      {viewMode === 'week' && (
        <div className="space-y-4">
          <div className="grid grid-cols-7 gap-3">
            {weekDays.map((d) => {
              const dayEvents = events.filter(e => e.date === d.date)
              return (
                <div
                  key={d.date}
                  className={`p-3 rounded-2xl border flex flex-col min-h-[320px] ${
                    d.isToday
                      ? 'border-primary/50 bg-primary/30 shadow-xs'
                      : 'border-[var(--v088-border)] bg-[var(--v088-surface-subtle)]'
                  }`}
                >
                  <div className="flex items-center justify-between pb-2 border-b border-[var(--v088-border-subtle)] mb-2">
                    <span className="text-xs font-bold text-[var(--v088-muted)]">{d.name}요일</span>
                    <span className={`text-sm font-bold ${d.isToday ? 'text-primary font-extrabold' : 'text-[var(--v088-ink)]'}`}>
                      {d.dayNum}일
                    </span>
                  </div>

                  <div className="space-y-2 flex-1">
                    {dayEvents.map((evt) => (
                      <div
                        key={evt.id}
                        onClick={() => onSelectEvent?.(evt.id)}
                        className={`p-2.5 rounded-xl border text-xs space-y-1 transition-transform hover:scale-102 cursor-pointer shadow-xs ${getChannelColor(evt.channel)}`}
                        title="클릭하여 상세 실사 시안 확인"
                      >
                        <div className="flex items-center justify-between text-[10px] font-bold">
                          <span>{getChannelName(evt.channel)}</span>
                          <span className="font-mono">{evt.time}</span>
                        </div>
                        <p className="font-bold leading-snug line-clamp-2">{evt.title}</p>
                        <div className="text-[10px] opacity-80">
                          {evt.status === 'needs_approval' ? '⏳ 사장님 승인 대기' : evt.status === 'scheduled' ? '⏰ 자동 발행 예약' : '✅ 발행 완료'}
                        </div>
                      </div>
                    ))}
                    {dayEvents.length === 0 && (
                      <div className="h-full flex items-center justify-center text-[11px] text-[var(--v088-muted)]">
                        일정 없음
                      </div>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* 3. DAY VIEW */}
      {viewMode === 'day' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between p-4 rounded-2xl bg-primary text-white">
            <div>
              <span className="text-xs font-bold text-primary block">선택된 날짜</span>
              <h3 className="text-lg font-bold">
                {selectedLabel}
                {isSelectedPast ? ' (지난 날짜)' : selectedDate === todayStr ? ' (오늘)' : ''}
              </h3>
            </div>
            <span className="text-xs px-3 py-1 rounded-xl bg-primary font-bold">
              {selectedDayEvents.length === 0 ? '일정 없음' : `${selectedDayEvents.length}건의 마케팅 일정`}
            </span>
          </div>

          <div className="space-y-3">
            {selectedDayEvents.map((evt) => (
              <div
                key={evt.id}
                onClick={() => onSelectEvent?.(evt.id)}
                className="p-4 rounded-2xl bg-[var(--v088-surface-subtle)] border border-[var(--v088-border)] hover:border-primary/50 flex items-center justify-between gap-4 transition-all cursor-pointer shadow-xs"
              >
                <div className="flex items-center gap-3">
                  <div className="w-12 h-12 rounded-xl bg-primary text-white flex flex-col items-center justify-center font-bold text-xs">
                    <Clock className="w-3.5 h-3.5 mb-0.5" />
                    <span>{evt.time}</span>
                  </div>
                  <div>
                    <span className="text-[11px] font-bold text-primary block">
                      {getChannelName(evt.channel)}
                    </span>
                    <h4 className="font-bold text-sm text-[var(--v088-ink)]">{evt.title}</h4>
                    <span className="text-xs text-[var(--v088-muted)]">예상 문의 전환: {evt.expectedInquiries}건</span>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <span className="text-xs px-3 py-1 rounded-xl bg-state-warn-soft text-state-warn dark:bg-state-warn dark:text-state-warn font-bold border border-state-warn/40">
                    {evt.status === 'needs_approval' ? '사장님 승인 대기' : '예약 완료'}
                  </span>
                  <button className="px-3.5 py-1.5 rounded-xl bg-primary text-white text-xs font-bold shadow-xs hover:bg-primary/90">
                    시안 보기
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
