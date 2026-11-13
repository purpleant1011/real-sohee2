import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { PeriodPlanCard, type PeriodPlanCardArtifact } from './period-plan-card'

describe('PeriodPlanCard', () => {
  const artifact: PeriodPlanCardArtifact = {
      id: '10000000-0000-4000-8000-000000000001', originalRequest: '다음 주 계획을 만들어줘',
      periodStart: '2026-08-24', periodEnd: '2026-08-30', timezone: 'Asia/Seoul', goal: '예약 문의',
      catalogVersion: 1, estimatedCredits: 54, expectedRemainingCredits: 46, status: 'ready' as const,
      channels: [
        { channel: 'instagram', postCount: 7, imagesPerPost: 4 }, { channel: 'threads', postCount: 3, imagesPerPost: 0 },
        { channel: 'naver_blog', postCount: 2, imagesPerPost: 1 }, { channel: 'naver_place', postCount: 1, imagesPerPost: 0 },
        { channel: 'daangn', postCount: 2, imagesPerPost: 1 },
      ],
    }

  it('shows the complete plan decision in one card without saving or reserving', () => {
    render(<PeriodPlanCard artifact={artifact} />)

    expect(screen.getByRole('heading', { name: '예약 문의를 위한 7일 계획' })).toBeVisible()
    expect(screen.getByText('8월 24일 - 8월 30일')).toBeVisible()
    expect(screen.getByText('게시물 15개 · 이미지 32장')).toBeVisible()
    expect(screen.getByText('인스타그램').closest('li')).toHaveTextContent('게시물 7개이미지 28장')
    expect(screen.getByText('당근 비즈프로필').closest('li')).toHaveTextContent('게시물 2개이미지 2장')
    expect(screen.queryByText('54 크레딧')).toBeNull()
    expect(screen.queryByText('실행 후 46')).toBeNull()
    expect(screen.queryByText('현재 100')).toBeNull()
    expect(screen.queryByRole('region', { name: '예상 크레딧' })).toBeNull()
    expect(screen.getByText('계획 승인 전에는 저장하거나 크레딧을 확보하지 않아요.')).toBeVisible()
  })

  it('emits only the selected conversation action and blocks confirmation when credits are insufficient', () => {
    const onAction = vi.fn()
    const { rerender } = render(<PeriodPlanCard artifact={artifact} onAction={onAction} />)

    fireEvent.click(screen.getByRole('button', { name: '범위 줄이기' }))
    expect(onAction).toHaveBeenCalledWith('reduce')
    expect(onAction).toHaveBeenCalledTimes(1)

    rerender(<PeriodPlanCard artifact={{ ...artifact, expectedRemainingCredits: -34, status: 'insufficient' }} onAction={onAction} />)
    expect(screen.getByText('이용 한도에 도달했어요')).toBeVisible()
    expect(screen.queryByText('34 크레딧 부족')).toBeNull()
    expect(screen.getByRole('button', { name: '이 계획으로 시작' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '범위 줄이기' })).toBeEnabled()
  })
})
