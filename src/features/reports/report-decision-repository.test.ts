import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

import { createReportDecisionRepository } from './report-decision-repository'

const workspaceId = '20000000-0000-4000-8000-000000000001'
const actorUserId = '10000000-0000-4000-8000-000000000001'
const decisionId = '30000000-0000-4000-8000-000000000001'
const versionId = '40000000-0000-4000-8000-000000000001'

const decision = {
  workspaceId,
  insightKey: 'saved-response-up',
  periodStart: '2026-08-01T00:00:00.000Z',
  periodEnd: '2026-08-08T00:00:00.000Z',
  observedFacts: ['저장 반응이 늘었어요.'],
  hypothesis: '첫 문장이 구체적이어서 저장했을 가능성이 있어요.',
  changeVariable: 'opening' as const,
  invariants: ['본문 구조', '게시 시각'],
  customerSignalIds: [],
  ownerNote: null,
  evidenceVersionIds: [versionId],
}

describe('report decision repository', () => {
  it('persists a decision and exact-version evidence without raw customer text', async () => {
    const gateway = {
      insertDecisionWithEvidence: vi.fn().mockResolvedValue({ data: { id: decisionId, workspace_id: workspaceId }, error: null }),
      listDecisions: vi.fn(),
      insertExperiment: vi.fn(),
    }
    const repository = createReportDecisionRepository(gateway, actorUserId)

    await expect(repository.createReportDecision(decision)).resolves.toEqual({ ok: true, decisionId })
    expect(gateway.insertDecisionWithEvidence).toHaveBeenCalledWith(expect.objectContaining({
      workspace_id: workspaceId,
      observed_facts: decision.observedFacts,
      customer_signal_ids: [],
      created_by: actorUserId,
      evidence_version_ids: [versionId],
    }))
  })

  it('rejects a cross-workspace insert response', async () => {
    const gateway = {
      insertDecisionWithEvidence: vi.fn().mockResolvedValue({
        data: { id: decisionId, workspace_id: '20000000-0000-4000-8000-000000000099' },
        error: null,
      }),
      listDecisions: vi.fn(),
      insertExperiment: vi.fn(),
    }

    await expect(createReportDecisionRepository(gateway, actorUserId).createReportDecision(decision))
      .resolves.toEqual({ ok: false, code: 'REPORT_DECISION_CONFLICT' })
    expect(gateway.insertDecisionWithEvidence).toHaveBeenCalledTimes(1)
  })
})
