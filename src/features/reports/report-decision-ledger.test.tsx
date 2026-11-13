import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { ReportDecisionLedger } from './report-decision-ledger'

const decision = {
  id: '60000000-0000-4000-8000-000000000001',
  insightKey: 'briefing:2026-08-01:2026-08-08',
  observedFacts: ['저장 반응이 이전 기간보다 42% 늘었어요.'],
  hypothesis: '첫 문장이 관심을 만들었을 가능성이 있어요.',
  changeVariable: 'opening' as const,
  invariants: ['본문 구조'],
  evidenceVersionIds: ['40000000-0000-4000-8000-000000000001'],
  conversationThreadId: '30000000-0000-4000-8000-000000000001',
  experimentId: '70000000-0000-4000-8000-000000000001',
  experimentStatus: 'planned' as const,
  status: 'experiment_planned' as const,
  createdAt: '2026-08-22T03:00:00.000Z',
}

describe('ReportDecisionLedger', () => {
  it('shows observation, decision, execution, result, and learning boundaries', () => {
    render(<ReportDecisionLedger decisions={[decision]} />)

    expect(screen.getByRole('heading', { name: '의사결정 기록' })).toBeVisible()
    expect(screen.getByText('관찰')).toBeVisible()
    expect(screen.getByText('판단')).toBeVisible()
    expect(screen.getByText('실행 계획')).toBeVisible()
    expect(screen.getByText('결과 확인 전')).toBeVisible()
    expect(screen.getByText('학습은 자동으로 미래 콘텐츠에 반영되지 않아요.')).toBeVisible()
    expect(screen.getByRole('link', { name: '연결된 대화 보기' })).toHaveAttribute('href', expect.stringContaining(decision.conversationThreadId))
    expect(screen.getByRole('link', { name: '실험 일정 보기' })).toHaveAttribute('href', expect.stringContaining(decision.experimentId))
  })

  it('uses an explicit empty state instead of invented records', () => {
    render(<ReportDecisionLedger decisions={[]} />)
    expect(screen.getByText('아직 저장된 의사결정이 없어요.')).toBeVisible()
    expect(screen.queryByText('가상 예시')).not.toBeInTheDocument()
  })
})
