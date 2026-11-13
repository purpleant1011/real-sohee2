import { describe, it, expect } from 'vitest'
import { createCreativeBundle } from '@/features/creative/creative-bundle-engine'
import {
  recordBundleApproval,
  preflightPublishAdmission,
  ApprovalIntegrityError,
} from '@/features/creative/approval-invalidation-engine'
import type { BundleOrderedMediaItem } from '@/features/creative/creative-bundle-types'

describe('ANI-1081: Approval Invalidation & TOCTOU Protection Engine', () => {
  const sampleMedia: BundleOrderedMediaItem[] = [
    {
      mediaAssetId: 'media-01',
      sha256Digest: '3333333333333333333333333333333333333333333333333333333333333333',
      position: 0,
      role: 'primary',
    },
  ]

  const bundle = createCreativeBundle({
    workspaceId: 'ws-test-01',
    contentId: 'c-01',
    versionId: 'v-01',
    channel: 'instagram',
    caption: '원고 승인 테스트 캡션입니다.',
    hashtags: ['#테스트'],
    orderedMedia: sampleMedia,
  })

  it('admits publishing when bundle has not changed since approval', () => {
    const { bundle: approvedBundle, approval } = recordBundleApproval({
      bundle,
      approvedBy: 'user-manager-01',
    })

    const result = preflightPublishAdmission({
      bundle: approvedBundle,
      approval,
    })

    expect(result.admitted).toBe(true)
    expect(result.currentFingerprint).toBe(approval.bundleFingerprint)
  })

  it('rejects publishing (TOCTOU) when image is swapped after approval', () => {
    const { approval } = recordBundleApproval({
      bundle,
      approvedBy: 'user-manager-01',
    })

    // Malicious or accidental image swap after approval
    const mutatedBundle = {
      ...bundle,
      orderedMedia: [
        {
          mediaAssetId: 'media-swapped-99',
          sha256Digest: '4444444444444444444444444444444444444444444444444444444444444444',
          position: 0,
          role: 'primary' as const,
        },
      ],
    }

    expect(() =>
      preflightPublishAdmission({
        bundle: mutatedBundle,
        approval,
      })
    ).toThrowError(ApprovalIntegrityError)

    expect(() =>
      preflightPublishAdmission({
        bundle: mutatedBundle,
        approval,
      })
    ).toThrowError(/TOCTOU violation detected/)
  })

  it('rejects publishing when caption is edited after approval', () => {
    const { approval } = recordBundleApproval({
      bundle,
      approvedBy: 'user-manager-01',
    })

    const mutatedBundle = {
      ...bundle,
      caption: '수정된 캡션입니다 (승인 이후 변경)',
    }

    expect(() =>
      preflightPublishAdmission({
        bundle: mutatedBundle,
        approval,
      })
    ).toThrowError(ApprovalIntegrityError)
  })
})
