import { describe, it, expect, vi } from 'vitest'
import {
  ReceiptReconciliationService,
  type ReconcileDependencies,
  type PublishWebhookEvent,
} from '@/features/publishing/receipt-reconciliation-service'
import {
  createExternalActionReceipt,
  transitionReceiptState,
  isSafeToRepublish,
  type ExternalActionReceipt,
} from '@/features/publishing/external-action-receipt-engine'
import {
  executeCreativeBundlePublish,
  type BundleExecutorDependencies,
  type CreativeBundlePublishInput,
} from '@/features/publishing/creative-bundle-publishing-executor'
import { MultiChannelPublishSaga } from '@/features/publishing/multi-channel-parent-saga'
import type { CreativeBundle } from '@/features/creative/creative-bundle-types'
import type { MediaAsset } from '@/features/media/media-asset-types'
import type { PublishRendition, ProviderDeliveryLease } from '@/features/media/media-asset-types'

describe('ANI-1138: RESULT_UNKNOWN Reconciliation & Webhook Idempotency', () => {
  const workspaceId = '00000000-0000-4000-8000-000000000001'
  const bundleId = 'bundle_rec_1138'
  const mockFingerprint = 'a'.repeat(64)
  const sha256Digest = 'b'.repeat(64)

  const mockBundle: CreativeBundle = {
    bundleId,
    workspaceId,
    contentId: 'content_1',
    versionId: 'v1',
    channel: 'instagram',
    creativeBriefVersion: 'b1',
    caption: '2026 청라 자연 눈썹 봄맞이 가이드',
    hashtags: ['#청라눈썹', '#자연눈썹'],
    orderedMedia: [
      { mediaAssetId: 'asset_1', position: 0, role: 'primary', sha256Digest },
    ],
    bundleFingerprint: mockFingerprint,
    approvalStatus: 'APPROVED',
    approvedFingerprint: mockFingerprint,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }

  const mockAsset: MediaAsset = {
    id: 'asset_1',
    workspace_id: workspaceId,
    bucket_id: 'content-media',
    object_path: 'assets/test.jpg',
    kind: 'image',
    source_type: 'USER_UPLOAD',
    sha256_digest: sha256Digest,
    width: 1080,
    height: 1080,
    size_bytes: 1024,
    mime_type: 'image/jpeg',
    rights_status: 'OWNED',
    lifecycle_status: 'READY',
    publish_eligibility: true,
    generation_metadata: {},
    created_by: 'user_1',
    created_at: new Date().toISOString(),
  }

  const mockRendition: PublishRendition = {
    id: 'rend_1',
    workspace_id: workspaceId,
    source_media_asset_id: 'asset_1',
    channel: 'instagram',
    transform_policy_version: 'v1',
    format: 'jpeg',
    quality: 90,
    width: 1080,
    height: 1080,
    aspect_ratio: '1:1',
    rendition_sha256: 'c'.repeat(64),
    object_path: 'renditions/rend_1.jpg',
    storage_bucket: 'content-media',
    created_at: new Date().toISOString(),
  }

  const mockLease: ProviderDeliveryLease = {
    id: 'lease_1',
    workspace_id: workspaceId,
    rendition_id: 'rend_1',
    provider: 'instagram',
    purpose: 'meta_publish',
    delivery_url: 'https://cdn.example.com/signed/rend_1.jpg',
    issued_at: new Date().toISOString(),
    expires_at: new Date(Date.now() + 3600000).toISOString(),
    status: 'ACTIVE',
  }

  function reconciliationFixture(channel: 'instagram' | 'threads' = 'instagram') {
    const receipt = transitionReceiptState(createExternalActionReceipt({
      receiptId: 'receipt-safety', workspaceId, scheduleId: 'schedule-safety',
      creativeBundleId: bundleId, creativeFingerprint: mockFingerprint, channel,
      orderedMediaSha256: [sha256Digest], providerPayloadDigest: 'digest', idempotencyKey: 'safety-key',
    }), 'RESULT_UNKNOWN')
    const bundle = { ...mockBundle, channel }
    const post = { providerPostId: 'post-safety', caption: `${bundle.caption} ${bundle.hashtags.join(' ')}` }
    const deps = {
      loadReceipt: vi.fn().mockResolvedValue(receipt),
      loadBundle: vi.fn().mockResolvedValue(bundle),
      loadCredential: vi.fn().mockResolvedValue({ externalAccountId: 'account-safety', accessToken: 'token' }),
      fetchRecentProviderPosts: vi.fn().mockResolvedValue([post]),
      verifyPublishedPost: vi.fn().mockResolvedValue({ outcome: 'VERIFIED' }),
      saveReceipt: vi.fn(), isEventProcessed: vi.fn().mockResolvedValue(false), markEventProcessed: vi.fn(),
    }
    const service = new ReceiptReconciliationService(deps)
    const params = { workspaceId, receiptId: receipt.receiptId }
    const event: PublishWebhookEvent = {
      ...params, eventId: 'event-safety', status: 'PUBLISHED', providerPostId: post.providerPostId,
      timestamp: new Date().toISOString(),
    }
    return { receipt, bundle, post, deps, service, params, event }
  }

  it.each(['instagram', 'threads'] as const)('recovers %s via independent verification without a provider write', async (channel) => {
    const f = reconciliationFixture(channel)
    await expect(f.service.reconcileReceipt(f.params)).resolves.toMatchObject({ resolvedState: 'VERIFIED', providerPostId: f.post.providerPostId })
    expect(f.deps.fetchRecentProviderPosts).toHaveBeenCalledWith(channel, 'account-safety', 'token')
    expect(f.deps.verifyPublishedPost).toHaveBeenCalledExactlyOnceWith(f.bundle, f.post.providerPostId, 'token')
    expect(f.deps.saveReceipt).toHaveBeenCalledOnce()
  })

  it.each(['VERIFICATION_PENDING', 'RESULT_UNKNOWN', 'FAILED'] as const)('preserves readback outcome %s in reconcile and webhook paths', async (outcome) => {
    for (const webhook of [false, true]) {
      const f = reconciliationFixture()
      f.deps.verifyPublishedPost.mockResolvedValueOnce({ outcome })
      const result = webhook ? await f.service.handlePublishWebhookEvent(f.event) : await f.service.reconcileReceipt(f.params)
      expect('receiptState' in result ? result.receiptState : result.resolvedState).toBe(outcome)
      expect(f.deps.saveReceipt).toHaveBeenCalledWith(expect.objectContaining({ state: outcome, providerPostId: f.post.providerPostId }))
      if (outcome !== 'FAILED') expect(f.deps.markEventProcessed).not.toHaveBeenCalled()
    }
  })

  it('never selects one of multiple matching captions or replaces a known ID', async () => {
    const f = reconciliationFixture()
    f.deps.fetchRecentProviderPosts.mockResolvedValueOnce([f.post, { ...f.post, providerPostId: 'other-post' }])
    await expect(f.service.reconcileReceipt(f.params)).resolves.toMatchObject({ resolvedState: 'RESULT_UNKNOWN', reconciled: false })
    f.receipt.providerPostId = 'original-post'
    await expect(f.service.reconcileReceipt(f.params)).resolves.toMatchObject({ resolvedState: 'RESULT_UNKNOWN', providerPostId: 'original-post' })
    expect(f.deps.verifyPublishedPost).not.toHaveBeenCalled()
    expect(f.deps.saveReceipt).not.toHaveBeenCalled()
  })

  it('matches the existing ID instead of the first same-caption object', async () => {
    const f = reconciliationFixture()
    f.receipt.providerPostId = 'original-post'
    f.deps.fetchRecentProviderPosts.mockResolvedValueOnce([f.post, { ...f.post, providerPostId: 'original-post' }])
    await expect(f.service.reconcileReceipt(f.params)).resolves.toMatchObject({ resolvedState: 'VERIFIED', providerPostId: 'original-post' })
    expect(f.deps.verifyPublishedPost).toHaveBeenCalledWith(f.bundle, 'original-post', 'token')
  })

  it.each(['', 'unknown'])('does not verify an incomplete candidate ID %j', async (providerPostId) => {
    const f = reconciliationFixture()
    f.deps.fetchRecentProviderPosts.mockResolvedValueOnce([{ ...f.post, providerPostId }])
    await expect(f.service.reconcileReceipt(f.params)).resolves.toMatchObject({ resolvedState: 'RESULT_UNKNOWN' })
    expect(f.deps.verifyPublishedPost).not.toHaveBeenCalled()
    expect(f.deps.saveReceipt).not.toHaveBeenCalled()
  })

  it.each(['bundle', 'id', 'placeholder', 'credential', 'lookup', 'verification'] as const)('fails closed for missing or unavailable %s', async (missing) => {
    const f = reconciliationFixture()
    if (missing === 'bundle') f.deps.loadBundle.mockResolvedValueOnce(null)
    if (missing === 'id') f.event.providerPostId = undefined
    if (missing === 'placeholder') f.event.providerPostId = 'unknown'
    if (missing === 'credential') f.deps.loadCredential.mockResolvedValueOnce({ externalAccountId: '', accessToken: '' })
    if (missing === 'lookup') f.deps.fetchRecentProviderPosts.mockRejectedValueOnce(new Error('LOOKUP_UNAVAILABLE'))
    if (missing === 'verification') f.deps.verifyPublishedPost.mockRejectedValueOnce(new Error('READBACK_UNAVAILABLE'))
    await expect(missing === 'lookup'
      ? f.service.reconcileReceipt(f.params)
      : f.service.handlePublishWebhookEvent(f.event)).rejects.toThrow()
    expect(f.deps.saveReceipt).not.toHaveBeenCalled()
    expect(f.deps.markEventProcessed).not.toHaveBeenCalled()
    if (missing !== 'verification') expect(f.deps.verifyPublishedPost).not.toHaveBeenCalled()
  })

  it.each(['receipt', 'bundle', 'duplicate-receipt'] as const)('rejects cross-tenant %s before readback or storage', async (target) => {
    for (const webhook of [false, true]) {
      const f = reconciliationFixture()
      if (target === 'bundle') f.bundle.workspaceId = 'other-workspace'
      else f.receipt.workspaceId = 'other-workspace'
      if (target === 'duplicate-receipt') f.deps.isEventProcessed.mockResolvedValueOnce(true)
      await expect(webhook ? f.service.handlePublishWebhookEvent(f.event) : f.service.reconcileReceipt(f.params)).rejects.toThrow('UNAVAILABLE')
      expect(f.deps.fetchRecentProviderPosts).not.toHaveBeenCalled()
      expect(f.deps.verifyPublishedPost).not.toHaveBeenCalled()
      expect(f.deps.saveReceipt).not.toHaveBeenCalled()
      expect(f.deps.markEventProcessed).not.toHaveBeenCalled()
    }
  })

  it('rejects conflicting webhook IDs and preserves a verified receipt as a no-op', async () => {
    const f = reconciliationFixture()
    f.receipt.providerPostId = 'original-post'
    await expect(f.service.handlePublishWebhookEvent(f.event)).rejects.toThrow('POST_ID_MISMATCH')
    f.receipt.state = 'VERIFIED'
    await expect(f.service.reconcileReceipt(f.params)).resolves.toMatchObject({ alreadyVerified: true, providerPostId: 'original-post' })
    await expect(f.service.handlePublishWebhookEvent({ ...f.event, status: 'FAILED' })).resolves.toMatchObject({ receiptState: 'VERIFIED', downgradePrevented: true })
    expect(f.receipt.providerPostId).toBe('original-post')
    expect(f.deps.verifyPublishedPost).not.toHaveBeenCalled()
    expect(f.deps.saveReceipt).not.toHaveBeenCalled()
  })

  it.each(['REQUESTED', 'PROVIDER_ACCEPTED', 'VERIFICATION_PENDING'] as const)('persists unknown after an inconclusive lookup from %s', async (state) => {
    const f = reconciliationFixture()
    f.receipt.state = state
    f.deps.fetchRecentProviderPosts.mockResolvedValueOnce([])
    const result = await f.service.reconcileReceipt(f.params)
    expect(result.resolvedState).toBe('RESULT_UNKNOWN')
    expect(result.receipt?.state).toBe('RESULT_UNKNOWN')
    expect(isSafeToRepublish(result.receipt!).safe).toBe(false)
    expect(f.deps.saveReceipt).toHaveBeenCalledWith(expect.objectContaining({ state: 'RESULT_UNKNOWN' }))
    expect(f.deps.verifyPublishedPost).not.toHaveBeenCalled()
  })

  it.each(['bundleId', 'channel', 'bundleFingerprint'] as const)('rejects mismatched bundle %s without readback or storage', async (field) => {
    const f = reconciliationFixture()
    const bundle = { ...f.bundle, [field]: 'different' }
    f.deps.loadBundle.mockResolvedValueOnce(bundle)
    await expect(f.service.handlePublishWebhookEvent(f.event)).rejects.toThrow('BUNDLE_UNAVAILABLE')
    expect(f.deps.verifyPublishedPost).not.toHaveBeenCalled()
    expect(f.deps.saveReceipt).not.toHaveBeenCalled()
  })

  it.each([
    ['confirmed', 'PRE_VALIDATION_FAILED', { preContainerFailed: true }, 'REVIEW_CONFIRMED_FAILURE'],
    ['submitted', 'PRE_VALIDATION_FAILED', { preContainerFailed: true, transportAttempted: true }, 'CONTACT_OPERATOR'],
    ['legacy', 'TIMEOUT_RESULT_UNKNOWN', {}, 'CONTACT_OPERATOR'],
  ] as const)('preserves %s FAILED across empty/matching lookups and all webhook statuses without automatic recovery', async (_kind, reasonCode, evidence, nextAction) => {
    for (const scenario of ['empty', 'match', 'PUBLISHED', 'FAILED', 'MEDIA_READY'] as const) {
      const f = reconciliationFixture()
      f.receipt.state = 'FAILED'
      f.receipt.reasonCode = reasonCode
      f.receipt.evidence = { ...evidence }
      if (scenario === 'empty') f.deps.fetchRecentProviderPosts.mockResolvedValueOnce([])
      const before = structuredClone(f.receipt)
      if (scenario === 'empty' || scenario === 'match') {
        await expect(f.service.reconcileReceipt(f.params)).resolves.toMatchObject({
          resolvedState: 'FAILED', reconciled: false, receipt: before, nextAction,
          reason: expect.stringContaining(nextAction === 'CONTACT_OPERATOR' ? '운영 담당자' : '제출 전 실패'),
        })
      } else {
        await expect(f.service.handlePublishWebhookEvent({ ...f.event, status: scenario })).resolves.toMatchObject({
          receiptState: 'FAILED', idempotentNoOp: true, nextAction,
          reason: expect.stringContaining(nextAction === 'CONTACT_OPERATOR' ? '운영 담당자' : '제출 전 실패'),
        })
      }
      expect(f.receipt).toEqual(before)
      expect(f.deps.loadBundle).not.toHaveBeenCalled()
      expect(f.deps.fetchRecentProviderPosts).not.toHaveBeenCalled()
      expect(f.deps.verifyPublishedPost).not.toHaveBeenCalled()
      expect(f.deps.saveReceipt).not.toHaveBeenCalled()
      expect(f.deps.markEventProcessed).not.toHaveBeenCalled()
    }
  })

  it('does not claim success for a duplicate event whose receipt is missing', async () => {
    const f = reconciliationFixture()
    f.deps.loadReceipt.mockResolvedValueOnce(null)
    f.deps.isEventProcessed.mockResolvedValueOnce(true)
    await expect(f.service.handlePublishWebhookEvent(f.event)).rejects.toThrow('RECEIPT_UNAVAILABLE')
    expect(f.deps.verifyPublishedPost).not.toHaveBeenCalled()
    expect(f.deps.saveReceipt).not.toHaveBeenCalled()
  })

  it('isolates network timeout to RESULT_UNKNOWN instead of FAILED during publish execution', async () => {
    let recordedReceipt: ExternalActionReceipt | null = null

    const mockDeps: BundleExecutorDependencies = {
      loadApprovedBundle: vi.fn().mockResolvedValue(mockBundle),
      loadMediaAsset: vi.fn().mockResolvedValue(mockAsset),
      loadOrCreatePublishRendition: vi.fn().mockResolvedValue(mockRendition),
      leaseGateway: {
        createSignedUrl: vi.fn().mockResolvedValue({ signedUrl: 'https://cdn.example.com/signed/test.jpg' }),
        probeUrl: vi.fn().mockResolvedValue({ ok: true, status: 200 }),
        persistLease: vi.fn().mockResolvedValue(mockLease),
        findActiveLease: vi.fn().mockResolvedValue(null),
      } as any,
      recordReceipt: vi.fn().mockImplementation(async (r) => {
        recordedReceipt = r
      }),
      loadCredential: vi.fn().mockResolvedValue({
        externalAccountId: 'ig_acc_1',
        accessToken: 'valid_token',
      }),
      providerPublish: vi.fn().mockImplementation(async () => {
        const timeoutError: any = new Error('FetchError: network timeout at: https://graph.facebook.com')
        timeoutError.code = 'ETIMEDOUT'
        throw timeoutError
      }),
      readbackDependencies: {
        fetchPublishedPost: vi.fn(),
        computePerceptualSimilarity: vi.fn(),
      },
    }

    const input: CreativeBundlePublishInput = {
      workspaceId,
      scheduleId: 'sched_timeout',
      creativeBundleId: bundleId,
      expectedFingerprint: mockFingerprint,
      targetChannel: 'instagram',
      channelConnectionId: 'default',
      actorUserId: 'system',
      idempotencyKey: 'idem_timeout_test',
    }

    const outcome = await executeCreativeBundlePublish(input, mockDeps)

    expect(outcome.ok).toBe(false)
    expect(outcome.verificationOutcome).toBe('RESULT_UNKNOWN')
    expect(outcome.receiptState).toBe('RESULT_UNKNOWN')
    expect(outcome.errorCode).toBe('TIMEOUT_RESULT_UNKNOWN')
    expect(recordedReceipt).not.toBeNull()
    expect((recordedReceipt as any)?.state).toBe('RESULT_UNKNOWN')
    expect((recordedReceipt as any)?.evidence?.ambiguousTimeout).toBe(true)
  })

  it('safely reconciles RESULT_UNKNOWN receipt to VERIFIED when matching post is found on provider', async () => {
    const receipt = createExternalActionReceipt({
      receiptId: 'rcpt_unknown_1',
      workspaceId,
      scheduleId: 'sched_1',
      creativeBundleId: bundleId,
      creativeFingerprint: mockFingerprint,
      channel: 'instagram',
      orderedMediaSha256: [sha256Digest],
      providerPayloadDigest: 'digest_1',
      idempotencyKey: 'idem_1',
    })
    const unknownReceipt = transitionReceiptState(receipt, 'RESULT_UNKNOWN', {
      reasonCode: 'TIMEOUT_RESULT_UNKNOWN',
    })

    let savedReceipt: any = null

    const mockReconcileDeps: ReconcileDependencies = {
      loadReceipt: vi.fn().mockResolvedValue(unknownReceipt),
      loadBundle: vi.fn().mockResolvedValue(mockBundle),
      loadCredential: vi.fn().mockResolvedValue({
        externalAccountId: 'ig_acc_1',
        accessToken: 'valid_token',
      }),
      fetchRecentProviderPosts: vi.fn().mockResolvedValue([
        {
          providerPostId: 'ig_post_reconciled_999',
          caption: '2026 청라 자연 눈썹 봄맞이 가이드 #청라눈썹 #자연눈썹',
          permalink: 'https://instagram.com/p/reconciled_999',
          publishedAt: new Date().toISOString(),
          mediaUrls: ['https://cdn.example.com/obs.jpg'],
        },
      ]),
      verifyPublishedPost: vi.fn().mockResolvedValue({
        outcome: 'VERIFIED',
        visualScore: 0.96,
        captionMatch: true,
        reasonCode: 'READBACK_VERIFIED',
        message: 'Reconciliation readback verified',
        evaluatedAt: new Date().toISOString(),
      }),
      saveReceipt: vi.fn().mockImplementation(async (r) => {
        savedReceipt = r
      }),
    }

    const reconciler = new ReceiptReconciliationService(mockReconcileDeps)
    const result = await reconciler.reconcileReceipt({
      workspaceId,
      receiptId: 'rcpt_unknown_1',
    })

    expect(result.resolvedState).toBe('VERIFIED')
    expect(result.providerPostId).toBe('ig_post_reconciled_999')
    expect(savedReceipt?.state).toBe('VERIFIED')
    expect(savedReceipt?.providerPostId).toBe('ig_post_reconciled_999')
    expect(savedReceipt?.permalink).toBe('https://instagram.com/p/reconciled_999')
  })

  it('keeps RESULT_UNKNOWN when post is not found and elapsed time is below threshold (still pending)', async () => {
    const recentReceipt = createExternalActionReceipt({
      receiptId: 'rcpt_unknown_recent',
      workspaceId,
      scheduleId: 'sched_1',
      creativeBundleId: bundleId,
      creativeFingerprint: mockFingerprint,
      channel: 'instagram',
      orderedMediaSha256: [sha256Digest],
      providerPayloadDigest: 'digest_1',
      idempotencyKey: 'idem_recent',
    })
    const unknownReceipt = transitionReceiptState(recentReceipt, 'RESULT_UNKNOWN', {
      reasonCode: 'TIMEOUT_RESULT_UNKNOWN',
    })

    const mockReconcileDeps: ReconcileDependencies = {
      loadReceipt: vi.fn().mockResolvedValue(unknownReceipt),
      loadBundle: vi.fn().mockResolvedValue(mockBundle),
      loadCredential: vi.fn().mockResolvedValue({
        externalAccountId: 'ig_acc_1',
        accessToken: 'valid_token',
      }),
      fetchRecentProviderPosts: vi.fn().mockResolvedValue([]),
      verifyPublishedPost: vi.fn(),
      saveReceipt: vi.fn(),
    }

    const reconciler = new ReceiptReconciliationService(mockReconcileDeps)
    const result = await reconciler.reconcileReceipt({
      workspaceId,
      receiptId: 'rcpt_unknown_recent',
      timeoutThresholdMs: 900000,
    })

    expect(result.resolvedState).toBe('RESULT_UNKNOWN')
    expect(result.reason).toContain('대기 중')
  })

  it('preserves RESULT_UNKNOWN beyond the timeout when a recent list contains no post', async () => {
    const oldReceipt = createExternalActionReceipt({
      receiptId: 'rcpt_unknown_old',
      workspaceId,
      scheduleId: 'sched_1',
      creativeBundleId: bundleId,
      creativeFingerprint: mockFingerprint,
      channel: 'instagram',
      orderedMediaSha256: [sha256Digest],
      providerPayloadDigest: 'digest_1',
      idempotencyKey: 'idem_old',
    })
    oldReceipt.createdAt = new Date(Date.now() - 1200000).toISOString()
    const unknownReceipt = transitionReceiptState(oldReceipt, 'RESULT_UNKNOWN', {
      reasonCode: 'TIMEOUT_RESULT_UNKNOWN',
    })

    let savedReceipt: any = null

    const mockReconcileDeps: ReconcileDependencies = {
      loadReceipt: vi.fn().mockResolvedValue(unknownReceipt),
      loadBundle: vi.fn().mockResolvedValue(mockBundle),
      loadCredential: vi.fn().mockResolvedValue({
        externalAccountId: 'ig_acc_1',
        accessToken: 'valid_token',
      }),
      fetchRecentProviderPosts: vi.fn().mockResolvedValue([]),
      verifyPublishedPost: vi.fn(),
      saveReceipt: vi.fn().mockImplementation(async (r) => {
        savedReceipt = r
      }),
    }

    const reconciler = new ReceiptReconciliationService(mockReconcileDeps)
    const result = await reconciler.reconcileReceipt({
      workspaceId,
      receiptId: 'rcpt_unknown_old',
      timeoutThresholdMs: 900000,
    })

    expect(result.resolvedState).toBe('RESULT_UNKNOWN')
    expect(savedReceipt).toBeNull()
    expect(mockReconcileDeps.saveReceipt).not.toHaveBeenCalled()
    const retryCheck = isSafeToRepublish(result.receipt!)
    expect(retryCheck.safe).toBe(false)
    expect(retryCheck.stage).toBe('CONTAINER_SUBMITTED')
  })

  it('handles webhook callbacks idempotently and prevents duplicate processing', async () => {
    const receipt = createExternalActionReceipt({
      receiptId: 'rcpt_webhook_1',
      workspaceId,
      scheduleId: 'sched_1',
      creativeBundleId: bundleId,
      creativeFingerprint: mockFingerprint,
      channel: 'instagram',
      orderedMediaSha256: [sha256Digest],
      providerPayloadDigest: 'digest_1',
      idempotencyKey: 'idem_webhook_1',
    })
    const pendingReceipt = transitionReceiptState(receipt, 'PROVIDER_ACCEPTED', {
      providerPostId: 'meta_post_100',
    })

    const processedEvents = new Set<string>()
    let savedReceipt = pendingReceipt

    const mockReconcileDeps: ReconcileDependencies = {
      loadReceipt: vi.fn().mockImplementation(async () => savedReceipt),
      loadBundle: vi.fn().mockResolvedValue(mockBundle),
      loadCredential: vi.fn().mockResolvedValue({
        externalAccountId: 'ig_acc_1',
        accessToken: 'valid_token',
      }),
      fetchRecentProviderPosts: vi.fn(),
      verifyPublishedPost: vi.fn().mockResolvedValue({
        outcome: 'VERIFIED',
        visualScore: 0.98,
        captionMatch: true,
        reasonCode: 'WEBHOOK_VERIFIED',
        message: 'Verified via webhook',
      }),
      saveReceipt: vi.fn().mockImplementation(async (r) => {
        savedReceipt = r
      }),
      isEventProcessed: vi.fn().mockImplementation(async (id) => processedEvents.has(id)),
      markEventProcessed: vi.fn().mockImplementation(async (id) => {
        processedEvents.add(id)
      }),
    }

    const reconciler = new ReceiptReconciliationService(mockReconcileDeps)

    const webhookEvent: PublishWebhookEvent = {
      eventId: 'evt_meta_unique_123',
      workspaceId,
      receiptId: 'rcpt_webhook_1',
      providerPostId: 'meta_post_100',
      status: 'PUBLISHED',
      permalink: 'https://instagram.com/p/meta_post_100',
      timestamp: new Date().toISOString(),
    }

    // 1st delivery
    const outcome1 = await reconciler.handlePublishWebhookEvent(webhookEvent)
    expect(outcome1.idempotentNoOp).toBe(false)
    expect(outcome1.receiptState).toBe('VERIFIED')
    expect(processedEvents.has('evt_meta_unique_123')).toBe(true)

    // 2nd duplicate delivery
    const outcome2 = await reconciler.handlePublishWebhookEvent(webhookEvent)
    expect(outcome2.idempotentNoOp).toBe(true)
    expect(outcome2.receiptState).toBe('VERIFIED')
  })

  it('rejects late callback downgrade: never turns a VERIFIED receipt into FAILED', async () => {
    const receipt = createExternalActionReceipt({
      receiptId: 'rcpt_verified_immutable',
      workspaceId,
      scheduleId: 'sched_1',
      creativeBundleId: bundleId,
      creativeFingerprint: mockFingerprint,
      channel: 'instagram',
      orderedMediaSha256: [sha256Digest],
      providerPayloadDigest: 'digest_1',
      idempotencyKey: 'idem_verified',
    })
    const accepted = transitionReceiptState(receipt, 'PROVIDER_ACCEPTED', {
      providerPostId: 'post_verified_1',
    })
    const pending = transitionReceiptState(accepted, 'VERIFICATION_PENDING')
    const verifiedReceipt = transitionReceiptState(pending, 'VERIFIED', {
      providerPostId: 'post_verified_1',
      permalink: 'https://instagram.com/p/post_verified_1',
    })

    let savedReceipt = verifiedReceipt

    const mockReconcileDeps: ReconcileDependencies = {
      loadReceipt: vi.fn().mockImplementation(async () => savedReceipt),
      loadBundle: vi.fn().mockResolvedValue(mockBundle),
      loadCredential: vi.fn().mockResolvedValue({
        externalAccountId: 'ig_acc_1',
        accessToken: 'valid_token',
      }),
      fetchRecentProviderPosts: vi.fn(),
      verifyPublishedPost: vi.fn(),
      saveReceipt: vi.fn().mockImplementation(async (r) => {
        savedReceipt = r
      }),
      isEventProcessed: vi.fn().mockResolvedValue(false),
      markEventProcessed: vi.fn().mockResolvedValue(undefined),
    }

    const reconciler = new ReceiptReconciliationService(mockReconcileDeps)

    const lateFailedEvent: PublishWebhookEvent = {
      eventId: 'evt_late_failure_999',
      workspaceId,
      receiptId: 'rcpt_verified_immutable',
      providerPostId: 'post_verified_1',
      status: 'FAILED',
      errorMessage: 'Transcoding delayed error received late',
      timestamp: new Date().toISOString(),
    }

    const outcome = await reconciler.handlePublishWebhookEvent(lateFailedEvent)

    expect(outcome.receiptState).toBe('VERIFIED')
    expect(outcome.downgradePrevented).toBe(true)
    expect(savedReceipt.state).toBe('VERIFIED')
  })

  it('guarantees ZERO blind republish when a child channel has a RESULT_UNKNOWN receipt in MultiChannelPublishSaga', async () => {
    const publishChannelCalls: string[] = []

    const unknownReceipt: Partial<ExternalActionReceipt> = {
      receiptId: 'rcpt_ig_unknown',
      workspaceId,
      channel: 'instagram',
      state: 'RESULT_UNKNOWN',
      evidence: {
        ambiguousTimeout: true,
      },
    }

    const saga = new MultiChannelPublishSaga({
      publishChannel: vi.fn().mockImplementation(async (input) => {
        publishChannelCalls.push(input.targetChannel)
        return {
          ok: true,
          receiptId: `receipt_${input.targetChannel}`,
          providerPostId: `post_${input.targetChannel}`,
          destinationUrl: `https://${input.targetChannel}.com/p/1`,
          verificationOutcome: 'VERIFIED',
          receiptState: 'VERIFIED',
        }
      }),
      loadExistingReceipt: vi.fn().mockImplementation(async (_ws, _bId, ch) => {
        if (ch === 'instagram') return unknownReceipt as ExternalActionReceipt
        return null
      }),
      reconcileUnknownReceipt: vi.fn().mockResolvedValue({
        resolvedState: 'RESULT_UNKNOWN',
        reason: 'Still ambiguous on provider',
      }),
    })

    const outcome = await saga.execute({
      workspaceId,
      bundleId,
      expectedFingerprint: mockFingerprint,
      channel: 'BOTH',
    })

    expect(publishChannelCalls).not.toContain('instagram')
    expect(publishChannelCalls).toEqual(['threads'])

    expect(outcome.children.instagram?.status).toBe('RESULT_UNKNOWN')
    expect(outcome.children.instagram?.errorCode).toBe('RESULT_UNKNOWN_RECONCILE_PENDING')
    expect(outcome.overallStatus).toBe('PARTIAL_SUCCESS')
    expect(outcome.success).toBe(false)
  })

  it('checks SafeRetryBoundary correctly across all lifecycle stages', () => {
    const freshReceipt = createExternalActionReceipt({
      workspaceId,
      scheduleId: 's1',
      creativeBundleId: bundleId,
      creativeFingerprint: mockFingerprint,
      channel: 'instagram',
      orderedMediaSha256: [sha256Digest],
      providerPayloadDigest: 'd1',
      idempotencyKey: 'k1',
    })

    // 1. Fresh REQUESTED (Pre-container) -> safe to retry
    expect(isSafeToRepublish(freshReceipt).safe).toBe(true)
    expect(isSafeToRepublish(freshReceipt).stage).toBe('PRE_CONTAINER')

    // 2. Container submitted -> unsafe
    freshReceipt.evidence = { ...freshReceipt.evidence, containerSubmitted: true }
    expect(isSafeToRepublish(freshReceipt).safe).toBe(false)
    expect(isSafeToRepublish(freshReceipt).stage).toBe('CONTAINER_SUBMITTED')

    // 3. RESULT_UNKNOWN -> unsafe (must reconcile)
    const unknownReceipt = transitionReceiptState(freshReceipt, 'RESULT_UNKNOWN')
    expect(isSafeToRepublish(unknownReceipt).safe).toBe(false)
    expect(isSafeToRepublish(unknownReceipt).stage).toBe('CONTAINER_SUBMITTED')

    // 4. PROVIDER_ACCEPTED / VERIFICATION_PENDING -> unsafe
    const acceptedReceipt = transitionReceiptState(freshReceipt, 'PROVIDER_ACCEPTED', { providerPostId: 'p1' })
    expect(isSafeToRepublish(acceptedReceipt).safe).toBe(false)
    expect(isSafeToRepublish(acceptedReceipt).stage).toBe('PROVIDER_ACCEPTED')

    // 5. VERIFIED -> unsafe
    const pendingReceipt = transitionReceiptState(acceptedReceipt, 'VERIFICATION_PENDING')
    const verifiedReceipt = transitionReceiptState(pendingReceipt, 'VERIFIED', { providerPostId: 'p1' })
    expect(isSafeToRepublish(verifiedReceipt).safe).toBe(false)
    expect(isSafeToRepublish(verifiedReceipt).stage).toBe('VERIFIED')

    // 6. FAILED -> post-dispatch/timeout failure without pre-submit proof is unsafe for blind retry
    const failedReceipt = transitionReceiptState(unknownReceipt, 'FAILED')
    expect(isSafeToRepublish(failedReceipt).safe).toBe(false)
    expect(isSafeToRepublish(failedReceipt).stage).toBe('CONTAINER_SUBMITTED')

    // Confirmed pre-submit failure (e.g. PRE_VALIDATION_FAILED before container creation) -> safe to retry
    const preSubmitReceipt = createExternalActionReceipt({
      receiptId: 'r_pre',
      workspaceId,
      scheduleId: 's1',
      creativeBundleId: bundleId,
      creativeFingerprint: mockFingerprint,
      channel: 'instagram',
      orderedMediaSha256: [sha256Digest],
      providerPayloadDigest: 'd1',
      idempotencyKey: 'k_pre',
    })
    const preSubmitFailedReceipt = transitionReceiptState(preSubmitReceipt, 'FAILED', {
      reasonCode: 'PRE_VALIDATION_FAILED',
      additionalEvidence: { preContainerFailed: true },
    })
    expect(isSafeToRepublish(preSubmitFailedReceipt).safe).toBe(true)
    expect(isSafeToRepublish(preSubmitFailedReceipt).stage).toBe('PRE_CONTAINER')
  })
})
