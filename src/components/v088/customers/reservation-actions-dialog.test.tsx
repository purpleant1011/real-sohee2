import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import React from 'react'
import { ReservationActionsDialog } from './reservation-actions-dialog'

describe('ReservationActionsDialog Component', () => {
  const defaultProps = {
    open: true,
    mode: 'cancel' as const,
    workspaceId: 'ws-123',
    reservationId: 'res-456',
    customerName: '홍길동',
    customerPhone: '010-1234-5678',
    hasKakaoHistory: true,
    currentBookingStartsAt: '2026-11-20T14:00:00+09:00',
    onClose: vi.fn(),
    onDone: vi.fn(),
  }

  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('fetch', vi.fn())
  })

  describe('취소 모드 (mode="cancel")', () => {
    it('다이얼로그 타이틀과 textarea를 렌더링한다', () => {
      render(<ReservationActionsDialog {...defaultProps} mode="cancel" />)

      expect(screen.getByText('예약 취소')).toBeInTheDocument()
      expect(screen.getByLabelText(/취소 사유/i)).toBeInTheDocument()
    })

    it('알림톡 항목이 있거나 번호가 있을 때 "취소하면 고객에게 취소 안내가 카카오톡으로 가요" 문구를 보여준다', () => {
      render(
        <ReservationActionsDialog
          {...defaultProps}
          mode="cancel"
          customerPhone="010-1234-5678"
          hasKakaoHistory={false}
        />
      )
      expect(
        screen.getByText('취소하면 고객에게 취소 안내가 카카오톡으로 가요')
      ).toBeInTheDocument()

      const { unmount } = render(
        <ReservationActionsDialog
          {...defaultProps}
          mode="cancel"
          customerPhone=""
          hasKakaoHistory={true}
        />
      )
      expect(
        screen.getAllByText('취소하면 고객에게 취소 안내가 카카오톡으로 가요').length
      ).toBeGreaterThanOrEqual(1)
      unmount()
    })

    it('알림톡 항목도 없고 전화번호도 없을 때 "고객 연락처가 있으면 취소 안내가 카카오톡으로 갈 수 있어요" 문구를 보여준다', () => {
      render(
        <ReservationActionsDialog
          {...defaultProps}
          mode="cancel"
          customerPhone=""
          hasKakaoHistory={false}
        />
      )
      expect(
        screen.getByText('고객 연락처가 있으면 취소 안내가 카카오톡으로 갈 수 있어요')
      ).toBeInTheDocument()
    })

    it('취소 사유가 비어 있으면(공백 포함) 제출을 막고 에러 메시지를 표시한다', async () => {
      render(<ReservationActionsDialog {...defaultProps} mode="cancel" />)

      const submitBtn = screen.getByRole('button', { name: '예약 취소 확인' })
      fireEvent.click(submitBtn)

      expect(screen.getByText('취소 사유를 입력해 주세요.')).toBeInTheDocument()
      expect(fetch).not.toHaveBeenCalled()
    })

    it('취소 사유를 입력하고 제출하면 PATCH API를 올바른 payload로 호출하고 성공 시 onDone을 호출한다', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ ok: true, status: 'cancelled', reservationId: 'res-456' }),
      })
      vi.stubGlobal('fetch', mockFetch)

      const onDone = vi.fn()
      render(<ReservationActionsDialog {...defaultProps} mode="cancel" onDone={onDone} />)

      const textarea = screen.getByLabelText(/취소 사유/i)
      fireEvent.change(textarea, { target: { value: '고객 개인 사정 취소 요청' } })

      const submitBtn = screen.getByRole('button', { name: '예약 취소 확인' })
      fireEvent.click(submitBtn)

      await waitFor(() => {
        expect(mockFetch).toHaveBeenCalledWith(
          '/api/workspaces/ws-123/reservations/res-456',
          expect.objectContaining({
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              action: 'cancel',
              reason: '고객 개인 사정 취소 요청',
            }),
          })
        )
      })

      await waitFor(() => {
        expect(onDone).toHaveBeenCalled()
      })
    })

    it('서버 에러 발생 시 서버 오류 문구를 그대로 표시한다', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        json: async () => ({ error: '이미 취소된 예약입니다.' }),
      })
      vi.stubGlobal('fetch', mockFetch)

      render(<ReservationActionsDialog {...defaultProps} mode="cancel" />)

      const textarea = screen.getByLabelText(/취소 사유/i)
      fireEvent.change(textarea, { target: { value: '고객 요청' } })

      const submitBtn = screen.getByRole('button', { name: '예약 취소 확인' })
      fireEvent.click(submitBtn)

      await waitFor(() => {
        expect(screen.getByText('이미 취소된 예약입니다.')).toBeInTheDocument()
      })
    })

    it('제출 중일 때 이중 제출을 방지한다 (버튼 비활성화 및 fetch 1회 호출)', async () => {
      let resolvePromise: (val: any) => void
      const pendingPromise = new Promise((resolve) => {
        resolvePromise = resolve
      })
      const mockFetch = vi.fn().mockImplementation(() => pendingPromise)
      vi.stubGlobal('fetch', mockFetch)

      render(<ReservationActionsDialog {...defaultProps} mode="cancel" />)

      const textarea = screen.getByLabelText(/취소 사유/i)
      fireEvent.change(textarea, { target: { value: '고객 요청' } })

      const submitBtn = screen.getByRole('button', { name: '예약 취소 확인' })
      fireEvent.click(submitBtn)
      fireEvent.click(submitBtn)

      expect(mockFetch).toHaveBeenCalledTimes(1)
      expect(submitBtn).toBeDisabled()

      // cleanup
      resolvePromise!({
        ok: true,
        json: async () => ({ ok: true, status: 'cancelled' }),
      })
    })
  })

  describe('변경 모드 (mode="reschedule")', () => {
    it('다이얼로그 타이틀, datetime-local input 및 "변경 안내가 카카오톡으로 갈 수 있어요" 문구를 렌더링한다', () => {
      render(<ReservationActionsDialog {...defaultProps} mode="reschedule" />)

      expect(screen.getByText('예약 변경')).toBeInTheDocument()
      expect(screen.getByLabelText(/변경할 예약 일시/i)).toBeInTheDocument()
      expect(
        screen.getByText('변경 안내가 카카오톡으로 갈 수 있어요')
      ).toBeInTheDocument()
    })

    it('날짜 미입력 시 제출을 막고 에러 메시지를 표시한다', () => {
      render(
        <ReservationActionsDialog
          {...defaultProps}
          mode="reschedule"
          currentBookingStartsAt=""
        />
      )

      const dateInput = screen.getByLabelText(/변경할 예약 일시/i)
      fireEvent.change(dateInput, { target: { value: '' } })

      const submitBtn = screen.getByRole('button', { name: '예약 변경 확인' })
      fireEvent.click(submitBtn)

      expect(screen.getByText('변경할 예약 일시를 입력해 주세요.')).toBeInTheDocument()
      expect(fetch).not.toHaveBeenCalled()
    })

    it('일시를 입력하고 제출하면 PATCH API를 action="reschedule"로 호출하고 성공 시 onDone을 호출한다', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ ok: true, status: 'rescheduled', reservationId: 'res-456' }),
      })
      vi.stubGlobal('fetch', mockFetch)

      const onDone = vi.fn()
      render(<ReservationActionsDialog {...defaultProps} mode="reschedule" onDone={onDone} />)

      const dateInput = screen.getByLabelText(/변경할 예약 일시/i)
      fireEvent.change(dateInput, { target: { value: '2026-11-25T16:00' } })

      const submitBtn = screen.getByRole('button', { name: '예약 변경 확인' })
      fireEvent.click(submitBtn)

      await waitFor(() => {
        expect(mockFetch).toHaveBeenCalledWith(
          '/api/workspaces/ws-123/reservations/res-456',
          expect.objectContaining({
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              action: 'reschedule',
              bookingStartsAt: '2026-11-25T16:00',
            }),
          })
        )
      })

      await waitFor(() => {
        expect(onDone).toHaveBeenCalled()
      })
    })

    it('서버 오류 발생 시 서버 오류 문구를 그대로 표시한다', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        json: async () => ({ error: '기존 예약 일시와 동일합니다.' }),
      })
      vi.stubGlobal('fetch', mockFetch)

      render(<ReservationActionsDialog {...defaultProps} mode="reschedule" />)

      const dateInput = screen.getByLabelText(/변경할 예약 일시/i)
      fireEvent.change(dateInput, { target: { value: '2026-11-25T16:00' } })

      const submitBtn = screen.getByRole('button', { name: '예약 변경 확인' })
      fireEvent.click(submitBtn)

      await waitFor(() => {
        expect(screen.getByText('기존 예약 일시와 동일합니다.')).toBeInTheDocument()
      })
    })
  })

  describe('거절 모드 (mode="decline")', () => {
    it('다이얼로그 타이틀과 textarea를 렌더링하고 별도 알림톡 미발송 안내를 보여준다', () => {
      render(<ReservationActionsDialog {...defaultProps} mode="decline" />)

      expect(screen.getByText('예약 신청 거절')).toBeInTheDocument()
      expect(screen.getByLabelText(/거절 사유/i)).toBeInTheDocument()
      expect(
        screen.getByText('예약 신청을 거절해요. 별도의 취소 안내 알림톡은 발송되지 않아요.')
      ).toBeInTheDocument()
    })

    it('거절 사유가 비어 있으면 제출을 막고 에러 메시지를 표시한다', () => {
      render(<ReservationActionsDialog {...defaultProps} mode="decline" />)

      const submitBtn = screen.getByRole('button', { name: '신청 거절' })
      fireEvent.click(submitBtn)

      expect(screen.getByText('거절 사유를 입력해 주세요.')).toBeInTheDocument()
      expect(fetch).not.toHaveBeenCalled()
    })

    it('거절 사유를 입력하고 제출하면 action: decline으로 PATCH API를 호출한다', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ ok: true, status: 'declined', reservationId: 'res-456' }),
      })
      vi.stubGlobal('fetch', mockFetch)

      const onDone = vi.fn()
      render(<ReservationActionsDialog {...defaultProps} mode="decline" onDone={onDone} />)

      const textarea = screen.getByLabelText(/거절 사유/i)
      fireEvent.change(textarea, { target: { value: '영업 시간 마감' } })

      const submitBtn = screen.getByRole('button', { name: '신청 거절' })
      fireEvent.click(submitBtn)

      await waitFor(() => {
        expect(mockFetch).toHaveBeenCalledWith(
          '/api/workspaces/ws-123/reservations/res-456',
          expect.objectContaining({
            method: 'PATCH',
            body: JSON.stringify({
              action: 'decline',
              reason: '영업 시간 마감',
            }),
          })
        )
        expect(onDone).toHaveBeenCalled()
      })
    })
  })
})
