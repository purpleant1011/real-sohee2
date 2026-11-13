import { describe, expect, it, vi } from 'vitest'
import { LearningError } from './contracts'
import { reviewLearningCandidates } from './review-service'
import {
  TENANT_A_CANDIDATE_ID,
  TENANT_A_USER_ID,
  TENANT_A_WORKSPACE_ID,
  TENANT_B_WORKSPACE_ID,
  tenantASourceRef,
} from './test-fixtures'

describe('review-service', () => {
  const createMockRepo = () => ({
    loadSource: vi.fn(),
    listSources: vi.fn(),
    registerSource: vi.fn(),
    persistDocuments: vi.fn(),
    persistCandidates: vi.fn(),
    loadCandidates: vi.fn(),
    updateVerificationLease: vi.fn(),
    reviewCandidates: vi.fn(),
    revokeSource: vi.fn(),
    createJob: vi.fn(),
    getJob: vi.fn(),
    claimJob: vi.fn(),
    updateJobStatus: vi.fn(),
    markSourceDeleted: vi.fn(),
    queryApprovedContext: vi.fn(),
    validateResult: vi.fn(async () => true),
  })

  it('rejects viewer role from reviewing candidates', async () => {
    const repository = createMockRepo()
    await expect(
      reviewLearningCandidates(
        { userId: TENANT_A_USER_ID, workspaceId: TENANT_A_WORKSPACE_ID, role: 'viewer' },
        {
          source: tenantASourceRef,
          evidenceRevision: 1,
          decisions: [
            { candidateId: TENANT_A_CANDIDATE_ID, version: 1, decision: 'approved' },
          ],
        },
        { repository },
      ),
    ).rejects.toThrow(LearningError)
    expect(repository.reviewCandidates).not.toHaveBeenCalled()
  })

  it('rejects foreign tenant workspace mismatch', async () => {
    const repository = createMockRepo()
    await expect(
      reviewLearningCandidates(
        { userId: TENANT_A_USER_ID, workspaceId: TENANT_B_WORKSPACE_ID, role: 'owner' },
        {
          source: tenantASourceRef, // belongs to TENANT_A
          evidenceRevision: 1,
          decisions: [
            { candidateId: TENANT_A_CANDIDATE_ID, version: 1, decision: 'approved' },
          ],
        },
        { repository },
      ),
    ).rejects.toThrow(LearningError)
  })

  it('delegates to repository for valid manager actor and payload', async () => {
    const repository = createMockRepo()
    await reviewLearningCandidates(
      { userId: TENANT_A_USER_ID, workspaceId: TENANT_A_WORKSPACE_ID, role: 'manager' },
      {
        source: tenantASourceRef,
        evidenceRevision: 1,
        decisions: [
          { candidateId: TENANT_A_CANDIDATE_ID, version: 1, decision: 'approved', editedContent: '수정된 운영시간' },
        ],
      },
      { repository },
    )
    expect(repository.reviewCandidates).toHaveBeenCalledWith(
      { userId: TENANT_A_USER_ID, workspaceId: TENANT_A_WORKSPACE_ID },
      expect.objectContaining({
        source: tenantASourceRef,
        evidenceRevision: 1,
      }),
    )
  })
})
