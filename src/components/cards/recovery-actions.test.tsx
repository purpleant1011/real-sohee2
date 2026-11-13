import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { RecoveryActions } from './recovery-actions'

describe('RecoveryActions', () => {
  it('shows preserved work and calls only the selected recovery action', () => {
    const retry = vi.fn()
    const manual = vi.fn()
    render(
      <RecoveryActions
        state="failure"
        title="게시하지 못했어요"
        description="공식 채널이 요청을 거절했어요"
        preserved="승인한 V3는 보관됐어요"
        creditSummary="생성 12 사용 · 외부 실행 0"
        actions={[
          { id: 'retry', label: '다시 확인', onSelect: retry },
          { id: 'manual', label: '수동 마무리', onSelect: manual, emphasis: 'primary' },
        ]}
      />,
    )

    expect(screen.getByText('승인한 V3는 보관됐어요')).toBeVisible()
    expect(screen.queryByText('생성 12 사용 · 외부 실행 0')).not.toBeInTheDocument()
    expect(screen.queryByText('크레딧')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '수동 마무리' }))
    expect(manual).toHaveBeenCalledTimes(1)
    expect(retry).not.toHaveBeenCalled()
  })

  it('marks an unknown external result as duplicate-unsafe', () => {
    render(
      <RecoveryActions
        state="unknown"
        title="결과를 아직 확인하지 못했어요"
        description="같은 요청을 다시 보내지 않아요"
        actions={[{ id: 'check', label: '상태 확인', onSelect: vi.fn() }]}
      />,
    )

    expect(screen.getByText('중복 실행 금지')).toHaveAttribute('data-tone', 'unknown')
    expect(screen.getByText('같은 요청을 다시 보내지 않아요')).toBeVisible()
  })

  it('limits recovery choices to two clear actions', () => {
    expect(() =>
      render(
        <RecoveryActions
          state="failure"
          title="실패"
          description="설명"
          actions={[
            { id: 'one', label: '하나', onSelect: vi.fn() },
            { id: 'two', label: '둘', onSelect: vi.fn() },
            { id: 'three', label: '셋', onSelect: vi.fn() },
          ]}
        />,
      ),
    ).toThrow('RecoveryActions supports at most two actions')
  })
})
