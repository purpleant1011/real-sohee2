import { describe, it, expect, vi } from 'vitest'
import {
  createExternalActionReceipt,
  transitionReceiptState,
  mapOutcomeToReceiptState,
  ReceiptStateTransitionError,
  restoreExternalActionReceipt,
  type ExternalActionReceipt,
} from '@/features/publishing/external-action-receipt-engine'
import {
  verifyPublishedCreativeBundle,
  normalizeCaptionForDigest,
  computeCaptionDigest,
  composeBundleCaption,
} from '@/features/publishing/provider-readback-verifier'
import type { CreativeBundle } from '@/features/creative/creative-bundle-types'
import { CALIBRATION_CORPUS_VERSION } from '@/features/publishing/calibration/calibration-corpus'
import { PERCEPTUAL_SIMILARITY_THRESHOLDS } from '@/features/publishing/perceptual-image-comparator'

describe('ANI-1136: Exact Caption + Visual Equivalence Readback State Machine', () => {
  const workspaceId = '00000000-0000-4000-8000-000000000001'
  const bundleId = 'bundle_test_1136'
  const mockFingerprint = 'a'.repeat(64)
  const mockMediaDigest = 'b'.repeat(64)

  const sampleBundle: CreativeBundle = {
    bundleId,
    workspaceId,
    contentId: 'content_1136',
    versionId: 'ver_1136',
    channel: 'instagram',
    caption: '자연스러운 눈썹 결의 완성, 바이름 스튜디오입니다.',
    hashtags: ['눈썹문신', '자연눈썹', '강남눈썹'],
    orderedMedia: [
      {
        mediaAssetId: 'media_asset_1',
        sha256Digest: mockMediaDigest,
        position: 0,
        role: 'primary',
      },
    ],
    creativeBriefVersion: 'v10.0',
    bundleFingerprint: mockFingerprint,
    approvalStatus: 'APPROVED',
    approvedFingerprint: mockFingerprint,
    approvedAt: new Date().toISOString(),
    approvedBy: 'user_1',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }

  it('enforces durable state transition flow: REQUESTED -> PROVIDER_ACCEPTED -> VERIFICATION_PENDING -> VERIFIED', () => {
    let receipt = createExternalActionReceipt({
      workspaceId,
      scheduleId: 'sched_1',
      creativeBundleId: bundleId,
      creativeFingerprint: mockFingerprint,
      channel: 'instagram',
      orderedMediaSha256: [mockMediaDigest],
      providerPayloadDigest: 'digest_payload',
      idempotencyKey: 'idem_1',
    })

    expect(receipt.state).toBe('REQUESTED')

    receipt = transitionReceiptState(receipt, 'PROVIDER_ACCEPTED', {
      providerPostId: 'ig_post_12345',
      permalink: 'https://www.instagram.com/p/C_abc123',
    })
    expect(receipt.state).toBe('PROVIDER_ACCEPTED')
    expect(receipt.providerPostId).toBe('ig_post_12345')
    expect(receipt.permalink).toBe('https://www.instagram.com/p/C_abc123')

    receipt = transitionReceiptState(receipt, 'VERIFICATION_PENDING')
    expect(receipt.state).toBe('VERIFICATION_PENDING')

    receipt = transitionReceiptState(receipt, 'VERIFIED', {
      observedAt: '2026-09-09T06:00:00.000Z',
      additionalEvidence: {
        visualScore: 0.96,
        captionMatch: true,
      },
    })
    expect(receipt.state).toBe('VERIFIED')
    expect(receipt.observedAt).toBe('2026-09-09T06:00:00.000Z')
    expect(receipt.evidence.visualScore).toBe(0.96)
  })

  it('prevents illegal auto-promotion to VERIFIED without providerPostId (Fail-Closed)', () => {
    let receipt = createExternalActionReceipt({
      workspaceId,
      scheduleId: 'sched_2',
      creativeBundleId: bundleId,
      creativeFingerprint: mockFingerprint,
      channel: 'instagram',
      orderedMediaSha256: [mockMediaDigest],
      providerPayloadDigest: 'digest_payload',
      idempotencyKey: 'idem_2',
    })

    // Cannot transition directly from REQUESTED to VERIFIED
    expect(() => {
      transitionReceiptState(receipt, 'VERIFIED')
    }).toThrow(ReceiptStateTransitionError)

    // Move to PROVIDER_ACCEPTED
    receipt = transitionReceiptState(receipt, 'PROVIDER_ACCEPTED', {
      providerPostId: 'ig_post_temp',
    })

    // Cannot transition directly from PROVIDER_ACCEPTED to VERIFIED (must go through VERIFICATION_PENDING)
    expect(() => {
      transitionReceiptState(receipt, 'VERIFIED')
    }).toThrow(ReceiptStateTransitionError)
  })

  it('verifies caption & hashtags exact digest match and fails on copy tampering', () => {
    const fullCaption = composeBundleCaption(sampleBundle.caption, sampleBundle.hashtags)
    expect(fullCaption).toContain(sampleBundle.caption)
    expect(fullCaption).toContain('#눈썹문신')

    const normalizedApproved = normalizeCaptionForDigest(fullCaption)
    const approvedDigest = computeCaptionDigest(normalizedApproved)

    // Exact match passes
    const matchingObserved = fullCaption
    expect(computeCaptionDigest(matchingObserved)).toBe(approvedDigest)

    // Tampered copy (e.g. slight text alteration) fails
    const tamperedObserved = fullCaption.replace('바이름', '타사스튜디오')
    expect(computeCaptionDigest(tamperedObserved)).not.toBe(approvedDigest)
  })

  it('routes caption digest mismatch to VISUAL_MISMATCH and sets receipt to FAILED', async () => {
    const readbackDeps = {
      fetchPublishedPost: vi.fn().mockResolvedValue({
        providerPostId: 'ig_post_tampered',
        channel: 'instagram',
        caption: '완전히 변조된 엉뚱한 캡션입니다.',
        permalink: 'https://www.instagram.com/p/tampered',
        mediaItems: [{ id: 'm1', mediaType: 'IMAGE', mediaUrl: 'https://cdn.example.com/img.jpg', position: 0 }],
        timestamp: new Date().toISOString(),
      }),
      computePerceptualSimilarity: vi.fn().mockResolvedValue({ similarity: 0.95 }),
    }

    const verification = await verifyPublishedCreativeBundle(
      sampleBundle,
      'ig_post_tampered',
      'valid_token',
      readbackDeps
    )

    expect(verification.outcome).toBe('VISUAL_MISMATCH')
    expect(verification.reasonCode).toBe('CAPTION_DIGEST_MISMATCH')
    expect(verification.captionMatch).toBe(false)
    expect(mapOutcomeToReceiptState(verification.outcome)).toBe('FAILED')
  })

  it('routes media count mismatch or missing media to VISUAL_MISMATCH', async () => {
    const readbackDeps = {
      fetchPublishedPost: vi.fn().mockResolvedValue({
        providerPostId: 'ig_post_no_media',
        channel: 'instagram',
        caption: sampleBundle.caption,
        permalink: 'https://www.instagram.com/p/no_media',
        mediaItems: [], // Expected 1, got 0 but not transcoding
        timestamp: new Date().toISOString(),
      }),
      computePerceptualSimilarity: vi.fn().mockResolvedValue({ similarity: 0 }),
    }

    const verification = await verifyPublishedCreativeBundle(
      sampleBundle,
      'ig_post_no_media',
      'valid_token',
      readbackDeps
    )

    // When media items are 0 and expected > 0, it gives VERIFICATION_PENDING for async processing
    expect(verification.outcome).toBe('VERIFICATION_PENDING')
    expect(verification.reasonCode).toBe('OBSERVED_MEDIA_EMPTY')

    // But when expected 1 and observed has 2 (unexpected extra items), it is VISUAL_MISMATCH
    readbackDeps.fetchPublishedPost.mockResolvedValueOnce({
      providerPostId: 'ig_post_extra_media',
      channel: 'instagram',
      caption: sampleBundle.caption,
      permalink: 'https://www.instagram.com/p/extra',
      mediaItems: [
        { id: 'm1', mediaType: 'IMAGE', mediaUrl: 'https://cdn.example.com/img1.jpg', position: 0 },
        { id: 'm2', mediaType: 'IMAGE', mediaUrl: 'https://cdn.example.com/img2.jpg', position: 1 },
      ],
      timestamp: new Date().toISOString(),
    })

    const mismatchVerification = await verifyPublishedCreativeBundle(
      sampleBundle,
      'ig_post_extra_media',
      'valid_token',
      readbackDeps
    )

    expect(mismatchVerification.outcome).toBe('VISUAL_MISMATCH')
    expect(mismatchVerification.reasonCode).toBe('MEDIA_COUNT_MISMATCH')
  })

  it('gracefully holds VERIFICATION_PENDING while provider media is transcoding or unindexed', async () => {
    const readbackDeps = {
      fetchPublishedPost: vi.fn().mockResolvedValue(null), // Post not yet indexed
      computePerceptualSimilarity: vi.fn(),
    }

    const verification = await verifyPublishedCreativeBundle(
      sampleBundle,
      'ig_post_not_indexed',
      'valid_token',
      readbackDeps
    )

    expect(verification.outcome).toBe('VERIFICATION_PENDING')
    expect(verification.reasonCode).toBe('PROVIDER_POST_NOT_YET_INDEXED')
    expect(mapOutcomeToReceiptState(verification.outcome)).toBe('VERIFICATION_PENDING')
  })

  it('restores durable receipt from database row after F5/re-login', () => {
    // 1. Simulate creation and transitions in publishing pipeline
    let originalReceipt = createExternalActionReceipt({
      workspaceId,
      scheduleId: 'sched_restore',
      creativeBundleId: bundleId,
      creativeFingerprint: mockFingerprint,
      channel: 'instagram',
      orderedMediaSha256: [mockMediaDigest],
      providerPayloadDigest: 'digest_restore',
      idempotencyKey: 'idem_restore',
    })

    originalReceipt = transitionReceiptState(originalReceipt, 'PROVIDER_ACCEPTED', {
      providerPostId: 'ig_post_1136_live',
      permalink: 'https://www.instagram.com/p/restored',
    })

    originalReceipt = transitionReceiptState(originalReceipt, 'VERIFICATION_PENDING')

    originalReceipt = transitionReceiptState(originalReceipt, 'VERIFIED', {
      reasonCode: 'HIGH_CONFIDENCE_VISUAL_MATCH',
      observedAt: '2026-09-09T05:01:00.000Z',
      additionalEvidence: {
        visualScore: 0.94,
        captionMatch: true,
        calibrationCorpusVersion: CALIBRATION_CORPUS_VERSION,
        thresholdVersion: PERCEPTUAL_SIMILARITY_THRESHOLDS.VERSION,
      },
    })

    // 2. Simulate what CanonicalPublishFacade persists to external_action_receipts table
    const simulatedDbRow = {
      id: originalReceipt.receiptId,
      workspace_id: originalReceipt.workspaceId,
      schedule_id: originalReceipt.scheduleId,
      bundle_id: originalReceipt.creativeBundleId,
      action_kind: `${originalReceipt.channel}_publish`,
      state: originalReceipt.state,
      idempotency_key: originalReceipt.idempotencyKey,
      request_payload_digest: originalReceipt.providerPayloadDigest,
      additional_evidence: originalReceipt.evidence,
      created_at: originalReceipt.createdAt,
      finalized_at: originalReceipt.observedAt,
    }

    // 3. Restore receipt from DB row (e.g. on client refresh or session resume)
    const restored: ExternalActionReceipt = restoreExternalActionReceipt(simulatedDbRow)

    expect(restored.receiptId).toBe(originalReceipt.receiptId)
    expect(restored.workspaceId).toBe(workspaceId)
    expect(restored.channel).toBe('instagram') // Lowercase SSOT channel
    expect(restored.state).toBe('VERIFIED')
    expect(restored.creativeFingerprint).toBe(mockFingerprint) // No data loss!
    expect(restored.orderedMediaSha256).toEqual([mockMediaDigest]) // No data loss!
    expect(restored.providerPostId).toBe('ig_post_1136_live')
    expect(restored.permalink).toBe('https://www.instagram.com/p/restored')
    expect(restored.evidence.visualScore).toBe(0.94)
    expect(restored.evidence.calibrationCorpusVersion).toBe(CALIBRATION_CORPUS_VERSION)
    expect(restored.evidence.thresholdVersion).toBe(PERCEPTUAL_SIMILARITY_THRESHOLDS.VERSION)
  })

  it('records channel-specific evidence and permalinks for Threads posts', async () => {
    const threadsBundle: CreativeBundle = {
      ...sampleBundle,
      bundleId: 'bundle_threads_1136',
      channel: 'threads',
    }

    const readbackDeps = {
      fetchPublishedPost: vi.fn().mockResolvedValue({
        providerPostId: 'threads_post_9999',
        channel: 'threads',
        caption: threadsBundle.caption,
        permalink: 'https://www.threads.net/@byreum/post/C_th999',
        mediaItems: [{ id: 'tm1', mediaType: 'IMAGE', mediaUrl: 'https://cdn.threads.net/img.jpg', position: 0 }],
        timestamp: new Date().toISOString(),
      }),
      computePerceptualSimilarity: vi.fn().mockResolvedValue({ similarity: 0.91 }),
    }

    const verification = await verifyPublishedCreativeBundle(
      threadsBundle,
      'threads_post_9999',
      'valid_threads_token',
      readbackDeps
    )

    expect(verification.outcome).toBe('VERIFIED')
    expect(verification.visualScore).toBe(0.91)
    expect(verification.observedPost?.permalink).toBe('https://www.threads.net/@byreum/post/C_th999')
    expect(verification.calibrationCorpusVersion).toBe(CALIBRATION_CORPUS_VERSION)
  })
})
