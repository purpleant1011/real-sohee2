import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import BookingRequestClientForm from './booking-request-client-form'

describe('BookingRequestClientForm', () => {
  const defaultProps = {
    token: 'test.valid.token',
    storeName: '살롱 드 소희 강남본점',
  }

  beforeEach(() => {
    vi.resetAllMocks()
  })

  it('renders all form fields and required consent text', () => {
    render(<BookingRequestClientForm {...defaultProps} />)

    expect(screen.getByRole('heading', { name: '살롱 드 소희 강남본점' })).toBeInTheDocument()
    expect(screen.getByLabelText(/^이름/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/^휴대폰 번호/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/^희망 일시/i)).toBeInTheDocument()
    expect(
      screen.getByText(/예약 확인과 변경·취소 안내를 카카오톡으로 받기 위해 이름과 휴대폰 번호를 수집하며/i),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '예약 신청하기' })).toBeInTheDocument()
  })

  it('validates required fields before submitting', async () => {
    render(<BookingRequestClientForm {...defaultProps} />)

    // 1. Submit with empty name
    fireEvent.click(screen.getByRole('button', { name: '예약 신청하기' }))
    expect(screen.getByText('이름을 입력해 주세요.')).toBeInTheDocument()

    // 2. Fill name, submit with empty phone
    fireEvent.change(screen.getByLabelText(/^이름/i), { target: { value: '홍길동' } })
    fireEvent.click(screen.getByRole('button', { name: '예약 신청하기' }))
    expect(screen.getByText('휴대폰 번호를 입력해 주세요.')).toBeInTheDocument()

    // 3. Fill phone, submit with empty date
    fireEvent.change(screen.getByLabelText(/^휴대폰 번호/i), { target: { value: '010-1234-5678' } })
    fireEvent.click(screen.getByRole('button', { name: '예약 신청하기' }))
    expect(screen.getByText('희망 일시를 선택해 주세요.')).toBeInTheDocument()

    // 4. Fill date, submit without consent
    fireEvent.change(screen.getByLabelText(/^희망 일시/i), { target: { value: '2026-11-20T14:00' } })
    fireEvent.click(screen.getByRole('button', { name: '예약 신청하기' }))
    expect(screen.getByText('개인정보 수집 및 이용에 동의해 주세요.')).toBeInTheDocument()
  })

  it('displays success view when API responds with ok: true', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true }),
    })
    global.fetch = fetchMock

    render(<BookingRequestClientForm {...defaultProps} />)

    fireEvent.change(screen.getByLabelText(/^이름/i), { target: { value: '홍길동' } })
    fireEvent.change(screen.getByLabelText(/^휴대폰 번호/i), { target: { value: '010-1234-5678' } })
    fireEvent.change(screen.getByLabelText(/^희망 일시/i), { target: { value: '2026-11-20T14:00' } })
    fireEvent.click(screen.getByRole('checkbox'))

    fireEvent.click(screen.getByRole('button', { name: '예약 신청하기' }))

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: '신청이 접수됐어요.' })).toBeInTheDocument()
      expect(screen.getByText('매장에서 확인하면 카카오톡으로 안내드려요.')).toBeInTheDocument()
    })

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/public/booking-request',
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      }),
    )

    const sentBody = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect(sentBody).toMatchObject({
      token: 'test.valid.token',
      customerName: '홍길동',
      customerPhone: '010-1234-5678',
      desiredStartsAt: '2026-11-20T14:00',
      consent: true,
    })
  })

  it('displays server error message when API responds with error', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      json: async () => ({ ok: false, error: '단시간 내 예약 신청이 많습니다. 잠시 후 다시 시도해 주세요.' }),
    })
    global.fetch = fetchMock

    render(<BookingRequestClientForm {...defaultProps} />)

    fireEvent.change(screen.getByLabelText(/^이름/i), { target: { value: '홍길동' } })
    fireEvent.change(screen.getByLabelText(/^휴대폰 번호/i), { target: { value: '010-1234-5678' } })
    fireEvent.change(screen.getByLabelText(/^희망 일시/i), { target: { value: '2026-11-20T14:00' } })
    fireEvent.click(screen.getByRole('checkbox'))

    fireEvent.click(screen.getByRole('button', { name: '예약 신청하기' }))

    await waitFor(() => {
      expect(
        screen.getByText('단시간 내 예약 신청이 많습니다. 잠시 후 다시 시도해 주세요.'),
      ).toBeInTheDocument()
    })
  })
})
