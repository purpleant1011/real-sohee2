'use client'

import React, { useState } from 'react'
import { Calendar, ChevronLeft, ChevronRight, Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'

export interface CalendarReservationItem {
  id: string
  customerName: string
  serviceName: string
  bookingStartsAt: string // e.g. "2026-10-20 14:00" or ISO
  totalAmountKrw?: number
  depositKrw?: number
  status?: 'confirmed' | 'pending' | 'completed'
  channel?: string
}

export interface ReservationCalendarViewProps {
  reservations: CalendarReservationItem[]
  onSelectSlot?: (dateTimeStr: string) => void
  onSelectReservation?: (reservation: CalendarReservationItem) => void
  className?: string
}

const HOURS = [10, 12, 14, 16, 18, 20]

export function ReservationCalendarView({
  reservations = [],
  onSelectSlot,
  onSelectReservation,
  className = '',
}: ReservationCalendarViewProps) {
  const [currentWeekOffset, setCurrentWeekOffset] = useState(0)

  // Calculate Monday to Sunday of the targeted week
  const getWeekDays = () => {
    const now = new Date()
    // Current day offset
    const currentDay = now.getDay() // 0 = Sun, 1 = Mon ...
    const distanceToMonday = (currentDay + 6) % 7
    const monday = new Date(now)
    monday.setDate(now.getDate() - distanceToMonday + currentWeekOffset * 7)

    const days = []
    const dayNames = ['월', '화', '수', '목', '금', '토', '일']
    for (let i = 0; i < 7; i++) {
      const d = new Date(monday)
      d.setDate(monday.getDate() + i)
      const dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
      days.push({
        name: dayNames[i],
        dateStr,
        displayDate: `${d.getMonth() + 1}/${d.getDate()}`,
        isToday: d.toDateString() === new Date().toDateString(),
      })
    }
    return days
  }

  const weekDays = getWeekDays()

  // Match reservation to date & hour
  const findReservationsForSlot = (dateStr: string, hour: number) => {
    return reservations.filter((r) => {
      if (!r.bookingStartsAt) return false
      // Format can be "YYYY-MM-DD HH:mm" or ISO
      if (r.bookingStartsAt.includes(dateStr)) {
        // extract hour
        const match = r.bookingStartsAt.match(/(\d{2}):\d{2}/)
        if (match) {
          const resHour = parseInt(match[1], 10)
          return resHour >= hour && resHour < hour + 2
        }
      }
      return false
    })
  }

  return (
    <div
      data-testid="reservation-calendar-view"
      className={`rounded-3xl border border-border bg-card p-4 sm:p-6 space-y-4 shadow-xs ${className}`}
    >
      {/* Calendar Navigation Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 border-b border-border/40 pb-3">
        <div className="flex items-center gap-2">
          <div className="size-8 rounded-xl bg-primary/10 text-primary flex items-center justify-center">
            <Calendar className="size-4.5" aria-hidden="true" />
          </div>
          <div>
            <h3 className="font-bold text-base sm:text-lg text-foreground flex items-center gap-2">
              <span>주간 예약 스케줄</span>
              <Badge variant="outline" className="border-primary/30 text-foreground dark:text-primary text-xs font-semibold">
                실시간 장부
              </Badge>
            </h3>
            <p className="text-xs text-muted-foreground">
              {weekDays[0].dateStr} ~ {weekDays[6].dateStr}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setCurrentWeekOffset((prev) => prev - 1)}
            className="size-8 p-0"
            aria-label="이전 주"
          >
            <ChevronLeft className="size-4" />
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setCurrentWeekOffset(0)}
            className="text-xs font-semibold px-2.5 h-8"
          >
            이번 주
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setCurrentWeekOffset((prev) => prev + 1)}
            className="size-8 p-0"
            aria-label="다음 주"
          >
            <ChevronRight className="size-4" />
          </Button>
        </div>
      </div>

      {/* Week Grid */}
      <div className="w-full overflow-x-auto pb-2">
        <div className="min-w-[640px] w-full border border-border/60 rounded-2xl overflow-hidden bg-background">
          {/* Day Headers */}
          <div className="grid grid-cols-8 border-b border-border/60 bg-muted/40 text-center text-xs font-bold text-muted-foreground">
            <div className="p-3 border-r border-border/60 flex items-center justify-center">
              시간
            </div>
            {weekDays.map((day) => (
              <div
                key={day.dateStr}
                className={`p-3 border-r border-border/60 last:border-r-0 ${
                  day.isToday ? 'bg-primary/10 text-foreground dark:text-primary font-extrabold' : ''
                }`}
              >
                <span>{day.name}</span>
                <span className="block text-[11px] font-normal text-muted-foreground mt-0.5">
                  {day.displayDate}
                </span>
              </div>
            ))}
          </div>

          {/* Time Rows */}
          {HOURS.map((hour) => (
            <div key={hour} className="grid grid-cols-8 border-b border-border/40 last:border-b-0 min-h-[64px]">
              {/* Hour Label */}
              <div className="p-2 border-r border-border/60 flex items-center justify-center text-xs font-mono text-muted-foreground bg-muted/20">
                {String(hour).padStart(2, '0')}:00
              </div>

              {/* Day Slot Cells */}
              {weekDays.map((day) => {
                const matched = findReservationsForSlot(day.dateStr, hour)
                const slotDateTime = `${day.dateStr} ${String(hour).padStart(2, '0')}:00`

                return (
                  <div
                    key={`${day.dateStr}-${hour}`}
                    onClick={() => {
                      if (matched.length === 0) {
                        onSelectSlot?.(slotDateTime)
                      }
                    }}
                    className={`p-1.5 border-r border-border/40 last:border-r-0 relative group transition-colors ${
                      matched.length > 0 ? 'bg-card' : 'hover:bg-muted/30 cursor-pointer'
                    }`}
                  >
                    {matched.map((res) => (
                      <div
                        key={res.id}
                        onClick={(e) => {
                          e.stopPropagation()
                          onSelectReservation?.(res)
                        }}
                        className="p-1.5 rounded-lg border border-primary/30 bg-primary/10 hover:border-primary/50 transition-all cursor-pointer space-y-0.5 shadow-2xs"
                      >
                        <div className="flex items-center justify-between text-[11px] font-bold text-foreground">
                          <span className="truncate">{res.customerName}</span>
                          <span className="size-1.5 rounded-full bg-state-ok" />
                        </div>
                        <p className="text-[10px] text-muted-foreground truncate">
                          {res.serviceName}
                        </p>
                      </div>
                    ))}

                    {matched.length === 0 && (
                      <div className="size-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                        <Plus className="size-3.5 text-muted-foreground" />
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
