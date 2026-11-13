import { render, screen, fireEvent } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ReservationDialog } from './reservation-dialog'

describe('ReservationDialog Component', () => {
  it('renders initial values and handles submit', () => {
    const handleConfirm = vi.fn()
    render(
      <ReservationDialog
        open={true}
        onClose={vi.fn()}
        defaultCustomerName="hoceol339"
        defaultSuggestedTime="2026-10-20 14:00"
        onConfirm={handleConfirm}
      />
    )

    expect(screen.getByText(/예약 확정 등록/i)).toBeDefined()
    const nameInput = screen.getByLabelText(/고객명/i) as HTMLInputElement
    expect(nameInput.value).toBe('hoceol339')

    const confirmBtn = screen.getByRole('button', { name: /확정 등록/i })
    fireEvent.click(confirmBtn)

    expect(handleConfirm).toHaveBeenCalledWith(
      expect.objectContaining({
        customerName: 'hoceol339',
        notifyConsentAttested: false,
      })
    )
  })

  it('연락처가 없을 때는 알림톡 고지 체크박스를 숨기고 제출 시 notifyConsentAttested: false 전달', () => {
    const handleConfirm = vi.fn()
    render(
      <ReservationDialog
        open={true}
        onClose={vi.fn()}
        defaultCustomerName="김고객"
        onConfirm={handleConfirm}
      />
    )

    expect(
      screen.queryByLabelText('고객에게 예약 안내 알림톡 발송 사실을 알렸습니다')
    ).toBeNull()
    expect(
      screen.queryByText('사장님이 확인한 내용이 기록되며, 알리지 않은 고객에게는 체크하지 마세요.')
    ).toBeNull()

    const confirmBtn = screen.getByRole('button', { name: /확정 등록/i })
    fireEvent.click(confirmBtn)

    expect(handleConfirm).toHaveBeenCalledWith(
      expect.objectContaining({
        customerName: '김고객',
        customerPhone: '',
        notifyConsentAttested: false,
      })
    )
  })

  it('연락처 입력 시 체크박스와 보조설명이 표시되고 기본값은 false', () => {
    render(
      <ReservationDialog
        open={true}
        onClose={vi.fn()}
        defaultCustomerName="김고객"
        onConfirm={vi.fn()}
      />
    )

    const phoneInput = screen.getByLabelText(/연락처/i)
    fireEvent.change(phoneInput, { target: { value: '010-1234-5678' } })

    const checkbox = screen.getByLabelText(
      '고객에게 예약 안내 알림톡 발송 사실을 알렸습니다'
    ) as HTMLInputElement
    expect(checkbox).toBeDefined()
    expect(checkbox.checked).toBe(false)
    expect(
      screen.getByText('사장님이 확인한 내용이 기록되며, 알리지 않은 고객에게는 체크하지 마세요.')
    ).toBeDefined()
  })

  it('연락처 입력 후 체크박스 체크 시 notifyConsentAttested: true 로 제출', () => {
    const handleConfirm = vi.fn()
    render(
      <ReservationDialog
        open={true}
        onClose={vi.fn()}
        defaultCustomerName="김고객"
        onConfirm={handleConfirm}
      />
    )

    const phoneInput = screen.getByLabelText(/연락처/i)
    fireEvent.change(phoneInput, { target: { value: '010-1234-5678' } })

    const checkbox = screen.getByLabelText(
      '고객에게 예약 안내 알림톡 발송 사실을 알렸습니다'
    ) as HTMLInputElement
    fireEvent.click(checkbox)
    expect(checkbox.checked).toBe(true)

    const confirmBtn = screen.getByRole('button', { name: /확정 등록/i })
    fireEvent.click(confirmBtn)

    expect(handleConfirm).toHaveBeenCalledWith(
      expect.objectContaining({
        customerName: '김고객',
        customerPhone: '010-1234-5678',
        notifyConsentAttested: true,
      })
    )
  })

  it('연락처 입력 후 체크했더라도 연락처를 지우면 체크박스가 숨겨지고 해제되며 제출값 false', () => {
    const handleConfirm = vi.fn()
    render(
      <ReservationDialog
        open={true}
        onClose={vi.fn()}
        defaultCustomerName="김고객"
        onConfirm={handleConfirm}
      />
    )

    const phoneInput = screen.getByLabelText(/연락처/i)
    fireEvent.change(phoneInput, { target: { value: '010-1234-5678' } })

    const checkbox = screen.getByLabelText(
      '고객에게 예약 안내 알림톡 발송 사실을 알렸습니다'
    ) as HTMLInputElement
    fireEvent.click(checkbox)
    expect(checkbox.checked).toBe(true)

    // 연락처를 공백으로 지움
    fireEvent.change(phoneInput, { target: { value: '   ' } })

    expect(
      screen.queryByLabelText('고객에게 예약 안내 알림톡 발송 사실을 알렸습니다')
    ).toBeNull()

    const confirmBtn = screen.getByRole('button', { name: /확정 등록/i })
    fireEvent.click(confirmBtn)

    expect(handleConfirm).toHaveBeenCalledWith(
      expect.objectContaining({
        customerName: '김고객',
        customerPhone: '',
        notifyConsentAttested: false,
      })
    )
  })

  it('전화번호 입력 시 숫자와 하이픈만 허용되고 도움말("010으로 시작하는 휴대폰 번호")이 표시된다', () => {
    render(
      <ReservationDialog
        open={true}
        onClose={vi.fn()}
        defaultCustomerName="김고객"
        onConfirm={vi.fn()}
      />
    )

    expect(screen.getByText('010으로 시작하는 휴대폰 번호')).toBeDefined()

    const phoneInput = screen.getByLabelText(/연락처/i) as HTMLInputElement
    fireEvent.change(phoneInput, { target: { value: '010-abcd-1234#$%' } })
    expect(phoneInput.value).toBe('010--1234')
  })

  it('잘못된 전화번호 형식 제출 시 제출을 막고 한국어 오류 문구를 표시한다', () => {
    const handleConfirm = vi.fn()
    render(
      <ReservationDialog
        open={true}
        onClose={vi.fn()}
        defaultCustomerName="김고객"
        onConfirm={handleConfirm}
      />
    )

    const phoneInput = screen.getByLabelText(/연락처/i)
    fireEvent.change(phoneInput, { target: { value: '011-1234-5678' } })

    const confirmBtn = screen.getByRole('button', { name: /확정 등록/i })
    fireEvent.click(confirmBtn)

    expect(screen.getByText(/전화번호를 확인해 주세요/i)).toBeDefined()
    expect(handleConfirm).not.toHaveBeenCalled()
  })
})
