import { describe, it, expect } from 'vitest'
import {
  proposeFirstPostMission,
  reviseFirstPostMissionDraft,
  confirmExactApproval,
  validateApprovalForPublish,
  calculateApprovalFingerprint,
  type FirstPostMissionDraft,
} from '@/features/missions/conversational-first-post'
import type { SoheeReadinessSnapshot } from '@/features/sohee-ready/types'

const MOCK_READINESS = {
  ready: true,
  calculatedAt: new Date().toISOString(),
  facts: {
    BUSINESS_VERIFIED: { verified: true },
    INSTAGRAM_VERIFIED: { verified: true },
    THREADS_VERIFIED: { verified: true },
    BUSINESS_KNOWLEDGE_CONFIRMED: { verified: true },
    TEXT_HARNESS_CONFIRMED: { verified: true },
    IMAGE_HARNESS_CONFIRMED: { verified: true },
    OPERATING_POLICY_CONFIRMED: { verified: true },
  },
} as unknown as SoheeReadinessSnapshot

describe('ANI-1450 & ANI-1451: Unified First-Post Composer, Partial Revision & Publish Truth', () => {
  const baseParams = {
    workspaceId: 'ws-composer-test',
    readiness: MOCK_READINESS,
    knowledgeSnapshot: {
      businessName: '바이름 뷰티 살롱',
      signatureServices: ['시그니처 헤어 스파'],
      operatingHours: '10:00 - 20:00',
      versionNumber: 1,
    },
    textHarnessSnapshot: {
      brandVoice: '따뜻하고 정갈한 말투',
      versionNumber: 1,
    },
    imageHarnessSnapshot: {
      goldenImageIds: ['golden-img-1', 'golden-img-2', 'golden-img-3'],
      rightsStatus: 'USER_CONFIRMED' as const,
      consentStatus: 'NOT_APPLICABLE' as const,
      versionNumber: 1,
    },
    operatingPolicySnapshot: {
      publishApprovalLevel: 'always_require',
      versionNumber: 1,
    },
    connectedChannels: [
      { provider: 'instagram', handle: '@byreum.beauty', profileUrl: 'https://instagram.com/byreum.beauty' },
      { provider: 'threads', handle: '@byreum.beauty', profileUrl: 'https://threads.net/@byreum.beauty' },
    ],
  }

  describe('1. Partial Revision Invariants (TEXT_ONLY vs IMAGE_ONLY)', () => {
    it('preserves image asset identity and rights during text-only revision', () => {
      const initialDraft = proposeFirstPostMission(baseParams)
      const initialImageIds = [...initialDraft.selectedImageIds]
      const initialRights = { ...initialDraft.rights }

      const { revisedDraft, deltaExplanation } = reviseFirstPostMissionDraft({
        draft: initialDraft,
        revisionType: 'TEXT_ONLY',
        feedbackUtterance: '첫 문장을 더 담백하고 편안하게 바꿔줘',
      })

      // Image assets and rights must remain exactly identical
      expect(revisedDraft.selectedImageIds).toEqual(initialImageIds)
      expect(revisedDraft.rights).toEqual(initialRights)
      expect(revisedDraft.boundVersions.imageHarnessVersion).toBe(initialDraft.boundVersions.imageHarnessVersion)

      // Copy must be revised
      expect(revisedDraft.copies.instagram.caption).not.toEqual(initialDraft.copies.instagram.caption)
      expect(revisedDraft.copies.threads.content).not.toEqual(initialDraft.copies.threads.content)

      // Fingerprint must diverge
      expect(revisedDraft.approvalFingerprint).not.toEqual(initialDraft.approvalFingerprint)
      expect(deltaExplanation).toContain('문장')
    })

    it('preserves copy text during image-only revision', () => {
      const initialDraft = proposeFirstPostMission(baseParams)
      const initialIgCaption = initialDraft.copies.instagram.caption
      const initialThContent = initialDraft.copies.threads.content

      const { revisedDraft, deltaExplanation } = reviseFirstPostMissionDraft({
        draft: initialDraft,
        revisionType: 'IMAGE_ONLY',
        feedbackUtterance: '사진만 다른 골든 레퍼런스 스타일로 바꿔줘',
      })

      // Copy text must remain exactly identical
      expect(revisedDraft.copies.instagram.caption).toEqual(initialIgCaption)
      expect(revisedDraft.copies.threads.content).toEqual(initialThContent)

      // Fingerprint must diverge
      expect(revisedDraft.approvalFingerprint).not.toEqual(initialDraft.approvalFingerprint)
      expect(deltaExplanation).toContain('이미지')
    })
  })

  describe('2. Exact Approval Invalidation Invariant', () => {
    it('invalidates prior approval when content is revised after approval', () => {
      const draft = proposeFirstPostMission(baseParams)

      // User approved original draft
      const approved = confirmExactApproval({
        payload: {
          workspaceId: draft.workspaceId,
          missionId: draft.missionId,
          channels: draft.channels,
          copies: draft.copies,
          imageIds: draft.selectedImageIds,
          boundVersions: draft.boundVersions,
          rights: draft.rights,
        },
        fingerprint: draft.approvalFingerprint,
        isExplicitlyApproved: true,
        explicitPhrase: '이 버전 승인하고 발행',
        approvedByUserId: 'user-owner-1',
      })

      // Later user requested a slight text revision
      const { revisedDraft } = reviseFirstPostMissionDraft({
        draft,
        revisionType: 'TEXT_ONLY',
        feedbackUtterance: '첫 문장만 더 부드럽게',
      })

      // Attempting to publish using the previous approved record with revised payload must throw tamper error
      const revisedPayload = {
        workspaceId: revisedDraft.workspaceId,
        missionId: revisedDraft.missionId,
        channels: revisedDraft.channels,
        copies: revisedDraft.copies,
        imageIds: revisedDraft.selectedImageIds,
        boundVersions: revisedDraft.boundVersions,
        rights: revisedDraft.rights,
      }

      expect(() => {
        validateApprovalForPublish(approved, revisedPayload)
      }).toThrow('APPROVAL_FINGERPRINT_TAMPERED')
    })
  })
})
