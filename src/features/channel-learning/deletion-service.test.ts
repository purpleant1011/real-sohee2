import { describe, expect, it, vi } from 'vitest'
import { LearningError } from './contracts'
import { deleteLearningSource, revokeLearningSource } from './deletion-service'
import {
  TENANT_A_USER_ID,
  TENANT_A_WORKSPACE_ID,
  TENANT_B_WORKSPACE_ID,
  tenantASourceRef,
} from './test-fixtures'

describe('deletion-service', () => {
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
    markSourceDeleted: vi.fn(async () => ({
      deletionJobId: '50000000-0000-4000-8000-000000000001',
      status: 'pending' as const,
    })),
    queryApprovedContext: vi.fn(),
    validateResult: vi.fn(async () => true),
  })

  it('rejects viewer from revoking source', async () => {
    const repository = createMockRepo()
    await expect(
      revokeLearningSource(
        { userId: TENANT_A_USER_ID, workspaceId: TENANT_A_WORKSPACE_ID, role: 'viewer' },
        tenantASourceRef,
        { repository },
      ),
    ).rejects.toThrow(LearningError)
  })

  it('rejects cross-tenant revoke', async () => {
    const repository = createMockRepo()
    await expect(
      revokeLearningSource(
        { userId: TENANT_A_USER_ID, workspaceId: TENANT_B_WORKSPACE_ID, role: 'owner' },
        tenantASourceRef,
        { repository },
      ),
    ).rejects.toThrow(LearningError)
  })

  it('revokes source via repository for owner actor', async () => {
    const repository = createMockRepo()
    await revokeLearningSource(
      { userId: TENANT_A_USER_ID, workspaceId: TENANT_A_WORKSPACE_ID, role: 'owner' },
      tenantASourceRef,
      { repository },
    )
    expect(repository.revokeSource).toHaveBeenCalledWith(
      { userId: TENANT_A_USER_ID, workspaceId: TENANT_A_WORKSPACE_ID },
      tenantASourceRef,
    )
  })

  it('deletes source, returns pending deletion job receipt', async () => {
    const repository = createMockRepo()
    const result = await deleteLearningSource(
      { userId: TENANT_A_USER_ID, workspaceId: TENANT_A_WORKSPACE_ID, role: 'owner' },
      tenantASourceRef,
      { repository },
    )
    expect(result).toEqual({
      deletionJobId: '50000000-0000-4000-8000-000000000001',
      status: 'pending',
    })
    expect(repository.markSourceDeleted).toHaveBeenCalledWith(
      { userId: TENANT_A_USER_ID, workspaceId: TENANT_A_WORKSPACE_ID },
      tenantASourceRef,
    )
  })
})
