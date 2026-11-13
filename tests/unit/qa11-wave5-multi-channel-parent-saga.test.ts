import { describe, it, expect, vi } from 'vitest'
import {
  MultiChannelPublishSaga,
  type MultiChannelSagaRequest,
  type MultiChannelSagaOutcome,
} from '@/features/publishing/multi-channel-parent-saga'
import type { BundleExecutorDependencies, BundlePublishOutcome } from '@/features/publishing/creative-bundle-publishing-executor'
import type { ExternalActionReceipt } from '@/features/publishing/external-action-receipt-engine'

describe('ANI-1137: Multi-channel Parent Saga & Partial Success Preservation', () => {
  const workspaceId = '00000000-0000-4000-8000-000000000001'
  const bundleId = 'bundle_multi_1137'
  const mockFingerprint = 'f'.repeat(64)
  const sagaIdempotencyKey = 'parent_saga_idem_1137'

  const baseRequest: MultiChannelSagaRequest = {
    workspaceId,
    bundleId,
    expectedFingerprint: mockFingerprint,
    channel: 'BOTH',
    idempotencyKey: sagaIdempotencyKey,
    actorUserId: 'user_1137',
  }

  it('marks ALL_VERIFIED when both Instagram and Threads succeed', async () => {
    const executedChannels: string[] = []

    const mockPublishExecutor = vi.fn().mockImplementation(async (input): Promise<BundlePublishOutcome> => {
      executedChannels.push(input.targetChannel)
      return {
        ok: true,
        receiptId: `receipt_${input.targetChannel}`,
        providerPostId: `post_${input.targetChannel}`,
        destinationUrl: `https://${input.targetChannel}.com/p/1`,
        verificationOutcome: 'VERIFIED',
        receiptState: 'VERIFIED',
      }
    })

    const saga = new MultiChannelPublishSaga({
      publishChannel: mockPublishExecutor,
      loadExistingReceipt: vi.fn().mockResolvedValue(null),
    })

    const outcome: MultiChannelSagaOutcome = await saga.execute(baseRequest)

    expect(outcome.overallStatus).toBe('ALL_VERIFIED')
    expect(outcome.success).toBe(true)
    expect(executedChannels).toEqual(['instagram', 'threads'])
    expect(outcome.children.instagram?.status).toBe('VERIFIED')
    expect(outcome.children.threads?.status).toBe('VERIFIED')
  })

  it('preserves PARTIAL_SUCCESS and does NOT claim total success when Instagram succeeds but Threads fails', async () => {
    const mockPublishExecutor = vi.fn().mockImplementation(async (input): Promise<BundlePublishOutcome> => {
      if (input.targetChannel === 'instagram') {
        return {
          ok: true,
          receiptId: 'receipt_ig_success',
          providerPostId: 'ig_post_1',
          destinationUrl: 'https://instagram.com/p/1',
          verificationOutcome: 'VERIFIED',
          receiptState: 'VERIFIED',
        }
      }
      return {
        ok: false,
        receiptId: 'receipt_th_fail',
        providerPostId: null,
        destinationUrl: null,
        verificationOutcome: 'FAILED',
        receiptState: 'FAILED',
        errorCode: 'THREADS_TOKEN_EXPIRED',
        errorMessage: 'Threads token expired during post creation',
      }
    })

    const saga = new MultiChannelPublishSaga({
      publishChannel: mockPublishExecutor,
      loadExistingReceipt: vi.fn().mockResolvedValue(null),
    })

    const outcome: MultiChannelSagaOutcome = await saga.execute(baseRequest)

    expect(outcome.overallStatus).toBe('PARTIAL_SUCCESS')
    // Partial success must NOT be reported as total clean success
    expect(outcome.success).toBe(false)
    expect(outcome.message).toContain('일부 채널')
    expect(outcome.children.instagram?.status).toBe('VERIFIED')
    expect(outcome.children.threads?.status).toBe('FAILED')
    expect(outcome.children.threads?.errorMessage).toContain('Threads token expired')
  })

  it('guarantees ZERO republish of Instagram when retrying a PARTIAL_SUCCESS saga', async () => {
    const publishChannelCalls: string[] = []

    // Pre-existing verified Instagram receipt
    const existingIgReceipt: Partial<ExternalActionReceipt> = {
      receiptId: 'receipt_ig_existing',
      workspaceId,
      channel: 'instagram',
      state: 'VERIFIED',
      providerPostId: 'ig_post_existing',
      permalink: 'https://instagram.com/p/existing',
      evidence: {
        visualScore: 0.95,
        captionMatch: true,
      },
    }

    const mockPublishExecutor = vi.fn().mockImplementation(async (input): Promise<BundlePublishOutcome> => {
      publishChannelCalls.push(input.targetChannel)
      return {
        ok: true,
        receiptId: `receipt_${input.targetChannel}_new`,
        providerPostId: `post_${input.targetChannel}_new`,
        destinationUrl: `https://${input.targetChannel}.com/p/new`,
        verificationOutcome: 'VERIFIED',
        receiptState: 'VERIFIED',
      }
    })

    const mockLoadReceipt = vi.fn().mockImplementation(async (_wsId, _bundleId, channel) => {
      if (channel === 'instagram') return existingIgReceipt as ExternalActionReceipt
      return null // Threads had failed and needs publishing
    })

    const saga = new MultiChannelPublishSaga({
      publishChannel: mockPublishExecutor,
      loadExistingReceipt: mockLoadReceipt,
    })

    const outcome: MultiChannelSagaOutcome = await saga.execute(baseRequest)

    // Acceptance invariant: IG republish count MUST BE 0!
    expect(publishChannelCalls).not.toContain('instagram')
    expect(publishChannelCalls).toEqual(['threads'])

    // Instagram was safely reused from existing verified receipt
    expect(outcome.children.instagram?.reusedExisting).toBe(true)
    expect(outcome.children.instagram?.status).toBe('VERIFIED')
    expect(outcome.children.instagram?.postId).toBe('ig_post_existing')

    // Threads succeeded on retry
    expect(outcome.children.threads?.reusedExisting).toBe(false)
    expect(outcome.children.threads?.status).toBe('VERIFIED')

    // Now all converged to ALL_VERIFIED
    expect(outcome.overallStatus).toBe('ALL_VERIFIED')
    expect(outcome.success).toBe(true)
  })

  it('marks ALL_FAILED when all requested channels fail', async () => {
    const mockPublishExecutor = vi.fn().mockResolvedValue({
      ok: false,
      receiptId: 'receipt_failed',
      providerPostId: null,
      destinationUrl: null,
      verificationOutcome: 'FAILED',
      receiptState: 'FAILED',
      errorCode: 'META_SERVICE_UNAVAILABLE',
      errorMessage: '503 Service Unavailable',
    })

    const saga = new MultiChannelPublishSaga({
      publishChannel: mockPublishExecutor,
      loadExistingReceipt: vi.fn().mockResolvedValue(null),
    })

    const outcome: MultiChannelSagaOutcome = await saga.execute(baseRequest)

    expect(outcome.overallStatus).toBe('ALL_FAILED')
    expect(outcome.success).toBe(false)
    expect(outcome.children.instagram?.status).toBe('FAILED')
    expect(outcome.children.threads?.status).toBe('FAILED')
  })

  it('propagates parent saga lineage into child publish invocations', async () => {
    const capturedInputs: any[] = []

    const mockPublishExecutor = vi.fn().mockImplementation(async (input): Promise<BundlePublishOutcome> => {
      capturedInputs.push(input)
      return {
        ok: true,
        receiptId: `receipt_${input.targetChannel}`,
        providerPostId: `post_${input.targetChannel}`,
        destinationUrl: `https://${input.targetChannel}.com/p/1`,
        verificationOutcome: 'VERIFIED',
        receiptState: 'VERIFIED',
      }
    })

    const saga = new MultiChannelPublishSaga({
      publishChannel: mockPublishExecutor,
      loadExistingReceipt: vi.fn().mockResolvedValue(null),
    })

    await saga.execute(baseRequest)

    expect(capturedInputs.length).toBe(2)
    // Child idempotency keys must be derived deterministically from parent
    expect(capturedInputs[0].idempotencyKey).toBe(`${sagaIdempotencyKey}:instagram`)
    expect(capturedInputs[1].idempotencyKey).toBe(`${sagaIdempotencyKey}:threads`)
  })

  it('isolates unexpected exceptions thrown by one channel so other channels still execute', async () => {
    const mockPublishExecutor = vi.fn().mockImplementation(async (input): Promise<BundlePublishOutcome> => {
      if (input.targetChannel === 'instagram') {
        throw new Error('Fatal socket hang up')
      }
      return {
        ok: true,
        receiptId: 'receipt_threads_ok',
        providerPostId: 'threads_post_1',
        destinationUrl: 'https://threads.net/p/1',
        verificationOutcome: 'VERIFIED',
        receiptState: 'VERIFIED',
      }
    })

    const saga = new MultiChannelPublishSaga({
      publishChannel: mockPublishExecutor,
      loadExistingReceipt: vi.fn().mockResolvedValue(null),
    })

    const outcome = await saga.execute(baseRequest)

    expect(outcome.overallStatus).toBe('PARTIAL_SUCCESS')
    expect(outcome.success).toBe(false)
    expect(outcome.children.instagram?.status).toBe('RESULT_UNKNOWN')
    expect(outcome.children.instagram?.errorCode).toBe('RESULT_UNKNOWN')
    expect(outcome.children.instagram?.errorMessage).toContain('Fatal socket hang up')
    expect(outcome.children.threads?.status).toBe('VERIFIED')
  })
})
