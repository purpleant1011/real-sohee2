import React from 'react'
import { render, screen, fireEvent } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { RoiCalculatorCard } from '../roi-calculator-card'

describe('RoiCalculatorCard', () => {
  it('renders ROI metrics accurately and provides copy action', async () => {
    const writeTextMock = vi.fn().mockResolvedValue(undefined)
    Object.assign(navigator, {
      clipboard: {
        writeText: writeTextMock,
      },
    })

    render(
      <RoiCalculatorCard
        hoursSaved={50}
        costSavedWon={400000}
        reachCount={2500}
        postsCount={12}
        businessName="햇살 뷰티스튜디오"
      />
    )

    expect(screen.getByTestId('roi-calculator-card')).toBeInTheDocument()
    expect(screen.getByText('소희가 사장님께 돌려드린 실질적인 가치예요')).toBeInTheDocument()
    expect(screen.getByText('₩400,000')).toBeInTheDocument()
    expect(screen.getByText('50시간')).toBeInTheDocument()
    expect(screen.getByText('2,500명')).toBeInTheDocument()
    expect(screen.getByText('12건')).toBeInTheDocument()

    const copyBtn = screen.getByRole('button', { name: /성과 요약 1초 복사/ })
    fireEvent.click(copyBtn)

    expect(writeTextMock).toHaveBeenCalledTimes(1)
    expect(writeTextMock.mock.calls[0][0]).toContain('햇살 뷰티스튜디오')
    expect(writeTextMock.mock.calls[0][0]).toContain('₩400,000')
    expect(writeTextMock.mock.calls[0][0]).toContain('50시간')
  })
})
