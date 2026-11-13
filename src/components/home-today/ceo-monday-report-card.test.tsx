import React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { CeoMondayReportCard } from './ceo-monday-report-card'
vi.mock('@/features/reporting/weekly-truth-summary', () => ({ WeeklyTruthSummary: ({ workspaceId }: { workspaceId: string }) => <p>공통 주간 보고:{workspaceId}</p> }))
afterEach(cleanup)

describe('CeoMondayReportCard', () => {
  it('never creates metrics from default or caller-supplied unverified counts', () => {
    render(<CeoMondayReportCard confirmedBookings={4} postsPublished={10} />)
    expect(screen.getByRole('status').textContent).toContain('성과 집계에 필요한 사업장을 확인해 주세요')
    expect(document.body.textContent).not.toMatch(/450,000|인건비 절감|순수익/)
  })
  it('uses the same authorized weekly summary for a known workspace', () => {
    render(<CeoMondayReportCard workspaceId="ws-test" />)
    expect(screen.getByText('공통 주간 보고:ws-test')).toBeTruthy()
  })

  it('ignores caller-supplied counts and never renders fabricated money for a known workspace', () => {
    render(<CeoMondayReportCard workspaceId="ws-test" confirmedBookings={4} postsPublished={10} />)

    expect(screen.getByText('공통 주간 보고:ws-test')).toBeTruthy()
    expect(screen.queryByText(/450,000/)).not.toBeInTheDocument()
    expect(screen.queryByText(/4건/)).not.toBeInTheDocument()
    expect(screen.queryByText(/10건/)).not.toBeInTheDocument()
    expect(screen.queryByText(/순수익/)).not.toBeInTheDocument()
  })
})
