import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { IncidentReadSection } from './incident-read-section'

const incident = {
  id: '46000000-0000-4000-8000-000000000001', source: 'conversation_jobs' as const, sourceState: 'degraded' as const,
  sourceFreshness: 'fresh' as const, sourceObservedAt: '2026-08-23T03:00:00.000Z', title: '작업 큐 주의', severity: 'high' as const,
  status: 'open' as const, version: 1, reason: '최근 관측 창에서 주의 상태가 확인되었습니다.', factKind: 'observed' as const,
  rollbackCandidateCode: 'QUEUE_RETRY_CANDIDATE', recoveryState: 'pending' as const, openedAt: '2026-08-23T03:00:00.000Z',
  assigneeUserId: null, assigneeDisplay: null, impactScope: null, recoveryVerifiedAt: null, recoveryEvidenceSummary: null,
  remediationKind: null, remediationResult: null,
  updatedAt: '2026-08-23T03:00:00.000Z', freshness: 'fresh' as const, timeline: [],
}

describe('IncidentReadSection', () => {
  it('renders safe timeline facts and keeps recovery actions disabled', () => {
    render(<IncidentReadSection data={{ items: [incident] }} error={null} />)
    expect(screen.getByRole('heading', { name: '사고 원장·복구 시간선' })).toBeVisible()
    expect(screen.getByText('작업 큐 주의')).toBeVisible()
    expect(screen.getByText('QUEUE_RETRY_CANDIDATE')).toBeVisible()
    expect(screen.getByRole('button', { name: '복구 실행' })).toBeDisabled()
    expect(screen.queryByText(/raw_log|secret|token/iu)).toBeNull()
  })

  it('renders a neutral empty state without inventing incidents', () => {
    render(<IncidentReadSection data={{ items: [] }} error={null} />)
    expect(screen.getByText('사고 원장 자료가 없습니다.')).toBeVisible()
    expect(screen.queryByText('0건')).toBeNull()
  })
})
