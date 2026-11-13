import { describe, it, expect } from 'vitest'
import {
  evaluateMediaRightsAndSafety,
  validateCarouselMediaIntegrity,
} from '@/features/creative/rights-safety-gate'
import type { MediaAsset, ContentVersionMediaBinding } from '@/features/media/media-asset-types'
import { CreativeGenerationError } from '@/features/creative/creative-generation-types'

describe('ANI-1079 & ANI-1098: Rights, Consent, and Moderation Visual Safety Gate', () => {
  const asset: MediaAsset = {
    id: 'asset-safe-01',
    workspace_id: 'ws-test-01',
    bucket_id: 'content-media',
    object_path: 'workspaces/ws-test-01/media/source/asset-safe-01/original.png',
    kind: 'content',
    source_type: 'GENERATED_OPENAI',
    mime_type: 'image/png',
    size_bytes: 500_000,
    width: 1024,
    height: 1024,
    sha256_digest: '11223344556677889900aabbccddeeff11223344556677889900aabbccddeeff',
    rights_status: 'approved',
    lifecycle_status: 'READY',
    publish_eligibility: true,
    generation_metadata: {},
    created_by: 'system',
    created_at: new Date().toISOString(),
  }

  it('permits publishing for approved product-only asset', () => {
    const evalResult = evaluateMediaRightsAndSafety({
      workspaceId: 'ws-test-01',
      mediaAsset: asset,
      containsIdentifiablePerson: false,
    })

    expect(evalResult.eligibleForPublish).toBe(true)
    expect(evalResult.violations).toHaveLength(0)
  })

  it('blocks publishing when identifiable person lacks consent (ANI-1079)', () => {
    const evalResult = evaluateMediaRightsAndSafety({
      workspaceId: 'ws-test-01',
      mediaAsset: asset,
      containsIdentifiablePerson: true,
      personConsentGranted: false,
    })

    expect(evalResult.eligibleForPublish).toBe(false)
    expect(evalResult.violations).toContain('PERSON_CONSENT_MISSING')
  })

  it('blocks publishing when moderation fails', () => {
    const evalResult = evaluateMediaRightsAndSafety({
      workspaceId: 'ws-test-01',
      mediaAsset: asset,
      moderationBlocked: true,
    })

    expect(evalResult.eligibleForPublish).toBe(false)
    expect(evalResult.violations).toContain('MODERATION_BLOCKED')
  })

  it('blocks cross-workspace carousel bindings (ANI-1098)', () => {
    const foreignAsset: MediaAsset = {
      ...asset,
      id: 'asset-foreign-02',
      workspace_id: 'ws-other-02', // Different workspace
    }

    const bindings: ContentVersionMediaBinding[] = [
      {
        workspace_id: 'ws-test-01',
        version_id: 'v-01',
        media_asset_id: 'asset-foreign-02',
        position: 0,
        role: 'primary',
        created_at: new Date().toISOString(),
      },
    ]

    expect(() =>
      validateCarouselMediaIntegrity('ws-test-01', bindings, [foreignAsset])
    ).toThrowError(CreativeGenerationError)
  })
})
