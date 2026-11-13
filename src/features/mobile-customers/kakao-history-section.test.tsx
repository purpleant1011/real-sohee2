// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { KakaoHistorySection, formatKakaoHistoryTime } from './kakao-history-section'
import type { KakaoHistoryItem } from '@/features/kakao/history/contract'
import * as useKakaoHistoryModule from '@/features/kakao/history/use-kakao-history'

vi.mock('@/features/kakao/history/use-kakao-history')

describe('formatKakaoHistoryTime', () => {
  it('KST 기준으로 M월 D일 오전|오후 H:MM 형식으로 포맷한다', () => {
    // 2026-05-12T05:30:00Z -> KST 14:30 -> 5월 12일 오후 2:30
    expect(formatKakaoHistoryTime('2026-05-12T05:30:00Z')).toBe('5월 12일 오후 2:30')
    // 2026-11-09T00:00:00+09:00 -> KST 00:00 -> 11월 9일 오전 12:00
    expect(formatKakaoHistoryTime('2026-11-09T00:00:00+09:00')).toBe('11월 9일 오전 12:00')
    // 2026-11-09T12:00:00+09:00 -> KST 12:00 -> 11월 9일 오후 12:00
    expect(formatKakaoHistoryTime('2026-11-09T12:00:00+09:00')).toBe('11월 9일 오후 12:00')
    // 2026-11-09T00:05:00Z -> KST 09:05 -> 11월 9일 오전 9:05
    expect(formatKakaoHistoryTime('2026-11-09T00:05:00Z')).toBe('11월 9일 오전 9:05')
  })

  it('잘못된 입력은 빈 문자열을 반환한다', () => {
    expect(formatKakaoHistoryTime('invalid-date')).toBe('')
    expect(formatKakaoHistoryTime('')).toBe('')
  })
})

describe('KakaoHistorySection', () => {
  const mockRefresh = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('로딩 중일 때는 로딩 상태를 표시하고 빈 상태나 에러 문구를 노출하지 않는다', () => {
    vi.spyOn(useKakaoHistoryModule, 'useKakaoHistory').mockReturnValue({
      items: [],
      load: 'loading',
      refresh: mockRefresh,
    })

    render(<KakaoHistorySection workspaceId="ws-1" customerId="c-1" />)

    expect(screen.getByText('카카오 안내 발송내역')).toBeTruthy()
    expect(screen.getByText(/불러오는 중/)).toBeTruthy()
    expect(screen.queryByText('아직 보낸 안내가 없어요')).toBeNull()
    expect(screen.queryByText(/불러오지 못했어요/)).toBeNull()
  })

  it('오류 발생 시 "불러오지 못했어요"와 다시 시도 버튼을 노출하며 오류를 "없음"으로 표시하지 않는다', () => {
    vi.spyOn(useKakaoHistoryModule, 'useKakaoHistory').mockReturnValue({
      items: [],
      load: 'error',
      refresh: mockRefresh,
    })

    render(<KakaoHistorySection workspaceId="ws-1" customerId="c-1" />)

    expect(screen.getByText(/불러오지 못했어요/)).toBeTruthy()
    expect(screen.queryByText('아직 보낸 안내가 없어요')).toBeNull()

    const retryButton = screen.getByRole('button', { name: '다시 시도' })
    expect(retryButton).toBeTruthy()
    expect(retryButton.className).toContain('min-h-11') // 44px 터치 대상

    fireEvent.click(retryButton)
    expect(mockRefresh).toHaveBeenCalledTimes(1)
  })

  it('발송 내역이 비어 있을 때 "아직 보낸 안내가 없어요"를 표시한다', () => {
    vi.spyOn(useKakaoHistoryModule, 'useKakaoHistory').mockReturnValue({
      items: [],
      load: 'ready',
      refresh: mockRefresh,
    })

    render(<KakaoHistorySection workspaceId="ws-1" customerId="c-1" />)

    expect(screen.getByText('아직 보낸 안내가 없어요')).toBeTruthy()
    expect(screen.queryByText(/불러오지 못했어요/)).toBeNull()
  })

  it('발송 내역 목록을 올바른 라벨, 상태 배지, 시각, 상세 설명으로 렌더링한다', () => {
    const items: KakaoHistoryItem[] = [
      {
        id: 'h1',
        reservationId: 'r1',
        event: 'BOOKING_CONFIRMED',
        eventLabel: '예약 확정 안내',
        status: 'DELIVERED',
        statusLabel: '도착 확인',
        detailLabel: null,
        dueAt: '2026-05-12T05:30:00Z',
        updatedAt: '2026-05-12T05:30:10Z',
      },
      {
        id: 'h2',
        reservationId: 'r1',
        event: 'REMINDER_24H',
        eventLabel: '방문 하루 전 안내',
        status: 'FAILED',
        statusLabel: '전달 실패',
        detailLabel: '카카오톡 전달에 실패했어요.',
        dueAt: '2026-11-09T00:00:00Z',
        updatedAt: '2026-11-09T00:00:05Z',
      },
      {
        id: 'h3',
        reservationId: 'r2',
        event: 'BOOKING_CHANGED',
        eventLabel: '예약 변경 안내',
        status: 'SCHEDULED',
        statusLabel: '발송 예정',
        detailLabel: null,
        dueAt: '2026-11-10T01:00:00Z',
        updatedAt: '2026-11-09T02:00:00Z',
      },
    ]

    vi.spyOn(useKakaoHistoryModule, 'useKakaoHistory').mockReturnValue({
      items,
      load: 'ready',
      refresh: mockRefresh,
    })

    const { container } = render(<KakaoHistorySection workspaceId="ws-1" customerId="c-1" />)

    // 이벤트 라벨
    expect(screen.getByText('예약 확정 안내')).toBeTruthy()
    expect(screen.getByText('방문 하루 전 안내')).toBeTruthy()
    expect(screen.getByText('예약 변경 안내')).toBeTruthy()

    // 상태 배지
    expect(screen.getByText('도착 확인')).toBeTruthy()
    expect(screen.getByText('전달 실패')).toBeTruthy()
    expect(screen.getByText('발송 예정')).toBeTruthy()

    // 상태 배지 색상 토큰
    const deliveredBadge = screen.getByText('도착 확인')
    expect(deliveredBadge.className).toContain('text-state-ok')

    const failedBadge = screen.getByText('전달 실패')
    expect(failedBadge.className).toContain('text-state-danger')

    // 시각 KST
    expect(screen.getByText('5월 12일 오후 2:30')).toBeTruthy()
    expect(screen.getByText('11월 9일 오전 9:00')).toBeTruthy()

    // 상세 설명
    expect(screen.getByText('카카오톡 전달에 실패했어요.')).toBeTruthy()

    // 크레딧·비용 숫자 금지 규칙
    expect(container.textContent).not.toMatch(/크레딧|잔액|비용|\b\d+원\b/)
  })
})
