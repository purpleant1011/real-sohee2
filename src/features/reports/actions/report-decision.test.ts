import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

import {
  createReportExperimentAction,
  startReportConversationAction,
} from './report-decision'

const workspaceId = '20000000-0000-4000-8000-000000000001'
const decisionId = '30000000-0000-4000-8000-000000000001'
const versionA = '40000000-0000-4000-8000-000000000001'

const validDecision = {
  workspaceId,
  insightKey: 'saved-response-up',
  periodStart: '2026-08-01T00:00:00.000Z',
  periodEnd: '2026-08-08T00:00:00.000Z',
  observedFacts: ['저장 반응이 늘었어요.'],
  hypothesis: '첫 문장이 구체적이어서 저장했을 가능성이 있어요.',
  changeVariable: 'opening',
  invariants: ['본문 구조'],
  customerSignalIds: [],
  evidenceVersionIds: [versionA],
}

describe('report decision actions', () => {
  it('rejects a report handoff when the actor is not an active workspace manager', async () => {
    const repository = { createReportDecision: vi.fn(), createReportExperiment: vi.fn() }
    const result = await startReportConversationAction(validDecision, {
      workspace: vi.fn().mockResolvedValue({ workspaceId, role: 'viewer' }),
      repository,
    })

    expect(result).toEqual({ ok: false, code: 'REPORT_DECISION_FORBIDDEN' })
    expect(repository.createReportDecision).not.toHaveBeenCalled()
  })

  it('persists authorized context and returns a conversation bootstrap path', async () => {
    const repository = {
      createReportDecision: vi.fn().mockResolvedValue({ ok: true, decisionId }),
      createReportExperiment: vi.fn(),
    }
    const result = await startReportConversationAction(validDecision, {
      workspace: vi.fn().mockResolvedValue({ workspaceId, role: 'manager' }),
      repository,
    })

    expect(result).toEqual({ ok: true, decisionId, next: `/app?reportDecision=${decisionId}` })
  })

  it('rejects an experiment whose exact versions are the same', async () => {
    const repository = { createReportDecision: vi.fn(), createReportExperiment: vi.fn() }
    const result = await createReportExperimentAction({
      workspaceId,
      decisionId,
      hypothesis: '도입만 바꾸면 저장 반응이 달라질 수 있어요.',
      changeVariable: 'opening',
      invariantKeys: ['본문', '게시 시각'],
      variantAContentVersionId: versionA,
      variantBContentVersionId: versionA,
      variantAScheduledAt: '2026-08-24T01:00:00.000Z',
      variantBScheduledAt: '2026-08-25T01:00:00.000Z',
      primaryMetric: 'saved',
      secondaryMetrics: ['inquiries'],
      guardrailMetrics: ['negative_reactions'],
      reviewAt: '2026-09-01T01:00:00.000Z',
    }, {
      workspace: vi.fn().mockResolvedValue({ workspaceId, role: 'owner' }),
      repository,
    })

    expect(result).toEqual({ ok: false, code: 'REPORT_EXPERIMENT_INVALID' })
    expect(repository.createReportExperiment).not.toHaveBeenCalled()
  })
})
