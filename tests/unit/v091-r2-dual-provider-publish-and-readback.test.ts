import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  createDefaultProductionAdapter,
  executeDualProviderPublish,
  retryFailedChannelPublish,
  type ChannelPublishAdapter,
  type PublishStage,
} from '@/features/publishing/dual-provider-publish-service'
import { calculateApprovalFingerprint } from '@/lib/evidence/approval-fingerprint'
import type { ApprovedFirstPostMission, ExactApprovalPayload } from '@/features/missions/conversational-first-post'

function makeMockApprovedMission(channels: Array<{ provider: 'instagram' | 'threads'; handle: string }>): {
  approved: ApprovedFirstPostMission
  payload: ExactApprovalPayload
} {
  const payload: ExactApprovalPayload = {
    workspaceId: 'ws-cafe-1',
    missionId: 'mission-fp-1',
    channels,
    copies: {
      instagram: { caption: '첫 게시물입니다! ☕' },
      threads: { content: '첫 게시물입니다! ☕' },
    },
    imageIds: ['asset-golden-1'],
    boundVersions: {
      knowledgeVersion: 1,
      textHarnessVersion: 1,
      imageHarnessVersion: 1,
      operatingPolicyVersion: 1,
    },
    rights: {
      rightsStatus: 'OWNED',
      consentStatus: 'CONFIRMED',
    },
  }

  const fingerprint = calculateApprovalFingerprint(payload)

  const approved: ApprovedFirstPostMission = Object.freeze({
    id: 'appr-1',
    workspaceId: 'ws-cafe-1',
    missionId: 'mission-fp-1',
    approvalId: 'appr-rec-1',
    status: 'APPROVED_FOR_PUBLISH',
    approvedFingerprint: fingerprint,
    payload,
    approvedByUserId: 'user-1',
    approvedAt: new Date().toISOString(),
  })

  return { approved, payload }
}

describe('ANI-1434: Dual Provider Publish · Independent Readback · Evidence Lineage', () => {
  let origAllowlist: string | undefined

  beforeEach(() => {
    origAllowlist = process.env.META_LIVE_WORKSPACE_ALLOWLIST
    process.env.META_LIVE_WORKSPACE_ALLOWLIST = '*'
  })

  afterEach(() => {
    if (origAllowlist !== undefined) {
      process.env.META_LIVE_WORKSPACE_ALLOWLIST = origAllowlist
    } else {
      delete process.env.META_LIVE_WORKSPACE_ALLOWLIST
    }
  })

  describe('1. 5-Stage Lifecycle & Provider Accepted ≠ Verified Invariant', () => {
    it('requires independent readback to transition from PROVIDER_ACCEPTED to EXTERNALLY_VERIFIED', async () => {
      const { approved, payload } = makeMockApprovedMission([
        { provider: 'instagram', handle: '@cafe_dalkom' },
      ])

      const mockAdapter: ChannelPublishAdapter = {
        publish: vi.fn().mockResolvedValue({
          providerAccepted: true,
          providerPostId: 'ig_post_100',
          requestId: 'req_ig_1',
        }),
        readback: vi.fn().mockResolvedValue({
          isLive: true,
          permalink: 'https://instagram.com/p/ig_post_100',
          verifiedAt: new Date().toISOString(),
        }),
      }

      const result = await executeDualProviderPublish({
        approvedMission: approved,
        currentPayload: payload,
        adapters: { instagram: mockAdapter },
      })

      expect(mockAdapter.publish).toHaveBeenCalledTimes(1)
      expect(mockAdapter.readback).toHaveBeenCalledWith('ig_post_100', expect.anything())

      const igReceipt = result.receipts.instagram
      expect(igReceipt).toBeDefined()
      expect(igReceipt?.stage).toBe('EXTERNALLY_VERIFIED')
      expect(igReceipt?.permalink).toBe('https://instagram.com/p/ig_post_100')
      expect(igReceipt?.verifiedAt).toBeDefined()
      expect(result.overallStatus).toBe('ALL_VERIFIED')
    })

    it('stays at PROVIDER_ACCEPTED and fails verification if readback fails or post is not live', async () => {
      const { approved, payload } = makeMockApprovedMission([
        { provider: 'instagram', handle: '@cafe_dalkom' },
      ])

      const mockAdapter: ChannelPublishAdapter = {
        publish: vi.fn().mockResolvedValue({
          providerAccepted: true,
          providerPostId: 'ig_post_pending',
          requestId: 'req_ig_pending',
        }),
        readback: vi.fn().mockResolvedValue({
          isLive: false,
          errorMessage: 'Post not yet indexable by provider',
        }),
      }

      const result = await executeDualProviderPublish({
        approvedMission: approved,
        currentPayload: payload,
        adapters: { instagram: mockAdapter },
      })

      const igReceipt = result.receipts.instagram
      expect(igReceipt?.stage).toBe('PROVIDER_ACCEPTED')
      expect(igReceipt?.permalink).toBeUndefined()
      expect(result.overallStatus).toBe('FAILED')
    })
  })

  describe('2. Dual Channel Independence & Partial Success Truth (No Blurring)', () => {
    it('correctly marks PARTIAL_SUCCESS when Instagram succeeds and Threads fails', async () => {
      const { approved, payload } = makeMockApprovedMission([
        { provider: 'instagram', handle: '@cafe_dalkom' },
        { provider: 'threads', handle: '@cafe_dalkom' },
      ])

      const igAdapter: ChannelPublishAdapter = {
        publish: vi.fn().mockResolvedValue({
          providerAccepted: true,
          providerPostId: 'ig_post_success',
          requestId: 'req_ig_1',
        }),
        readback: vi.fn().mockResolvedValue({
          isLive: true,
          permalink: 'https://instagram.com/p/ig_post_success',
          verifiedAt: new Date().toISOString(),
        }),
      }

      const thAdapter: ChannelPublishAdapter = {
        publish: vi.fn().mockRejectedValue(new Error('Threads rate limit exceeded')),
        readback: vi.fn(),
      }

      const result = await executeDualProviderPublish({
        approvedMission: approved,
        currentPayload: payload,
        adapters: { instagram: igAdapter, threads: thAdapter },
      })

      expect(result.overallStatus).toBe('PARTIAL_SUCCESS')
      expect(result.receipts.instagram?.stage).toBe('EXTERNALLY_VERIFIED')
      expect(result.receipts.threads?.stage).toBe('FAILED')
      expect(result.receipts.threads?.errorMessage).toContain('Threads rate limit')
      expect(thAdapter.readback).not.toHaveBeenCalled()
    })
  })

  describe('3. Selective Retry & Idempotency Invariant (No Duplicate Post)', () => {
    it.each(['RESULT_UNKNOWN', 'AbortError: operation aborted', 'publish outcome unknown'])(
      'preserves uncertain retry outcomes and blocks another publish: %s',
      async (errorMessage) => {
        const { approved, payload } = makeMockApprovedMission([
          { provider: 'threads', handle: '@cafe_dalkom' },
        ])
        const adapter: ChannelPublishAdapter = {
          publish: vi.fn().mockResolvedValue({ providerAccepted: false, errorMessage }),
          readback: vi.fn(),
        }
        const result = await retryFailedChannelPublish({
          approvedMission: approved,
          currentPayload: payload,
          targetChannel: 'threads',
          existingReceipts: {},
          adapters: { threads: adapter },
        })
        expect(result.receipts.threads?.stage).toBe('RESULT_UNKNOWN')
        await expect(retryFailedChannelPublish({
          approvedMission: approved,
          currentPayload: payload,
          targetChannel: 'threads',
          existingReceipts: result.receipts,
          adapters: { threads: adapter },
        })).rejects.toThrow('RESULT_UNKNOWN_RETRY_BLOCKED')
        expect(adapter.publish).toHaveBeenCalledTimes(1)
      },
    )

    it('retries only the failed channel and skips the already verified channel', async () => {
      const { approved, payload } = makeMockApprovedMission([
        { provider: 'instagram', handle: '@cafe_dalkom' },
        { provider: 'threads', handle: '@cafe_dalkom' },
      ])

      const existingReceipts = {
        instagram: {
          channel: 'instagram' as const,
          stage: 'EXTERNALLY_VERIFIED' as PublishStage,
          providerPostId: 'ig_post_existing',
          permalink: 'https://instagram.com/p/ig_post_existing',
          receiptId: 'rcpt_ig_old',
          requestId: 'req_ig_old',
          approvalFingerprint: approved.approvedFingerprint,
          attemptCount: 1,
          lastAttemptAt: new Date().toISOString(),
          verifiedAt: new Date().toISOString(),
        },
        threads: {
          channel: 'threads' as const,
          stage: 'FAILED' as PublishStage,
          receiptId: 'rcpt_th_old',
          requestId: 'req_th_old',
          approvalFingerprint: approved.approvedFingerprint,
          attemptCount: 1,
          lastAttemptAt: new Date().toISOString(),
          errorMessage: 'Server 500 error',
        },
      }

      const igAdapter: ChannelPublishAdapter = {
        publish: vi.fn(),
        readback: vi.fn(),
      }

      const thAdapter: ChannelPublishAdapter = {
        publish: vi.fn().mockResolvedValue({
          providerAccepted: true,
          providerPostId: 'th_post_retried',
          requestId: 'req_th_retried',
        }),
        readback: vi.fn().mockResolvedValue({
          isLive: true,
          permalink: 'https://threads.com/@cafe_dalkom/post/th_post_retried',
          verifiedAt: new Date().toISOString(),
        }),
      }

      const retryResult = await retryFailedChannelPublish({
        approvedMission: approved,
        currentPayload: payload,
        targetChannel: 'threads',
        existingReceipts,
        adapters: { instagram: igAdapter, threads: thAdapter },
      })

      // Invariant: Instagram MUST NOT be published again
      expect(igAdapter.publish).not.toHaveBeenCalled()

      // Threads was successfully retried
      expect(thAdapter.publish).toHaveBeenCalledTimes(1)
      expect(thAdapter.readback).toHaveBeenCalledWith('th_post_retried', expect.anything())

      expect(retryResult.receipts.instagram?.stage).toBe('EXTERNALLY_VERIFIED')
      expect(retryResult.receipts.instagram?.permalink).toBe('https://instagram.com/p/ig_post_existing')
      expect(retryResult.receipts.threads?.stage).toBe('EXTERNALLY_VERIFIED')
      expect(retryResult.receipts.threads?.permalink).toBe('https://threads.com/@cafe_dalkom/post/th_post_retried')
      expect(retryResult.overallStatus).toBe('ALL_VERIFIED')
    })

    it('rejects retry if target channel is already EXTERNALLY_VERIFIED', async () => {
      const { approved, payload } = makeMockApprovedMission([
        { provider: 'instagram', handle: '@cafe_dalkom' },
      ])

      const existingReceipts = {
        instagram: {
          channel: 'instagram' as const,
          stage: 'EXTERNALLY_VERIFIED' as PublishStage,
          providerPostId: 'ig_post_existing',
          permalink: 'https://instagram.com/p/ig_post_existing',
          receiptId: 'rcpt_ig_old',
          requestId: 'req_ig_old',
          approvalFingerprint: approved.approvedFingerprint,
          attemptCount: 1,
          lastAttemptAt: new Date().toISOString(),
          verifiedAt: new Date().toISOString(),
        },
      }

      await expect(
        retryFailedChannelPublish({
          approvedMission: approved,
          currentPayload: payload,
          targetChannel: 'instagram',
          existingReceipts,
          adapters: {
            instagram: { publish: vi.fn(), readback: vi.fn() },
          },
        })
      ).rejects.toThrowError(/CHANNEL_ALREADY_VERIFIED/)
    })

    it('refuses to retry a channel that was not included in approved channels', async () => {
      // Only instagram is approved
      const { approved, payload } = makeMockApprovedMission([
        { provider: 'instagram', handle: '@cafe_dalkom' },
      ])

      const mockThreadsAdapter: ChannelPublishAdapter = {
        publish: vi.fn(),
        readback: vi.fn(),
      }

      await expect(
        retryFailedChannelPublish({
          approvedMission: approved,
          currentPayload: payload,
          targetChannel: 'threads',
          existingReceipts: {},
          adapters: { threads: mockThreadsAdapter },
        })
      ).rejects.toThrowError(/INVALID_RETRY_CHANNEL/)

      expect(mockThreadsAdapter.publish).not.toHaveBeenCalled()
    })

    it('does NOT re-publish when channel was PROVIDER_ACCEPTED, only runs readback', async () => {
      const { approved, payload } = makeMockApprovedMission([
        { provider: 'instagram', handle: '@cafe_dalkom' },
      ])

      const existingReceipts = {
        instagram: {
          channel: 'instagram' as const,
          stage: 'PROVIDER_ACCEPTED' as PublishStage,
          providerPostId: 'ig_post_accepted_earlier',
          receiptId: 'rcpt_ig_old',
          requestId: 'req_ig_idempotent',
          approvalFingerprint: approved.approvedFingerprint,
          attemptCount: 1,
          lastAttemptAt: new Date().toISOString(),
        },
      }

      const igAdapter: ChannelPublishAdapter = {
        publish: vi.fn(),
        readback: vi.fn().mockResolvedValue({
          isLive: true,
          permalink: 'https://instagram.com/p/ig_post_accepted_earlier',
          verifiedAt: new Date().toISOString(),
        }),
      }

      const retryResult = await retryFailedChannelPublish({
        approvedMission: approved,
        currentPayload: payload,
        targetChannel: 'instagram',
        existingReceipts,
        adapters: { instagram: igAdapter },
      })

      // Invariant: adapter.publish must NOT be called again!
      expect(igAdapter.publish).not.toHaveBeenCalled()
      // Independent readback was called to re-verify
      expect(igAdapter.readback).toHaveBeenCalledWith('ig_post_accepted_earlier', expect.anything())
      expect(retryResult.receipts.instagram?.stage).toBe('EXTERNALLY_VERIFIED')
      expect(retryResult.receipts.instagram?.permalink).toBe('https://instagram.com/p/ig_post_accepted_earlier')
      expect(retryResult.receipts.instagram?.requestId).toBe('req_ig_idempotent')
    })

    it('blocks re-publish when previous channel outcome was RESULT_UNKNOWN without providerPostId', async () => {
      const { approved, payload } = makeMockApprovedMission([
        { provider: 'threads', handle: '@cafe_dalkom' },
      ])

      const existingReceipts = {
        threads: {
          channel: 'threads' as const,
          stage: 'RESULT_UNKNOWN' as PublishStage,
          receiptId: 'rcpt_th_unknown',
          requestId: 'req_th_unknown',
          approvalFingerprint: approved.approvedFingerprint,
          attemptCount: 1,
          lastAttemptAt: new Date().toISOString(),
          errorMessage: 'Gateway timeout',
        },
      }

      const thAdapter: ChannelPublishAdapter = {
        publish: vi.fn(),
        readback: vi.fn(),
      }

      await expect(
        retryFailedChannelPublish({
          approvedMission: approved,
          currentPayload: payload,
          targetChannel: 'threads',
          existingReceipts,
          adapters: { threads: thAdapter },
        })
      ).rejects.toThrowError(/RESULT_UNKNOWN_RETRY_BLOCKED/)

      expect(thAdapter.publish).not.toHaveBeenCalled()
    })

    it('reuses idempotent requestId when retrying a FAILED channel', async () => {
      const { approved, payload } = makeMockApprovedMission([
        { provider: 'threads', handle: '@cafe_dalkom' },
      ])

      const existingReceipts = {
        threads: {
          channel: 'threads' as const,
          stage: 'FAILED' as PublishStage,
          receiptId: 'rcpt_th_failed',
          requestId: 'req_th_original_idempotent',
          approvalFingerprint: approved.approvedFingerprint,
          attemptCount: 1,
          lastAttemptAt: new Date().toISOString(),
          errorMessage: 'Provider rate limit exceeded',
        },
      }

      const thAdapter: ChannelPublishAdapter = {
        publish: vi.fn().mockResolvedValue({
          providerAccepted: true,
          providerPostId: 'th_new_post',
          requestId: 'req_th_original_idempotent',
        }),
        readback: vi.fn().mockResolvedValue({
          isLive: true,
          permalink: 'https://threads.com/@cafe_dalkom/post/th_new_post',
        }),
      }

      const retryResult = await retryFailedChannelPublish({
        approvedMission: approved,
        currentPayload: payload,
        targetChannel: 'threads',
        existingReceipts,
        adapters: { threads: thAdapter },
      })

      expect(thAdapter.publish).toHaveBeenCalledTimes(1)
      expect(retryResult.receipts.threads?.requestId).toBe('req_th_original_idempotent')
    })
  })

  describe('4. Tamper Detection Guard Before External Publish', () => {
    it('refuses to publish any channel if payload does not match approved fingerprint', async () => {
      const { approved, payload } = makeMockApprovedMission([
        { provider: 'instagram', handle: '@cafe_dalkom' },
      ])

      const tamperedPayload: ExactApprovalPayload = {
        ...payload,
        copies: {
          ...payload.copies,
          instagram: { caption: '내용이 승인 후 변조됨!' },
        },
      }

      const mockAdapter: ChannelPublishAdapter = {
        publish: vi.fn(),
        readback: vi.fn(),
      }

      await expect(
        executeDualProviderPublish({
          approvedMission: approved,
          currentPayload: tamperedPayload,
          adapters: { instagram: mockAdapter },
        })
      ).rejects.toThrowError(/APPROVAL_FINGERPRINT_TAMPERED/)

      expect(mockAdapter.publish).not.toHaveBeenCalled()
    })
  })

  describe('5. Instagram Fallback Image Prohibition', () => {
    it('fails closed when Instagram has no valid image URLs and never uses fallback image', async () => {
      // Mock credentials repository
      vi.mock('@/features/channels/credential-repository', () => ({
        loadChannelCredentialByChannel: vi.fn().mockResolvedValue({
          accessToken: 'test_token',
          externalAccountId: 'ig_acc_123',
        }),
      }))

      const adapter = createDefaultProductionAdapter('instagram')
      const payloadWithoutImages: ExactApprovalPayload = {
        workspaceId: 'ws-cafe-1',
        missionId: 'mission-fp-1',
        channels: [{ provider: 'instagram', handle: '@cafe_dalkom' }],
        copies: {
          instagram: { caption: '첫 게시물입니다! ☕' },
          threads: { content: '첫 게시물입니다! ☕' },
        },
        imageIds: [], // No images!
        boundVersions: {
          knowledgeVersion: 1,
          textHarnessVersion: 1,
          imageHarnessVersion: 1,
          operatingPolicyVersion: 1,
        },
        rights: {
          rightsStatus: 'OWNED',
          consentStatus: 'CONFIRMED',
        },
      }

      const result = await adapter.publish('instagram', payloadWithoutImages)
      expect(result.providerAccepted).toBe(false)
      expect(result.errorMessage).toContain('IMAGE_REQUIRED')
      expect(result.errorMessage).not.toContain('sohee_insta_post.jpg')
    })
  })
})
