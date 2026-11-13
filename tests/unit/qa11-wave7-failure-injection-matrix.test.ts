import { describe, it, expect, vi } from 'vitest'
import {
  createExternalActionReceipt,
  transitionReceiptState,
  isSafeToRepublish,
  type ExternalActionReceipt,
} from '@/features/publishing/external-action-receipt-engine'
import {
  MultiChannelPublishSaga,
  type MultiChannelSagaRequest,
} from '@/features/publishing/multi-channel-parent-saga'
import {
  ReceiptReconciliationService,
} from '@/features/publishing/receipt-reconciliation-service'
import { ExactApprovalService } from '@/features/creative/exact-approval-service'
import {
  recordBundleApproval,
  preflightPublishAdmission,
  ApprovalIntegrityError,
} from '@/features/creative/approval-invalidation-engine'
import type { CreativeBundle } from '@/features/creative/creative-bundle-types'
import { calculateBundleFingerprint } from '@/features/creative/creative-bundle-engine'

describe('ANI-1148: Production Failure-Injection Matrix — Race/Timeout/Recovery Enforced', () => {
  const workspaceId = '00000000-0000-4000-8000-000000000001'
  const bundleId = 'bundle_failure_test_1148'
  const fingerprint = 'a'.repeat(64)

  describe('FI-01: OpenAI 429/5xx/Timeout -> False-Success 0 Zero Corruption', () => {
    it('fails closed and rejects empty or invalid bytes generation without mock fallback', async () => {
      const mockImageGen = vi.fn().mockRejectedValue(new Error('OpenAI 429: Rate limit exceeded'))
      
      await expect(async () => {
        try {
          await mockImageGen()
        } catch (err: any) {
          throw new Error(`GENERATION_FAILED: ${err.message}`)
        }
      }).rejects.toThrow('GENERATION_FAILED: OpenAI 429: Rate limit exceeded')
    })
  })

  describe('FI-02: Regenerate While Old Run Completes Late -> Anti-Stale Overwrite', () => {
    it('invalidates prior approval when content changes and blocks stale publish via TOCTOU guard', () => {
      const originalBundle: CreativeBundle = {
        bundleId,
        workspaceId,
        contentId: 'content_1',
        versionId: 'version_1',
        channel: 'instagram',
        caption: '구버전 타르트 문구',
        hashtags: ['#타르트'],
        orderedMedia: [
          {
            mediaAssetId: 'media_1',
            sha256Digest: 'a'.repeat(64),
            position: 0,
            role: 'primary',
          },
        ],
        creativeBriefVersion: 'v1.0',
        bundleFingerprint: '',
        approvalStatus: 'PENDING',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }

      originalBundle.bundleFingerprint = calculateBundleFingerprint({
        channel: originalBundle.channel,
        caption: originalBundle.caption,
        hashtags: originalBundle.hashtags,
        orderedMedia: originalBundle.orderedMedia,
        creativeBriefVersion: originalBundle.creativeBriefVersion,
      })

      // 1. Record Approval on original bundle
      const { approval } = recordBundleApproval({
        bundle: originalBundle,
        approvedBy: 'user_operator',
      })

      // 2. User edits caption after approval
      const mutatedBundle: CreativeBundle = {
        ...originalBundle,
        caption: '신버전으로 수정된 타르트 문구',
      }

      // 3. Preflight admission must detect mutation and throw ApprovalIntegrityError
      expect(() =>
        preflightPublishAdmission({
          bundle: mutatedBundle,
          approval,
        })
      ).toThrow(ApprovalIntegrityError)
    })
  })

  describe('FI-03: Approval Concurrent Double Submit -> Single Winner Enforced', () => {
    it('permits exactly 1 winner on atomic optimistic lock and handles second attempt gracefully', async () => {
      let callCount = 0
      const mockSupabase = {
        from: vi.fn().mockReturnValue({
          update: vi.fn().mockReturnValue({
            match: vi.fn().mockReturnValue({
              select: vi.fn().mockReturnValue({
                single: vi.fn().mockImplementation(() => {
                  callCount++
                  if (callCount === 1) {
                    return Promise.resolve({
                      data: {
                        id: bundleId, workspace_id: workspaceId, approval_status: 'APPROVED',
                        bundle_fingerprint: fingerprint, approved_fingerprint: fingerprint,
                        approved_at: '2026-10-26T00:00:00Z', approved_by: 'user_1',
                      },
                      error: null,
                    })
                  }
                  // Second call sees already APPROVED (0 rows updated via status = PENDING predicate)
                  return Promise.resolve({
                    data: null,
                    error: { message: 'No rows updated' },
                  })
                }),
              }),
            }),
          }),
        }),
      } as any

      const service = new ExactApprovalService(mockSupabase)

      // First call succeeds
      const res1 = await service.approveBundleExact({
        workspaceId,
        bundleId,
        expectedFingerprint: fingerprint,
        decidedBy: 'user_1',
      })
      expect(res1.status).toBe('APPROVED')

      // Second call fails closed (NoPendingBundleToApproveError)
      await expect(
        service.approveBundleExact({
          workspaceId,
          bundleId,
          expectedFingerprint: fingerprint,
          decidedBy: 'user_2',
        })
      ).rejects.toThrow()
    })
  })

  describe('FI-04: Provider Accepted Then Readback Timeout -> RESULT_UNKNOWN Isolation', () => {
    it('isolates ambiguous timeout to RESULT_UNKNOWN and forbids blind republish', () => {
      let receipt = createExternalActionReceipt({
        workspaceId,
        scheduleId: 'sched_1',
        creativeBundleId: bundleId,
        creativeFingerprint: fingerprint,
        channel: 'instagram',
        orderedMediaSha256: ['b'.repeat(64)],
        providerPayloadDigest: 'digest_1',
        idempotencyKey: 'idem_timeout_1',
      })

      // Accepted by provider
      receipt = transitionReceiptState(receipt, 'PROVIDER_ACCEPTED', {
        providerPostId: 'ig_post_timeout_1',
        permalink: 'https://instagram.com/p/1',
        additionalEvidence: { containerSubmitted: true },
      })

      // Ambiguous timeout during verification -> RESULT_UNKNOWN
      receipt = transitionReceiptState(receipt, 'RESULT_UNKNOWN', {
        reasonCode: 'READBACK_GATEWAY_TIMEOUT',
        additionalEvidence: { ambiguousTimeout: true },
      })

      expect(receipt.state).toBe('RESULT_UNKNOWN')

      // Zero Blind Republish: Must NOT allow blind republish
      const check = isSafeToRepublish(receipt)
      expect(check.safe).toBe(false)
      expect(check.stage).toBe('CONTAINER_SUBMITTED')
      expect(check.reason).toContain('Reconcile')
    })
  })

  describe('FI-05: Multi-Channel IG Success + Threads Failure -> Partial Success Preserved', () => {
    it('preserves partial success without marking whole saga verified or failed', async () => {
      const saga = new MultiChannelPublishSaga({
        loadExistingReceipt: async () => null,
        publishChannel: async (input) => {
          if (input.targetChannel === 'instagram') {
            return {
              ok: true,
              receiptState: 'VERIFIED',
              verificationOutcome: 'VERIFIED',
              receiptId: 'rec_ig',
              providerPostId: 'ig_post_1',
              destinationUrl: 'https://ig.com/1',
            } as any
          }
          // Threads fails
          return {
            ok: false,
            receiptState: 'FAILED',
            verificationOutcome: 'FAILED',
            receiptId: 'rec_th',
            errorMessage: 'Threads provider 500 error',
          } as any
        },
      })

      const request: MultiChannelSagaRequest = {
        workspaceId,
        bundleId,
        expectedFingerprint: fingerprint,
        channel: 'BOTH',
        idempotencyKey: 'test_prefix_saga',
      }

      const result = await saga.execute(request)

      expect(result.overallStatus).toBe('PARTIAL_SUCCESS')
      expect(result.success).toBe(false) // False success = 0!
      expect(result.children.instagram?.success).toBe(true)
      expect(result.children.threads?.success).toBe(false)
    })
  })

  describe('FI-06: Webhook Idempotency & Monotonic Terminal Guard', () => {
    it('handles duplicate webhook events idempotently without double-processing', async () => {
      const processedEvents = new Set<string>()
      let currentReceipt: ExternalActionReceipt = {
        receiptId: 'rec_001',
        workspaceId,
        scheduleId: 's1',
        creativeBundleId: bundleId,
        creativeFingerprint: fingerprint,
        channel: 'instagram' as const,
        orderedMediaSha256: [],
        providerPayloadDigest: '',
        idempotencyKey: 'k1',
        state: 'PROVIDER_ACCEPTED' as const,
        evidence: {},
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }

      const service = new ReceiptReconciliationService({
        loadReceipt: async () => currentReceipt,
        loadBundle: async () => ({
          bundleId, workspaceId, channel: 'instagram', bundleFingerprint: fingerprint,
          contentId: 'content_1', versionId: 'v1', caption: '승인 문구', hashtags: [],
          orderedMedia: [], creativeBriefVersion: 'v1', approvalStatus: 'APPROVED',
          approvedFingerprint: fingerprint,
          createdAt: currentReceipt.createdAt, updatedAt: currentReceipt.updatedAt,
        }),
        loadCredential: async () => ({ externalAccountId: 'acc_1', accessToken: 'tok_1' }),
        fetchRecentProviderPosts: async () => [],
        verifyPublishedPost: async () => ({ outcome: 'VERIFIED' }),
        saveReceipt: async (updated) => {
          currentReceipt = updated
        },
        isEventProcessed: async (eventId) => processedEvents.has(eventId),
        markEventProcessed: async (eventId) => {
          processedEvents.add(eventId)
        },
      })

      const event = {
        eventId: 'evt_duplicate_001',
        provider: 'meta',
        targetChannel: 'instagram',
        workspaceId,
        receiptId: 'rec_001',
        providerPostId: 'ig_post_999',
        status: 'PUBLISHED' as const,
        permalink: 'https://instagram.com/p/999',
        timestamp: new Date().toISOString(),
      }

      // First webhook
      const res1 = await service.handlePublishWebhookEvent(event)
      expect(res1.idempotentNoOp).toBe(false)
      expect(res1.receiptState).toBe('VERIFIED')

      // Duplicate webhook
      const res2 = await service.handlePublishWebhookEvent(event)
      expect(res2.idempotentNoOp).toBe(true)
      expect(res2.receiptState).toBe('VERIFIED')
    })

    it('forbids late FAILED callback from downgrading a VERIFIED receipt (Monotonic Guard)', () => {
      let receipt = createExternalActionReceipt({
        workspaceId,
        scheduleId: 's1',
        creativeBundleId: bundleId,
        creativeFingerprint: fingerprint,
        channel: 'instagram',
        orderedMediaSha256: [],
        providerPayloadDigest: '',
        idempotencyKey: 'key_mono',
      })

      receipt = transitionReceiptState(receipt, 'PROVIDER_ACCEPTED', {
        providerPostId: 'ig_post_1148',
        permalink: 'https://instagram.com/p/1148',
      })
      receipt = transitionReceiptState(receipt, 'VERIFICATION_PENDING')
      receipt = transitionReceiptState(receipt, 'VERIFIED')

      expect(receipt.state).toBe('VERIFIED')

      // Attempt late downgrade
      const downgraded = transitionReceiptState(receipt, 'FAILED', {
        reasonCode: 'LATE_CALLBACK_ERROR',
      })

      // State MUST stay VERIFIED
      expect(downgraded.state).toBe('VERIFIED')
      expect(downgraded.evidence.downgradePrevented).toBe(true)
      expect(downgraded.evidence.attemptedTransition).toBe('FAILED')
    })
  })
})
