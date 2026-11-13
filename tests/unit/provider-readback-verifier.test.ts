import { describe, it, expect, vi } from 'vitest'
import {
  verifyPublishedCreativeBundle,
  computeCaptionDigest,
  type ReadbackVerificationDependencies,
  type ProviderObservedPost,
} from '@/features/publishing/provider-readback-verifier'
import type { CreativeBundle } from '@/features/creative/creative-bundle-types'

describe('Provider Media Readback & Perceptual Equivalence Verifier (ANI-1084, ANI-1096)', () => {
  const dummyBundle: CreativeBundle = {
    bundleId: 'bundle-test',
    workspaceId: 'ws-bakery',
    contentId: 'cnt-1',
    versionId: 'ver-1',
    channel: 'instagram',
    caption: '달콤한 단호박 타르트 신메뉴 출시! 고소한 파이 시트에 진한 단호박 크림 가득 🎃',
    hashtags: ['#단호박타르트', '#베이커리신메뉴'],
    orderedMedia: [
      {
        mediaAssetId: 'media-tart-1',
        sha256Digest: '1'.repeat(64),
        position: 0,
        role: 'primary',
      },
    ],
    creativeBriefVersion: 'v10.0',
    bundleFingerprint: 'f'.repeat(64),
    approvalStatus: 'APPROVED',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }

  const dummyObservedPost: ProviderObservedPost = {
    providerPostId: 'ig-post-12345',
    channel: 'instagram',
    caption: '달콤한 단호박 타르트 신메뉴 출시! 고소한 파이 시트에 진한 단호박 크림 가득 🎃',
    permalink: 'https://instagram.com/p/ig-post-12345',
    mediaItems: [
      {
        id: 'ig-media-1',
        mediaType: 'IMAGE',
        mediaUrl: 'https://scontent.cdninstagram.com/v/t51/tart.jpg',
        position: 0,
      },
    ],
    timestamp: new Date().toISOString(),
  }

  it('verifies high-confidence match when JPEG compression/resizing preserves perceptual visual identity (VERIFIED)', async () => {
    const deps: ReadbackVerificationDependencies = {
      fetchPublishedPost: vi.fn().mockResolvedValue(dummyObservedPost),
      computePerceptualSimilarity: vi.fn().mockResolvedValue({ similarity: 0.94 }),
    }

    const result = await verifyPublishedCreativeBundle(
      dummyBundle,
      'ig-post-12345',
      'valid-meta-token',
      deps
    )

    expect(result.outcome).toBe('VERIFIED')
    expect(result.captionMatch).toBe(true)
    expect(result.visualScore).toBe(0.94)
    expect(result.reasonCode).toBe('HIGH_CONFIDENCE_VISUAL_MATCH')
  })

  it('detects 9th false-green mismatch: caption matches but image is wrong salon interior (VISUAL_MISMATCH)', async () => {
    const deps: ReadbackVerificationDependencies = {
      fetchPublishedPost: vi.fn().mockResolvedValue(dummyObservedPost),
      // Visual similarity between tart and salon is extremely low (e.g. 0.18)
      computePerceptualSimilarity: vi.fn().mockResolvedValue({ similarity: 0.18 }),
    }

    const result = await verifyPublishedCreativeBundle(
      dummyBundle,
      'ig-post-12345',
      'valid-meta-token',
      deps
    )

    expect(result.outcome).toBe('VISUAL_MISMATCH')
    expect(result.captionMatch).toBe(true)
    expect(result.visualScore).toBe(0.18)
    expect(result.reasonCode).toBe('PERCEPTUAL_VISUAL_MISMATCH')
  })

  it('rejects post when caption has been tampered with or does not match digest', async () => {
    const tamperedPost: ProviderObservedPost = {
      ...dummyObservedPost,
      caption: '완전히 다른 카피입니다. 살롱 펌 50% 할인 이벤트!',
    }

    const deps: ReadbackVerificationDependencies = {
      fetchPublishedPost: vi.fn().mockResolvedValue(tamperedPost),
      computePerceptualSimilarity: vi.fn().mockResolvedValue({ similarity: 0.95 }),
    }

    const result = await verifyPublishedCreativeBundle(
      dummyBundle,
      'ig-post-12345',
      'valid-meta-token',
      deps
    )

    expect(result.outcome).toBe('VISUAL_MISMATCH')
    expect(result.captionMatch).toBe(false)
    expect(result.reasonCode).toBe('CAPTION_DIGEST_MISMATCH')
  })

  it('flags gray-band similarity for manual review (0.65 .. 0.84)', async () => {
    const deps: ReadbackVerificationDependencies = {
      fetchPublishedPost: vi.fn().mockResolvedValue(dummyObservedPost),
      computePerceptualSimilarity: vi.fn().mockResolvedValue({ similarity: 0.72 }),
    }

    const result = await verifyPublishedCreativeBundle(
      dummyBundle,
      'ig-post-12345',
      'valid-meta-token',
      deps
    )

    expect(result.outcome).toBe('MANUAL_REVIEW_REQUIRED')
    expect(result.reasonCode).toBe('GRAY_BAND_SIMILARITY')
  })

  it('returns VERIFICATION_PENDING if provider media has not finished processing yet', async () => {
    const pendingPost: ProviderObservedPost = {
      ...dummyObservedPost,
      mediaItems: [],
    }

    const deps: ReadbackVerificationDependencies = {
      fetchPublishedPost: vi.fn().mockResolvedValue(pendingPost),
      computePerceptualSimilarity: vi.fn(),
    }

    const result = await verifyPublishedCreativeBundle(
      dummyBundle,
      'ig-post-12345',
      'valid-meta-token',
      deps
    )

    expect(result.outcome).toBe('VERIFICATION_PENDING')
    expect(result.reasonCode).toBe('OBSERVED_MEDIA_EMPTY')
  })
})
