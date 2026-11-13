import { describe, it, expect } from 'vitest'
import {
  resolveCreativeAssetFeatureFlags,
  evaluatePublishAdmission,
  resolveHistoricalMediaPresentation,
} from '@/features/publishing/creative-bundle-migration-guard'

describe('Creative Bundle Migration Guard & Compatibility (ANI-1103)', () => {
  it('default flags enable creative asset truth v10 and deny raw imageUrl publishing', () => {
    const flags = resolveCreativeAssetFeatureFlags()
    expect(flags.creativeAssetTruthV10).toBe(true)
    expect(flags.denyRawImageUrlPublish).toBe(true)
    expect(flags.allowHistoricalRenderOnly).toBe(true)
  })

  it('rejects publishing request containing only raw imageUrl without CreativeBundle (Fail-Closed)', () => {
    const decision = evaluatePublishAdmission({
      workspaceId: 'ws-test-01',
      contentVersionId: 'cv-legacy-01',
      rawImageUrl: 'https://images.unsplash.com/photo-tart',
    })

    expect(decision.admitted).toBe(false)
    expect(decision.code).toBe('RAW_IMAGE_URL_FORBIDDEN')
    expect(decision.reason).toContain('Publishing raw imageUrl is forbidden')
  })

  it('rejects publishing request missing creativeBundleId under v10', () => {
    const decision = evaluatePublishAdmission({
      workspaceId: 'ws-test-01',
      contentVersionId: 'cv-new-01',
    })

    expect(decision.admitted).toBe(false)
    expect(decision.code).toBe('BUNDLE_REQUIRED')
  })

  it('admits publishing request with verified CreativeBundle', () => {
    const decision = evaluatePublishAdmission({
      workspaceId: 'ws-test-01',
      contentVersionId: 'cv-new-01',
      creativeBundleId: 'cb-pumpkin-1001',
    })

    expect(decision.admitted).toBe(true)
    expect(decision.code).toBe('ADMITTED_CANONICAL_BUNDLE')
  })

  it('denies static mock/stock publishing even during rollback drill', () => {
    const rollbackFlags = {
      creativeAssetTruthV10: false,
      denyRawImageUrlPublish: false,
      allowHistoricalRenderOnly: true,
    }

    const decision = evaluatePublishAdmission(
      {
        workspaceId: 'ws-test-01',
        contentVersionId: 'cv-rollback-01',
        rawImageUrl: 'https://example.com/sohee_insta_post.jpg',
      },
      rollbackFlags
    )

    expect(decision.admitted).toBe(false)
    expect(decision.code).toBe('RAW_IMAGE_URL_FORBIDDEN')
    expect(decision.reason).toContain('Static/stock placeholder images cannot be published')
  })

  it('preserves historical read view while blocking publishing for legacy image content', () => {
    const historicalItem = {
      id: 'item-historical-01',
      contentId: 'cnt-old-01',
      versionId: 'cv-old-01',
      legacyImageUrl: 'https://cdn.example.com/legacy_image.png',
      canonicalMediaAssetId: null,
      createdAt: '2026-08-01T00:00:00Z',
    }

    const presentation = resolveHistoricalMediaPresentation(historicalItem)
    expect(presentation.canRenderHistoricalView).toBe(true)
    expect(presentation.displayImageUrl).toBe('https://cdn.example.com/legacy_image.png')
    expect(presentation.publishEligibility).toBe(false)
    expect(presentation.migrationStatus).toBe('LEGACY_RENDER_ONLY')
    expect(presentation.advisoryNote).toContain('직접 게시는 제한됩니다')
  })

  it('resolves canonical media preview and allows publishing for v10 items', () => {
    const canonicalItem = {
      id: 'item-v10-01',
      contentId: 'cnt-new-01',
      versionId: 'cv-new-01',
      legacyImageUrl: null,
      canonicalMediaAssetId: 'ma-pumpkin-001',
      createdAt: '2026-09-08T00:00:00Z',
    }

    const presentation = resolveHistoricalMediaPresentation(canonicalItem)
    expect(presentation.canRenderHistoricalView).toBe(true)
    expect(presentation.displayImageUrl).toBe('/api/media/ma-pumpkin-001/preview')
    expect(presentation.publishEligibility).toBe(true)
    expect(presentation.migrationStatus).toBe('CANONICAL_V10')
    expect(presentation.advisoryNote).toBeNull()
  })
})
