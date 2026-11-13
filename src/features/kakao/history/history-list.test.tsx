import React from 'react'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { KakaoHistoryList } from './history-list'
import { useKakaoHistory } from './use-kakao-history'
import type { KakaoHistoryItem } from './contract'

vi.mock('./use-kakao-history', () => ({
  useKakaoHistory: vi.fn(),
}))

const mockUseKakaoHistory = vi.mocked(useKakaoHistory)

describe('KakaoHistoryList', () => {
  const refreshMock = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('로딩 중: 스켈레톤 요소를 표시한다', () => {
    mockUseKakaoHistory.mockReturnValue({
      items: [],
      load: 'loading',
      refresh: refreshMock,
    })

    const { container } = render(<KakaoHistoryList workspaceId="ws-1" />)

    expect(screen.getByRole('status')).toBeInTheDocument()
    expect(container.querySelectorAll('.animate-pulse').length).toBeGreaterThan(0)
    expect(screen.queryByText('아직 보낸 안내가 없어요')).toBeNull()
  })

  it('오류 발생: 안내 문구와 다시 시도 버튼을 표시하며 빈 상태로 속이지 않는다', () => {
    mockUseKakaoHistory.mockReturnValue({
      items: [],
      load: 'error',
      refresh: refreshMock,
    })

    render(<KakaoHistoryList workspaceId="ws-1" />)

    expect(screen.getByText('발송내역을 불러오지 못했어요')).toBeInTheDocument()
    const retryBtn = screen.getByRole('button', { name: '다시 시도' })
    expect(retryBtn).toBeInTheDocument()

    // 오류를 '내역 없음'으로 보이지 않게
    expect(screen.queryByText('아직 보낸 안내가 없어요')).toBeNull()

    fireEvent.click(retryBtn)
    expect(refreshMock).toHaveBeenCalledTimes(1)
  })

  it('빈 상태: 정상 조회되었으나 내역이 없을 때 빈 상태 문구를 표시한다', () => {
    mockUseKakaoHistory.mockReturnValue({
      items: [],
      load: 'ready',
      refresh: refreshMock,
    })

    render(<KakaoHistoryList workspaceId="ws-1" />)

    expect(screen.getByText('아직 보낸 안내가 없어요')).toBeInTheDocument()
    expect(screen.queryByText('발송내역을 불러오지 못했어요')).toBeNull()
  })

  it('목록 렌더링: eventLabel, 배지, 한국어 KST 시각, detailLabel을 표시한다', () => {
    const mockItems: KakaoHistoryItem[] = [
      {
        id: 'job-1',
        reservationId: 'res-1',
        event: 'BOOKING_CONFIRMED',
        eventLabel: '예약 확정 안내',
        status: 'DELIVERED',
        statusLabel: '도착 확인',
        detailLabel: null,
        dueAt: '2026-11-09T05:16:00.000Z',
        updatedAt: '2026-11-09T05:16:00.000Z', // UTC 05:16 -> KST 14:16 (오후 2:16)
      },
      {
        id: 'job-2',
        reservationId: 'res-1',
        event: 'REMINDER_24H',
        eventLabel: '방문 하루 전 안내',
        status: 'HELD',
        statusLabel: '보내지 않았어요',
        detailLabel: '전화번호를 확인할 수 없어 보내지 않았어요.',
        dueAt: '2026-11-08T15:05:00.000Z', // UTC 15:05 -> KST 11-09 00:05 (오전 12:05)
        updatedAt: '2026-11-08T15:05:00.000Z',
      },
    ]

    mockUseKakaoHistory.mockReturnValue({
      items: mockItems,
      load: 'ready',
      refresh: refreshMock,
    })

    render(<KakaoHistoryList workspaceId="ws-1" reservationId="res-1" />)

    // 1번 항목
    expect(screen.getByText('예약 확정 안내')).toBeInTheDocument()
    expect(screen.getByText('도착 확인')).toBeInTheDocument()
    expect(screen.getByText('11월 9일 오후 2:16')).toBeInTheDocument()

    // 2번 항목
    expect(screen.getByText('방문 하루 전 안내')).toBeInTheDocument()
    expect(screen.getByText('보내지 않았어요')).toBeInTheDocument()
    expect(screen.getByText('11월 9일 오전 12:05')).toBeInTheDocument()
    expect(screen.getByText('전화번호를 확인할 수 없어 보내지 않았어요.')).toBeInTheDocument()

    // 크레딧·비용·잔액 등 숫자 노출 금지 확인
    const allText = document.body.textContent || ''
    expect(allText).not.toMatch(/크레딧|잔액|비용|\d+원/)
  })

  it('useKakaoHistory에 workspaceId, reservationId, customerId를 올바르게 전달한다', () => {
    mockUseKakaoHistory.mockReturnValue({
      items: [],
      load: 'ready',
      refresh: refreshMock,
    })

    render(<KakaoHistoryList workspaceId="ws-test" reservationId="res-test" customerId="cust-test" />)

    expect(mockUseKakaoHistory).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: 'ws-test',
        reservationId: 'res-test',
        customerId: 'cust-test',
      }),
    )
  })
})
