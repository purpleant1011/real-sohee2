import React from 'react'
import { render, screen, fireEvent } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { SwipeApprovalDeck } from '../swipe-approval-deck'
import type { HomeApprovalItem } from '@/features/home/home-approval-types'

describe('SwipeApprovalDeck with Web Audio Feedback', () => {
  const mockItems: HomeApprovalItem[] = [
    {
      id: 'appr-1',
      category: 'post_publish',
      title: '인스타그램 가을 신메뉴 소개',
      targetLabel: '인스타그램 피드',
      sourceSnippet: '가을 신메뉴 소식',
      draftSnippet: '정성스레 준비한 가을 신메뉴입니다.',
      channel: 'instagram',
      createdAt: new Date().toISOString(),
    },
    {
      id: 'appr-2',
      category: 'comment_reply',
      title: '고객 문의 답글',
      targetLabel: '@user123',
      sourceSnippet: '예약 문의',
      draftSnippet: '네 예약 가능합니다!',
      channel: 'threads',
      createdAt: new Date().toISOString(),
    },
  ]

  it('renders swipe card and handles manual approve button click with callback', async () => {
    const onApprove = vi.fn().mockResolvedValue(undefined)
    const onDismiss = vi.fn().mockResolvedValue(undefined)

    render(
      <SwipeApprovalDeck
        items={mockItems}
        onApprove={onApprove}
        onDismiss={onDismiss}
      />
    )

    expect(screen.getByTestId('swipe-active-card')).toBeInTheDocument()
    expect(screen.getByText('카드 1 / 2')).toBeInTheDocument()

    const approveBtn = screen.getByRole('button', { name: /승인/i })
    fireEvent.click(approveBtn)

    await vi.waitFor(() => {
      expect(onApprove).toHaveBeenCalledWith(mockItems[0])
    })
  })

  it('preserves the active card when onApprove returns false (failure preservation contract)', async () => {
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

    const approveBtn = screen.getByRole('button', { name: /승인/i })
    fireEvent.click(approveBtn)

    await vi.waitFor(() => {
      expect(onApprove).toHaveBeenCalledWith(mockItems[0])
    })

    // Advance must NOT be called; Card 1 must remain active
    expect(screen.getByText('카드 1 / 2')).toBeInTheDocument()
    expect(screen.getByText('인스타그램 피드')).toBeInTheDocument()
  })

  it('handles manual dismiss button click with callback', async () => {
    const onApprove = vi.fn().mockResolvedValue(undefined)
    const onDismiss = vi.fn().mockResolvedValue(undefined)

    render(
      <SwipeApprovalDeck
        items={mockItems}
        onApprove={onApprove}
        onDismiss={onDismiss}
      />
    )

    const dismissBtn = screen.getByRole('button', { name: /보류/i })
    fireEvent.click(dismissBtn)

    await vi.waitFor(() => {
      expect(onDismiss).toHaveBeenCalledWith(mockItems[0])
    })
  })
})
