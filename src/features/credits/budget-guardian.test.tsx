import { describe, it, expect } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { BudgetGuardian } from './budget-guardian'

describe('BudgetGuardian', () => {
  it('hides credit progress gauge and topup CTA, but handles saving proposal application', () => {
    render(<BudgetGuardian currentCredits={7180} totalCredits={10000} />)

    expect(screen.getByText(/소희 Budget Guardian/i)).toBeInTheDocument()
    expect(screen.queryByText(/7,180/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/추가 충전/i)).not.toBeInTheDocument()
    expect(screen.getByText(/소희의 예산 방어 제안/i)).toBeInTheDocument()
    expect(screen.getByText(/100% 정상 유지/i)).toBeInTheDocument()

    const applyBtn = screen.getByRole('button', { name: /소희 절약 제안 즉시 적용/i })
    fireEvent.click(applyBtn)

    expect(screen.getByText(/예산 방어 제안이 적용되었습니다/i)).toBeInTheDocument()
  })
})
