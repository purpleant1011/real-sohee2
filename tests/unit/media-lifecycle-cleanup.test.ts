import { describe, it, expect } from 'vitest'
import {
  evaluateMediaDeletionEligibility,
  reconcileStorageOrphans,
  isProductionCustomerMetricsEligible,
  filterCustomerMetricPosts,
  type ProductionPostEntity,
} from '@/features/media/media-lifecycle-cleanup'

describe('Media Lifecycle Retention & Golden Test Hygiene (ANI-1108)', () => {
  it('blocks deletion of approved or published assets regardless of age', () => {
    const oldDate = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString()
    const result = evaluateMediaDeletionEligibility({
      mediaAssetId: 'ma-pumpkin-approved',
      status: 'READY',
      isApproved: true,
      isPublished: true,
      isEvidenceReferenced: true,
      createdAt: oldDate,
    })

    expect(result.eligible).toBe(false)
    expect(result.nextState).toBe('RETENTION_HOLD')
    expect(result.reason).toContain('deletion strictly forbidden')
  })

  it('keeps superseded asset in RETENTION_HOLD if within 72h window', () => {
    const recentSuperseded = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
    const result = evaluateMediaDeletionEligibility({
      mediaAssetId: 'ma-superseded-recent',
      status: 'READY',
      isApproved: false,
      isPublished: false,
      isEvidenceReferenced: false,
      createdAt: recentSuperseded,
      supersededAt: recentSuperseded,
    })

    expect(result.eligible).toBe(false)
    expect(result.nextState).toBe('RETENTION_HOLD')
    expect(result.reason).toContain('cooling hold')
  })

  it('marks unreferenced superseded asset CLEANUP_ELIGIBLE after 72h retention window', () => {
    const oldSuperseded = new Date(Date.now() - 80 * 60 * 60 * 1000).toISOString()
    const result = evaluateMediaDeletionEligibility({
      mediaAssetId: 'ma-superseded-old',
      status: 'READY',
      isApproved: false,
      isPublished: false,
      isEvidenceReferenced: false,
      createdAt: oldSuperseded,
      supersededAt: oldSuperseded,
    })

    expect(result.eligible).toBe(true)
    expect(result.nextState).toBe('CLEANUP_ELIGIBLE')
  })

  it('accurately reconciles orphan storage objects and missing DB paths', () => {
    const storagePaths = [
      'workspaces/ws-01/media/source/ma-01.png',
      'workspaces/ws-01/media/source/ma-orphan-02.png',
      'workspaces/ws-01/media/source/ma-03.png',
    ]
    const dbPaths = [
      'workspaces/ws-01/media/source/ma-01.png',
      'workspaces/ws-01/media/source/ma-03.png',
      'workspaces/ws-01/media/source/ma-missing-db-04.png',
    ]

    const reconciliation = reconcileStorageOrphans(storagePaths, dbPaths)
    expect(reconciliation.orphanStoragePaths).toEqual(['workspaces/ws-01/media/source/ma-orphan-02.png'])
    expect(reconciliation.missingStoragePaths).toEqual(['workspaces/ws-01/media/source/ma-missing-db-04.png'])
    expect(reconciliation.healthyCount).toBe(2)
  })

  it('filters test posts out of customer marketing metrics', () => {
    const posts: ProductionPostEntity[] = [
      {
        id: 'post-cust-01',
        workspaceId: 'ws-cust-01',
        caption: '실제 고객 게시물',
        impressions: 500,
        likes: 50,
      },
      {
        id: 'post-test-02',
        workspaceId: 'ws-cust-01',
        caption: '골든 테스트 게시물',
        testRunId: 'golden-run-1092',
        isTestPost: true,
        purpose: 'GOLDEN_JOURNEY',
        impressions: 10,
        likes: 1,
      },
    ]

    expect(isProductionCustomerMetricsEligible(posts[0])).toBe(true)
    expect(isProductionCustomerMetricsEligible(posts[1])).toBe(false)

    const customerPosts = filterCustomerMetricPosts(posts)
    expect(customerPosts).toHaveLength(1)
    expect(customerPosts[0].id).toBe('post-cust-01')
  })
})
