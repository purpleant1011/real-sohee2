import { describe, it, expect } from 'vitest'
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
  confirmConversationalImageHarness,
  createConversationalImageHarness,
  type ConversationalImageHarnessState,
} from '@/features/image-harness/conversational-image-harness'
import {
  confirmConversationalPolicyWithExplicitGate,
  extractConversationalOperatingPolicyDraft,
} from '@/features/operating-policy/conversational-operating-policy'
import {
  proposeFirstPostMission,
  reviseFirstPostMissionDraft,
  confirmExactApproval,
} from '@/features/missions/conversational-first-post'
import type { SoheeReadinessSnapshot, ReadinessFactProvenance } from '@/features/sohee-ready/types'

function makeMockProvenance(key: string, verified: boolean): ReadinessFactProvenance {
  return {
    key: key as any,
    verified,
    status: verified ? 'VERIFIED' : 'MISSING',
    source: 'test:mock',
    evidenceId: verified ? `ev_${key}` : null,
    version: verified ? '1.0' : null,
    verifiedAt: verified ? new Date().toISOString() : null,
    freshness: verified ? 'FRESH' : 'UNKNOWN',
  }
}

function makeMockReadiness(allTrue: boolean = true): SoheeReadinessSnapshot {
  return {
    workspaceId: '11111111-1111-4111-a111-111111111111',
    ready: allTrue,
    evaluatedAt: new Date().toISOString(),
    blockers: allTrue ? [] : [{
      code: 'BUSINESS_NOT_VERIFIED',
      factKey: 'BUSINESS_VERIFIED',
      message: '사업자 미인증',
      remediationAction: '인증',
      remediationHref: '/onboarding/business',
    }],
    facts: {
      BUSINESS_VERIFIED: makeMockProvenance('BUSINESS_VERIFIED', allTrue),
      INSTAGRAM_VERIFIED: makeMockProvenance('INSTAGRAM_VERIFIED', allTrue),
      THREADS_VERIFIED: makeMockProvenance('THREADS_VERIFIED', allTrue),
      BUSINESS_KNOWLEDGE_CONFIRMED: makeMockProvenance('BUSINESS_KNOWLEDGE_CONFIRMED', allTrue),
      TEXT_HARNESS_CONFIRMED: makeMockProvenance('TEXT_HARNESS_CONFIRMED', allTrue),
      IMAGE_HARNESS_CONFIRMED: makeMockProvenance('IMAGE_HARNESS_CONFIRMED', allTrue),
      OPERATING_POLICY_CONFIRMED: makeMockProvenance('OPERATING_POLICY_CONFIRMED', allTrue),
    },
  }
}

describe('ANI-1454: Calibration Persistence, Lineage, and Workspace Isolation Contract', () => {
  const WORKSPACE_A = '11111111-1111-4111-a111-111111111111'
  const WORKSPACE_B = '22222222-2222-4222-a222-222222222222'
  const USER_A = 'user-owner-a-123'
  const USER_B = 'user-intruder-b-456'

  describe('1. Multi-Tenant Workspace Isolation Guard', () => {
    it('strictly prevents Workspace B caller from confirming Workspace A operating policy', () => {
      // Cross-tenant attempt
      expect(() => {
        confirmConversationalPolicyWithExplicitGate({
          workspaceId: WORKSPACE_A,
          callerTenantId: WORKSPACE_B, // Intruder
          userId: USER_B,
          rules: extractConversationalOperatingPolicyDraft(''),
          explicitApprovalPhrase: '이 기준으로 사용',
          isExplicitlyApproved: true,
        })
      }).toThrowError(/CROSS_TENANT_POLICY_DENIED/)
    })

    it('strictly prevents Workspace B caller from proposing or approving Workspace A first post mission', () => {
      const allReady = makeMockReadiness(true)

      // Cross-tenant admission attempt
      expect(() => {
        proposeFirstPostMission({
          workspaceId: WORKSPACE_A,
          readiness: allReady,
          callerTenantId: WORKSPACE_B, // Intruder
          utterance: '가을 신메뉴 소금빵 출시',
          knowledgeSnapshot: {
            businessName: '맛있는 베이커리',
            signatureServices: ['소금빵'],
            operatingHours: '10:00-20:00',
            versionNumber: 1,
          },
          textHarnessSnapshot: {
            brandVoice: '따뜻한',
            rules: ['과장 금지'],
            versionNumber: 1,
          },
          imageHarnessSnapshot: {
            goldenImageIds: ['img-1', 'img-2', 'img-3'],
            rightsStatus: 'OWNED',
            consentStatus: 'CONFIRMED',
            versionNumber: 1,
          },
          operatingPolicySnapshot: {
            publishApprovalLevel: 'always_require',
            dailySpendLimitKrw: 10000,
            maxDailyPublishCount: 1,
            versionNumber: 1,
          },
          connectedChannels: [
            { provider: 'instagram', handle: '@mybiz', profileUrl: 'https://instagram.com/mybiz' },
            { provider: 'threads', handle: '@mybiz', profileUrl: 'https://threads.com/@mybiz' },
          ],
        })
      }).toThrowError(/CROSS_TENANT_ACCESS_DENIED/)
    })
  })

  describe('2. Revision Lineage & Prior Evidence Preservation', () => {
    it('preserves initial candidates and accumulates feedback lineage across corrections', () => {
      // 1. Initial extraction
      const candidates = extractFirstMeetingIntent('인스타 홍보를 주로 잘해줬으면 좋겠어')
      expect(candidates.length).toBeGreaterThan(0)
      const initialCandidate = candidates[0]
      expect(initialCandidate.previousValues.length).toBe(0)

      // 2. User correction
      const corrected = recordCandidateRevision(
        initialCandidate,
        '피드 활성화보다는 스토리와 예약 위주로',
        '스토리 예약 전환 중심 인스타그램 마케팅'
      )

      expect(corrected.version).toBe(2)
      expect(corrected.previousValues.length).toBe(1)
      expect(corrected.previousValues[0].value).toBe(initialCandidate.value)
      expect(corrected.value).toBe('스토리 예약 전환 중심 인스타그램 마케팅')
      expect(corrected.sourceUtterance).toBe('피드 활성화보다는 스토리와 예약 위주로')
      expect(corrected.previousValues[0].revisedAt).toBeDefined()
    })

    it('preserves text harness prompt revision history and test runs lineage', () => {
      const rules = extractTextHarnessRules('따뜻하고 친근한 어투로 작성해줘')
      const draft: ConversationalTextHarnessDraft = {
        workspaceId: WORKSPACE_A,
        rules,
        testRunsCount: 1,
        status: 'DRAFT',
      }
      const batch = generateDualChannelTestCopies(draft, '소금빵 신메뉴')
      expect(batch.instagramCopies.length).toBeGreaterThan(0)

      const targetCopy = batch.instagramCopies[0]
      const revised = reviseTextHarnessCandidate(targetCopy, {
        feedbackType: 'revised',
        userCorrection: '더 담백하고 솔직한 어투로 수정해줘',
      })

      expect(revised.revisionLineage).toBeDefined()
      expect(revised.revisionLineage?.originalCopyId).toBe(targetCopy.id)
      expect(revised.revisionLineage?.userCorrection).toBe('더 담백하고 솔직한 어투로 수정해줘')
      expect(revised.text).not.toBe(targetCopy.text)
    })

    it('preserves partial first-post draft revision lineage (text-only preserves image; image-only preserves text)', () => {
      const allReady = makeMockReadiness(true)
      const initialDraft = proposeFirstPostMission({
        workspaceId: WORKSPACE_A,
        readiness: allReady,
        callerTenantId: WORKSPACE_A,
        utterance: '새로 구운 소금빵 안내',
        knowledgeSnapshot: {
          businessName: '달콤 베이커리',
          signatureServices: ['소금빵'],
          operatingHours: '10:00-20:00',
          versionNumber: 1,
        },
        textHarnessSnapshot: {
          brandVoice: '따뜻한',
          rules: ['과장 금지'],
          versionNumber: 1,
        },
        imageHarnessSnapshot: {
          goldenImageIds: ['asset-1', 'asset-2', 'asset-3'],
          rightsStatus: 'OWNED',
          consentStatus: 'CONFIRMED',
          versionNumber: 1,
        },
        operatingPolicySnapshot: {
          publishApprovalLevel: 'always_require',
          dailySpendLimitKrw: 10000,
          maxDailyPublishCount: 1,
          versionNumber: 1,
        },
        connectedChannels: [
          { provider: 'instagram', handle: '@bakery', profileUrl: 'https://instagram.com/bakery' },
          { provider: 'threads', handle: '@bakery', profileUrl: 'https://threads.com/@bakery' },
        ],
      })

      // 1. Text-only revision
      const textRevResult = reviseFirstPostMissionDraft({
        draft: initialDraft,
        revisionType: 'TEXT_ONLY',
        feedbackUtterance: '첫 문장을 더 강렬하게 바꿔줘',
      })

      // Image assets must be strictly preserved
      expect(textRevResult.revisedDraft.selectedImageIds).toEqual(initialDraft.selectedImageIds)
      // Copy must be updated
      expect(textRevResult.revisedDraft.copies.instagram.caption).not.toEqual(initialDraft.copies.instagram.caption)
      // Fingerprint must diverge
      expect(textRevResult.revisedDraft.approvalFingerprint).not.toEqual(initialDraft.approvalFingerprint)

      // 2. Image-only revision
      const imgRevResult = reviseFirstPostMissionDraft({
        draft: initialDraft,
        revisionType: 'IMAGE_ONLY',
        feedbackUtterance: '다른 사진으로 골라줘',
      })

      // Copy must be strictly preserved
      expect(imgRevResult.revisedDraft.copies).toEqual(initialDraft.copies)
      // Image assets must be modified
      expect(imgRevResult.revisedDraft.selectedImageIds).not.toEqual(initialDraft.selectedImageIds)
      // Fingerprint must diverge
      expect(imgRevResult.revisedDraft.approvalFingerprint).not.toEqual(initialDraft.approvalFingerprint)
    })
  })

  describe('3. Explicit Confirm Auditability & Immutable Snapshots', () => {
    it('strictly records actor, timestamp, approval phrase, and deep-freezes text harness snapshot', () => {
      const rules = extractTextHarnessRules('따뜻하고 친근하게')
      const draft: ConversationalTextHarnessDraft = {
        workspaceId: WORKSPACE_A,
        rules,
        testRunsCount: 2,
        status: 'DRAFT',
      }

      const snapshot = confirmTextHarnessWithExplicitGate({
        draft,
        userId: USER_A,
        userConfirmationPhrase: '이 기준으로 사용',
        isExplicitlyApproved: true,
      })

      expect(snapshot.status).toBe('ACTIVE_CONFIRMED')
      expect(snapshot.confirmedByUserId).toBe(USER_A)
      expect(snapshot.confirmedAt).toBeDefined()
      expect(Object.isFrozen(snapshot)).toBe(true)
    })

    it('strictly records actor, timestamp, approval phrase, and deep-freezes image harness snapshot', () => {
      const baseHarness = createConversationalImageHarness({
        workspaceId: WORKSPACE_A,
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

      const snapshot = confirmConversationalImageHarness({
        harness,
        userId: USER_A,
        explicitApprovalPhrase: '이 기준으로 사용',
        isExplicitlyApproved: true,
      })

      expect(snapshot.workspaceId).toBe(WORKSPACE_A)
      expect(snapshot.confirmedByUserId).toBe(USER_A)
      expect(snapshot.goldenImageIds.length).toBe(3)
      expect(snapshot.immutableHash).toBeDefined()
      expect(Object.isFrozen(snapshot)).toBe(true)
    })
  })
})
