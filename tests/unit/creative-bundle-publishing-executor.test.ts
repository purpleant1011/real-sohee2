import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  executeCreativeBundlePublish,
  type BundleExecutorDependencies,
} from '@/features/publishing/creative-bundle-publishing-executor'
import type { CreativeBundle } from '@/features/creative/creative-bundle-types'
import type { MediaAsset, PublishRendition } from '@/features/media/media-asset-types'

describe('Strict CreativeBundle Delivery Executor (ANI-1083)', () => {
  const dummyBundle: CreativeBundle = {
    bundleId: 'bundle-tart-100',
    workspaceId: 'ws-bakery',
    contentId: 'cnt-10',
    versionId: 'ver-10',
    channel: 'instagram',
    caption: '단호박 타르트 가을 한정 출시! 진한 풍미를 만나보세요 🥧',
    hashtags: ['#단호박타르트', '#디저트'],
    orderedMedia: [
      {
        mediaAssetId: 'media-asset-1',
        sha256Digest: 'a'.repeat(64),
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

  const dummyAsset: MediaAsset = {
    id: 'media-asset-1',
    workspace_id: 'ws-bakery',
    bucket_id: 'content-media',
    object_path: 'ws-bakery/cnt-10/ver-10/media-asset-1.png',
    kind: 'content',
    source_type: 'GENERATED_OPENAI',
    mime_type: 'image/png',
    size_bytes: 1024000,
    width: 1024,
    height: 1024,
    sha256_digest: 'a'.repeat(64),
    rights_status: 'confirmed',
    lifecycle_status: 'READY',
    publish_eligibility: true,
    generation_metadata: {},
    created_by: 'user-1',
    created_at: new Date().toISOString(),
  }

  const dummyRendition: PublishRendition = {
    id: 'rendition-1',
    workspace_id: 'ws-bakery',
    source_media_asset_id: 'media-asset-1',
    channel: 'instagram',
    transform_policy_version: 'v10',
    format: 'image/jpeg',
    quality: 90,
    width: 1080,
    height: 1080,
    aspect_ratio: '1:1',
    storage_bucket: 'content-media',
    object_path: 'ws-bakery/cnt-10/ver-10/rendition-1.jpg',
    rendition_sha256: 'b'.repeat(64),
    created_at: new Date().toISOString(),
  }

  const mockDeps: BundleExecutorDependencies = {
    loadApprovedBundle: vi.fn(),
    loadMediaAsset: vi.fn(),
    loadOrCreatePublishRendition: vi.fn(),
    leaseGateway: {
      createSignedUrl: vi.fn(),
      probeUrl: vi.fn(),
    },
    loadCredential: vi.fn(),
    providerPublish: vi.fn(),
    readbackDependencies: {
      fetchPublishedPost: vi.fn(),
      computePerceptualSimilarity: vi.fn(),
    },
    recordReceipt: vi.fn(),
  }

  beforeEach(() => {
    vi.clearAllMocks()
    mockDeps.loadApprovedBundle = vi.fn().mockResolvedValue(dummyBundle)
    mockDeps.loadMediaAsset = vi.fn().mockResolvedValue(dummyAsset)
    mockDeps.loadOrCreatePublishRendition = vi.fn().mockResolvedValue(dummyRendition)
    mockDeps.leaseGateway.createSignedUrl = vi.fn().mockResolvedValue({
      signedUrl: 'https://storage/signed/url?token=xyz',
      error: null,
    })
    mockDeps.leaseGateway.probeUrl = vi.fn().mockResolvedValue({ ok: true, status: 200, contentType: 'image/jpeg' })
    mockDeps.loadCredential = vi.fn().mockResolvedValue({
      accessToken: 'meta-access-token-123',
      externalAccountId: 'ig-account-456',
    })
    mockDeps.providerPublish = vi.fn().mockResolvedValue({
      providerPostId: 'published-ig-post-999',
      destinationUrl: 'https://instagram.com/p/published-ig-post-999',
    })
    mockDeps.readbackDependencies.fetchPublishedPost = vi.fn().mockResolvedValue({
      providerPostId: 'published-ig-post-999',
      channel: 'instagram',
      caption: '단호박 타르트 가을 한정 출시! 진한 풍미를 만나보세요 🥧',
      permalink: 'https://instagram.com/p/published-ig-post-999',
      mediaItems: [{ id: 'm-1', mediaType: 'IMAGE', mediaUrl: 'https://cdn.instagram.com/test.jpg', position: 0 }],
      timestamp: new Date().toISOString(),
    })
    mockDeps.readbackDependencies.computePerceptualSimilarity = vi.fn().mockResolvedValue({ similarity: 0.96 })
    mockDeps.recordReceipt = vi.fn().mockResolvedValue(undefined)
  })

  it('publishes successfully from approved CreativeBundle without any raw imageUrl input', async () => {
    const outcome = await executeCreativeBundlePublish(
      {
        workspaceId: 'ws-bakery',
        scheduleId: 'sched-100',
        creativeBundleId: 'bundle-tart-100',
        expectedFingerprint: 'f'.repeat(64),
        channelConnectionId: 'conn-1',
        actorUserId: 'user-admin',
      },
      mockDeps
    )

    expect(outcome.ok).toBe(true)
    expect(outcome.providerPostId).toBe('published-ig-post-999')
    expect(outcome.verificationOutcome).toBe('VERIFIED')
    expect(outcome.receiptState).toBe('VERIFIED')
    expect(mockDeps.recordReceipt).toHaveBeenCalled()
  })

  it('fails closed when bundle fingerprint does not match expected fingerprint (TOCTOU guard)', async () => {
    const outcome = await executeCreativeBundlePublish(
      {
        workspaceId: 'ws-bakery',
        scheduleId: 'sched-100',
        creativeBundleId: 'bundle-tart-100',
        expectedFingerprint: 'wrong-stale-fingerprint'.padEnd(64, '0'),
        channelConnectionId: 'conn-1',
        actorUserId: 'user-admin',
      },
      mockDeps
    )

    expect(outcome.ok).toBe(false)
    expect(outcome.errorCode).toBe('FINGERPRINT_MISMATCH')
    expect(mockDeps.providerPublish).not.toHaveBeenCalled()
  })

  it('fails closed when bundle approval status is not APPROVED (e.g. SUPERSEDED)', async () => {
    const depsWithSuperseded = {
      ...mockDeps,
      loadApprovedBundle: vi.fn().mockResolvedValue({
        ...dummyBundle,
        approvalStatus: 'SUPERSEDED',
      }),
    }

    const outcome = await executeCreativeBundlePublish(
      {
        workspaceId: 'ws-bakery',
        scheduleId: 'sched-100',
        creativeBundleId: 'bundle-tart-100',
        expectedFingerprint: 'f'.repeat(64),
        channelConnectionId: 'conn-1',
        actorUserId: 'user-admin',
      },
      depsWithSuperseded
    )

    expect(outcome.ok).toBe(false)
    expect(outcome.errorCode).toBe('BUNDLE_NOT_APPROVED')
    expect(mockDeps.providerPublish).not.toHaveBeenCalled()
  })

  it('fails closed if media asset digest has been corrupted or does not match bundle', async () => {
    const depsWithCorruptAsset = {
      ...mockDeps,
      loadMediaAsset: vi.fn().mockResolvedValue({
        ...dummyAsset,
        sha256_digest: 'corrupt-hash'.padEnd(64, '0'),
      }),
    }

    const outcome = await executeCreativeBundlePublish(
      {
        workspaceId: 'ws-bakery',
        scheduleId: 'sched-100',
        creativeBundleId: 'bundle-tart-100',
        expectedFingerprint: 'f'.repeat(64),
        channelConnectionId: 'conn-1',
        actorUserId: 'user-admin',
      },
      depsWithCorruptAsset
    )

    expect(outcome.ok).toBe(false)
    expect(outcome.errorCode).toBe('MEDIA_DIGEST_CORRUPT')
    expect(mockDeps.providerPublish).not.toHaveBeenCalled()
  })

  it('fails closed when cross-workspace bundle execution is attempted', async () => {
    const outcome = await executeCreativeBundlePublish(
      {
        workspaceId: 'ws-other-hacker',
        scheduleId: 'sched-100',
        creativeBundleId: 'bundle-tart-100',
        expectedFingerprint: 'f'.repeat(64),
        channelConnectionId: 'conn-1',
        actorUserId: 'user-admin',
      },
      mockDeps
    )

    expect(outcome.ok).toBe(false)
    expect(outcome.errorCode).toBe('CROSS_WORKSPACE_FORBIDDEN')
    expect(mockDeps.providerPublish).not.toHaveBeenCalled()
  })
})
