import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { BillingStatusNotice } from './billing-status-notice'
import { OPERATOR_INFO } from '@/features/marketing/operator-information'

describe('BillingStatusNotice', () => {
  it('결제 실패 상태 시 결제 수단 확인 안내 문구와 고객센터(전화, 이메일)를 노출한다', () => {
    const handleAction = vi.fn()
    render(<BillingStatusNotice status="failed" onAction={handleAction} />)

    expect(screen.getByText('결제가 되지 않았어요. 결제 수단을 확인해 주세요')).toBeInTheDocument()
    expect(screen.getByText(new RegExp(OPERATOR_INFO.phone))).toBeInTheDocument()
    expect(screen.getByText(new RegExp(OPERATOR_INFO.supportEmail))).toBeInTheDocument()

    const actionBtn = screen.getByRole('button', { name: '결제 수단 다시 확인' })
    expect(actionBtn).toBeInTheDocument()
    fireEvent.click(actionBtn)
    expect(handleAction).toHaveBeenCalledTimes(1)
  })

  it('이용 중단 상태 시 이용 중단 안내 문구와 고객센터(전화, 이메일)를 노출한다', () => {
    render(<BillingStatusNotice status="suspended" />)

    expect(screen.getByText('서비스 이용이 잠시 멈췄어요')).toBeInTheDocument()
    expect(screen.getByText(/결제 정보를 확인하시면 바로 다시 이용하실 수 있어요/)).toBeInTheDocument()
    expect(screen.getByText(new RegExp(OPERATOR_INFO.phone))).toBeInTheDocument()
    expect(screen.getByText(new RegExp(OPERATOR_INFO.supportEmail))).toBeInTheDocument()
  })
})
