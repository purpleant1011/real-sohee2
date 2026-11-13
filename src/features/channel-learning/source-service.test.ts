import { describe, expect, it, vi } from 'vitest'
import { LearningError } from './contracts'
import { registerLearningSource } from './source-service'
import {
  sampleCapabilities,
  TENANT_A_USER_ID,
  TENANT_A_WORKSPACE_ID,
  tenantASource,
} from './test-fixtures'

describe('source-service', () => {
  const defaultDeps = {
    repository: {
      loadSource: vi.fn(async () => null),
      listSources: vi.fn(async () => []),
      registerSource: vi.fn(async () => tenantASource),
      persistDocuments: vi.fn(),
      persistCandidates: vi.fn(),
      loadCandidates: vi.fn(async () => []),
      updateVerificationLease: vi.fn(),
      reviewCandidates: vi.fn(),
      revokeSource: vi.fn(),
      createJob: vi.fn(),
      getJob: vi.fn(async () => null),
      claimJob: vi.fn(),
      updateJobStatus: vi.fn(),
      markSourceDeleted: vi.fn(),
      queryApprovedContext: vi.fn(async () => ({ items: [], epoch: 1, dependencies: [] })),
      validateResult: vi.fn(async () => true),
    },
    normalizeUrl: vi.fn((_platform, url) => ({
      canonicalUrl: url,
      canonicalIdentity: 'tenant_a_biz',
    })),
    getCapabilities: vi.fn(() => sampleCapabilities),
  }

  it('rejects viewer role attempting to register a source', async () => {
    await expect(
      registerLearningSource(
        { userId: TENANT_A_USER_ID, workspaceId: TENANT_A_WORKSPACE_ID, role: 'viewer' },
        {
          platform: 'instagram',
          url: 'https://www.instagram.com/tenant_a_biz/',
          consent: { text: true, images: false },
        },
        defaultDeps,
      ),
    ).rejects.toThrow(LearningError)
  })

  it('rejects blocked platform registration', async () => {
    await expect(
      registerLearningSource(
        { userId: TENANT_A_USER_ID, workspaceId: TENANT_A_WORKSPACE_ID, role: 'owner' },
        {
          platform: 'website',
          url: 'https://example.com/',
          consent: { text: true, images: false },
        },
        defaultDeps,
      ),
    ).rejects.toThrow(LearningError)
  })

  it('registers source with unverified pending status and delegates to repository', async () => {
    const result = await registerLearningSource(
      { userId: TENANT_A_USER_ID, workspaceId: TENANT_A_WORKSPACE_ID, role: 'owner' },
      {
        platform: 'instagram',
        url: 'https://www.instagram.com/tenant_a_biz/',
        consent: { text: true, images: true },
      },
      defaultDeps,
    )

    expect(result.sourceId).toBe(tenantASource.sourceId)
    expect(defaultDeps.normalizeUrl).toHaveBeenCalledWith(
      'instagram',
      'https://www.instagram.com/tenant_a_biz/',
    )
    expect(defaultDeps.repository.registerSource).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: TENANT_A_WORKSPACE_ID,
        platform: 'instagram',
        canonicalIdentity: 'tenant_a_biz',
        consent: { text: true, images: true },
      }),
    )
  })
})
