import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import ScheduleLoading from './loading'

describe('ScheduleLoading', () => {
  it('preserves the briefing, date strip, and timeline structure while loading', () => {
    render(<ScheduleLoading />)

    expect(screen.getByRole('status')).toHaveTextContent('오늘 일정을 확인하고 있어요')
    expect(screen.getByLabelText('운영 브리핑 불러오는 중')).toBeInTheDocument()
    expect(screen.getByLabelText('날짜 불러오는 중')).toBeInTheDocument()
    expect(screen.getByLabelText('일정 목록 불러오는 중')).toBeInTheDocument()
  })
})
