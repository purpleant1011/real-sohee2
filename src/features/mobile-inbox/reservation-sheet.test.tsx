// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MobileReservationSheet } from './reservation-sheet'
import { toast } from 'sonner'

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
    info: vi.fn(),
  },
}))

describe('MobileReservationSheet', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('열리면 필드와 초기값이 표시된다', () => {
    render(
      <MobileReservationSheet
        open={true}
        onOpenChange={vi.fn()}
        workspaceId="ws-1"
        defaultSuggestedTime="2026-10-23 14:00"
      />
    )

    expect(screen.getByRole('dialog')).toBeDefined()
    expect(screen.getByRole('heading', { name: '예약 등록' })).toBeDefined()
    expect(screen.getByLabelText(/고객 이름/i)).toBeDefined()
    expect(screen.getByLabelText(/휴대폰 번호/i)).toBeDefined()
    expect(screen.getByLabelText(/서비스명/i)).toBeDefined()
    expect(screen.getByLabelText(/예약 일시/i)).toBeDefined()
    expect(screen.getByText(/010으로 시작하는 휴대폰 번호/i)).toBeDefined()
  })

  it('연락처가 없을 때는 알림톡 고지 체크박스를 숨기고 제출 시 notifyConsentAttested: false', async () => {
    const handleSuccess = vi.fn()
    const handleOpenChange = vi.fn()
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ ok: true, reservation: { id: 'res-1' }, consentEvidenceRecorded: false }), {
        status: 201,
        headers: { 'Content-Type': 'application/json' },
      })
    )

    render(
      <MobileReservationSheet
        open={true}
        onOpenChange={handleOpenChange}
        workspaceId="ws-1"
        onSuccess={handleSuccess}
      />
    )

    expect(screen.queryByLabelText('고객에게 예약 안내 알림톡 발송 사실을 알렸습니다')).toBeNull()

    fireEvent.change(screen.getByLabelText(/고객 이름/i), { target: { value: '김민지' } })
    fireEvent.change(screen.getByLabelText(/서비스명/i), { target: { value: '속눈썹펌' } })
    fireEvent.change(screen.getByLabelText(/예약 일시/i), { target: { value: '2026-12-01T14:00' } })

    const submitBtn = screen.getByRole('button', { name: '예약 등록' })
    fireEvent.click(submitBtn)

    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalledWith(
        '/api/workspaces/ws-1/reservations',
        expect.objectContaining({
          method: 'POST',
          body: expect.stringContaining('"notifyConsentAttested":false'),
        })
      )
    })
    expect(handleOpenChange).toHaveBeenCalledWith(false)
    expect(handleSuccess).toHaveBeenCalled()
  })

  it('연락처 입력 시에만 체크박스가 나타나고, 번호를 지우면 체크박스가 사라지고 해제된다', () => {
    render(
      <MobileReservationSheet
        open={true}
        onOpenChange={vi.fn()}
        workspaceId="ws-1"
      />
    )

    const phoneInput = screen.getByLabelText(/휴대폰 번호/i)
    fireEvent.change(phoneInput, { target: { value: '010-1234-5678' } })

    const checkbox = screen.getByLabelText('고객에게 예약 안내 알림톡 발송 사실을 알렸습니다') as HTMLInputElement
    expect(checkbox).toBeDefined()
    expect(checkbox.checked).toBe(false)
    expect(screen.getByText('사장님이 확인한 내용이 기록되며, 알리지 않은 고객에게는 체크하지 마세요.')).toBeDefined()

    fireEvent.click(checkbox)
    expect(checkbox.checked).toBe(true)

    // 번호를 지움
    fireEvent.change(phoneInput, { target: { value: '' } })
    expect(screen.queryByLabelText('고객에게 예약 안내 알림톡 발송 사실을 알렸습니다')).toBeNull()
  })

  it('전화번호 입력 시 숫자와 하이픈만 허용된다', () => {
    render(
      <MobileReservationSheet
        open={true}
        onOpenChange={vi.fn()}
        workspaceId="ws-1"
      />
    )

    const phoneInput = screen.getByLabelText(/휴대폰 번호/i) as HTMLInputElement
    fireEvent.change(phoneInput, { target: { value: '010-abcd-1234#$%' } })
    expect(phoneInput.value).toBe('010--1234')
  })

  it('잘못된 전화번호 형식일 경우 인라인 검증 오류를 표시하고 API 호출을 막는다', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    render(
      <MobileReservationSheet
        open={true}
        onOpenChange={vi.fn()}
        workspaceId="ws-1"
      />
    )

    fireEvent.change(screen.getByLabelText(/고객 이름/i), { target: { value: '김민지' } })
    fireEvent.change(screen.getByLabelText(/휴대폰 번호/i), { target: { value: '011-1234-5678' } })
    fireEvent.change(screen.getByLabelText(/예약 일시/i), { target: { value: '2026-12-01T14:00' } })

    fireEvent.click(screen.getByRole('button', { name: '예약 등록' }))

    expect(screen.getByText('전화번호를 확인해 주세요.')).toBeDefined()
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('고객명이 비어 있으면 오류를 표시하고 API 호출을 막는다', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    render(
      <MobileReservationSheet
        open={true}
        onOpenChange={vi.fn()}
        workspaceId="ws-1"
      />
    )

    fireEvent.change(screen.getByLabelText(/고객 이름/i), { target: { value: '   ' } })
    fireEvent.change(screen.getByLabelText(/예약 일시/i), { target: { value: '2026-12-01T14:00' } })
    fireEvent.click(screen.getByRole('button', { name: '예약 등록' }))

    expect(screen.getByText('고객명을 입력해 주세요.')).toBeDefined()
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('예시 화면(preview-*)에서는 제출이 비활성화되고 안내 문구를 표시한다', () => {
    render(
      <MobileReservationSheet
        open={true}
        onOpenChange={vi.fn()}
        workspaceId="preview-workspace"
      />
    )

    expect(screen.getByText(/예시 화면에서는 예약을 등록할 수 없어요/i)).toBeDefined()
    const submitBtn = screen.getByRole('button', { name: '예약 등록' }) as HTMLButtonElement
    expect(submitBtn.disabled).toBe(true)
  })

  it('서버가 400 에러를 반환하면 서버 에러 문구를 화면에 표시하고 시트를 닫지 않는다', async () => {
    const handleOpenChange = vi.fn()
    const handleSuccess = vi.fn()
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ error: '올바른 예약 일시를 입력해 주세요.' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      })
    )

    render(
      <MobileReservationSheet
        open={true}
        onOpenChange={handleOpenChange}
        workspaceId="ws-1"
        onSuccess={handleSuccess}
      />
    )

    fireEvent.change(screen.getByLabelText(/고객 이름/i), { target: { value: '김민지' } })
    fireEvent.change(screen.getByLabelText(/예약 일시/i), { target: { value: '2026-12-01T14:00' } })

    fireEvent.click(screen.getByRole('button', { name: '예약 등록' }))

    await waitFor(() => {
      expect(screen.getByText('올바른 예약 일시를 입력해 주세요.')).toBeDefined()
    })
    expect(handleOpenChange).not.toHaveBeenCalled()
    expect(handleSuccess).not.toHaveBeenCalled()
  })

  it('동의를 체크하고 등록 성공했으나 consentEvidenceRecorded: false 이면 안내 토스트를 띄운다', async () => {
    const handleOpenChange = vi.fn()
    const handleSuccess = vi.fn()
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ ok: true, reservation: { id: 'res-1' }, consentEvidenceRecorded: false }), {
        status: 201,
        headers: { 'Content-Type': 'application/json' },
      })
    )

    render(
      <MobileReservationSheet
        open={true}
        onOpenChange={handleOpenChange}
        workspaceId="ws-1"
        onSuccess={handleSuccess}
      />
    )

    fireEvent.change(screen.getByLabelText(/고객 이름/i), { target: { value: '김민지' } })
    fireEvent.change(screen.getByLabelText(/휴대폰 번호/i), { target: { value: '010-1234-5678' } })
    fireEvent.change(screen.getByLabelText(/예약 일시/i), { target: { value: '2026-12-01T14:00' } })
    const checkbox = screen.getByLabelText('고객에게 예약 안내 알림톡 발송 사실을 알렸습니다')
    fireEvent.click(checkbox)

    fireEvent.click(screen.getByRole('button', { name: '예약 등록' }))

    await waitFor(() => {
      expect(toast.warning).toHaveBeenCalledWith('예약은 저장됐지만 안내 확인 기록은 저장하지 못했어요')
    })
    expect(handleOpenChange).toHaveBeenCalledWith(false)
    expect(handleSuccess).toHaveBeenCalled()
  })

  it('동의를 체크하고 등록 성공했으며 consentEvidenceRecorded: true 이면 성공 토스트를 띄운다', async () => {
    const handleOpenChange = vi.fn()
    const handleSuccess = vi.fn()
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ ok: true, reservation: { id: 'res-1' }, consentEvidenceRecorded: true }), {
        status: 201,
        headers: { 'Content-Type': 'application/json' },
      })
    )

    render(
      <MobileReservationSheet
        open={true}
        onOpenChange={handleOpenChange}
        workspaceId="ws-1"
        onSuccess={handleSuccess}
      />
    )

    fireEvent.change(screen.getByLabelText(/고객 이름/i), { target: { value: '김민지' } })
    fireEvent.change(screen.getByLabelText(/휴대폰 번호/i), { target: { value: '010-1234-5678' } })
    fireEvent.change(screen.getByLabelText(/예약 일시/i), { target: { value: '2026-12-01T14:00' } })
    const checkbox = screen.getByLabelText('고객에게 예약 안내 알림톡 발송 사실을 알렸습니다')
    fireEvent.click(checkbox)

    fireEvent.click(screen.getByRole('button', { name: '예약 등록' }))

    await waitFor(() => {
      expect(toast.success).toHaveBeenCalledWith('예약이 등록되었습니다.')
    })
    expect(handleOpenChange).toHaveBeenCalledWith(false)
    expect(handleSuccess).toHaveBeenCalled()
  })

  it('서비스명이 비어 있으면 오류를 표시하고 API 호출을 막는다', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    render(
      <MobileReservationSheet
        open={true}
        onOpenChange={vi.fn()}
        workspaceId="ws-1"
        defaultServiceName=""
      />
    )

    fireEvent.change(screen.getByLabelText(/고객 이름/i), { target: { value: '김민지' } })
    fireEvent.change(screen.getByLabelText(/서비스명/i), { target: { value: '   ' } })
    fireEvent.change(screen.getByLabelText(/예약 일시/i), { target: { value: '2026-12-01T14:00' } })
    fireEvent.click(screen.getByRole('button', { name: '예약 등록' }))
    expect(screen.getByText('서비스명을 입력해 주세요.')).toBeDefined()
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('예약 일시가 비어 있으면 오류를 표시하고 API 호출을 막는다', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    render(
      <MobileReservationSheet
        open={true}
        onOpenChange={vi.fn()}
        workspaceId="ws-1"
      />
    )

    fireEvent.change(screen.getByLabelText(/고객 이름/i), { target: { value: '김민지' } })
    // 일시 필드는 기본 빈 값 그대로 두고 폼 제출
    const form = screen.getByRole('button', { name: '예약 등록' }).closest('form')!
    fireEvent.submit(form)
    expect(screen.getByText('예약 일시를 입력해 주세요.')).toBeDefined()
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('fetch 중 네트워크 오류가 발생하면 쉬운 한국어 에러 메시지를 표시한다', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new Error('네트워크 연결이 불안정합니다.'))

    render(
      <MobileReservationSheet
        open={true}
        onOpenChange={vi.fn()}
        workspaceId="ws-1"
      />
    )

    fireEvent.change(screen.getByLabelText(/고객 이름/i), { target: { value: '김민지' } })
    fireEvent.change(screen.getByLabelText(/예약 일시/i), { target: { value: '2026-12-01T14:00' } })
    fireEvent.click(screen.getByRole('button', { name: '예약 등록' }))

    await waitFor(() => {
      expect(screen.getByText('네트워크 연결이 불안정합니다.')).toBeDefined()
    })
  })
})
