import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ExecutionChoiceCard } from './execution-choice-card'

const base = {
  accountLabel: '@studio_byreum',
  channel: 'instagram' as const,
  mediaCount: 3,
  pending: false,
  versionNumber: 3,
}

describe('ExecutionChoiceCard', () => {
  it('requires an exact-version confirmation before requesting an immediate publish', () => {
    const publishNow = vi.fn()
    render(<ExecutionChoiceCard {...base} onPublishNow={publishNow} onSchedule={vi.fn()} />)

    const card = screen.getByRole('region', { name: '승인 후 실행 선택' })
    expect(card).toHaveTextContent('Instagram')
    expect(card).toHaveTextContent('@studio_byreum')
    expect(card).toHaveTextContent('v3')
    expect(card).toHaveTextContent('이미지 3장')

    fireEvent.click(screen.getByRole('button', { name: '지금 게시' }))
    expect(publishNow).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: '승인한 v3 지금 게시' })).toBeDisabled()

    fireEvent.click(screen.getByRole('checkbox', { name: '승인한 v3을 @studio_byreum 계정에 지금 게시합니다' }))
    fireEvent.click(screen.getByRole('button', { name: '승인한 v3 지금 게시' }))

    expect(publishNow).toHaveBeenCalledTimes(1)
  })

  it('passes a visible Asia/Seoul local time only after the schedule choice is confirmed', () => {
    const schedule = vi.fn()
    render(<ExecutionChoiceCard {...base} onPublishNow={vi.fn()} onSchedule={schedule} />)

    fireEvent.click(screen.getByRole('button', { name: '예약 게시' }))
    fireEvent.change(screen.getByLabelText('예약 시각 · Asia/Seoul'), { target: { value: '2030-08-21T10:30' } })
    fireEvent.click(screen.getByRole('button', { name: '승인한 v3 예약 게시' }))

    expect(schedule).toHaveBeenCalledWith('2030-08-21T10:30')
    expect(schedule).toHaveBeenCalledTimes(1)
  })

  it('shows pending label "게시하는 중…", aria-busy, and disabled when pending is true', () => {
    render(<ExecutionChoiceCard {...base} pending={true} onPublishNow={vi.fn()} onSchedule={vi.fn()} />)

    fireEvent.click(screen.getByRole('button', { name: '지금 게시' }))
    const button = screen.getByRole('button', { name: /게시하는 중…/ })
    expect(button).toBeDisabled()
    expect(button).toHaveAttribute('aria-busy', 'true')
  })

  it('disables publish button when readiness props indicate not ready', () => {
    const publishNow = vi.fn()
    render(
      <ExecutionChoiceCard
        {...base}
        ready={false}
        onPublishNow={publishNow}
        onSchedule={vi.fn()}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: '지금 게시' }))
    fireEvent.click(screen.getByRole('checkbox', { name: '승인한 v3을 @studio_byreum 계정에 지금 게시합니다' }))
    const button = screen.getByRole('button', { name: '승인한 v3 지금 게시' })
    expect(button).toBeDisabled()
    fireEvent.click(button)
    expect(publishNow).not.toHaveBeenCalled()
  })
})
