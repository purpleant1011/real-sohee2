/**
 * R2-B11 Contract Simulation Suite.
 * NOTE: This is an in-memory/adapter contract simulation of the Golden Journey.
 * It strictly validates state machine transitions, fail-closed guards, and fingerprint contracts.
 * It DOES NOT replace or constitute live provider proof on production Instagram/Threads accounts.
 */

import { describe, it, expect, vi } from 'vitest'
import {
  SOHEE_READINESS_FACT_KEYS,
  type SoheeReadinessSnapshot,
  type ReadinessFactProvenance,
} from '@/features/sohee-ready/types'
import {
  validateFirstPostAdmission,
  proposeFirstPostMission,
  confirmExactApproval,
  validateApprovalForPublish,
  type ExactApprovalPayload,
} from '@/features/missions/conversational-first-post'
import {
  executeDualProviderPublish,
  type ChannelPublishAdapter,
} from '@/features/publishing/dual-provider-publish-service'
import {
  FUNNEL_STEPS,
  createFunnelEvent,
  calculateFunnelMetrics,
  type FunnelEventPayload,
} from '@/features/telemetry/first-post-funnel-telemetry'

describe('ANI-1435: Contract Simulation · Pre-deployment Contract Verification (Not Live Release Proof)', () => {
  const workspaceId = 'ws-sohee-golden-1'
  const userId = 'user-owner-sohee'
  const correlationId = 'corr-golden-journey-20260914'
  const startTime = new Date(Date.now() - 180000).toISOString() // 3 minutes ago

  describe('1. Non-seed Fail-Closed Guard: Direct Bypass Rejected', () => {
    it('blocks first post mission when any of the 7 facts are unverified (fail-closed)', () => {
      const incompleteSnapshot: SoheeReadinessSnapshot = {
        workspaceId,
        ready: false,
        facts: {
          BUSINESS_VERIFIED: { verified: true, status: 'VERIFIED' } as ReadinessFactProvenance,
          INSTAGRAM_VERIFIED: { verified: true, status: 'VERIFIED' } as ReadinessFactProvenance,
          THREADS_VERIFIED: { verified: false, status: 'MISSING' } as ReadinessFactProvenance, // Blocked!
          BUSINESS_KNOWLEDGE_CONFIRMED: { verified: true, status: 'CONFIRMED' } as ReadinessFactProvenance,
          TEXT_HARNESS_CONFIRMED: { verified: true, status: 'CONFIRMED' } as ReadinessFactProvenance,
          IMAGE_HARNESS_CONFIRMED: { verified: true, status: 'CONFIRMED' } as ReadinessFactProvenance,
          OPERATING_POLICY_CONFIRMED: { verified: true, status: 'CONFIRMED' } as ReadinessFactProvenance,
        },
        blockers: [{
          code: 'THREADS_NOT_VERIFIED',
          factKey: 'THREADS_VERIFIED',
          message: '스레드 연동이 완료되지 않았습니다.',
          remediationAction: '스레드 연결',
          remediationHref: '/onboarding/channels',
        }],
        evaluatedAt: new Date().toISOString(),
      }

      expect(() =>
        validateFirstPostAdmission(workspaceId, incompleteSnapshot, workspaceId)
      ).toThrowError(/SOHEE_NOT_READY/)
    })
  })

  describe('2. Full Golden Journey: Conjunction -> Proposal -> Exact Approval -> Dual Verified Publish', () => {
    it('executes the full authentic user flow end-to-end without mocking state shortcuts', async () => {
      // Step A: All 7 facts proven legitimately
      const confirmedFacts: Record<string, ReadinessFactProvenance> = {}
      SOHEE_READINESS_FACT_KEYS.forEach((key) => {
        confirmedFacts[key] = {
          key,
          verified: true,
          status: key.includes('VERIFIED') ? 'VERIFIED' : 'CONFIRMED',
          source: 'golden_flow',
          evidenceId: `ev_${key}_proven`,
          version: 'v1.0',
          verifiedAt: new Date().toISOString(),
          freshness: 'FRESH',
        }
      })

      const soheeReadySnapshot: SoheeReadinessSnapshot = {
        workspaceId,
        ready: true,
        facts: confirmedFacts,
        blockers: [],
        evaluatedAt: new Date().toISOString(),
      }

      // 1. Admission succeeds
      expect(() =>
        validateFirstPostAdmission(workspaceId, soheeReadySnapshot, workspaceId)
      ).not.toThrow()

      // 2. Formulate conversational first post draft
      const draft = proposeFirstPostMission({
        workspaceId,
        readiness: soheeReadySnapshot,
        utterance: '안녕하세요, AI 마케팅 직원 소희 공식 계정 오픈 소식을 전해주세요!',
        knowledgeSnapshot: {
          businessName: '소희 AI (sohee.ai)',
          signatureServices: ['인스타그램 및 스레드 자율 마케팅 운영'],
          operatingHours: '연중무휴 24시간 자율 관측',
          versionNumber: 1,
        },
        textHarnessSnapshot: {
          brandVoice: '정중하고 신뢰감 있는 친근한 목소리',
          rules: ['무조건 및 절대 등 과장 표현 금지', '명확한 서비스 안내'],
          versionNumber: 1,
        },
        imageHarnessSnapshot: {
          goldenImageIds: ['img-golden-1', 'img-golden-2', 'img-golden-3'],
          rightsStatus: 'OWNED',
          consentStatus: 'CONFIRMED',
          versionNumber: 1,
        },
        operatingPolicySnapshot: {
          publishApprovalLevel: 'always_require',
          dailySpendLimitKrw: 0,
          maxDailyPublishCount: 1,
          versionNumber: 1,
        },
        connectedChannels: [
          { provider: 'instagram', handle: '@sohee.ai', profileUrl: 'https://instagram.com/sohee.ai' },
          { provider: 'threads', handle: '@sohee.ai', profileUrl: 'https://threads.com/@sohee.ai' },
        ],
      })

      expect(draft.status).toBe('AWAITING_EXACT_APPROVAL')
      expect(draft.approvalFingerprint).toBeDefined()
      expect(draft.approvalFingerprint).toHaveLength(64) // SHA-256

      // 3. User Exact Approval Gate
      const approvalPayload: ExactApprovalPayload = {
        workspaceId: draft.workspaceId,
        missionId: draft.missionId,
        channels: draft.channels,
        copies: draft.copies,
        imageIds: draft.selectedImageIds,
        boundVersions: draft.boundVersions,
        rights: draft.rights,
      }

      const approvedRecord = confirmExactApproval({
        payload: approvalPayload,
        fingerprint: draft.approvalFingerprint,
        approvedByUserId: userId,
        explicitPhrase: '이 버전 승인하고 발행',
        isExplicitlyApproved: true,
      })

      expect(approvedRecord.status).toBe('APPROVED_FOR_PUBLISH')
      expect(approvedRecord.approvedFingerprint).toBe(draft.approvalFingerprint)

      // 4. Verification before publish
      expect(() => validateApprovalForPublish(approvedRecord, approvalPayload)).not.toThrow()

      // 5. Dual Provider Publish with Independent Readback
      const mockMetaAdapter: ChannelPublishAdapter = {
        publish: vi.fn().mockImplementation(async (channel: 'instagram' | 'threads') => ({
          providerAccepted: true,
          providerPostId: `${channel}_live_post_1011`,
          requestId: `req_${channel}_1011`,
        })),
        readback: vi.fn().mockImplementation(async (providerPostId: string) => {
          const isIg = providerPostId.includes('instagram')
          return {
            isLive: true,
            permalink: isIg
              ? 'https://www.instagram.com/p/sohee_post_1011'
              : 'https://www.threads.com/@sohee.ai/post/1011',
            verifiedAt: new Date().toISOString(),
          }
        }),
      }

      const publishResult = await executeDualProviderPublish({
        approvedMission: approvedRecord,
        currentPayload: approvalPayload,
        adapters: {
          instagram: mockMetaAdapter,
          threads: mockMetaAdapter,
        },
      })

      expect(publishResult.overallStatus).toBe('ALL_VERIFIED')
      expect(publishResult.receipts.instagram?.stage).toBe('EXTERNALLY_VERIFIED')
      expect(publishResult.receipts.instagram?.permalink).toBe('https://www.instagram.com/p/sohee_post_1011')
      expect(publishResult.receipts.threads?.stage).toBe('EXTERNALLY_VERIFIED')
      expect(publishResult.receipts.threads?.permalink).toBe('https://www.threads.com/@sohee.ai/post/1011')

      // 6. Complete 16-Step Funnel Telemetry Journey Confirmation
      const telemetryEvents: FunnelEventPayload[] = FUNNEL_STEPS.map((step) =>
        createFunnelEvent({
          workspaceId,
          correlationId,
          step,
          correlationStartTime: startTime,
          metadata: {
            stepName: step,
            missionId: draft.missionId,
            channels: ['instagram', 'threads'],
          },
        })
      )

      expect(telemetryEvents).toHaveLength(16)
      expect(telemetryEvents[0].step).toBe('ONBOARDING_START')
      expect(telemetryEvents[15].step).toBe('FIRST_POST_COMPLETE')

      const metrics = calculateFunnelMetrics(telemetryEvents, workspaceId)
      expect(metrics.totalJourneys).toBe(1)
      expect(metrics.completedJourneys).toBe(1)
      expect(metrics.overallConversionRatePct).toBe(100)
      expect(metrics.timeToFirstVerifiedPostSec.totalCompletedCount).toBe(1)
      expect(metrics.timeToFirstVerifiedPostSec.avgSeconds).toBeGreaterThan(0)
    })
  })
})
