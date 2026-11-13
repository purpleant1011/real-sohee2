import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { LedgerFreshnessNotice } from '../components/ledger-freshness-notice'

describe('ANI-1610 LedgerFreshnessNotice', () => {
  it('shows 확인 필요 for a stale ledger and never claims availability', () => {
    render(
      <LedgerFreshnessNotice
        freshness="STALE"
        observedAt="2026-10-20T01:00:00.000Z"
        timezone="Asia/Seoul"
      />,
    )

    const notice = screen.getByRole('status')
    expect(notice).toHaveTextContent('확인 필요')
    expect(notice).not.toHaveTextContent('예약 가능')
  })

  it('shows 확인 필요 when the external ledger is not connected', () => {
    render(<LedgerFreshnessNotice freshness="NOT_OBSERVED" timezone="Asia/Seoul" />)

    const notice = screen.getByRole('status')
    expect(notice).toHaveTextContent('확인 필요')
    expect(notice).not.toHaveTextContent('예약 가능')
  })

  it('shows 확인 필요 when the ledger read failed', () => {
    render(<LedgerFreshnessNotice freshness="ERROR" timezone="Asia/Seoul" />)

    const notice = screen.getByRole('status')
    expect(notice).toHaveTextContent('확인 필요')
    expect(notice).not.toHaveTextContent('예약 가능')
  })

  it('shows the confirmation time and source when the ledger is current', () => {
    render(
      <LedgerFreshnessNotice
        freshness="CURRENT"
        observedAt="2026-10-23T00:58:00.000Z"
        sourceLabel="사장님 직접 확인"
        timezone="Asia/Seoul"
      />,
    )

    const notice = screen.getByRole('status')
    expect(notice).toHaveTextContent('사장님 직접 확인')
    expect(notice).not.toHaveTextContent('확인 필요')
    // The confirmation time must be visible, not just an opaque timestamp.
    expect(notice.textContent).toMatch(/\d{2}:\d{2}/)
  })
})
