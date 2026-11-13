import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { BillingReceiptCard } from './billing-receipt-card'
import { OPERATOR_INFO } from '@/features/marketing/operator-information'

describe('BillingReceiptCard', () => {
  it('영수증·세금계산서·현금영수증 요청 안내 문구와 고객센터 실제 문의처(전화, 이메일)를 노출한다', () => {
    const { container } = render(<BillingReceiptCard />)

    expect(screen.getByText('영수증 및 증빙 안내')).toBeInTheDocument()
    expect(screen.getByText(new RegExp(OPERATOR_INFO.phone))).toBeInTheDocument()
    expect(screen.getByText(new RegExp(OPERATOR_INFO.supportEmail))).toBeInTheDocument()

    // 신청 데이터 수집 폼(input, textarea)을 절대 만들지 않는다
    const inputs = container.querySelectorAll('input, textarea')
    expect(inputs.length).toBe(0)
  })
})
