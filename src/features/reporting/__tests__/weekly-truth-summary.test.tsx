import React from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { WeeklyTruthSummary } from '../weekly-truth-summary'
import { WeeklyCeoReportService, type WeeklyCeoReportData } from '../weekly-ceo-report-service'

vi.mock('next/link', () => ({ default: ({ href, children, ...props }: React.PropsWithChildren<{ href: string }>) => <a href={href} {...props}>{children}</a> }))
const fetchReport = vi.fn()
const response = (report: WeeklyCeoReportData) => ({ ok: true, json: async () => report })
const fixture = (id = 'ws-test') => new WeeklyCeoReportService().generateReport(id, new Date('2026-10-15T00:00:00Z'))
beforeEach(() => { fetchReport.mockReset(); vi.stubGlobal('fetch', fetchReport) })
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

describe('WeeklyTruthSummary', () => {
  it('uses the authorized server report and never reads operator metadata in the browser', async () => {
    const report = await fixture()
    let complete!: (value: unknown) => void
    fetchReport.mockReturnValue(new Promise((resolve) => { complete = resolve }))
    render(<WeeklyTruthSummary workspaceId="ws-test" />)
    expect(screen.getByRole('status').textContent).toContain('확인하고')
    expect(fetchReport).toHaveBeenCalledWith('/api/workspaces/ws-test/reports/weekly', { cache: 'no-store' })
    await act(async () => complete(response(report)))
    expect(screen.getByRole('heading', { name: '이번 주 실제 기록' })).toBeTruthy()
    expect(screen.getAllByText('아직 확인할 수 없어요').length).toBeGreaterThan(0)
    expect(document.body.textContent).not.toMatch(/350,000|80,000|42시간|확정 매출/)
  })

  it('links observed booking evidence to a persisted reservation without displaying its internal ID', async () => {
    const report = await fixture()
    report.datasetMode = 'ACTUAL'
    report.metrics.bookingConfirmed = { ...report.metrics.bookingConfirmed, state: 'OBSERVED', value: 1, observedAt: report.generatedAt, evidenceIds: ['booking-fixture-1'] }
    fetchReport.mockResolvedValue(response(report))
    render(<WeeklyTruthSummary workspaceId="ws-test" />)
    fireEvent.click(await screen.findByText('예약 근거 보기'))
    const link = await screen.findByRole('link', { name: '예약 기록 1 보기' })
    expect(link.getAttribute('href')).toBe('/app/customers#reservation-booking-fixture-1')
    expect(document.body.textContent).not.toContain('booking-fixture-1')
  })

  it('keeps query errors visible and retries the actual read', async () => {
    fetchReport.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(response(await fixture()))
    render(<WeeklyTruthSummary workspaceId="ws-test" />)
    await screen.findByRole('alert')
    fireEvent.click(screen.getByRole('button', { name: '다시 조회' }))
    await screen.findByRole('heading', { name: '이번 주 실제 기록' })
    expect(fetchReport).toHaveBeenCalledTimes(2)
  })

  it('does not expose the previous workspace report while the next workspace loads', async () => {
    const report = await fixture('workspace-a')
    report.executiveSummary = '이전 사업장 전용 요약'
    fetchReport.mockResolvedValueOnce(response(report)).mockReturnValueOnce(new Promise(() => {}))
    const view = render(<WeeklyTruthSummary workspaceId="workspace-a" />)
    await screen.findByText('이전 사업장 전용 요약')
    view.rerender(<WeeklyTruthSummary workspaceId="workspace-b" />)
    await waitFor(() => expect(screen.queryByText('이전 사업장 전용 요약')).toBeNull())
    expect(screen.getByRole('status')).toBeTruthy()
  })

  it('collapses to the four owner-first metrics on home and expands without dropping any', async () => {
    fetchReport.mockResolvedValue(response(await fixture()))
    render(<WeeklyTruthSummary workspaceId="ws-test" collapsible />)
    await screen.findByRole('heading', { name: '이번 주 실제 기록' })

    // 접힌 상태: 홈에서 먼저 봐야 할 4개만 보인다.
    for (const label of ['현재 확정 예약', '게시 확인', '확인된 매출', '확인된 예약금 수납']) {
      expect(screen.getByText(label)).toBeTruthy()
    }
    expect(screen.queryByText('취소 예약')).toBeNull()
    expect(screen.queryByText('절감 비용')).toBeNull()

    // 정보는 삭제되지 않는다 — 남은 건수를 버튼이 알려 준다.
    const toggle = screen.getByRole('button', { name: '나머지 6개 지표 더 보기' })
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    expect(toggle.getAttribute('aria-controls')).toBe('home-weekly-metrics')
    expect(document.getElementById('home-weekly-metrics')).not.toBeNull()

    fireEvent.click(toggle)
    expect(screen.getByText('취소 예약')).toBeTruthy()
    expect(screen.getByText('절감 비용')).toBeTruthy()
    expect(screen.getByRole('button', { name: '지표 접기' }).getAttribute('aria-expanded')).toBe('true')

    fireEvent.click(screen.getByRole('button', { name: '지표 접기' }))
    expect(screen.queryByText('취소 예약')).toBeNull()
  })

  it('keeps all metrics visible on screens that do not ask for collapsing', async () => {
    fetchReport.mockResolvedValue(response(await fixture()))
    render(<WeeklyTruthSummary workspaceId="ws-test" />)
    await screen.findByRole('heading', { name: '이번 주 실제 기록' })
    expect(screen.getByText('취소 예약')).toBeTruthy()
    expect(screen.getByText('절감 비용')).toBeTruthy()
    expect(screen.queryByRole('button', { name: /더 보기/ })).toBeNull()
  })
})
