import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

import { ReportPlanBuilder } from './report-plan-builder'

const insight = {
  id: 'briefing:2026-08-01:2026-08-08',
  title: '저장 반응은 늘었지만 문의 전환은 멈췄어요',
  observedFacts: ['저장 반응은 이전 기간보다 42% 늘었어요.'],
  interpretations: ['고민을 바로 말한 첫 문장이 관심을 만들었을 가능성이 있어요.'],
  unknowns: ['문의가 멈춘 원인은 아직 단정할 수 없어요.'],
  confidence: 'moderate' as const,
  evidence: [{
    contentItemId: '30000000-0000-4000-8000-000000000001',
    contentVersionId: '40000000-0000-4000-8000-000000000001',
    versionNumber: 2,
    publishAttemptId: '50000000-0000-4000-8000-000000000001',
    providerPostReference: 'provider-post-1',
    title: '가을 눈썹 상담',
    channel: 'instagram' as const,
    collectionState: 'available' as const,
    collectedAt: '2026-08-08T03:00:00.000Z',
  }],
}

describe('ReportPlanBuilder', () => {
  it('requires one hypothesis and one changed variable and states the action boundary', () => {
    render(<ReportPlanBuilder
      insight={insight}
      periodEnd="2026-08-08T23:59:59.999Z"
      periodStart="2026-08-01T00:00:00.000Z"
      workspaceId="20000000-0000-4000-8000-000000000001"
    />)

    expect(screen.getByRole('heading', { name: '다음 포스팅 방향 정하기' })).toBeVisible()
    expect(screen.getByLabelText('검증할 가설')).toBeRequired()
    expect(screen.getByLabelText('이번에 바꿀 한 가지')).toBeRequired()
    expect(screen.getByText('저장만으로 게시하거나 메시지를 보내지 않아요.')).toBeVisible()
  })

  it('persists structured context and moves to conversation only after success', async () => {
    const submitAction = vi.fn().mockResolvedValue({
      ok: true,
      decisionId: '60000000-0000-4000-8000-000000000001',
      next: '/app?reportDecision=60000000-0000-4000-8000-000000000001',
    })
    const navigate = vi.fn()
    render(<ReportPlanBuilder
      insight={insight}
      navigate={navigate}
      periodEnd="2026-08-08T23:59:59.999Z"
      periodStart="2026-08-01T00:00:00.000Z"
      submitAction={submitAction}
      workspaceId="20000000-0000-4000-8000-000000000001"
    />)

    fireEvent.click(screen.getByRole('button', { name: '대화에서 개선 시작하기' }))

    await waitFor(() => {
      expect(submitAction).toHaveBeenCalledWith(expect.objectContaining({
        changeVariable: 'opening',
        evidenceVersionIds: ['40000000-0000-4000-8000-000000000001'],
        observedFacts: insight.observedFacts,
      }))
      expect(navigate).toHaveBeenCalledWith('/app?reportDecision=60000000-0000-4000-8000-000000000001')
    })
  })
})
