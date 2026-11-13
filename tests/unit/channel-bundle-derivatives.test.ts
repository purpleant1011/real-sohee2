import { describe, it, expect } from 'vitest'
import {
  deriveChannelBundles,
  verifyChannelApprovalIsolation,
} from '@/features/creative/channel-bundle-derivatives'
import type { BundleOrderedMediaItem } from '@/features/creative/creative-bundle-types'

describe('Channel-Specific Bundle Derivations (ANI-1082)', () => {
  const dummyMedia: BundleOrderedMediaItem[] = [
    {
      mediaAssetId: 'media-1',
      sha256Digest: 'a'.repeat(64),
      position: 0,
      role: 'primary',
    },
    {
      mediaAssetId: 'media-2',
      sha256Digest: 'b'.repeat(64),
      position: 1,
      role: 'carousel_item',
    },
  ]

  const baseInput = {
    workspaceId: 'ws-test',
    contentId: 'cnt-100',
    versionId: 'ver-1',
    sourceCaption: '달콤한 가을 단호박 타르트가 구워졌습니다. 고소한 타르트지와 부드러운 단호박 크림의 조화!',
    sourceHashtags: ['#단호박타르트', '#가을디저트', '#수제타르트', '#베이커리', '#디저트맛집'],
    sourceMedia: dummyMedia,
    creativeBriefVersion: 'v10.0',
  }

  it('derives distinct bundles for Instagram and Threads with different fingerprints', () => {
    const { instagramBundle, threadsBundle } = deriveChannelBundles(baseInput)

    expect(instagramBundle.channel).toBe('instagram')
    expect(threadsBundle.channel).toBe('threads')

    // Different channel fingerprints
    expect(instagramBundle.bundleFingerprint).not.toBe(threadsBundle.bundleFingerprint)

    // Instagram preserves all media
    expect(instagramBundle.orderedMedia.length).toBe(2)
    expect(instagramBundle.hashtags.length).toBe(5)

    // Threads adapts to top 3 hashtags and primary media
    expect(threadsBundle.hashtags.length).toBe(3)
    expect(threadsBundle.orderedMedia.length).toBe(1)
    expect(threadsBundle.orderedMedia[0].mediaAssetId).toBe('media-1')
  })

  it('strictly isolates channel approvals: Instagram approval cannot authorise Threads publishing', () => {
    const { instagramBundle, threadsBundle } = deriveChannelBundles(baseInput)

    const approvedInstagram = {
      ...instagramBundle,
      approvalStatus: 'APPROVED' as const,
      approvedFingerprint: instagramBundle.bundleFingerprint,
    }

    // Instagram approval against Threads bundle must be rejected
    const isIsoValid = verifyChannelApprovalIsolation(approvedInstagram, threadsBundle)
    expect(isIsoValid).toBe(false)

    // Instagram approval against Instagram bundle must pass
    const isInstagramValid = verifyChannelApprovalIsolation(approvedInstagram, instagramBundle)
    expect(isInstagramValid).toBe(true)
  })

  it('truncates long captions for Threads adaptation', () => {
    const longCaption = 'A'.repeat(600)
    const { threadsBundle } = deriveChannelBundles({
      ...baseInput,
      sourceCaption: longCaption,
    })

    expect(threadsBundle.caption.length).toBeLessThanOrEqual(500)
    expect(threadsBundle.caption.endsWith('...')).toBe(true)
  })
})
