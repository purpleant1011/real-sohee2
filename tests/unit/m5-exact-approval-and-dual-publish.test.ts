import { describe, it, expect } from 'vitest'
import {
  computeExactApprovalFingerprint,
  validateApprovalFingerprint,
  executeDualChannelPublish,
  reconcileChannelPublishState,
  type ExactApprovalPayload,
  type ChannelPublishReceipt,
} from '@/features/publishing/dual-publish-coordinator'

describe('HF-26 & HF-27: Exact Approval Fingerprint & Harness Lineage Integration', () => {
  const basePayload: ExactApprovalPayload = {
    workspaceId: 'ws-bakery-prod',
    contentId: 'cnt-100',
    contentVersion: 1,
    copyText: '프랑스산 유기농 밀가루로 만든 샤워도우',
    imageUrl: 'https://cdn.example.com/sourdough.jpg',
    channelTargets: ['instagram', 'threads'],
    harnessVersions: {
      knowledgeVersionId: 'know-v1',
      textHarnessVersionId: 'text-v1',
      imageHarnessVersionId: 'img-v1',
      operatingPolicyVersionId: 'pol-v1',
    },
    rightsAndConsent: {
      rightsStatus: 'OWNED',
      consentStatus: 'NOT_APPLICABLE',
    },
  }

  it('generates deterministic fingerprint for identical payload', () => {
    const fp1 = computeExactApprovalFingerprint(basePayload)
    const fp2 = computeExactApprovalFingerprint({ ...basePayload })
    expect(fp1).toBe(fp2)
    expect(fp1.startsWith('apfp_')).toBe(true)
  })

  it('changes fingerprint if copyText, imageUrl, channel, or any harness version changes', () => {
    const originalFp = computeExactApprovalFingerprint(basePayload)

    // 1. Text Harness version change
    const changedTextHarnessFp = computeExactApprovalFingerprint({
      ...basePayload,
      harnessVersions: {
        ...basePayload.harnessVersions,
        textHarnessVersionId: 'text-v2',
      },
    })
    expect(changedTextHarnessFp).not.toBe(originalFp)

    // 2. Channel targets change
    const changedChannelsFp = computeExactApprovalFingerprint({
      ...basePayload,
      channelTargets: ['instagram'],
    })
    expect(changedChannelsFp).not.toBe(originalFp)

    // 3. Copy text change
    const changedCopyFp = computeExactApprovalFingerprint({
      ...basePayload,
      copyText: '수정된 카피 문구입니다.',
    })
    expect(changedCopyFp).not.toBe(originalFp)
  })

  it('strictly validates approval fingerprint before execution (TOCTOU protection)', () => {
    const correctFp = computeExactApprovalFingerprint(basePayload)

    expect(() =>
      validateApprovalFingerprint({
        expectedFingerprint: correctFp,
        currentPayload: basePayload,
      })
    ).not.toThrow()

    // Modified payload must throw FINGERPRINT_MISMATCH
    const tamperedPayload = { ...basePayload, copyText: '악의적으로 변경된 문구' }
    expect(() =>
      validateApprovalFingerprint({
        expectedFingerprint: correctFp,
        currentPayload: tamperedPayload,
      })
    ).toThrowError(/FINGERPRINT_MISMATCH/)
  })
})

describe('HF-28: Instagram + Threads Dual Publish Independent Receipts', () => {
  const samplePayload: ExactApprovalPayload = {
    workspaceId: 'ws-bakery-prod',
    contentId: 'cnt-101',
    contentVersion: 1,
    copyText: '정성 가득한 브런치 세트 안내',
    imageUrl: 'https://cdn.example.com/brunch.jpg',
    channelTargets: ['instagram', 'threads'],
    harnessVersions: {
      knowledgeVersionId: 'know-v1',
      textHarnessVersionId: 'text-v1',
      imageHarnessVersionId: 'img-v1',
      operatingPolicyVersionId: 'pol-v1',
    },
    rightsAndConsent: {
      rightsStatus: 'OWNED',
      consentStatus: 'NOT_APPLICABLE',
    },
  }

  it('marks overall as ALL_VERIFIED only when both channels succeed with readback confirmation', async () => {
    const mockExecutor = async (channel: 'instagram' | 'threads') => {
      return {
        success: true,
        nativePostId: `${channel}_post_123`,
        liveUrl: `https://${channel}.com/p/123`,
      }
    }

    const result = await executeDualChannelPublish({
      payload: samplePayload,
      approvalFingerprint: computeExactApprovalFingerprint(samplePayload),
      executor: mockExecutor,
    })

    expect(result.overallStatus).toBe('ALL_VERIFIED')
    expect(result.receipts.instagram.status).toBe('VERIFIED')
    expect(result.receipts.instagram.liveUrl).toBe('https://instagram.com/p/123')
    expect(result.receipts.threads.status).toBe('VERIFIED')
    expect(result.receipts.threads.liveUrl).toBe('https://threads.com/p/123')
  })

  it('marks overall as PARTIAL_SUCCESS when one channel fails, avoiding false-success claims', async () => {
    const mockExecutor = async (channel: 'instagram' | 'threads') => {
      if (channel === 'threads') {
        throw new Error('THREADS_TOKEN_EXPIRED')
      }
      return {
        success: true,
        nativePostId: 'ig_post_999',
        liveUrl: 'https://instagram.com/p/999',
      }
    }

    const result = await executeDualChannelPublish({
      payload: samplePayload,
      approvalFingerprint: computeExactApprovalFingerprint(samplePayload),
      executor: mockExecutor,
    })

    expect(result.overallStatus).toBe('PARTIAL_SUCCESS')
    expect(result.receipts.instagram.status).toBe('VERIFIED')
    expect(result.receipts.threads.status).toBe('FAILED')
    expect(result.receipts.threads.errorMessage).toContain('THREADS_TOKEN_EXPIRED')
  })
})

describe('HF-29: Partial Success, RESULT_UNKNOWN & Reconcile Truth', () => {
  it('marks receipt as RESULT_UNKNOWN when timeout or 5xx occurs to prevent blind retry', async () => {
    const mockExecutor = async (channel: 'instagram' | 'threads') => {
      if (channel === 'instagram') {
        const timeoutErr: any = new Error('META_GATEWAY_TIMEOUT')
        timeoutErr.isUnknownResult = true
        throw timeoutErr
      }
      return {
        success: true,
        nativePostId: 'th_123',
        liveUrl: 'https://threads.net/t/123',
      }
    }

    const samplePayload: ExactApprovalPayload = {
      workspaceId: 'ws-bakery-prod',
      contentId: 'cnt-102',
      contentVersion: 1,
      copyText: '타임아웃 테스트 포스팅',
      channelTargets: ['instagram', 'threads'],
      harnessVersions: {
        knowledgeVersionId: 'know-v1',
        textHarnessVersionId: 'text-v1',
        imageHarnessVersionId: 'img-v1',
      },
      rightsAndConsent: {
        rightsStatus: 'OWNED',
        consentStatus: 'NOT_APPLICABLE',
      },
    }

    const result = await executeDualChannelPublish({
      payload: samplePayload,
      approvalFingerprint: computeExactApprovalFingerprint(samplePayload),
      executor: mockExecutor,
    })

    expect(result.receipts.instagram.status).toBe('RESULT_UNKNOWN')
    expect(result.overallStatus).toBe('PARTIAL_SUCCESS')
  })

  it('reconciles RESULT_UNKNOWN receipt to VERIFIED when live readback succeeds', async () => {
    const unknownReceipt: ChannelPublishReceipt = {
      channel: 'instagram',
      status: 'RESULT_UNKNOWN',
      attemptCount: 1,
      lastAttemptAt: new Date().toISOString(),
      idempotencyKey: 'idem-ig-102',
    }

    const reconcileResult = await reconcileChannelPublishState({
      receipt: unknownReceipt,
      readbackChecker: async () => ({
        found: true,
        nativePostId: 'ig_recovered_888',
        liveUrl: 'https://instagram.com/p/888',
      }),
    })

    expect(reconcileResult.status).toBe('VERIFIED')
    expect(reconcileResult.liveUrl).toBe('https://instagram.com/p/888')
    expect(reconcileResult.reconciledAt).toBeDefined()
  })
})
