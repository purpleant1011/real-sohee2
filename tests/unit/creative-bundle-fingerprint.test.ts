import { describe, it, expect } from 'vitest'
import {
  calculateBundleFingerprint,
  createCreativeBundle,
  mutateCreativeBundle,
} from '@/features/creative/creative-bundle-engine'
import type { BundleOrderedMediaItem } from '@/features/creative/creative-bundle-types'

describe('ANI-1080: CreativeBundle v1 + SHA-256 exact fingerprint contract', () => {
  const sampleMedia: BundleOrderedMediaItem[] = [
    {
      mediaAssetId: 'media-01',
      sha256Digest: '1111111111111111111111111111111111111111111111111111111111111111',
      position: 0,
      role: 'primary',
    },
    {
      mediaAssetId: 'media-02',
      sha256Digest: '2222222222222222222222222222222222222222222222222222222222222222',
      position: 1,
      role: 'carousel_item',
    },
  ]

  const baseInput = {
    workspaceId: 'ws-test-01',
    contentId: 'content-01',
    versionId: 'version-01',
    channel: 'instagram' as const,
    caption: '달콤한 단호박 타르트가 완성되었습니다.',
    hashtags: ['#단호박타르트', '#소희네베이커리'],
    orderedMedia: sampleMedia,
    creativeBriefVersion: 'v10.0',
  }

  it('produces identical fingerprint for identical canonical inputs', () => {
    const fp1 = calculateBundleFingerprint(baseInput)
    const fp2 = calculateBundleFingerprint(baseInput)

    expect(fp1).toHaveLength(64)
    expect(fp1).toMatch(/^[a-f0-9]{64}$/)
    expect(fp1).toBe(fp2)
  })

  it('changes fingerprint when caption changes by even 1 character', () => {
    const originalFp = calculateBundleFingerprint(baseInput)
    const modifiedFp = calculateBundleFingerprint({
      ...baseInput,
      caption: '달콤한 단호박 타르트가 완성되었습니다!', // exclamation mark added
    })

    expect(originalFp).not.toBe(modifiedFp)
  })

  it('changes fingerprint when media ordering changes', () => {
    const originalFp = calculateBundleFingerprint(baseInput)
    const reorderedMedia: BundleOrderedMediaItem[] = [
      { ...sampleMedia[1], position: 0, role: 'primary' },
      { ...sampleMedia[0], position: 1, role: 'carousel_item' },
    ]
    const reorderedFp = calculateBundleFingerprint({
      ...baseInput,
      orderedMedia: reorderedMedia,
    })

    expect(originalFp).not.toBe(reorderedFp)
  })

  it('changes fingerprint when channel changes', () => {
    const igFp = calculateBundleFingerprint(baseInput)
    const threadsFp = calculateBundleFingerprint({
      ...baseInput,
      channel: 'threads',
    })

    expect(igFp).not.toBe(threadsFp)
  })

  it('automatically transitions approvalStatus to SUPERSEDED when mutated', () => {
    const bundle = createCreativeBundle(baseInput)
    bundle.approvalStatus = 'APPROVED'

    const mutated = mutateCreativeBundle(bundle, {
      caption: '새로운 가을 프로모션 캡션',
    })

    expect(mutated.approvalStatus).toBe('SUPERSEDED')
    expect(mutated.bundleFingerprint).not.toBe(bundle.bundleFingerprint)
  })
})
