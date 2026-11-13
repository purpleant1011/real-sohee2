import { describe, it, expect } from 'vitest'
import {
  createDefaultProductionAdapter,
  executeDualProviderPublish,
} from '@/features/publishing/dual-provider-publish-service'
import type { ApprovedFirstPostMission, ExactApprovalPayload } from '@/features/missions/conversational-first-post'

describe('P0-1: Real Provider Publish & Fail-Closed Invariant', () => {
  const dummyPayload: ExactApprovalPayload = {
    workspaceId: 'ws-unconfigured-test',
    missionId: 'mission-test-1',
    channels: [
      { provider: 'instagram', handle: '@test' },
      { provider: 'threads', handle: '@test' },
    ],
    copies: {
      instagram: { caption: 'test', hashtags: [] },
      threads: { content: 'test' },
    },
    imageIds: ['img-1'],
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

  const dummyApprovedMission: ApprovedFirstPostMission = {
    id: 'appr-1',
    workspaceId: 'ws-unconfigured-test',
    missionId: 'mission-test-1',
    approvalId: 'appr-rec-1',
    status: 'APPROVED_FOR_PUBLISH',
    approvedFingerprint: 'dummy-fingerprint',
    payload: dummyPayload,
    approvedByUserId: 'user-1',
    approvedAt: new Date().toISOString(),
  }

  describe('1. Production Default Adapter Integrity', () => {
    it('does NOT manufacture fake/simulated post IDs or permalinks when real credentials are missing', async () => {
      const adapter = createDefaultProductionAdapter('instagram')

      const publishResult = await adapter.publish('instagram', dummyPayload)
      // Must FAIL CLOSED if no real provider/credentials configured:
      expect(publishResult.providerAccepted).toBe(false)
      expect(publishResult.providerPostId).toBeUndefined()

      const readbackResult = await adapter.readback('non-existent-id')
      expect(readbackResult.isLive).toBe(false)
      expect(readbackResult.permalink).toBeUndefined()
    })
  })

  describe('2. Dual Publish Execution Default Fail-Closed', () => {
    it('fails closed when adapters are omitted and workspace lacks credentials', async () => {
      // Mock fingerprint matching so tamper guard passes
      const { calculateApprovalFingerprint } = await import('@/features/missions/conversational-first-post')
      const realFingerprint = calculateApprovalFingerprint(dummyPayload)
      const validApprovedMission = {
        ...dummyApprovedMission,
        approvedFingerprint: realFingerprint,
      }

      const result = await executeDualProviderPublish({
        approvedMission: validApprovedMission,
        currentPayload: dummyPayload,
        // No mock adapters passed -> MUST use production adapter which fails closed
      })

      expect(result.overallStatus).toBe('FAILED')
      expect(result.receipts.instagram?.stage).not.toBe('EXTERNALLY_VERIFIED')
      expect(result.receipts.threads?.stage).not.toBe('EXTERNALLY_VERIFIED')
    })
  })
})
