import { describe, it, expect } from 'vitest'
import {
  proposeVisualDirections,
  applyImageCalibrationFeedback,
  verifyMediaRightsAndConsent,
  confirmImageCalibration,
  type VisualDirectionProposal,
  type ImageCalibrationDraft,
} from '@/features/image-harness/image-calibration-service'
import type { ConversationalBusinessKnowledgeDraft } from '@/features/knowledge/conversational-knowledge'

describe('ANI-1447 & ANI-1454: Image Calibration with Real Direction, Feedback Lineage & Rights Verification', () => {
  const mockKnowledge: ConversationalBusinessKnowledgeDraft = {
    businessType: '1인 프리미엄 헤어살롱',
    location: '인천 청라 호수공원 인근',
    primaryServices: '시그니처 레이어드 컷',
    pricing: '컷 35,000원부터',
  }

  describe('1. 3 Visual Direction Proposals', () => {
    it('proposes 3 distinct visual directions based on business knowledge', () => {
      const proposals = proposeVisualDirections(mockKnowledge)

      expect(proposals.length).toBe(3)
      const [dir1, dir2, dir3] = proposals

      expect(dir1.directionKey).toBe('NATURAL_LIGHT')
      expect(dir2.directionKey).toBe('DETAIL_FOCUS')
      expect(dir3.directionKey).toBe('WARM_MOOD')

      expect(dir1.title).toContain('자연 채광')
      expect(dir2.title).toContain('디테일')
      expect(dir3.title).toContain('따뜻한')

      // Direction selection alone does not confirm image harness
      const draft: ImageCalibrationDraft = {
        workspaceId: 'ws-img-test',
        selectedDirectionKey: dir1.directionKey,
        status: 'CALIBRATING',
        iterationCount: 1,
        calibrationHistory: [],
        goldenImages: [],
      }

      expect(draft.status).toBe('CALIBRATING')
      expect(draft.confirmedAt).toBeUndefined()
    })
  })

  describe('2. Natural-Language Feedback & Lineage-Preserved Regeneration', () => {
    it('applies feedback "더 실제 사진 같게, 얼굴 없이, 배경 덜 꾸민 느낌" to update rules and generate delta', () => {
      const proposals = proposeVisualDirections(mockKnowledge)
      const baseDirection = proposals[0]

      const initialAsset = {
        id: 'asset-img-1',
        digest: 'sha256_mock_hash_1',
        url: 'https://cdn.sohee.ai/assets/1.jpg',
        modelPresence: 'MODEL_PRESENT' as const,
        provenance: {
          model: 'dall-e-3',
          prompt: 'A hair salon with a model',
        },
      }

      const feedbackResult = applyImageCalibrationFeedback({
        currentDirection: baseDirection,
        currentAsset: initialAsset,
        feedbackUtterance: '더 실제 사진 같게, 얼굴 없이, 배경은 덜 꾸민 자연스러운 느낌으로 해줘',
      })

      // Model presence updated to absent
      expect(feedbackResult.updatedRules.modelPresence).toBe('MODEL_ABSENT')
      expect(feedbackResult.updatedRules.background).toContain('자연스러운')

      // Delta explanation generated for owner
      expect(feedbackResult.appliedDeltaExplanation).toContain('얼굴')
      expect(feedbackResult.appliedDeltaExplanation).toContain('자연스러운')

      // New asset generated with distinct digest and lineage linking prior asset
      expect(feedbackResult.newAsset.id).not.toBe(initialAsset.id)
      expect(feedbackResult.newAsset.digest).not.toBe(initialAsset.digest)
      expect(feedbackResult.newAsset.revisionLineage?.originalAssetId).toBe(initialAsset.id)
      expect(feedbackResult.newAsset.revisionLineage?.feedbackUtterance).toContain('얼굴 없이')
    })
  })

  describe('3. Rights & Likeness Consent Verification Guard', () => {
    it('sets publishEligibility to false when rights are unconfirmed', () => {
      const asset = {
        id: 'asset-1',
        rightsStatus: 'PENDING_CONFIRMATION' as const,
        consentStatus: 'NOT_REQUESTED' as const,
      }

      const result = verifyMediaRightsAndConsent(asset)
      expect(result.publishEligibility).toBe(false)
      expect(result.reason).toContain('사용 권한')
    })

    it('sets publishEligibility to true when owner confirms rights and likeness is cleared', () => {
      const asset = {
        id: 'asset-2',
        rightsStatus: 'OWNED' as const,
        consentStatus: 'NOT_APPLICABLE' as const, // No human faces
      }

      const result = verifyMediaRightsAndConsent(asset)
      expect(result.publishEligibility).toBe(true)
      expect(result.rightsConfirmedAt).toBeDefined()
    })
  })

  describe('4. Golden Images Invariant & Explicit Confirm Gate', () => {
    it('rejects confirmation if fewer than 3 golden images are selected', () => {
      const draft: ImageCalibrationDraft = {
        workspaceId: 'ws-img-test',
        selectedDirectionKey: 'NATURAL_LIGHT',
        status: 'CALIBRATING',
        iterationCount: 1,
        calibrationHistory: [],
        goldenImages: [
          { id: 'g1', rightsStatus: 'OWNED', consentStatus: 'NOT_APPLICABLE' },
          { id: 'g2', rightsStatus: 'OWNED', consentStatus: 'NOT_APPLICABLE' },
        ],
      }

      expect(() =>
        confirmImageCalibration({
          draft,
          userId: 'owner-1',
          userConfirmationPhrase: '이 기준으로 사용',
          isExplicitlyApproved: true,
        })
      ).toThrowError(/최소 3장 이상/)
    })

    it('successfully confirms and freezes image harness when 3~5 golden images and explicit phrase are provided', () => {
      const draft: ImageCalibrationDraft = {
        workspaceId: 'ws-img-test',
        selectedDirectionKey: 'NATURAL_LIGHT',
        status: 'CALIBRATING',
        iterationCount: 1,
        calibrationHistory: [],
        goldenImages: [
          { id: 'g1', rightsStatus: 'OWNED', consentStatus: 'NOT_APPLICABLE' },
          { id: 'g2', rightsStatus: 'OWNED', consentStatus: 'NOT_APPLICABLE' },
          { id: 'g3', rightsStatus: 'OWNED', consentStatus: 'NOT_APPLICABLE' },
        ],
      }

      const confirmed = confirmImageCalibration({
        draft,
        userId: 'owner-1',
        userConfirmationPhrase: '이 느낌으로 기억해줘',
        isExplicitlyApproved: true,
      })

      expect(confirmed.status).toBe('ACTIVE_CONFIRMED')
      expect(confirmed.confirmedAt).toBeDefined()
      expect(confirmed.confirmedByUserId).toBe('owner-1')
      expect(Object.isFrozen(confirmed)).toBe(true)
    })
  })
})
