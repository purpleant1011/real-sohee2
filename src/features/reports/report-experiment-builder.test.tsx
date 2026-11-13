import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

import { ReportExperimentBuilder } from './report-experiment-builder'

const insight = {
  id: 'briefing:2026-08-01:2026-08-08',
  title: '첫 문장 반응을 한 번 더 확인해요',
  observedFacts: ['저장 반응이 늘었어요.'],
  interpretations: ['고민을 바로 말한 첫 문장이 관심을 만들었을 가능성이 있어요.'],
  unknowns: ['문의 전환 원인은 아직 단정할 수 없어요.'],
  confidence: 'moderate' as const,
  evidence: [1, 2].map((versionNumber) => ({
    contentItemId: `30000000-0000-4000-8000-00000000000${versionNumber}`,
    contentVersionId: `40000000-0000-4000-8000-00000000000${versionNumber}`,
    versionNumber,
    publishAttemptId: `50000000-0000-4000-8000-00000000000${versionNumber}`,
    providerPostReference: `post-${versionNumber}`,
    title: `근거 포스트 ${versionNumber}`,
    channel: 'instagram' as const,
    collectionState: 'available' as const,
    collectedAt: '2026-08-08T03:00:00.000Z',
  })),
}

describe('ReportExperimentBuilder', () => {
  it('keeps exact versions, schedules, and approval state explicit', () => {
    render(<ReportExperimentBuilder
      decisionId="60000000-0000-4000-8000-000000000001"
      insight={insight}
      workspaceId="20000000-0000-4000-8000-000000000001"
    />)

    expect(screen.getByRole('heading', { name: '한 번에 한 가지를 바꿔 비교해볼게요' })).toBeVisible()
    expect(screen.getByLabelText('가 버전')).toBeRequired()
    expect(screen.getByLabelText('나 버전')).toBeRequired()
    expect(screen.getByText('계획 저장만으로 승인·예약·게시되지 않아요.')).toBeVisible()
  })

  it('creates a plan with a not-requested approval boundary', async () => {
    const submitAction = vi.fn().mockResolvedValue({
      ok: true,
      experimentId: '70000000-0000-4000-8000-000000000001',
      next: '/app/schedule?experiment=70000000-0000-4000-8000-000000000001',
    })
    const navigate = vi.fn()
    render(<ReportExperimentBuilder
      decisionId="60000000-0000-4000-8000-000000000001"
      insight={insight}
      navigate={navigate}
      submitAction={submitAction}
      workspaceId="20000000-0000-4000-8000-000000000001"
    />)

    fireEvent.change(screen.getByLabelText('가 게시 후보 시각'), { target: { value: '2026-08-24T10:00' } })
    fireEvent.change(screen.getByLabelText('나 게시 후보 시각'), { target: { value: '2026-08-25T10:00' } })
    fireEvent.change(screen.getByLabelText('결과 검토 시각'), { target: { value: '2026-09-01T10:00' } })
    fireEvent.click(screen.getByRole('button', { name: '실험 계획을 일정에서 검토하기' }))

    await waitFor(() => expect(submitAction).toHaveBeenCalledWith(expect.objectContaining({
      variantAContentVersionId: '40000000-0000-4000-8000-000000000001',
      variantBContentVersionId: '40000000-0000-4000-8000-000000000002',
      changeVariable: 'opening',
    })))
    expect(navigate).toHaveBeenCalledWith('/app/schedule?experiment=70000000-0000-4000-8000-000000000001')
  })
})
