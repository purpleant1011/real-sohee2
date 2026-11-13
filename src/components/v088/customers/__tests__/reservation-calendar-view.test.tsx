import React from 'react'
import { render, screen, fireEvent } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ReservationCalendarView } from '../reservation-calendar-view'

describe('ReservationCalendarView', () => {
  it('renders weekly schedule grid and matches reservations to time slots', () => {
    const onSelectReservation = vi.fn()
    const onSelectSlot = vi.fn()

    const today = new Date()
    const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`

    const mockReservations = [
      {
        id: 'res-1',
        customerName: '김민지',
        serviceName: '1:1 맞춤 퍼스널 뷰티',
        bookingStartsAt: `${todayStr} 14:00`,
        status: 'confirmed' as const,
      },
    ]

    render(
      <ReservationCalendarView
        reservations={mockReservations}
        onSelectReservation={onSelectReservation}
        onSelectSlot={onSelectSlot}
      />
    )

    expect(screen.getByTestId('reservation-calendar-view')).toBeInTheDocument()
    expect(screen.getByText('주간 예약 스케줄')).toBeInTheDocument()
    expect(screen.getByText('김민지')).toBeInTheDocument()
    expect(screen.getByText('1:1 맞춤 퍼스널 뷰티')).toBeInTheDocument()

    // Click reservation
    fireEvent.click(screen.getByText('김민지'))
    expect(onSelectReservation).toHaveBeenCalledWith(mockReservations[0])
  })

  it('주간 캘린더 그리드가 1024px 소형 PC에서도 가로 스크롤 없이 표시될 수 있도록 반응형 너비를 갖는다', () => {
    render(<ReservationCalendarView reservations={[]} />)
    const gridContainer = screen.getByText('시간').closest('.overflow-x-auto')?.querySelector('div')
    expect(gridContainer?.className).toContain('min-w-[640px]')
    expect(gridContainer?.className).not.toContain('min-w-[840px]')
  })
})
