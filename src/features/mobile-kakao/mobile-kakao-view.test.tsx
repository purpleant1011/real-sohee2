import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import React from 'react'
import { MobileKakaoView } from './mobile-kakao-view'
import * as useKakaoHistoryModule from '@/features/kakao/history/use-kakao-history'
import type { KakaoHistoryItem } from '@/features/kakao/history/contract'

describe('MobileKakaoView', () => {
  const mockRefresh = vi.fn()

  const fixtureItems: KakaoHistoryItem[] = [
    {
      id: 'k1',
      reservationId: 'res-1',
      event: 'BOOKING_CONFIRMED',
      eventLabel: '예약 확정 안내',
      status: 'DELIVERED',
      statusLabel: '도착 확인',
      detailLabel: null,
      dueAt: '2026-11-09T01:00:00Z',
      updatedAt: '2026-11-09T01:05:00Z',
    },
    {
      id: 'k2',
      reservationId: 'res-2',
      event: 'REMINDER_24H',
      eventLabel: '방문 하루 전 안내',
      status: 'SENT',
      statusLabel: '보냈어요',
      detailLabel: '도착 여부를 확인하고 있어요.',
      dueAt: '2026-11-09T02:00:00Z',
      updatedAt: '2026-11-09T02:01:00Z',
    },
    {
      id: 'k3',
      reservationId: 'res-3',
      event: 'BOOKING_CHANGED',
      eventLabel: '예약 변경 안내',
      status: 'NEEDS_CHECK',
      statusLabel: '확인이 필요해요',
      detailLabel: '발송 결과를 확인하지 못했어요.',
      dueAt: '2026-11-09T03:00:00Z',
      updatedAt: '2026-11-09T03:01:00Z',
    },
    {
      id: 'k4',
      reservationId: 'res-4',
      event: 'REMINDER_2H',
      eventLabel: '방문 2시간 전 안내',
      status: 'HELD',
      statusLabel: '보내지 않았어요',
      detailLabel: '조건이 맞지 않아 보내지 않았어요.',
      dueAt: '2026-11-09T04:00:00Z',
      updatedAt: '2026-11-09T04:01:00Z',
    },
    {
      id: 'k5',
      reservationId: 'res-5',
      event: 'BOOKING_CANCELLED',
      eventLabel: '예약 취소 안내',
      status: 'CANCELLED',
      statusLabel: '취소됐어요',
      detailLabel: '예약 일정이 바뀌어 이 안내는 취소됐어요.',
      dueAt: '2026-11-09T05:00:00Z',
      updatedAt: '2026-11-09T05:01:00Z',
    },
  ]

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('쉬운 한국어 도움말 한 줄을 정확히 렌더링한다', () => {
    vi.spyOn(useKakaoHistoryModule, 'useKakaoHistory').mockReturnValue({
      items: fixtureItems,
      load: 'ready',
      refresh: mockRefresh,
    })

    render(<MobileKakaoView workspaceId="ws-test" />)

    expect(
      screen.getByText('고객에게 보낸 예약 안내를 확인하는 곳이에요. 보내지 않은 안내는 이유가 함께 표시돼요.')
    ).toBeInTheDocument()
  })

  it('상단 요약에 도착확인/보냄/확인필요/보내지 않음/취소 건수를 표시한다', () => {
    vi.spyOn(useKakaoHistoryModule, 'useKakaoHistory').mockReturnValue({
      items: fixtureItems,
      load: 'ready',
      refresh: mockRefresh,
    })

    render(<MobileKakaoView workspaceId="ws-test" />)

    expect(screen.getByTestId('mobile-summary-delivered')).toHaveTextContent('1')
    expect(screen.getByTestId('mobile-summary-sent')).toHaveTextContent('1')
    expect(screen.getByTestId('mobile-summary-needs-check')).toHaveTextContent('1')
    expect(screen.getByTestId('mobile-summary-held')).toHaveTextContent('1')
    expect(screen.getByTestId('mobile-summary-cancelled')).toHaveTextContent('1')
  })

  it('크레딧, 비용, 잔액 관련 문구가 일체 노출되지 않는다', () => {
    vi.spyOn(useKakaoHistoryModule, 'useKakaoHistory').mockReturnValue({
      items: fixtureItems,
      load: 'ready',
      refresh: mockRefresh,
    })

    const { container } = render(<MobileKakaoView workspaceId="ws-test" />)
    const text = container.textContent ?? ''

    expect(text).not.toMatch(/크레딧/i)
    expect(text).not.toMatch(/잔액/i)
    expect(text).not.toMatch(/비용/i)
  })

  it('필터 칩(전체, 보낸 것, 확인 필요, 보내지 않은 것) 클릭 시 목록 카드가 필터링된다', () => {
    vi.spyOn(useKakaoHistoryModule, 'useKakaoHistory').mockReturnValue({
      items: fixtureItems,
      load: 'ready',
      refresh: mockRefresh,
    })

    render(<MobileKakaoView workspaceId="ws-test" />)

    expect(screen.getByText('예약 확정 안내')).toBeInTheDocument()
    expect(screen.getByText('방문 하루 전 안내')).toBeInTheDocument()

    // '보낸 것' 칩 클릭
    fireEvent.click(screen.getByRole('button', { name: '보낸 것' }))
    expect(screen.getByText('예약 확정 안내')).toBeInTheDocument()
    expect(screen.getByText('방문 하루 전 안내')).toBeInTheDocument()
    expect(screen.queryByText('예약 변경 안내')).not.toBeInTheDocument()

    // '확인 필요' 칩 클릭
    fireEvent.click(screen.getByRole('button', { name: '확인 필요' }))
    expect(screen.getByText('예약 변경 안내')).toBeInTheDocument()
    expect(screen.queryByText('예약 확정 안내')).not.toBeInTheDocument()

    // '보내지 않은 것' 칩 클릭
    fireEvent.click(screen.getByRole('button', { name: '보내지 않은 것' }))
    expect(screen.getByText('방문 2시간 전 안내')).toBeInTheDocument()
    expect(screen.getByText('예약 취소 안내')).toBeInTheDocument()
    expect(screen.queryByText('예약 변경 안내')).not.toBeInTheDocument()
  })

  it('로딩 중일 때 모바일 스켈레톤 UI를 보여준다', () => {
    vi.spyOn(useKakaoHistoryModule, 'useKakaoHistory').mockReturnValue({
      items: [],
      load: 'loading',
      refresh: mockRefresh,
    })

    render(<MobileKakaoView workspaceId="ws-test" />)
    expect(screen.getByRole('status', { name: '발송내역을 불러오는 중입니다' })).toBeInTheDocument()
  })

  it('조회 실패 시 오류 알림과 다시 시도 버튼을 노출하며 0건으로 위장하지 않는다', () => {
    vi.spyOn(useKakaoHistoryModule, 'useKakaoHistory').mockReturnValue({
      items: [],
      load: 'error',
      refresh: mockRefresh,
    })

    render(<MobileKakaoView workspaceId="ws-test" />)
    expect(screen.getByRole('alert')).toBeInTheDocument()
    expect(screen.getByText('발송내역을 불러오지 못했어요')).toBeInTheDocument()
    expect(screen.queryByText('아직 보낸 안내가 없어요')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '다시 시도' }))
    expect(mockRefresh).toHaveBeenCalledTimes(1)
  })

  it('하단 고정 버튼(Fixed CTA)이 존재하지 않는다', () => {
    vi.spyOn(useKakaoHistoryModule, 'useKakaoHistory').mockReturnValue({
      items: fixtureItems,
      load: 'ready',
      refresh: mockRefresh,
    })

    const { container } = render(<MobileKakaoView workspaceId="ws-test" />)
    expect(container.querySelector('[data-slot="fixed-bottom-cta"]')).toBeNull()
    expect(container.querySelector('.fixed.bottom-0')).toBeNull()
  })
})
