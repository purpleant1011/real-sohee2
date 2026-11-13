import React from 'react'
import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { SoheeBrainDashboard } from '../sohee-brain-dashboard'
import type { StudioOverviewData } from '../../types'

// Mock useGrowthSnapshot
let mockSnapshotResult: any = { snapshot: null, loading: false, error: null }
vi.mock('@/features/sohee-menu/use-growth-snapshot', () => ({
  useGrowthSnapshot: () => mockSnapshotResult,
}))

vi.mock('../brain-knowledge-tab', () => ({ BrainKnowledgeTab: () => <section aria-label="승인 지식" /> }))
vi.mock('../knowledge-journal-panel', () => ({ KnowledgeJournalPanel: ({ workspaceId }: { workspaceId: string }) => <section aria-label="지식·업무 일지">{workspaceId}</section> }))

describe('SoheeBrainDashboard Component Tests', () => {
  const workspaceId = 'ws-test-123'
  const onTabChange = vi.fn()
  const onAnswerQuestion = vi.fn()
  const onTellGoal = vi.fn()
  const onSelectKnowledge = vi.fn()
  const onGoToLegacyTab = vi.fn()

  const mockOverview: StudioOverviewData = {
    workspaceId,
    knowledgeStats: {
      activeCount: 12,
      pendingProposalCount: 2,
      staleCount: 0,
      byCategory: { HOURS: 2, MENU: 10 },
    },
    topQuestions: [
      {
        id: 'q-1',
        workspaceId,
        kind: 'missing',
        question: '주차 안내',
        reason: '',
        expectedOutcome: '',
        relatedFactIds: [],
        evidence: [],
        status: 'open',
        priority: 'important',
        createdAt: new Date().toISOString(),
      },
    ],
    activeGoals: [
      {
        id: 'g-1',
        workspaceId,
        title: '신규 상품 인지도 향상',
        desiredOutcome: '',
        priority: 'normal',
        status: 'active',
        version: 1,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    ],
    educationReadiness: null,
    recentActivity: [],
  }

  beforeEach(() => {
    vi.clearAllMocks()
    mockSnapshotResult = { snapshot: null, loading: false, error: null }
  })

  it('opens the same workspace knowledge journal from the brain tabs', () => {
    render(<SoheeBrainDashboard workspaceId={workspaceId} overview={mockOverview} activeTab="journal"
      onTabChange={onTabChange} onAnswerQuestion={onAnswerQuestion} onTellGoal={onTellGoal}
      onSelectKnowledgeForCorrection={onSelectKnowledge} refreshTrigger={0} />)
    expect(screen.getByRole('tab', { name: '일지' })).toBeInTheDocument()
    expect(screen.getByRole('region', { name: '지식·업무 일지' })).toHaveTextContent(workspaceId)
  })
  it('1. 교육 준비도 데이터가 없으면 가짜 60% 대신 — 를 표시한다', () => {
    render(
      <SoheeBrainDashboard
        workspaceId={workspaceId}
        overview={mockOverview}
        activeTab="knowledge"
        onTabChange={onTabChange}
        onAnswerQuestion={onAnswerQuestion}
        onTellGoal={onTellGoal}
        onSelectKnowledgeForCorrection={onSelectKnowledge}
        onGoToLegacyTab={onGoToLegacyTab}
        refreshTrigger={0}
      />
    )

    expect(screen.getByText('교육 준비도 —')).toBeInTheDocument()
    expect(screen.queryByText('교육 준비도 60%')).not.toBeInTheDocument()
  })

  it('2. 성장 스냅샷이 존재하면 해당 백분율을 교육 준비도로 표시한다', () => {
    mockSnapshotResult = {
      snapshot: {
        completenessPercent: 42,
        level: { level: 1, name: '신입', nextName: null, ladder: [] },
        jobs: [],
      },
      loading: false,
      error: null,
    }

    render(
      <SoheeBrainDashboard
        workspaceId={workspaceId}
        overview={mockOverview}
        activeTab="knowledge"
        onTabChange={onTabChange}
        onAnswerQuestion={onAnswerQuestion}
        onTellGoal={onTellGoal}
        onSelectKnowledgeForCorrection={onSelectKnowledge}
        onGoToLegacyTab={onGoToLegacyTab}
        refreshTrigger={0}
      />
    )

    expect(screen.getByText('교육 준비도 42%')).toBeInTheDocument()
  })

  it('3. overview 오류가 전달되면 상단에 에러 배너와 다시 시도 버튼을 노출한다', () => {
    const onRetry = vi.fn()
    render(
      <SoheeBrainDashboard
        workspaceId={workspaceId}
        overview={null}
        activeTab="knowledge"
        onTabChange={onTabChange}
        onAnswerQuestion={onAnswerQuestion}
        onTellGoal={onTellGoal}
        onSelectKnowledgeForCorrection={onSelectKnowledge}
        onGoToLegacyTab={onGoToLegacyTab}
        refreshTrigger={0}
        overviewError="두뇌 현황 데이터를 불러오지 못했습니다."
        onRetryOverview={onRetry}
      />
    )

    expect(screen.getByText('두뇌 현황 데이터를 불러오지 못했습니다.')).toBeInTheDocument()
    const retryBtn = screen.getByRole('button', { name: /다시 시도/ })
    fireEvent.click(retryBtn)
    expect(onRetry).toHaveBeenCalled()
  })
})
