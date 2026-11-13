// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import {
  MobileReservationManageSheet,
  type ManageReservationTarget,
} from './reservation-manage-sheet'
import { toast } from 'sonner'

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
    info: vi.fn(),
  },
}))

describe('MobileReservationManageSheet', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  const mockReservation: ManageReservationTarget = {
    id: 'res-123',
    customerName: '김민지',
    serviceLabel: '속눈썹펌',
    startsAt: '2026-10-23T05:00:00Z',
    endsAt: '2026-10-23T06:00:00Z',
  }

  it('열리면 예약 정보(고객명, 서비스명)와 일정 변경 탭이 기본으로 표시된다', () => {
    render(
      <MobileReservationManageSheet
        open={true}
        onOpenChange={vi.fn()}
        workspaceId="ws-1"
        reservation={mockReservation}
      />
    )

    expect(screen.getByRole('dialog')).toBeDefined()
    expect(screen.getByRole('heading', { name: '예약 관리' })).toBeDefined()
    expect(screen.getByText('김민지 · 속눈썹펌')).toBeDefined()
    expect(screen.getByRole('tab', { name: '일정 변경' })).toBeDefined()
    expect(screen.getByRole('tab', { name: '예약 취소' })).toBeDefined()
    expect(screen.getByText('변경 안내가 카카오톡으로 갈 수 있어요')).toBeDefined()
    expect(screen.getByLabelText(/변경할 예약 일시/i)).toBeDefined()
  })

  it('일정 변경 시 변경할 일시가 비어 있으면 에러를 표시하고 API 호출을 막는다', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    render(
      <MobileReservationManageSheet
        open={true}
        onOpenChange={vi.fn()}
        workspaceId="ws-1"
        reservation={mockReservation}
      />
    )

    const dateInput = screen.getByLabelText(/변경할 예약 일시/i)
    fireEvent.change(dateInput, { target: { value: '' } })

    fireEvent.click(screen.getByRole('button', { name: '일정 변경' }))

    expect(screen.getByText('변경할 예약 일시를 입력해 주세요.')).toBeDefined()
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('일정 변경 성공 시 PATCH 요청을 보내고 토스트 및 onDone을 호출한다', async () => {
    const handleDone = vi.fn()
    const handleOpenChange = vi.fn()
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(
        JSON.stringify({ ok: true, status: 'rescheduled', reservationId: 'res-123' }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
    )

    render(
      <MobileReservationManageSheet
        open={true}
        onOpenChange={handleOpenChange}
        workspaceId="ws-1"
        reservation={mockReservation}
        onDone={handleDone}
      />
    )

    const dateInput = screen.getByLabelText(/변경할 예약 일시/i)
    fireEvent.change(dateInput, { target: { value: '2026-10-24T15:00' } })

    fireEvent.click(screen.getByRole('button', { name: '일정 변경' }))

    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalledWith(
        '/api/workspaces/ws-1/reservations/res-123',
        expect.objectContaining({
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'reschedule',
            bookingStartsAt: '2026-10-24T15:00',
          }),
        })
      )
    })

    expect(toast.success).toHaveBeenCalledWith('예약 일정을 변경했어요.')
    expect(handleDone).toHaveBeenCalled()
    expect(handleOpenChange).toHaveBeenCalledWith(false)
  })

  it('일정 변경 실패 시 서버 에러 문구를 표시한다', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(
        JSON.stringify({ error: '기존 예약 일시와 동일합니다.' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      )
    )

    render(
      <MobileReservationManageSheet
        open={true}
        onOpenChange={vi.fn()}
        workspaceId="ws-1"
        reservation={mockReservation}
      />
    )

    const dateInput = screen.getByLabelText(/변경할 예약 일시/i)
    fireEvent.change(dateInput, { target: { value: '2026-10-23T14:00' } })

    fireEvent.click(screen.getByRole('button', { name: '일정 변경' }))

    await waitFor(() => {
      expect(screen.getByText('기존 예약 일시와 동일합니다.')).toBeDefined()
    })
  })

  it('예약 취소 탭으로 전환하면 사유 입력창이 나타나고, 빈 사유로 취소 시도 시 에러를 표시한다', () => {
    render(
      <MobileReservationManageSheet
        open={true}
        onOpenChange={vi.fn()}
        workspaceId="ws-1"
        reservation={mockReservation}
      />
    )

    fireEvent.click(screen.getByRole('tab', { name: '예약 취소' }))

    expect(screen.getByLabelText(/취소 사유/i)).toBeDefined()

    fireEvent.click(screen.getByRole('button', { name: '예약 취소' }))
    expect(screen.getByText('취소 사유를 입력해 주세요.')).toBeDefined()
  })

  it('취소 사유 입력 후 취소 시도 시 2단계 확인 문구가 나타나고, 돌아가기를 누르면 복귀한다', () => {
    render(
      <MobileReservationManageSheet
        open={true}
        onOpenChange={vi.fn()}
        workspaceId="ws-1"
        reservation={mockReservation}
      />
    )

    fireEvent.click(screen.getByRole('tab', { name: '예약 취소' }))

    const reasonInput = screen.getByLabelText(/취소 사유/i)
    fireEvent.change(reasonInput, { target: { value: '고객 일정 변경 요청' } })

    fireEvent.click(screen.getByRole('button', { name: '예약 취소' }))

    // 2단계 확인 안내 문구 확인
    expect(
      screen.getByText(
        '정말 취소할까요? 고객 연락처가 있으면 취소 안내가 카카오톡으로 갈 수 있어요'
      )
    ).toBeDefined()
    expect(screen.getByRole('button', { name: '네, 취소할게요' })).toBeDefined()
    expect(screen.getByRole('button', { name: '돌아가기' })).toBeDefined()

    // 돌아가기 클릭 시 2단계 확인 해제
    fireEvent.click(screen.getByRole('button', { name: '돌아가기' }))
    expect(
      screen.queryByText(
        '정말 취소할까요? 고객 연락처가 있으면 취소 안내가 카카오톡으로 갈 수 있어요'
      )
    ).toBeNull()
  })

  it('2단계 확인 후 취소 확정 시 PATCH 호출 후 성공 토스트 및 onDone을 호출한다', async () => {
    const handleDone = vi.fn()
    const handleOpenChange = vi.fn()
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(
        JSON.stringify({ ok: true, status: 'cancelled', reservationId: 'res-123' }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
    )

    render(
      <MobileReservationManageSheet
        open={true}
        onOpenChange={handleOpenChange}
        workspaceId="ws-1"
        reservation={mockReservation}
        onDone={handleDone}
      />
    )

    fireEvent.click(screen.getByRole('tab', { name: '예약 취소' }))

    const reasonInput = screen.getByLabelText(/취소 사유/i)
    fireEvent.change(reasonInput, { target: { value: '고객 사정으로 취소' } })

    fireEvent.click(screen.getByRole('button', { name: '예약 취소' }))
    fireEvent.click(screen.getByRole('button', { name: '네, 취소할게요' }))

    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalledWith(
        '/api/workspaces/ws-1/reservations/res-123',
        expect.objectContaining({
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'cancel',
            reason: '고객 사정으로 취소',
          }),
        })
      )
    })

    expect(toast.success).toHaveBeenCalledWith('예약이 취소되었습니다.')
    expect(handleDone).toHaveBeenCalled()
    expect(handleOpenChange).toHaveBeenCalledWith(false)
  })

  it('이미 취소된 건(status: already) 응답 시 안내 토스트를 띄우고 종료한다', async () => {
    const handleDone = vi.fn()
    const handleOpenChange = vi.fn()
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(
        JSON.stringify({ ok: true, status: 'already', reservationId: 'res-123' }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
    )

    render(
      <MobileReservationManageSheet
        open={true}
        onOpenChange={handleOpenChange}
        workspaceId="ws-1"
        reservation={mockReservation}
        onDone={handleDone}
      />
    )

    fireEvent.click(screen.getByRole('tab', { name: '예약 취소' }))
    fireEvent.change(screen.getByLabelText(/취소 사유/i), {
      target: { value: '중복 취소 테스트' },
    })
    fireEvent.click(screen.getByRole('button', { name: '예약 취소' }))
    fireEvent.click(screen.getByRole('button', { name: '네, 취소할게요' }))

    await waitFor(() => {
      expect(toast.info).toHaveBeenCalledWith('이미 취소된 예약입니다.')
    })
    expect(handleDone).toHaveBeenCalled()
    expect(handleOpenChange).toHaveBeenCalledWith(false)
  })

  it('예시 화면(preview-*)에서는 제출이 비활성화되고 안내 문구를 표시한다', () => {
    render(
      <MobileReservationManageSheet
        open={true}
        onOpenChange={vi.fn()}
        workspaceId="preview-workspace"
        reservation={mockReservation}
      />
    )

    expect(
      screen.getByText(/예시 화면에서는 예약을 변경하거나 취소할 수 없어요/)
    ).toBeDefined()

    const submitBtn = screen.getByRole('button', { name: '일정 변경' }) as HTMLButtonElement
    expect(submitBtn.disabled).toBe(true)

    fireEvent.click(screen.getByRole('tab', { name: '예약 취소' }))
    const cancelBtn = screen.getByRole('button', { name: '예약 취소' }) as HTMLButtonElement
    expect(cancelBtn.disabled).toBe(true)
  })

  it('reservation이 null이면 아무것도 렌더링하지 않는다', () => {
    const { container } = render(
      <MobileReservationManageSheet
        open={true}
        onOpenChange={vi.fn()}
        workspaceId="ws-1"
        reservation={null}
      />
    )

    expect(container.innerHTML).toBe('')
  })

  describe('확정 대기 신청 (status="pending_confirmation")', () => {
    const awaitingReservation: ManageReservationTarget = {
      ...mockReservation,
      id: 'res-req-999',
      status: 'pending_confirmation',
    }

    it('열리면 신청 확정 및 신청 거절 탭이 표시된다', () => {
      render(
        <MobileReservationManageSheet
          open={true}
          onOpenChange={vi.fn()}
          workspaceId="ws-1"
          reservation={awaitingReservation}
        />
      )

      expect(screen.getByRole('heading', { name: '예약 신청 관리' })).toBeDefined()
      expect(screen.getByRole('tab', { name: '신청 확정' })).toBeDefined()
      expect(screen.getByRole('tab', { name: '신청 거절' })).toBeDefined()
      expect(screen.getByRole('button', { name: '예약 신청 확정' })).toBeDefined()
    })

    it('신청 확정 버튼 클릭 시 PATCH action: confirm을 호출하고 성공 토스트를 띄운다', async () => {
      const handleDone = vi.fn()
      const handleOpenChange = vi.fn()
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response(
          JSON.stringify({ ok: true, status: 'confirmed', reservationId: 'res-req-999' }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        )
      )

      render(
        <MobileReservationManageSheet
          open={true}
          onOpenChange={handleOpenChange}
          workspaceId="ws-1"
          reservation={awaitingReservation}
          onDone={handleDone}
        />
      )

      fireEvent.click(screen.getByRole('button', { name: '예약 신청 확정' }))

      await waitFor(() => {
        expect(fetchSpy).toHaveBeenCalledWith(
          '/api/workspaces/ws-1/reservations/res-req-999',
          expect.objectContaining({
            method: 'PATCH',
            body: JSON.stringify({ action: 'confirm' }),
          })
        )
      })

      expect(toast.success).toHaveBeenCalledWith('예약 신청을 확정했어요.')
      expect(handleDone).toHaveBeenCalled()
      expect(handleOpenChange).toHaveBeenCalledWith(false)
    })

    it('신청 거절 탭에서 사유를 입력하고 거절 버튼을 누르면 action: decline을 호출한다', async () => {
      const handleDone = vi.fn()
      const handleOpenChange = vi.fn()
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response(
          JSON.stringify({ ok: true, status: 'declined', reservationId: 'res-req-999' }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        )
      )

      render(
        <MobileReservationManageSheet
          open={true}
          onOpenChange={handleOpenChange}
          workspaceId="ws-1"
          reservation={awaitingReservation}
          onDone={handleDone}
        />
      )

      fireEvent.click(screen.getByRole('tab', { name: '신청 거절' }))

      const textarea = screen.getByLabelText(/거절 사유/i)
      fireEvent.change(textarea, { target: { value: '해당 일자 예약 마감' } })

      fireEvent.click(screen.getByRole('button', { name: '예약 신청 거절' }))

      await waitFor(() => {
        expect(fetchSpy).toHaveBeenCalledWith(
          '/api/workspaces/ws-1/reservations/res-req-999',
          expect.objectContaining({
            method: 'PATCH',
            body: JSON.stringify({
              action: 'decline',
              reason: '해당 일자 예약 마감',
            }),
          })
        )
      })

      expect(toast.success).toHaveBeenCalledWith('예약 신청을 거절했어요.')
      expect(handleDone).toHaveBeenCalled()
      expect(handleOpenChange).toHaveBeenCalledWith(false)
    })
  })

  it('일정 변경 중 네트워크 오류가 발생하면 에러 문구를 표시한다', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(
      new Error('네트워크 연결이 원활하지 않습니다.')
    )

    render(
      <MobileReservationManageSheet
        open={true}
        onOpenChange={vi.fn()}
        workspaceId="ws-1"
        reservation={mockReservation}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: '일정 변경' }))

    await waitFor(() => {
      expect(screen.getByText('네트워크 연결이 원활하지 않습니다.')).toBeDefined()
    })
  })

  it('예약 취소 중 네트워크 오류가 발생하면 에러 문구를 표시한다', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(
      new Error('네트워크 연결이 원활하지 않습니다.')
    )

    render(
      <MobileReservationManageSheet
        open={true}
        onOpenChange={vi.fn()}
        workspaceId="ws-1"
        reservation={mockReservation}
      />
    )

    fireEvent.click(screen.getByRole('tab', { name: '예약 취소' }))
    fireEvent.change(screen.getByLabelText(/취소 사유/i), {
      target: { value: '네트워크 에러 테스트 사유' },
    })
    fireEvent.click(screen.getByRole('button', { name: '예약 취소' }))
    fireEvent.click(screen.getByRole('button', { name: '네, 취소할게요' }))

    await waitFor(() => {
      expect(screen.getByText('네트워크 연결이 원활하지 않습니다.')).toBeDefined()
    })
  })
})
