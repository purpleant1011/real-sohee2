import React from 'react'
import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AttributionOutcomeConsole } from '../AttributionOutcomeConsole'
import type { WeeklyCeoReportData } from '@/features/reporting/weekly-ceo-report-service'

vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: React.PropsWithChildren<{ href: string }>) => (
    <a href={href} {...props}>{children}</a>
  ),
}))

const fetchReport = vi.fn()

const period = { start: '2026-10-17T00:00:00.000Z', end: '2026-10-24T00:00:00.000Z' }
const observation = (value: number | null, state: string, evidenceIds: string[] = []) => ({
  value,
  state,
  source: 'test-source',
  period,
  observedAt: state === 'OBSERVED' ? '2026-10-23T02:00:00.000Z' : null,
  evidenceIds,
})

function report(overrides: Record<string, unknown> = {}): WeeklyCeoReportData {
  return {
    workspaceId: 'ws-attribution',
    datasetMode: 'ACTUAL',
    periodLabel: '2026-10-17 ~ 2026-10-24 (UTC)',
    period,
    hoursSaved: null,
    costSavedWon: null,
    confirmedBookingsCount: 1,
    totalRevenueWon: null,
    publishedPostsCount: 0,
    engagementCount: 0,
    metrics: {
      bookingConfirmed: observation(1, 'OBSERVED', ['res-A-1']),
      bookingCanceled: observation(0, 'OBSERVED', []),
      verifiedPublishedPosts: observation(0, 'OBSERVED', []),
      publicationPending: observation(0, 'OBSERVED', []),
      storedComments: observation(0, 'OBSERVED', []),
      paymentCapturedVerified: observation(null, 'NOT_OBSERVED'),
      revenue: observation(null, 'NOT_OBSERVED'),
      visitCompletedVerified: observation(null, 'NOT_OBSERVED'),
      hoursSaved: observation(null, 'NOT_OBSERVED'),
      costSavedWon: observation(null, 'NOT_OBSERVED'),
    },
    executiveSummary: '요약',
    generatedAt: '2026-10-23T02:00:00.000Z',
    ...overrides,
  } as unknown as WeeklyCeoReportData
}

const respond = (body: unknown) => ({ ok: true, json: async () => body })

beforeEach(() => {
  fetchReport.mockReset()
  vi.stubGlobal('fetch', fetchReport)
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

async function renderWith(body: unknown) {
  fetchReport.mockResolvedValue(respond(body))
  render(<AttributionOutcomeConsole workspaceId="ws-attribution" />)
  await act(async () => { await Promise.resolve() })
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)) })
  return document.body.textContent ?? ''
}

describe('AttributionOutcomeConsole truth', () => {
  it('does not claim a connected receipt ledger when payment evidence is missing', async () => {
    const text = await renderWith(report())
    expect(text).not.toContain('100% 영수증 결제 증빙 연동됨')
    expect(text).not.toMatch(/100%/)
    expect(text).toContain('영수증 결제 증빙 연동 대기')
  })

  it('never renders the demo revenue or conversion fixtures', async () => {
    const text = await renderWith(report())
    expect(text).not.toContain('2,450,000')
    expect(text).not.toContain('슬롯 확정 12건')
    expect(text).not.toContain('5,420회')
    expect(text).not.toContain('+22.4%')
    expect(text).not.toContain('12건')
    expect(text).not.toContain('8건')
    expect(text).not.toContain('3차 루프')
  })

  it('shows the confirmed reservation count from the same weekly source', async () => {
    const text = await renderWith(report())
    expect(text).toContain('확정 예약 1건')
    expect(text).toContain('주간 실제 기록의 확정 예약과 같은 기준')
  })

  it('explains the funnel definition so step 4 cannot be read as a different count', async () => {
    const text = await renderWith(report())
    expect(text).toContain('4단계 예약은 주간 실제 기록의 확정 예약과 같은 값입니다')
  })

  it('states honestly when the reporting source is unavailable', async () => {
    fetchReport.mockResolvedValue({ ok: false, json: async () => ({}) })
    render(<AttributionOutcomeConsole workspaceId="ws-attribution" />)
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)) })
    const text = document.body.textContent ?? ''
    expect(text).toContain('아직 확인할 수 없어요')
    expect(text).not.toContain('100% 영수증 결제 증빙 연동됨')
    expect(text).toContain('영수증 결제 증빙 연동 대기')
  })

  it('does not offer a one-click action that only fakes an execution result', async () => {
    const text = await renderWith(report())
    expect(text).not.toContain('추천 액션 즉시 실행')
    expect(screen.queryByText('추천 액션 실행 완료')).toBeNull()
  })
})
