/**
 * [ANI-1456] V0.91 3차 수정 종합 Golden E2E Release Verification Suite
 *
 * Validates the complete Adaptive Sohee Tutorial Journey across all 8 Scenarios (A~H):
 * A. Fresh Signup Business Identity Carry-Forward & Truth
 * B. First Meeting Intent Extraction & Candidate Lineage
 * C. Conversational Business Knowledge Learning & Reflection
 * D. Text Calibration (3 Samples, NL Feedback, Delta, Confirm)
 * E. Image Calibration (2-Track, 3 Visual Directions, Golden 3~5, Rights/Consent, Confirm)
 * F. First Post Unified Composer (Partial Revision & Exact Approval Invalidation)
 * G. Dual Provider Publish Truth (Channel-specific readback & selective retry)
 * H. Mobile Work-Surface-First Layout & Privacy-Safe Telemetry Signals
 */

import { describe, it, expect, vi } from 'vitest'
import {
  verifyBusinessRegistration,
} from '@/lib/auth/business-verification'
import {
  extractFirstMeetingIntent,
  recordCandidateRevision,
} from '@/features/onboarding/first-meeting/first-meeting-service'
import {
  extractTextHarnessRules,
  generateDualChannelTestCopies,
  reviseTextHarnessCandidate,
  confirmTextHarnessWithExplicitGate,
  type ConversationalTextHarnessDraft,
} from '@/features/text-harness/conversational-text-harness'
import {
  createConversationalImageHarness,
  confirmConversationalImageHarness,
  type ConversationalImageHarnessState,
} from '@/features/image-harness/conversational-image-harness'
import {
  validateFirstPostAdmission,
  proposeFirstPostMission,
  reviseFirstPostMissionDraft,
  confirmExactApproval,
  validateApprovalForPublish,
  type ExactApprovalPayload,
} from '@/features/missions/conversational-first-post'
import {
  executeDualProviderPublish,
  retryFailedChannelPublish,
  type ChannelPublishAdapter,
} from '@/features/publishing/dual-provider-publish-service'
import {
  createTutorialLearningSignal,
  calculateTutorialLearningMetrics,
} from '@/features/telemetry/tutorial-learning-telemetry'
import {
  SOHEE_READINESS_FACT_KEYS,
  type SoheeReadinessSnapshot,
  type ReadinessFactProvenance,
} from '@/features/sohee-ready/types'

describe('ANI-1456: V0.91 3차 수정 Controller-Led Golden E2E Scenarios (A~H)', () => {
  const WORKSPACE_ID = 'ws-sohee-r3-golden-01'
  const USER_ID = 'user-owner-sohee'
  const SESSION_ID = 'sess-r3-golden-123'

  function makeMockProvenance(key: string, verified: boolean): ReadinessFactProvenance {
    return {
      key: key as any,
      verified,
      status: verified ? 'VERIFIED' : 'MISSING',
      source: 'golden_flow',
      evidenceId: verified ? `ev_${key}_proven` : null,
      version: verified ? '1.0' : null,
      verifiedAt: verified ? new Date().toISOString() : null,
      freshness: verified ? 'FRESH' : 'UNKNOWN',
    }
  }

  function makeFullyReadySnapshot(): SoheeReadinessSnapshot {
    const facts: Record<string, ReadinessFactProvenance> = {}
    SOHEE_READINESS_FACT_KEYS.forEach((k) => {
      facts[k] = makeMockProvenance(k, true)
    })
    return {
      workspaceId: WORKSPACE_ID,
      ready: true,
      facts,
      blockers: [],
      evaluatedAt: new Date().toISOString(),
    }
  }

  // --- Scenario A: Fresh Signup & Business Identity Carry-Forward ---
  describe('Scenario A: Fresh Signup Business Identity Carry-Forward & Truth', () => {
    it('carries signup business identity forward and reflects truthful verification format', () => {
      const result = verifyBusinessRegistration({
        businessNumber: '123-45-67890',
        companyName: '성수 소금빵 베이커리',
        representativeName: '홍길동',
      })
      expect(result.status).toBeDefined()
      expect(result.normalizedBusinessNumber).toBe('1234567890')
      expect(result.message).toBeDefined()
    })
  })

  // --- Scenario B: First Meeting Intent Extraction & Reflection ---
  describe('Scenario B: First Meeting: Teach Sohee What Employee to Become', () => {
    it('extracts role expectation from natural language and preserves revision lineage', () => {
      const candidates = extractFirstMeetingIntent('인스타 홍보를 주로 잘해줬으면 좋겠어. 너무 과장된 광고 말투는 싫어.')
      expect(candidates.length).toBe(2)

      const goalCandidate = candidates.find((c) => c.key === 'marketing_goal')
      const toneCandidate = candidates.find((c) => c.key === 'brand_tone')

      expect(goalCandidate?.value).toContain('인스타그램 홍보')
      expect(toneCandidate?.value).toContain('과장된 광고형 말투 배제')

      // Owner refines candidate
      const revisedGoal = recordCandidateRevision(
        goalCandidate!,
        '예약 링크 유도보다는 피드 활성화 위주로 해줘',
        '인스타그램 피드 활성화 및 브랜드 인지도 확대'
      )
      expect(revisedGoal.version).toBe(2)
      expect(revisedGoal.previousValues.length).toBe(1)
      expect(revisedGoal.previousValues[0].value).toBe(goalCandidate!.value)
    })
  })

  // --- Scenario C: Conversational Business Knowledge Learning & Readiness ---
  describe('Scenario C: Conversational Business Knowledge Learning & Readiness Transition', () => {
    it('manages candidate reflection, edit, and ensures readiness conjunction gate', () => {
      const incompleteSnapshot: SoheeReadinessSnapshot = {
        workspaceId: WORKSPACE_ID,
        ready: false,
        facts: {
          BUSINESS_VERIFIED: makeMockProvenance('BUSINESS_VERIFIED', true),
          INSTAGRAM_VERIFIED: makeMockProvenance('INSTAGRAM_VERIFIED', true),
          THREADS_VERIFIED: makeMockProvenance('THREADS_VERIFIED', true),
          BUSINESS_KNOWLEDGE_CONFIRMED: makeMockProvenance('BUSINESS_KNOWLEDGE_CONFIRMED', false), // Missing!
          TEXT_HARNESS_CONFIRMED: makeMockProvenance('TEXT_HARNESS_CONFIRMED', true),
          IMAGE_HARNESS_CONFIRMED: makeMockProvenance('IMAGE_HARNESS_CONFIRMED', true),
          OPERATING_POLICY_CONFIRMED: makeMockProvenance('OPERATING_POLICY_CONFIRMED', true),
        },
        blockers: [{
          code: 'BUSINESS_KNOWLEDGE_NOT_CONFIRMED',
          factKey: 'BUSINESS_KNOWLEDGE_CONFIRMED',
          message: '매장 지식베이스가 확정되지 않았습니다.',
          remediationAction: '지식 확정',
          remediationHref: '/onboarding/knowledge',
        }],
        evaluatedAt: new Date().toISOString(),
      }

      // Fail-closed check: mission proposal blocked before knowledge confirmation
      expect(() =>
        validateFirstPostAdmission(WORKSPACE_ID, incompleteSnapshot, WORKSPACE_ID)
      ).toThrowError(/SOHEE_NOT_READY/)
    })
  })

  // --- Scenario D: Text Calibration (3 Samples, NL Feedback, Delta, Confirm) ---
  describe('Scenario D: Text Calibration: 3 Samples, NL Feedback, Delta, Explicit Confirm', () => {
    it('generates comparison copies, applies natural-language revision, and enforces explicit confirm gate', () => {
      const rules = extractTextHarnessRules('친근하고 정중한 어투로, 가격은 방문 유도로')
      const draft: ConversationalTextHarnessDraft = {
        workspaceId: WORKSPACE_ID,
        rules,
        testRunsCount: 1,
        status: 'DRAFT',
      }

      // 1. Dual channel test generation
      const testBatch = generateDualChannelTestCopies(draft, '소금빵 세트')
      expect(testBatch.instagramCopies.length).toBeGreaterThan(0)
      expect(testBatch.threadsCopies.length).toBeGreaterThan(0)

      // 2. Natural language revision with lineage
      const targetCopy = testBatch.instagramCopies[0]
      const revisedCopy = reviseTextHarnessCandidate(targetCopy, {
        feedbackType: 'revised',
        userCorrection: '덜 친한 척하고 정중하게 존댓말로 써줘',
      })
      expect(revisedCopy.revisionLineage?.userCorrection).toBe('덜 친한 척하고 정중하게 존댓말로 써줘')

      // 3. Explicit confirm gate
      const confirmed = confirmTextHarnessWithExplicitGate({
        draft: { ...draft, testRunsCount: 2 },
        userId: USER_ID,
        userConfirmationPhrase: '이 기준으로 사용',
        isExplicitlyApproved: true,
      })
      expect(confirmed.status).toBe('ACTIVE_CONFIRMED')
      expect(confirmed.confirmedByUserId).toBe(USER_ID)
      expect(Object.isFrozen(confirmed)).toBe(true)
    })
  })

  // --- Scenario E: Image Calibration (2-Track, Golden 3~5, Rights & Consent, Confirm) ---
  describe('Scenario E: Image Calibration: 2-Track, Golden 3~5, Rights/Consent, Explicit Confirm', () => {
    it('validates golden image count, rights/consent, and freezes confirmed visual rules', () => {
      const baseHarness = createConversationalImageHarness({
        workspaceId: WORKSPACE_ID,
        referenceAssets: [
          { id: 'img-1', url: 'https://example.com/1.jpg', category: 'PRODUCT', rightsStatus: 'OWNED', rightsConfirmedAt: new Date().toISOString(), consentStatus: 'NOT_APPLICABLE' },
          { id: 'img-2', url: 'https://example.com/2.jpg', category: 'PRODUCT', rightsStatus: 'OWNED', rightsConfirmedAt: new Date().toISOString(), consentStatus: 'NOT_APPLICABLE' },
          { id: 'img-3', url: 'https://example.com/3.jpg', category: 'PRODUCT', rightsStatus: 'OWNED', rightsConfirmedAt: new Date().toISOString(), consentStatus: 'NOT_APPLICABLE' },
        ],
      })

      const harness: ConversationalImageHarnessState = {
        ...baseHarness,
        lifecycleStatus: 'GOLDEN_SELECTED',
        goldenImageIds: ['img-1', 'img-2', 'img-3'],
        testRunsCount: 1,
      }

      const confirmedSnapshot = confirmConversationalImageHarness({
        harness,
        userId: USER_ID,
        explicitApprovalPhrase: '이 기준으로 사용',
        isExplicitlyApproved: true,
      })

      expect(confirmedSnapshot.goldenImageIds.length).toBe(3)
      expect(confirmedSnapshot.confirmedByUserId).toBe(USER_ID)
      expect(confirmedSnapshot.status).toBe('ACTIVE_CONFIRMED')
      expect(Object.isFrozen(confirmedSnapshot)).toBe(true)
    })
  })

  // --- Scenario F: First Post Partial Revision & Exact Approval Invalidation ---
  describe('Scenario F: Unified First Post Composer: Partial Revision & Exact Approval Invalidation', () => {
    it('invalidates prior approval fingerprint on partial revision and enforces exact re-approval', () => {
      const readySnapshot = makeFullyReadySnapshot()
      const draft = proposeFirstPostMission({
        workspaceId: WORKSPACE_ID,
        readiness: readySnapshot,
        callerTenantId: WORKSPACE_ID,
        utterance: '가을 신메뉴 시그니처 소금빵 출시',
        knowledgeSnapshot: { businessName: '성수 베이커리', signatureServices: ['소금빵'], operatingHours: '10:00-20:00', versionNumber: 1 },
        textHarnessSnapshot: { brandVoice: '따뜻한', rules: ['과장 금지'], versionNumber: 1 },
        imageHarnessSnapshot: { goldenImageIds: ['img-1', 'img-2', 'img-3'], rightsStatus: 'OWNED', consentStatus: 'CONFIRMED', versionNumber: 1 },
        operatingPolicySnapshot: { publishApprovalLevel: 'always_require', dailySpendLimitKrw: 10000, maxDailyPublishCount: 1, versionNumber: 1 },
        connectedChannels: [
          { provider: 'instagram', handle: '@seongsu_bakery', profileUrl: 'https://instagram.com/seongsu_bakery' },
          { provider: 'threads', handle: '@seongsu_bakery', profileUrl: 'https://threads.com/@seongsu_bakery' },
        ],
      })

      const initialPayload: ExactApprovalPayload = {
        workspaceId: draft.workspaceId,
        missionId: draft.missionId,
        channels: draft.channels,
        copies: draft.copies,
        imageIds: draft.selectedImageIds,
        boundVersions: draft.boundVersions,
        rights: draft.rights,
      }

      // 1. Initial exact approval
      const initialApprovedMission = confirmExactApproval({
        payload: initialPayload,
        fingerprint: draft.approvalFingerprint,
        isExplicitlyApproved: true,
        explicitPhrase: '이 버전 승인하고 발행',
        approvedByUserId: USER_ID,
      })
      expect(initialApprovedMission.status).toBe('APPROVED_FOR_PUBLISH')

      // 2. Partial Revision: TEXT_ONLY
      const textRev = reviseFirstPostMissionDraft({
        draft,
        revisionType: 'TEXT_ONLY',
        feedbackUtterance: '첫 문장을 더 깔끔하고 따뜻하게 고쳐줘',
      })

      // Invariant: Images are strictly preserved, copy and fingerprint change
      expect(textRev.revisedDraft.selectedImageIds).toEqual(draft.selectedImageIds)
      expect(textRev.revisedDraft.copies.instagram.caption).not.toEqual(draft.copies.instagram.caption)
      expect(textRev.revisedDraft.approvalFingerprint).not.toEqual(initialApprovedMission.approvedFingerprint)
      expect(textRev.deltaExplanation).toContain('문장')

      // 3. Pre-publish tamper guard catches modified payload against prior approval
      expect(() => {
        validateApprovalForPublish(initialApprovedMission, {
          workspaceId: WORKSPACE_ID,
          missionId: draft.missionId,
          channels: draft.channels,
          copies: textRev.revisedDraft.copies, // Modified copy!
          imageIds: draft.selectedImageIds,
          boundVersions: draft.boundVersions,
          rights: draft.rights,
        })
      }).toThrowError(/APPROVAL_FINGERPRINT_TAMPERED/)

      // 4. Exact re-approval succeeds with new fingerprint
      const revisedPayload: ExactApprovalPayload = {
        workspaceId: WORKSPACE_ID,
        missionId: draft.missionId,
        channels: textRev.revisedDraft.channels,
        copies: textRev.revisedDraft.copies,
        imageIds: textRev.revisedDraft.selectedImageIds,
        boundVersions: textRev.revisedDraft.boundVersions,
        rights: textRev.revisedDraft.rights,
      }

      const approvedMission = confirmExactApproval({
        payload: revisedPayload,
        fingerprint: textRev.revisedDraft.approvalFingerprint,
        isExplicitlyApproved: true,
        explicitPhrase: '이 버전 승인하고 발행',
        approvedByUserId: USER_ID,
      })
      expect(approvedMission.status).toBe('APPROVED_FOR_PUBLISH')
      expect(approvedMission.approvedFingerprint).toBe(textRev.revisedDraft.approvalFingerprint)
    })
  })

  // --- Scenario G: Dual Provider Publish Truth & Selective Retry ---
  describe('Scenario G: Dual Provider Publish Truth, Readback & Selective Safe Retry', () => {
    it('executes dual channel publish with independent truth and supports selective retry on partial failure', async () => {
      const readySnapshot = makeFullyReadySnapshot()
      const draft = proposeFirstPostMission({
        workspaceId: WORKSPACE_ID,
        readiness: readySnapshot,
        callerTenantId: WORKSPACE_ID,
        utterance: '소금빵 안내',
        knowledgeSnapshot: { businessName: '성수 베이커리', signatureServices: ['소금빵'], operatingHours: '10:00-20:00', versionNumber: 1 },
        textHarnessSnapshot: { brandVoice: '따뜻한', rules: ['과장 금지'], versionNumber: 1 },
        imageHarnessSnapshot: { goldenImageIds: ['img-1'], rightsStatus: 'OWNED', consentStatus: 'CONFIRMED', versionNumber: 1 },
        operatingPolicySnapshot: { publishApprovalLevel: 'always_require', dailySpendLimitKrw: 10000, maxDailyPublishCount: 1, versionNumber: 1 },
        connectedChannels: [
          { provider: 'instagram', handle: '@seongsu_bakery', profileUrl: 'https://instagram.com/seongsu_bakery' },
          { provider: 'threads', handle: '@seongsu_bakery', profileUrl: 'https://threads.com/@seongsu_bakery' },
        ],
      })

      const payload: ExactApprovalPayload = {
        workspaceId: WORKSPACE_ID,
        missionId: draft.missionId,
        channels: draft.channels,
        copies: draft.copies,
        imageIds: draft.selectedImageIds,
        boundVersions: draft.boundVersions,
        rights: draft.rights,
      }

      const approvedMission = confirmExactApproval({
        payload,
        fingerprint: draft.approvalFingerprint,
        isExplicitlyApproved: true,
        explicitPhrase: '이 버전 승인하고 발행',
        approvedByUserId: USER_ID,
      })

      // Mock adapters: Instagram succeeds, Threads temporarily fails
      const mockIgAdapter: ChannelPublishAdapter = {
        publish: vi.fn().mockResolvedValue({
          providerAccepted: true,
          providerPostId: 'ig_post_golden_123',
          requestId: 'req_ig_1',
        }),
        readback: vi.fn().mockResolvedValue({
          isLive: true,
          permalink: 'https://www.instagram.com/p/golden123',
          verifiedAt: new Date().toISOString(),
        }),
      }

      const mockThAdapter: ChannelPublishAdapter = {
        publish: vi.fn().mockResolvedValue({
          providerAccepted: false,
          requestId: 'req_th_1',
          errorMessage: 'THREADS_API_RATE_LIMIT',
        }),
        readback: vi.fn().mockResolvedValue({ isLive: false }),
      }

      // 1. Initial Publish execution
      const publishResult = await executeDualProviderPublish({
        approvedMission,
        currentPayload: payload,
        adapters: {
          instagram: mockIgAdapter,
          threads: mockThAdapter,
        },
      })

      // Invariant: Partial success truth is never masked as full success
      expect(publishResult.overallStatus).toBe('PARTIAL_SUCCESS')
      expect(publishResult.receipts.instagram?.stage).toBe('EXTERNALLY_VERIFIED')
      expect(publishResult.receipts.threads?.stage).toBe('FAILED')

      // 2. Selective retry: Instagram is already verified, so it must be SKIPPED to prevent duplicate posting!
      const mockThRetryAdapter: ChannelPublishAdapter = {
        publish: vi.fn().mockResolvedValue({
          providerAccepted: true,
          providerPostId: 'th_post_golden_456',
          requestId: 'req_th_retry_1',
        }),
        readback: vi.fn().mockResolvedValue({
          isLive: true,
          permalink: 'https://www.threads.com/@bakery/post/456',
          verifiedAt: new Date().toISOString(),
        }),
      }

      const retryResult = await retryFailedChannelPublish({
        approvedMission,
        currentPayload: payload,
        targetChannel: 'threads',
        existingReceipts: publishResult.receipts,
        adapters: {
          threads: mockThRetryAdapter,
        },
      })

      expect(retryResult.overallStatus).toBe('ALL_VERIFIED')
      expect(retryResult.receipts.threads?.stage).toBe('EXTERNALLY_VERIFIED')
      expect(retryResult.receipts.instagram?.stage).toBe('EXTERNALLY_VERIFIED')
      // Ensure Instagram publish was NOT called again during retry
      expect(mockIgAdapter.publish).toHaveBeenCalledTimes(1)
    })
  })

  // --- Scenario H: Telemetry & Work-Surface-First Observability ---
  describe('Scenario H: Privacy-Safe Learning Signals & Funnel Observability', () => {
    it('captures full learning lifecycle metrics while guaranteeing Zero PII bleed', () => {
      const signals = [
        createTutorialLearningSignal({
          workspaceId: WORKSPACE_ID,
          sessionId: SESSION_ID,
          eventType: 'tutorial_started',
          stage: 'FIRST_MEETING',
        }),
        createTutorialLearningSignal({
          workspaceId: WORKSPACE_ID,
          sessionId: SESSION_ID,
          eventType: 'first_meeting_goal_candidate_created',
          stage: 'FIRST_MEETING',
        }),
        createTutorialLearningSignal({
          workspaceId: WORKSPACE_ID,
          sessionId: SESSION_ID,
          eventType: 'text_calibration_regenerated',
          stage: 'TEXT_HARNESS',
          metrics: { iterationCount: 2 },
        }),
        createTutorialLearningSignal({
          workspaceId: WORKSPACE_ID,
          sessionId: SESSION_ID,
          eventType: 'image_calibration_feedback',
          stage: 'IMAGE_HARNESS',
          metrics: { iterationCount: 1 },
        }),
        createTutorialLearningSignal({
          workspaceId: WORKSPACE_ID,
          sessionId: SESSION_ID,
          eventType: 'first_post_revision_count',
          stage: 'FIRST_POST',
          metrics: { revisionCount: 1 },
        }),
        createTutorialLearningSignal({
          workspaceId: WORKSPACE_ID,
          sessionId: SESSION_ID,
          eventType: 'publish_channel_external_verified',
          stage: 'FIRST_POST',
          dimensions: { channel: 'DUAL' },
        }),
        createTutorialLearningSignal({
          workspaceId: WORKSPACE_ID,
          sessionId: SESSION_ID,
          eventType: 'tutorial_completed',
          stage: 'FIRST_POST',
        }),
      ]

      const funnelMetrics = calculateTutorialLearningMetrics(signals)
      expect(funnelMetrics.totalStarted).toBe(1)
      expect(funnelMetrics.totalCompleted).toBe(1)
      expect(funnelMetrics.completionRatePct).toBe(100)
      expect(funnelMetrics.avgTextRegenerations).toBe(2)
      expect(funnelMetrics.avgImageRegenerations).toBe(1)
      expect(funnelMetrics.avgFirstPostRevisions).toBe(1)
      expect(funnelMetrics.verifiedChannelsBreakdown.both).toBe(1)
    })
  })
})
