import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NaverGeneratingState } from './naver-generating-state'

describe('NaverGeneratingState', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('cycles through 3 status messages with aria-live role status', () => {
    render(
      <NaverGeneratingState
        topic="가을철 피부관리"
        imageCount={4}
        onCancel={vi.fn()}
      />,
    )

    const statusRegion = screen.getByRole('status')
    expect(statusRegion).toHaveAttribute('aria-live', 'polite')
    expect(screen.getByText('글을 쓰고 있어요')).toBeInTheDocument()

    // Advance timer to 2nd message
    act(() => {
      vi.advanceTimersByTime(5000)
    })
    expect(screen.getByText('사진을 만들고 있어요 (예상 1~2분)')).toBeInTheDocument()

    // Advance timer to 3rd message
    act(() => {
      vi.advanceTimersByTime(5000)
    })
    expect(screen.getByText('거의 다 됐어요')).toBeInTheDocument()
  })

  it('calls onCancel when clicking 그만두기 and disables button during cancellation', () => {
    const onCancel = vi.fn()
    render(
      <NaverGeneratingState
        topic="가을철 피부관리"
        imageCount={4}
        onCancel={onCancel}
      />,
    )

    const cancelButton = screen.getByRole('button', { name: '그만두기' })
    fireEvent.click(cancelButton)

    expect(onCancel).toHaveBeenCalledTimes(1)
  })

  it('renders retry button on retryable error', () => {
    const onRetry = vi.fn()
    render(
      <NaverGeneratingState
        topic="가을철 피부관리"
        imageCount={4}
        onCancel={vi.fn()}
        error={{ errorCode: 'SERVICE_UNAVAILABLE', message: '네이버 블로그 글을 생성하지 못했어요. 잠시 후 다시 시도해 주세요.' }}
        onRetry={onRetry}
      />,
    )

    expect(screen.getByText('네이버 블로그 글을 생성하지 못했어요. 잠시 후 다시 시도해 주세요.')).toBeInTheDocument()
    const retryBtn = screen.getByRole('button', { name: '다시 시도' })
    fireEvent.click(retryBtn)
    expect(onRetry).toHaveBeenCalledTimes(1)
  })

  it('renders charge link on CREDIT_INSUFFICIENT error', () => {
    render(
      <NaverGeneratingState
        topic="가을철 피부관리"
        imageCount={4}
        onCancel={vi.fn()}
        error={{ errorCode: 'CREDIT_INSUFFICIENT', message: '크레딧이 부족해서 글을 만들 수 없어요. 크레딧을 충전한 뒤 다시 시도해 주세요.' }}
      />,
    )

    expect(screen.getByText('크레딧이 부족해서 글을 만들 수 없어요. 크레딧을 충전한 뒤 다시 시도해 주세요.')).toBeInTheDocument()
    const chargeLink = screen.getByRole('link', { name: '크레딧 충전하기' })
    expect(chargeLink).toHaveAttribute('href', '/app/settings/billing')
  })

  it('does NOT render automatic retry button on UNKNOWN_RESULT or none action', () => {
    render(
      <NaverGeneratingState
        topic="가을철 피부관리"
        imageCount={4}
        onCancel={vi.fn()}
        error={{ errorCode: 'UNKNOWN_RESULT', message: '게시 결과를 확인하지 못했어요. 중복 게시를 막기 위해 자동으로 다시 올리지 않아요. 네이버에서 직접 확인해 주세요.' }}
      />,
    )

    expect(screen.queryByRole('button', { name: '다시 시도' })).not.toBeInTheDocument()
  })

  it('renders "같은 주제로 다시 만들기" and "처음으로" buttons on CLAIMS_NEED_REVIEW error', () => {
    const onRetry = vi.fn()
    const onCancel = vi.fn()
    render(
      <NaverGeneratingState
        topic="가을철 피부관리"
        imageCount={4}
        onCancel={onCancel}
        error={{ errorCode: 'CLAIMS_NEED_REVIEW', message: '확인이 필요한 표현이 남아 한 번 더 다듬어야 해요. 같은 주제로 다시 만들어 볼까요?' }}
        onRetry={onRetry}
      />,
    )

    expect(screen.getByText('확인이 필요한 표현이 남아 한 번 더 다듬어야 해요. 같은 주제로 다시 만들어 볼까요?')).toBeInTheDocument()
    const retryBtn = screen.getByRole('button', { name: '같은 주제로 다시 만들기' })
    expect(retryBtn).toBeInTheDocument()
    const cancelBtn = screen.getByRole('button', { name: '처음으로' })
    expect(cancelBtn).toBeInTheDocument()

    fireEvent.click(retryBtn)
    expect(onRetry).toHaveBeenCalledTimes(1)
  })

  it('renders "같은 주제로 다시 만들기" on DRAFT_FAILED error', () => {
    const onRetry = vi.fn()
    render(
      <NaverGeneratingState
        topic="가을철 피부관리"
        imageCount={4}
        onCancel={vi.fn()}
        error={{ errorCode: 'DRAFT_FAILED', message: '초안 글을 작성하지 못했습니다. 잠시 후 다시 시도해 주세요.' }}
        onRetry={onRetry}
      />,
    )

    const retryBtn = screen.getByRole('button', { name: '같은 주제로 다시 만들기' })
    expect(retryBtn).toBeInTheDocument()
    fireEvent.click(retryBtn)
    expect(onRetry).toHaveBeenCalledTimes(1)
  })
})
