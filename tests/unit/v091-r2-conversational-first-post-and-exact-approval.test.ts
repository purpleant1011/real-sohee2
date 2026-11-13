import { describe, it, expect } from 'vitest'
import {
  validateFirstPostAdmission,
  extractFirstPostIntent,
  proposeFirstPostMission,
  calculateApprovalFingerprint,
  confirmExactApproval,
  validateApprovalForPublish,
  type ExactApprovalPayload,
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
    workspaceId: 'ws-test-cafe-1',
    ready: allTrue,
    evaluatedAt: new Date().toISOString(),
    blockers: allTrue
      ? []
      : [
          {
            code: 'BUSINESS_NOT_VERIFIED',
            factKey: 'BUSINESS_VERIFIED',
            message: '사업자 미인증',
            remediationAction: '인증',
            remediationHref: '/onboarding/business',
          },
        ],
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

describe('ANI-1433: SOHEE_READY → First Post Guided Mission · Exact Approval', () => {
  describe('1. Readiness Admission Guard', () => {
    it('blocks mission admission when SOHEE_READY is false (fail-closed)', () => {
      const notReady = makeMockReadiness(false)
      expect(() => validateFirstPostAdmission('ws-test-cafe-1', notReady)).toThrowError(
        /SOHEE_NOT_READY/
      )
    })

    it('allows mission admission when all 7 readiness facts are verified', () => {
      const allReady = makeMockReadiness(true)
      expect(() => validateFirstPostAdmission('ws-test-cafe-1', allReady)).not.toThrow()
    })

    it('enforces multi-tenant isolation by rejecting mismatched tenant caller', () => {
      const allReady = makeMockReadiness(true)
      expect(() =>
        validateFirstPostAdmission('ws-test-cafe-1', allReady, 'ws-foreign-tenant')
      ).toThrowError(/CROSS_TENANT_ACCESS_DENIED/)
    })
  })

  describe('2. Conversational Intent Extraction', () => {
    it('extracts topic and marketing goal from natural conversational utterance', () => {
      const utterance = '오늘 갓 구운 제철 복숭아 생크림 타르트 소식을 알리고 싶어!'
      const intent = extractFirstPostIntent(utterance)

      expect(intent.topic).toContain('복숭아')
      expect(intent.goal).toBeDefined()
      expect(intent.isCustom).toBe(true)
    })

    it('falls back to safe welcome promotion if utterance is empty or general', () => {
      const intent = extractFirstPostIntent('')
      expect(intent.topic).toContain('매장 소개')
      expect(intent.isCustom).toBe(false)
    })
  })

  describe('3. Propose First Post Mission & Single Snapshot Binding', () => {
    it('binds knowledge, text harness, image harness, and policies into a single immutable mission draft', () => {
      const allReady = makeMockReadiness(true)
      const draft = proposeFirstPostMission({
        workspaceId: 'ws-test-cafe-1',
        readiness: allReady,
        utterance: '새로 오픈한 브런치 카페 대표 프렌치 토스트를 소개할래',
        knowledgeSnapshot: {
          businessName: '카페 달콤',
          signatureServices: ['수제 프렌치 토스트', '시그니처 바닐라빈 라떼'],
          operatingHours: '10:00 - 20:00',
          versionNumber: 1,
        },
        textHarnessSnapshot: {
          brandVoice: '따뜻하고 정중한',
          rules: ['과장 표현 금지', '정직한 가격 표기'],
          versionNumber: 2,
        },
        imageHarnessSnapshot: {
          goldenImageIds: ['asset-golden-1', 'asset-golden-2', 'asset-golden-3'],
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
          { provider: 'instagram', handle: '@cafe_dalkom', profileUrl: 'https://instagram.com/cafe_dalkom' },
          { provider: 'threads', handle: '@cafe_dalkom', profileUrl: 'https://threads.com/@cafe_dalkom' },
        ],
      })

      expect(draft.missionId).toBeDefined()
      expect(draft.workspaceId).toBe('ws-test-cafe-1')
      expect(draft.status).toBe('AWAITING_EXACT_APPROVAL')
      expect(draft.boundVersions.knowledgeVersion).toBe(1)
      expect(draft.boundVersions.textHarnessVersion).toBe(2)
      expect(draft.boundVersions.imageHarnessVersion).toBe(1)
      expect(draft.boundVersions.operatingPolicyVersion).toBe(1)
      expect(draft.copies.instagram.caption).toContain('카페 달콤')
      expect(draft.copies.threads.content).toBeDefined()
      expect(draft.selectedImageIds.length).toBeGreaterThanOrEqual(1)
      expect(draft.approvalFingerprint).toBeDefined()
      expect(typeof draft.approvalFingerprint).toBe('string')
      expect(draft.approvalFingerprint.length).toBe(64) // SHA-256 hex
    })
  })

  describe('4. Exact Approval Fingerprint Calculation & Tamper Detection', () => {
    const basePayload: ExactApprovalPayload = {
      workspaceId: 'ws-test-cafe-1',
      missionId: 'mission-first-123',
      channels: [
        { provider: 'instagram', handle: '@cafe_dalkom' },
        { provider: 'threads', handle: '@cafe_dalkom' },
      ],
      copies: {
        instagram: { caption: '달콤한 프렌치 토스트 드시러 오세요! 🍞' },
        threads: { content: '오늘 준비한 수제 프렌치 토스트가 모두 나왔습니다.' },
      },
      imageIds: ['asset-golden-1'],
      boundVersions: {
        knowledgeVersion: 1,
        textHarnessVersion: 2,
        imageHarnessVersion: 1,
        operatingPolicyVersion: 1,
      },
      rights: {
        rightsStatus: 'OWNED',
        consentStatus: 'CONFIRMED',
      },
    }

    it('produces deterministic SHA-256 fingerprint for identical payloads', () => {
      const fp1 = calculateApprovalFingerprint(basePayload)
      const fp2 = calculateApprovalFingerprint({ ...basePayload })
      expect(fp1).toBe(fp2)
    })

    it('changes fingerprint if even one character of copy is modified', () => {
      const originalFp = calculateApprovalFingerprint(basePayload)
      const modifiedPayload: ExactApprovalPayload = {
        ...basePayload,
        copies: {
          ...basePayload.copies,
          instagram: { caption: '달콤한 프렌치 토스트 드시러 오세요! 🥞' }, // Emoji changed
        },
      }
      const newFp = calculateApprovalFingerprint(modifiedPayload)
      expect(newFp).not.toBe(originalFp)
    })

    it('changes fingerprint if image asset selection changes', () => {
      const originalFp = calculateApprovalFingerprint(basePayload)
      const modifiedPayload: ExactApprovalPayload = {
        ...basePayload,
        imageIds: ['asset-golden-2'],
      }
      const newFp = calculateApprovalFingerprint(modifiedPayload)
      expect(newFp).not.toBe(originalFp)
    })

    it('changes fingerprint if harness version changes', () => {
      const originalFp = calculateApprovalFingerprint(basePayload)
      const modifiedPayload: ExactApprovalPayload = {
        ...basePayload,
        boundVersions: {
          ...basePayload.boundVersions,
          textHarnessVersion: 3,
        },
      }
      const newFp = calculateApprovalFingerprint(modifiedPayload)
      expect(newFp).not.toBe(originalFp)
    })
  })

  describe('5. Exact Approval Confirmation & Invalidation Guard', () => {
    const payload: ExactApprovalPayload = {
      workspaceId: 'ws-test-cafe-1',
      missionId: 'mission-first-123',
      channels: [{ provider: 'instagram', handle: '@cafe_dalkom' }],
      copies: {
        instagram: { caption: '오픈 이벤트 진행 중입니다!' },
        threads: { content: '오픈 이벤트 진행 중입니다!' },
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
        consentStatus: 'NOT_APPLICABLE',
      },
    }

    it('rejects approval when explicit phrase "이 버전 승인하고 발행" is missing', () => {
      const fingerprint = calculateApprovalFingerprint(payload)
      expect(() =>
        confirmExactApproval({
          payload,
          fingerprint,
          isExplicitlyApproved: true,
          explicitPhrase: '대충 올려줘',
          approvedByUserId: 'user-owner-1',
        })
      ).toThrowError(/EXPLICIT_APPROVAL_PHRASE_REQUIRED/)
    })

    it('rejects approval when fingerprint does not match payload', () => {
      expect(() =>
        confirmExactApproval({
          payload,
          fingerprint: 'invalid-tampered-fingerprint',
          isExplicitlyApproved: true,
          explicitPhrase: '이 버전 승인하고 발행',
          approvedByUserId: 'user-owner-1',
        })
      ).toThrowError(/FINGERPRINT_MISMATCH_REJECTED/)
    })

    it('confirms exact approval and freezes approved mission state upon valid inputs', () => {
      const fingerprint = calculateApprovalFingerprint(payload)
      const approved = confirmExactApproval({
        payload,
        fingerprint,
        isExplicitlyApproved: true,
        explicitPhrase: '이 버전 승인하고 발행',
        approvedByUserId: 'user-owner-1',
      })

      expect(approved.status).toBe('APPROVED_FOR_PUBLISH')
      expect(approved.approvalId).toBeDefined()
      expect(approved.approvedFingerprint).toBe(fingerprint)
      expect(Object.isFrozen(approved)).toBe(true)
    })

    it('detects tampering and throws APPROVAL_FINGERPRINT_TAMPERED if content changes after approval', () => {
      const fingerprint = calculateApprovalFingerprint(payload)
      const approved = confirmExactApproval({
        payload,
        fingerprint,
        isExplicitlyApproved: true,
        explicitPhrase: '이 버전 승인하고 발행',
        approvedByUserId: 'user-owner-1',
      })

      const tamperedPayload: ExactApprovalPayload = {
        ...payload,
        copies: {
          ...payload.copies,
          instagram: { caption: '카피 내용이 몰래 변조되었습니다!' },
        },
      }

      expect(() => validateApprovalForPublish(approved, tamperedPayload)).toThrowError(
        /APPROVAL_FINGERPRINT_TAMPERED/
      )
    })

    it('passes publish validation when content strictly matches approved fingerprint', () => {
      const fingerprint = calculateApprovalFingerprint(payload)
      const approved = confirmExactApproval({
        payload,
        fingerprint,
        isExplicitlyApproved: true,
        explicitPhrase: '이 버전 승인하고 발행',
        approvedByUserId: 'user-owner-1',
      })

      expect(() => validateApprovalForPublish(approved, payload)).not.toThrow()
    })
  })
})
