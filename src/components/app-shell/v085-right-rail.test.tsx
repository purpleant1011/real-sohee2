import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { V085RightRail } from './v085-right-rail'

describe('V085RightRail', () => {
  it('does not render credit budget section, available credits, or credit amounts', () => {
    render(
      <V085RightRail
        currentCredits={120}
        totalCredits={500}
        newInquiries={3}
        validConsultations={2}
        confirmedBookings={1}
        conversionRate={50.0}
      />,
    )

    expect(screen.getByText('업무 문맥 & 사업 성과')).toBeInTheDocument()
    expect(screen.queryByLabelText('소희 업무 예산')).not.toBeInTheDocument()
    expect(screen.queryByText(/가용 크레딧/)).not.toBeInTheDocument()
    expect(screen.queryByText(/120/)).not.toBeInTheDocument()
    expect(screen.queryByText(/500/)).not.toBeInTheDocument()
    expect(screen.queryByText(/C$/)).not.toBeInTheDocument()
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument()
  })
})
