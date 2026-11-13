import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { SwipeApprovalDeck } from './swipe-approval-deck'
import type { HomeApprovalItem } from '@/features/home/home-approval-types'

describe('SwipeApprovalDeck', () => {
  const mockItems: HomeApprovalItem[] = [
    {
      id: 'post:1',
      category: 'post_publish',
      channel: 'multi',
      title: '포스팅',
      targetLabel: '가을 꿀팁 포스팅',
      sourceSnippet: '가을 스킨케어 꿀팁',
      draftSnippet: '환절기 루틴 소개',
      roiImpact: { type: 'reach', label: '예상 도달', value: '500명' },
      createdAt: '2026-10-15T00:00:00Z',
    },
    {
      id: 'dm:1',
      category: 'dm_reply',
      channel: 'instagram',
      title: 'DM 문의',
      targetLabel: '고객님',
      sourceSnippet: '예약 문의',
      draftSnippet: '답변 초안',
      createdAt: '2026-10-15T01:00:00Z',
    },
  ]

  it('renders top card and counter', () => {
    render(
      <SwipeApprovalDeck
        items={mockItems}
        onApprove={vi.fn()}
        onDismiss={vi.fn()}
      />
    )

    expect(screen.getByText('카드 1 / 2')).toBeInTheDocument()
    expect(screen.getByText('가을 꿀팁 포스팅')).toBeInTheDocument()
    expect(screen.getByText(/예상 도달:/)).toBeInTheDocument()
    expect(screen.getByText('500명')).toBeInTheDocument()
  })

  it('calls onApprove when approve button is clicked', async () => {
    const onApprove = vi.fn().mockResolvedValue(undefined)
    const onDismiss = vi.fn().mockResolvedValue(undefined)

    render(
      <SwipeApprovalDeck
        items={mockItems}
        onApprove={onApprove}
        onDismiss={onDismiss}
      />
    )

    const approveBtn = screen.getByText(/승인 \(우측\)/)
    fireEvent.click(approveBtn)

    await vi.waitFor(() => {
      expect(onApprove).toHaveBeenCalledWith(mockItems[0])
    })
  })

  it('calls onDismiss when dismiss button is clicked', async () => {
    const onApprove = vi.fn().mockResolvedValue(undefined)
    const onDismiss = vi.fn().mockResolvedValue(undefined)

    render(
      <SwipeApprovalDeck
        items={mockItems}
        onApprove={onApprove}
        onDismiss={onDismiss}
      />
    )

    const dismissBtn = screen.getByText(/보류 \(좌측\)/)
    fireEvent.click(dismissBtn)

    await vi.waitFor(() => {
      expect(onDismiss).toHaveBeenCalledWith(mockItems[0])
    })
  })

  it('preserves the active card when onApprove returns false on failure', async () => {
    const onApprove = vi.fn().mockResolvedValue(false)
    const onDismiss = vi.fn().mockResolvedValue(true)

    render(
      <SwipeApprovalDeck
        items={mockItems}
        onApprove={onApprove}
        onDismiss={onDismiss}
      />
    )

    expect(screen.getByText('카드 1 / 2')).toBeInTheDocument()
    const approveBtn = screen.getByText(/승인 \(우측\)/)
    fireEvent.click(approveBtn)

    await vi.waitFor(() => {
      expect(onApprove).toHaveBeenCalledWith(mockItems[0])
    })

    // Advance must NOT be called; Card 1 remains
    expect(screen.getByText('카드 1 / 2')).toBeInTheDocument()
    expect(screen.getByText('가을 꿀팁 포스팅')).toBeInTheDocument()
  })
})
