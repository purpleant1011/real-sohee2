import React from 'react'
import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { KakaoStatusBadge } from './history-badge'
import type { KakaoHistoryItem } from './contract'

function createItem(status: KakaoHistoryItem['status'], statusLabel: string): KakaoHistoryItem {
  return {
    id: 'test-1',
    reservationId: 'res-1',
    event: 'BOOKING_CONFIRMED',
    eventLabel: '예약 확정 안내',
    status,
    statusLabel,
    detailLabel: null,
    dueAt: '2026-11-09T05:00:00.000Z',
    updatedAt: '2026-11-09T05:00:00.000Z',
  }
}

describe('KakaoStatusBadge', () => {
  it('SCHEDULED(예정) 상태: 중립 스타일과 텍스트, aria-label을 렌더링한다', () => {
    const item = createItem('SCHEDULED', '발송 예정')
    render(<KakaoStatusBadge item={item} />)

    const badge = screen.getByText('발송 예정')
    expect(badge).toBeInTheDocument()
    expect(badge).toHaveAttribute('aria-label', expect.stringContaining('발송 예정'))
    expect(badge.className).toMatch(/zinc/)
  })

  it('DELIVERED(도착확인) 상태: 초록 스타일과 텍스트를 렌더링한다', () => {
    const item = createItem('DELIVERED', '도착 확인')
    render(<KakaoStatusBadge item={item} />)

    const badge = screen.getByText('도착 확인')
    expect(badge).toBeInTheDocument()
    expect(badge).toHaveAttribute('aria-label', expect.stringContaining('도착 확인'))
    expect(badge.className).toMatch(/state-ok/)
  })

  it('FAILED(실패) 상태: 빨강 스타일과 텍스트를 렌더링한다', () => {
    const item = createItem('FAILED', '전달 실패')
    render(<KakaoStatusBadge item={item} />)

    const badge = screen.getByText('전달 실패')
    expect(badge).toBeInTheDocument()
    expect(badge).toHaveAttribute('aria-label', expect.stringContaining('전달 실패'))
    expect(badge.className).toMatch(/destructive/)
  })

  it('NEEDS_CHECK(확인필요) / HELD(보내지않음) 상태: 주황 스타일과 텍스트를 렌더링한다', () => {
    const needsCheck = createItem('NEEDS_CHECK', '확인이 필요해요')
    const { rerender } = render(<KakaoStatusBadge item={needsCheck} />)

    let badge = screen.getByText('확인이 필요해요')
    expect(badge).toBeInTheDocument()
    expect(badge.className).toMatch(/state-warn/)

    const held = createItem('HELD', '보내지 않았어요')
    rerender(<KakaoStatusBadge item={held} />)
    badge = screen.getByText('보내지 않았어요')
    expect(badge).toBeInTheDocument()
    expect(badge.className).toMatch(/state-warn/)
  })

  it('CANCELLED(취소) 상태: 회색 스타일과 텍스트를 렌더링한다', () => {
    const item = createItem('CANCELLED', '취소됐어요')
    render(<KakaoStatusBadge item={item} />)

    const badge = screen.getByText('취소됐어요')
    expect(badge).toBeInTheDocument()
    expect(badge).toHaveAttribute('aria-label', expect.stringContaining('취소됐어요'))
    expect(badge.className).toMatch(/zinc|muted/)
  })
})
