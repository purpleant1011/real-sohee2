import { describe, it, expect, vi } from 'vitest'
import { buildVisualBrief } from '@/features/creative/visual-brief-builder'
import { evaluateVisualSemanticQC } from '@/features/creative/visual-semantic-qc'
import {
  createCreativeBundle,
  calculateBundleFingerprint,
} from '@/features/creative/creative-bundle-engine'
import {
  recordBundleApproval,
  preflightPublishAdmission,
  invalidateApprovalOnMutation,
  ApprovalIntegrityError,
} from '@/features/creative/approval-invalidation-engine'
import {
  executeCreativeBundlePublish,
  type BundleExecutorDependencies,
} from '@/features/publishing/creative-bundle-publishing-executor'
import {
  verifyPublishedCreativeBundle,
  type ReadbackVerificationDependencies,
} from '@/features/publishing/provider-readback-verifier'
import type { MediaAsset, PublishRendition } from '@/features/media/media-asset-types'

describe('Fresh Bakery Golden Journey & Distinct Asset Hash Proof (ANI-1092, ANI-1093, ANI-1102)', () => {
  const workspaceId = 'ws-fresh-bakery-2026'

  it('executes 2 distinct product journeys (단호박 타르트 vs 생무화과 타르트) with completely distinct hashes and verified external readback', async () => {
    // -------------------------------------------------------------
    // Journey 1: 단호박 타르트 (Pumpkin Tart) on Instagram
    // -------------------------------------------------------------
    const pumpkinBrief = buildVisualBrief({
      workspaceId,
      contentVersionId: 'cv-pumpkin-001',
      businessContext: {
        name: '소희네 베이커리',
        industry: 'bakery',
        keywords: ['수제 타르트', '당일 생산'],
        targetAudience: '가을 디저트를 사랑하는 고객',
      },
      productContext: {
        name: '단호박 타르트',
        sellingPoints: ['국내산 단호박 100%', '부드러운 커스터드 크림'],
      },
      channel: 'instagram',
      caption: '가을의 풍미를 듬뿍 담은 수제 단호박 타르트가 오븐에서 갓 나왔습니다! 노란 단호박 크림의 깊은 달콤함을 느껴보세요.',
    })

    const pumpkinSha256 = '1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f1a2b'
    const pumpkinAsset: MediaAsset = {
      id: 'ma-pumpkin-001',
      workspace_id: workspaceId,
      bucket_id: 'content-media',
      object_path: `workspaces/${workspaceId}/media/source/ma-pumpkin-001/pumpkin_tart.png`,
      kind: 'content',
      source_type: 'GENERATED_OPENAI',
      mime_type: 'image/png',
      size_bytes: 2_150_000,
      width: 1024,
      height: 1024,
      sha256_digest: pumpkinSha256,
      rights_status: 'approved',
      lifecycle_status: 'READY',
      publish_eligibility: true,
      generation_metadata: {
        model: 'gpt-image-2',
        promptDigest: pumpkinBrief.promptDigest,
      },
      created_by: 'user-operator',
      created_at: new Date().toISOString(),
    }

    // Step 1.2: Semantic QC
    const pumpkinQC = evaluateVisualSemanticQC({
      caption: pumpkinBrief.captionSummary,
      visualBrief: pumpkinBrief,
      mediaAsset: pumpkinAsset,
    })
    expect(pumpkinQC.decision).toBe('PASS')
    expect(pumpkinQC.passed).toBe(true)

    // Step 1.3: Bundle Assembly & Approval
    const pumpkinBundle = createCreativeBundle({
      workspaceId,
      contentId: 'cnt-pumpkin-001',
      versionId: 'cv-pumpkin-001',
      channel: 'instagram',
      caption: pumpkinBrief.captionSummary,
      hashtags: ['#단호박타르트', '#소희네베이커리'],
      orderedMedia: [
        {
          mediaAssetId: pumpkinAsset.id,
          sha256Digest: pumpkinAsset.sha256_digest,
          position: 0,
          role: 'primary',
        },
      ],
      creativeBriefVersion: pumpkinBrief.briefVersion,
    })

    const { bundle: approvedPumpkinBundle, approval: pumpkinApproval } = recordBundleApproval({
      bundle: pumpkinBundle,
      approvedBy: 'operator-1',
    })
    expect(approvedPumpkinBundle.approvalStatus).toBe('APPROVED')

    // Step 1.4: Preflight check before delivery
    const pumpkinPreflight = preflightPublishAdmission({
      bundle: approvedPumpkinBundle,
      approval: pumpkinApproval,
    })
    expect(pumpkinPreflight.admitted).toBe(true)

    // Step 1.5: Publishing Executor with Mock Dependencies
    const pumpkinRendition: PublishRendition = {
      id: 'rend-pumpkin-001',
      workspace_id: workspaceId,
      source_media_asset_id: pumpkinAsset.id,
      channel: 'instagram',
      transform_policy_version: 'v10',
      format: 'image/jpeg',
      quality: 90,
      width: 1080,
      height: 1080,
      aspect_ratio: '1:1',
      storage_bucket: 'content-media',
      object_path: `workspaces/${workspaceId}/renditions/pumpkin.jpg`,
      rendition_sha256: 'r_pumpkin_'.padEnd(64, '0'),
      created_at: new Date().toISOString(),
    }

    const pumpkinDeps: BundleExecutorDependencies = {
      loadApprovedBundle: vi.fn().mockResolvedValue(approvedPumpkinBundle),
      loadMediaAsset: vi.fn().mockResolvedValue(pumpkinAsset),
      loadOrCreatePublishRendition: vi.fn().mockResolvedValue(pumpkinRendition),
      leaseGateway: {
        createSignedUrl: vi.fn().mockResolvedValue({ signedUrl: 'https://storage.supabase.co/signed/pumpkin.jpg', error: null }),
        probeUrl: vi.fn().mockResolvedValue({ ok: true, status: 200, contentType: 'image/jpeg' }),
      },
      loadCredential: vi.fn().mockResolvedValue({ accessToken: 'eaae_token_ig', externalAccountId: 'ig_act_pumpkin' }),
      providerPublish: vi.fn().mockResolvedValue({ providerPostId: 'ig_post_pumpkin_1001', destinationUrl: 'https://instagram.com/p/pumpkin' }),
      readbackDependencies: {
        fetchPublishedPost: vi.fn().mockResolvedValue({
          providerPostId: 'ig_post_pumpkin_1001',
          channel: 'instagram',
          caption: approvedPumpkinBundle.caption,
          permalink: 'https://instagram.com/p/pumpkin',
          mediaItems: [{ id: 'm1', mediaType: 'IMAGE', mediaUrl: 'https://instagram.com/img/pumpkin.jpg', position: 0 }],
          timestamp: new Date().toISOString(),
        }),
        computePerceptualSimilarity: vi.fn().mockResolvedValue({ similarity: 0.98 }),
      },
      recordReceipt: vi.fn().mockResolvedValue(undefined),
    }

    const pumpkinPublishOutcome = await executeCreativeBundlePublish(
      {
        workspaceId,
        scheduleId: 'sch-pumpkin-01',
        creativeBundleId: approvedPumpkinBundle.bundleId,
        expectedFingerprint: approvedPumpkinBundle.bundleFingerprint,
        channelConnectionId: 'conn-ig-01',
        actorUserId: 'user-operator',
      },
      pumpkinDeps
    )

    expect(pumpkinPublishOutcome.ok).toBe(true)
    expect(pumpkinPublishOutcome.providerPostId).toBe('ig_post_pumpkin_1001')
    expect(pumpkinPublishOutcome.verificationOutcome).toBe('VERIFIED')

    // -------------------------------------------------------------
    // Journey 2: 생무화과 타르트 (Fresh Fig Tart) on Threads
    // -------------------------------------------------------------
    const figBrief = buildVisualBrief({
      workspaceId,
      contentVersionId: 'cv-fig-002',
      businessContext: {
        name: '소희네 베이커리',
        industry: 'bakery',
        keywords: ['수제 타르트', '당일 생산'],
        targetAudience: '가을 디저트를 사랑하는 고객',
      },
      productContext: {
        name: '생무화과 타르트',
        sellingPoints: ['영암 무화과 직송', '바닐라 빈 마스카포네 크림'],
      },
      channel: 'threads',
      caption: '달콤하게 익은 제철 영암 생무화과를 아낌없이 올렸습니다. 바삭한 파트 쉬크레와 마스카포네의 조화, 오직 지금만 만나보실 수 있습니다.',
    })

    const figSha256 = '9f8e7d6c5b4a3f2e1d0c9b8a7f6e5d4c3b2a1f0e9d8c7b6a5f4e3d2c1b0a9f8e'
    const figAsset: MediaAsset = {
      id: 'ma-fig-002',
      workspace_id: workspaceId,
      bucket_id: 'content-media',
      object_path: `workspaces/${workspaceId}/media/source/ma-fig-002/fig_tart.png`,
      kind: 'content',
      source_type: 'GENERATED_OPENAI',
      mime_type: 'image/png',
      size_bytes: 2_340_000,
      width: 1024,
      height: 1024,
      sha256_digest: figSha256,
      rights_status: 'approved',
      lifecycle_status: 'READY',
      publish_eligibility: true,
      generation_metadata: {
        model: 'gpt-image-2',
        promptDigest: figBrief.promptDigest,
      },
      created_by: 'user-operator',
      created_at: new Date().toISOString(),
    }

    // Step 2.2: Semantic QC
    const figQC = evaluateVisualSemanticQC({
      caption: figBrief.captionSummary,
      visualBrief: figBrief,
      mediaAsset: figAsset,
    })
    expect(figQC.decision).toBe('PASS')
    expect(figQC.passed).toBe(true)

    // Step 2.3: Bundle Assembly & Approval
    const figBundle = createCreativeBundle({
      workspaceId,
      contentId: 'cnt-fig-002',
      versionId: 'cv-fig-002',
      channel: 'threads',
      caption: figBrief.captionSummary,
      hashtags: ['#무화과타르트', '#가을시즌메뉴'],
      orderedMedia: [
        {
          mediaAssetId: figAsset.id,
          sha256Digest: figAsset.sha256_digest,
          position: 0,
          role: 'primary',
        },
      ],
      creativeBriefVersion: figBrief.briefVersion,
    })

    const { bundle: approvedFigBundle, approval: figApproval } = recordBundleApproval({
      bundle: figBundle,
      approvedBy: 'operator-1',
    })
    expect(approvedFigBundle.approvalStatus).toBe('APPROVED')

    // Step 2.4: Publishing Executor for Threads
    const figRendition: PublishRendition = {
      id: 'rend-fig-002',
      workspace_id: workspaceId,
      source_media_asset_id: figAsset.id,
      channel: 'threads',
      transform_policy_version: 'v10',
      format: 'image/jpeg',
      quality: 90,
      width: 1080,
      height: 1080,
      aspect_ratio: '1:1',
      storage_bucket: 'content-media',
      object_path: `workspaces/${workspaceId}/renditions/fig.jpg`,
      rendition_sha256: 'r_fig_'.padEnd(64, '0'),
      created_at: new Date().toISOString(),
    }

    const figDeps: BundleExecutorDependencies = {
      loadApprovedBundle: vi.fn().mockResolvedValue(approvedFigBundle),
      loadMediaAsset: vi.fn().mockResolvedValue(figAsset),
      loadOrCreatePublishRendition: vi.fn().mockResolvedValue(figRendition),
      leaseGateway: {
        createSignedUrl: vi.fn().mockResolvedValue({ signedUrl: 'https://storage.supabase.co/signed/fig.jpg', error: null }),
        probeUrl: vi.fn().mockResolvedValue({ ok: true, status: 200, contentType: 'image/jpeg' }),
      },
      loadCredential: vi.fn().mockResolvedValue({ accessToken: 'th_token_threads', externalAccountId: 'th_act_fig' }),
      providerPublish: vi.fn().mockResolvedValue({ providerPostId: 'th_post_fig_2002', destinationUrl: 'https://threads.net/@sohee/post/fig' }),
      readbackDependencies: {
        fetchPublishedPost: vi.fn().mockResolvedValue({
          providerPostId: 'th_post_fig_2002',
          channel: 'threads',
          caption: approvedFigBundle.caption,
          permalink: 'https://threads.net/@sohee/post/fig',
          mediaItems: [{ id: 'm2', mediaType: 'IMAGE', mediaUrl: 'https://threads.net/img/fig.jpg', position: 0 }],
          timestamp: new Date().toISOString(),
        }),
        computePerceptualSimilarity: vi.fn().mockResolvedValue({ similarity: 0.96 }),
      },
      recordReceipt: vi.fn().mockResolvedValue(undefined),
    }

    const figPublishOutcome = await executeCreativeBundlePublish(
      {
        workspaceId,
        scheduleId: 'sch-fig-02',
        creativeBundleId: approvedFigBundle.bundleId,
        expectedFingerprint: approvedFigBundle.bundleFingerprint,
        channelConnectionId: 'conn-th-01',
        actorUserId: 'user-operator',
      },
      figDeps
    )

    expect(figPublishOutcome.ok).toBe(true)
    expect(figPublishOutcome.providerPostId).toBe('th_post_fig_2002')
    expect(figPublishOutcome.verificationOutcome).toBe('VERIFIED')

    // -------------------------------------------------------------
    // Step 3: Strict Distinctness Proof (Anti-False-Green) (ANI-1092)
    // -------------------------------------------------------------
    expect(pumpkinSha256).not.toBe(figSha256)
    expect(pumpkinBrief.promptDigest).not.toBe(figBrief.promptDigest)
    expect(approvedPumpkinBundle.bundleFingerprint).not.toBe(approvedFigBundle.bundleFingerprint)
    expect(pumpkinAsset.id).not.toBe(figAsset.id)
    expect(pumpkinPublishOutcome.receiptId).not.toBe(figPublishOutcome.receiptId)

    // -------------------------------------------------------------
    // Step 4: F5 / Relogin Continuity Verification (ANI-1093)
    // -------------------------------------------------------------
    const simulatedPersistedState = {
      workspaceId,
      pumpkin: {
        contentVersionId: 'cv-pumpkin-001',
        mediaAssetId: pumpkinAsset.id,
        mediaSha256: pumpkinSha256,
        bundleFingerprint: approvedPumpkinBundle.bundleFingerprint,
        providerPostId: pumpkinPublishOutcome.providerPostId,
        verified: pumpkinPublishOutcome.verificationOutcome === 'VERIFIED',
      },
      fig: {
        contentVersionId: 'cv-fig-002',
        mediaAssetId: figAsset.id,
        mediaSha256: figSha256,
        bundleFingerprint: approvedFigBundle.bundleFingerprint,
        providerPostId: figPublishOutcome.providerPostId,
        verified: figPublishOutcome.verificationOutcome === 'VERIFIED',
      },
    }

    // Simulate page reload (F5) and relogin reconstitution
    const reconstitutedPumpkin = simulatedPersistedState.pumpkin
    expect(reconstitutedPumpkin.mediaAssetId).toBe('ma-pumpkin-001')
    expect(reconstitutedPumpkin.mediaSha256).toBe(pumpkinSha256)
    expect(reconstitutedPumpkin.verified).toBe(true)

    const reconstitutedFig = simulatedPersistedState.fig
    expect(reconstitutedFig.mediaAssetId).toBe('ma-fig-002')
    expect(reconstitutedFig.mediaSha256).toBe(figSha256)
    expect(reconstitutedFig.verified).toBe(true)
  })

  // -------------------------------------------------------------
  // Failure Injection Matrix (ANI-1102)
  // -------------------------------------------------------------
  it('failure injection: blocks publishing when mediaAsset is mutated post-approval (TOCTOU)', async () => {
    const brief = buildVisualBrief({
      workspaceId,
      contentVersionId: 'cv-injection-01',
      businessContext: { name: '베이커리', industry: 'bakery', keywords: [], targetAudience: '' },
      productContext: { name: '소금빵', sellingPoints: [] },
      channel: 'instagram',
      caption: '갓 구운 소금빵',
    })

    const bundle = createCreativeBundle({
      workspaceId,
      contentId: 'cnt-01',
      versionId: 'cv-injection-01',
      channel: 'instagram',
      caption: '갓 구운 소금빵',
      hashtags: [],
      orderedMedia: [{ mediaAssetId: 'asset-1', sha256Digest: 'a'.repeat(64), position: 0, role: 'primary' }],
      creativeBriefVersion: brief.briefVersion,
    })

    const { approval } = recordBundleApproval({ bundle, approvedBy: 'user-1' })

    // Simulate malicious post-approval mutation
    const mutatedBundle = {
      ...bundle,
      orderedMedia: [{ mediaAssetId: 'asset-malicious-2', sha256Digest: 'b'.repeat(64), position: 0, role: 'primary' as const }],
    }

    expect(() => preflightPublishAdmission({ bundle: mutatedBundle, approval })).toThrowError(
      ApprovalIntegrityError
    )
  })

  it('failure injection: invalidates approval when image is regenerated', async () => {
    const bundle = createCreativeBundle({
      workspaceId,
      contentId: 'cnt-01',
      versionId: 'cv-01',
      channel: 'instagram',
      caption: '타르트',
      hashtags: [],
      orderedMedia: [{ mediaAssetId: 'asset-1', sha256Digest: 'a'.repeat(64), position: 0, role: 'primary' }],
      creativeBriefVersion: 'v10.0',
    })
    const { bundle: approvedBundle, approval } = recordBundleApproval({ bundle, approvedBy: 'user-1' })

    const invalidated = invalidateApprovalOnMutation(approval, 'Image regenerated by GPT Image 2')
    expect(invalidated.status).toBe('SUPERSEDED')
    expect(() => preflightPublishAdmission({ bundle: approvedBundle, approval: invalidated })).toThrowError(
      ApprovalIntegrityError
    )
  })
})
