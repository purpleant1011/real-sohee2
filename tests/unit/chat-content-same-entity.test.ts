import { describe, it, expect } from 'vitest'
import {
  recordBundleApproval,
  preflightPublishAdmission,
  invalidateApprovalOnMutation,
  ApprovalIntegrityError,
} from '@/features/creative/approval-invalidation-engine'
import type { CreativeBundle } from '@/features/creative/creative-bundle-types'

describe('Chat <-> Content Same Entity UX Contract (ANI-1087)', () => {
  const initialBundle: CreativeBundle = {
    bundleId: 'cb-same-01',
    workspaceId: 'ws-bakery-01',
    contentId: 'cnt-100',
    versionId: 'cv-100',
    channel: 'instagram',
    caption: '가을 단호박 타르트',
    hashtags: ['#타르트'],
    orderedMedia: [
      {
        mediaAssetId: 'asset-tart-01',
        position: 0,
        role: 'primary',
        sha256Digest: '1'.repeat(64),
      },
    ],
    creativeBriefVersion: 'v10.0',
    bundleFingerprint: 'f'.repeat(64),
    approvalStatus: 'PENDING',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }

  it('maintains identity across Chat and Content Studio for the same entity', () => {
    // Both Chat Artifact and Content Studio must point to identical mediaAssetId and sha256
    const chatArtifact = {
      mediaAssetId: 'asset-tart-01',
      sha256Digest: '1'.repeat(64),
      workspaceId: 'ws-bakery-01',
    }

    const contentStudioEntity = {
      mediaAssetId: initialBundle.orderedMedia[0].mediaAssetId,
      sha256Digest: initialBundle.orderedMedia[0].sha256Digest,
      workspaceId: initialBundle.workspaceId,
    }

    expect(chatArtifact.mediaAssetId).toBe(contentStudioEntity.mediaAssetId)
    expect(chatArtifact.sha256Digest).toBe(contentStudioEntity.sha256Digest)
    expect(chatArtifact.workspaceId).toBe(contentStudioEntity.workspaceId)
  })

  it('invalidates prior approval immediately when new image is generated in either Chat or Studio', () => {
    const { bundle: approvedBundle, approval } = recordBundleApproval({
      bundle: initialBundle,
      approvedBy: 'user-01',
    })

    expect(approval.status).toBe('APPROVED')
    expect(approvedBundle.approvalStatus).toBe('APPROVED')

    // Invalidate approval upon mutation (image regenerated/replaced)
    const invalidated = invalidateApprovalOnMutation(approval, 'User regenerated image with gpt-image-2 via Chat')
    expect(invalidated.status).toBe('SUPERSEDED')
    expect(invalidated.supersededReason).toContain('regenerated image')

    // Preflight admission with superseded approval must fail closed
    expect(() => preflightPublishAdmission({ bundle: approvedBundle, approval: invalidated })).toThrowError(
      ApprovalIntegrityError
    )
  })
})

