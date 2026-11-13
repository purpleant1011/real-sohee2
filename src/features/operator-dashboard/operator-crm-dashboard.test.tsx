import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { OperatorRiskOverview } from '@/features/operator-risk/risk-schemas'
import { OperatorCrmDashboard } from './operator-crm-dashboard'

const meta = { sourceLabel: '운영 원장', windowLabel: '현재', observedAt: '2026-08-24T00:00:00.000Z', freshness: 'fresh' as const }
const overview: OperatorRiskOverview = {
  items: [
    { id: 'one', workspace_id: '11111111-1111-4111-8111-111111111111', workspace_name: '바이름', title: '게시 실패', detail: 'Instagram', severity: 'critical', fact_kind: 'observed', source_timestamp: '2026-08-24T00:00:00.000Z', freshness: 'fresh', href: '/admin/workspaces/11111111-1111-4111-8111-111111111111#workspace-publishing' },
    { id: 'two', workspace_id: '22222222-2222-4222-8222-222222222222', workspace_name: '라이트 스튜디오', title: '활성화 필수 항목 미완료', detail: 'privacy_consent', severity: 'medium', fact_kind: 'observed', source_timestamp: '2026-08-23T00:00:00.000Z', freshness: 'stale', href: '/admin/workspaces/22222222-2222-4222-8222-222222222222#workspace-lifecycle' },
  ],
  summary: {
    state: 'stale', critical: 1, high: null, medium: 1, activeCount: 6, pendingApprovalCount: 2, creditRiskCount: 1, sourceTimestamp: '2026-08-24T00:00:00.000Z',
    cardMetadata: { critical: meta, activeCustomers: meta, pendingApprovals: meta, creditRisk: meta, overall: meta },
  },
}

describe('OperatorCrmDashboard', () => {
  beforeEach(() => {
    vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({ matches: false, addListener: vi.fn(), removeListener: vi.fn(), addEventListener: vi.fn(), removeEventListener: vi.fn() }))
    const getComputedStyle = window.getComputedStyle.bind(window)
    vi.spyOn(window, 'getComputedStyle').mockImplementation((element) => getComputedStyle(element))
  })

  it('matches the approved operations hierarchy with real aggregate values', () => {
    render(<OperatorCrmDashboard overview={overview} />)

    expect(screen.getByRole('heading', { level: 1, name: '운영 현황' })).toBeInTheDocument()
    expect(screen.getByText('즉시 확인이 필요한 운영 이슈가 1건 있습니다.')).toBeInTheDocument()
    expect(screen.getByText('활성 고객사')).toBeInTheDocument()
    expect(screen.getByText('승인 대기')).toBeInTheDocument()
    expect(screen.getByText('크레딧 위험')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '게시 성공률과 API 비용' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '우선 처리 업무' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '가입 진행 현황' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '최근 운영 이벤트' })).toBeInTheDocument()
    expect(screen.getAllByText(/바이름/u).length).toBeGreaterThan(0)
    expect(screen.queryByText(/원본 로그|provider payload|credential|source 전체/)).not.toBeInTheDocument()
  }, 15_000)
})
