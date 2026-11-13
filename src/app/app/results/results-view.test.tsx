import React from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import ResultsPage from './results-view'

const WS = '11111111-1111-4111-8111-111111111111'

vi.mock('@/hooks/use-workspace-context', () => ({
  useWorkspaceId: () => WS,
}))

vi.mock('@/components/v088/layout/v088-app-shell', () => ({
  V088AppShell: ({ children }: { children: React.ReactNode }) => <main>{children}</main>,
}))

const mockReport = {
  workspaceId: WS,
  datasetMode: 'ACTUAL',
  periodLabel: '2026.11.01 ~ 2026.11.08',
  period: { start: '2026-11-01T00:00:00.000Z', end: '2026-11-08T00:00:00.000Z' },
  hoursSaved: null,
  costSavedWon: null,
  confirmedBookingsCount: 1,
  totalRevenueWon: null,
  publishedPostsCount: 2,
  engagementCount: 5,
  executiveSummary: '이번 주 확정된 예약 1건과 게시 확인 2건이 있어요.',
  generatedAt: '2026-11-08 12:00:00',
  metrics: {
    verifiedPublishedPosts: {
      value: 2,
      state: 'OBSERVED',
      source: 'external_action_receipts',
      period: { start: '2026-11-01T00:00:00.000Z', end: '2026-11-08T00:00:00.000Z' },
      observedAt: '2026-11-08T12:00:00.000Z',
      evidenceIds: ['post-1', 'post-2'],
    },
    bookingConfirmed: {
      value: 1,
      state: 'OBSERVED',
      source: 'reservations',
      period: { start: '2026-11-01T00:00:00.000Z', end: '2026-11-08T00:00:00.000Z' },
      observedAt: '2026-11-08T12:00:00.000Z',
      evidenceIds: ['book-1'],
    },
    revenue: {
      value: null,
      state: 'NOT_OBSERVED',
      source: 'verified_revenue_ledger_not_connected',
      period: { start: '2026-11-01T00:00:00.000Z', end: '2026-11-08T00:00:00.000Z' },
      observedAt: null,
      evidenceIds: [],
    },
    storedComments: {
      value: 5,
      state: 'OBSERVED',
      source: 'social_comments',
      period: { start: '2026-11-01T00:00:00.000Z', end: '2026-11-08T00:00:00.000Z' },
      observedAt: '2026-11-08T12:00:00.000Z',
      evidenceIds: ['comm-1', 'comm-2'],
    },
    bookingCanceled: {
      value: 0,
      state: 'OBSERVED',
      source: 'reservations',
      period: { start: '2026-11-01T00:00:00.000Z', end: '2026-11-08T00:00:00.000Z' },
      observedAt: '2026-11-08T12:00:00.000Z',
      evidenceIds: [],
    },
    publicationPending: {
      value: 0,
      state: 'OBSERVED',
      source: 'external_action_receipts',
      period: { start: '2026-11-01T00:00:00.000Z', end: '2026-11-08T00:00:00.000Z' },
      observedAt: null,
      evidenceIds: [],
    },
    paymentCapturedVerified: {
      value: null,
      state: 'NOT_OBSERVED',
      source: 'verified_payment_ledger_not_connected',
      period: { start: '2026-11-01T00:00:00.000Z', end: '2026-11-08T00:00:00.000Z' },
      observedAt: null,
      evidenceIds: [],
    },
    visitCompletedVerified: {
      value: null,
      state: 'NOT_OBSERVED',
      source: 'verified_visit_ledger_not_connected',
      period: { start: '2026-11-01T00:00:00.000Z', end: '2026-11-08T00:00:00.000Z' },
      observedAt: null,
      evidenceIds: [],
    },
    hoursSaved: {
      value: null,
      state: 'NOT_OBSERVED',
      source: 'unobserved',
      period: { start: '2026-11-01T00:00:00.000Z', end: '2026-11-08T00:00:00.000Z' },
      observedAt: null,
      evidenceIds: [],
    },
    costSavedWon: {
      value: null,
      state: 'NOT_OBSERVED',
      source: 'unobserved',
      period: { start: '2026-11-01T00:00:00.000Z', end: '2026-11-08T00:00:00.000Z' },
      observedAt: null,
      evidenceIds: [],
    },
  },
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async () => Response.json(mockReport)))
})

describe('PC ResultsView', () => {
  it('상단 핵심 지표 4개(게시 확인·예약 확정·확인된 매출·고객 문의)를 렌더링한다', async () => {
    render(<ResultsPage />)
    const published = await screen.findAllByText('게시 확인')
    expect(published.length).toBeGreaterThan(0)
    expect(screen.getAllByText('예약 확정').length).toBeGreaterThan(0)
    expect(screen.getByText('확인된 매출')).toBeVisible()
    expect(screen.getAllByText('고객 문의').length).toBeGreaterThan(0)
    expect(screen.queryByText(/\(UTC\)/)).toBeNull()
  })

  it('값 없는 지표는 10개씩 나열되지 않고 한 줄 안내 + 접기로 제공된다', async () => {
    render(<ResultsPage />)
    expect(await screen.findByText(/확인할 수 없는 지표/)).toBeVisible()
    // 기본 상태에서는 미확인 지표 상세가 숨겨져 있거나 접혀 있음
    expect(screen.getByRole('button', { name: /확인할 수 없는 지표/ })).toBeVisible()
  })

  it('MasterDetail 구조로 오른쪽 상세 패널(최근 기록 목록 + 근거 링크 + 실행 버튼 1개)을 제공한다', async () => {
    render(<ResultsPage initialMetricId="published" />)
    expect(await screen.findByRole('region', { name: '성과 요약' })).toBeVisible()
    expect(screen.getByRole('region', { name: '지표 상세' })).toBeVisible()

    // 오른쪽 상세 패널에 근거 링크와 실행 버튼 1개가 노출된다
    expect(screen.getByRole('link', { name: '성과 근거 기록 보기' })).toHaveAttribute(
      'href',
      '/app/results/published/evidence'
    )
    expect(screen.getByRole('link', { name: '새 홍보 만들기' })).toHaveAttribute('href', '/app/content')
  })

  it('periodLabel 에 (UTC)가 포함되어 있어도 사장님 화면에는 (UTC)가 노출되지 않는다', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({
      ...mockReport,
      periodLabel: '2026.11.01 ~ 2026.11.08 (UTC)',
    })))
    render(<ResultsPage />)
    await screen.findByText(/마케팅 성과 요약/)
    expect(screen.queryByText(/\(UTC\)/)).toBeNull()
  })

  it('미확인 지표는 text-2xl 대신 text-base 스타일을 사용하여 줄바꿈 붕괴를 방지한다', async () => {
    render(<ResultsPage />)
    const unobserved = await screen.findByText('아직 확인할 수 없어요')
    expect(unobserved.className).not.toContain('text-2xl')
    expect(unobserved.className).toContain('text-base')
  })

  it('KPI 지표 카드는 키보드로 접근 가능하도록 role="button"과 tabIndex=0을 갖는다', async () => {
    render(<ResultsPage />)
    const buttons = await screen.findAllByRole('button')
    const kpiCard = buttons.find((b) => b.textContent?.includes('게시 확인'))
    expect(kpiCard).toBeDefined()
    expect(kpiCard).toHaveAttribute('tabIndex', '0')
  })

  it('차트 헤더의 "실제 확인된 기록" 서브텍스트에 whitespace-nowrap이 적용되어 1024px에서 찌그러지지 않는다', async () => {
    render(<ResultsPage />)
    const subtext = await screen.findByText('실제 확인된 기록')
    expect(subtext.className).toContain('whitespace-nowrap')
  })
})
