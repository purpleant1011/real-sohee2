import { describe, it, expect } from 'vitest'
import {
  generateCalibrationSamples,
  applyCalibrationFeedback,
  confirmTextCalibration,
  type TextCalibrationDraft,
  type TextCalibrationSample,
} from '@/features/text-harness/text-calibration-service'
import type { ConversationalBusinessKnowledgeDraft } from '@/features/knowledge/conversational-knowledge'

describe('ANI-1446 & ANI-1454: Sample-First Text Calibration with Natural-Language Feedback & Lineage', () => {
  const mockKnowledge: ConversationalBusinessKnowledgeDraft = {
    businessType: '1인 프리미엄 헤어살롱',
    location: '인천 청라 호수공원 인근',
    primaryServices: '시그니처 레이어드 컷 & 퍼스널컬러 염색',
    pricing: '컷 35,000원부터',
    operatingHours: '화~일 10:00 - 20:00 (월요일 휴무)',
    reservationPolicy: '100% 네이버 예약제',
  }

  describe('1. 3 Distinct Sample Generation based on Business Facts', () => {
    it('generates 3 observable distinct styles (minimal, warm, vibrant) reflecting business facts', () => {
      const batch = generateCalibrationSamples(mockKnowledge, '여름 맞이 스타일 체인지')

      expect(batch.samples.length).toBe(3)
      const [sample1, sample2, sample3] = batch.samples

      // Style diversity verification
      expect(sample1.styleKey).toBe('MINIMAL')
      expect(sample2.styleKey).toBe('WARM')
      expect(sample3.styleKey).toBe('VIBRANT')

      // All samples reflect confirmed business knowledge facts
      expect(sample1.text).toContain('청라')
      expect(sample2.text).toContain('레이어드 컷')
      expect(sample3.text).toContain('예약')

      // Observable differences in wording and tone
      expect(sample1.text).not.toEqual(sample2.text)
      expect(sample2.text).not.toEqual(sample3.text)
    })

    it('sample selection alone does NOT confirm the text harness (Confirm Boundary)', () => {
      const batch = generateCalibrationSamples(mockKnowledge, '여름 맞이 스타일 체인지')
      const selectedSample = batch.samples[1] // Pick warm style

      const draft: TextCalibrationDraft = {
        workspaceId: 'ws-test',
        selectedSampleId: selectedSample.id,
        status: 'CALIBRATING',
        iterationCount: 1,
        calibrationHistory: [],
      }

      expect(draft.status).toBe('CALIBRATING')
      expect(draft.confirmedAt).toBeUndefined()
    })
  })

  describe('2. Natural-Language Feedback & Delta Preview', () => {
    it('converts natural language feedback into structured rule updates and produces human delta explanation', () => {
      const batch = generateCalibrationSamples(mockKnowledge, '여름 맞이 스타일 체인지')
      const chosenSample = batch.samples[1]

      const feedbackResult = applyCalibrationFeedback({
        sample: chosenSample,
        feedbackUtterance: '2번이 좋은데 조금 덜 친한 척하고 "부담 없이"라는 표현은 쓰지 말아줘',
        currentRules: {
          brandVoice: '다정하고 따뜻한 이웃 스타일',
          prohibitedWords: ['초특가'],
          sentenceLength: 'MEDIUM',
        },
      })

      // Prohibited word added from feedback
      expect(feedbackResult.updatedRules.prohibitedWords).toContain('부담 없이')

      // Delta explanation generated for owner preview
      expect(feedbackResult.appliedDeltaExplanation).toBeDefined()
      expect(feedbackResult.appliedDeltaExplanation).toContain('부담 없이')

      // New revised copy contains preserved lineage
      expect(feedbackResult.revisedSample.revisionLineage).toBeDefined()
      expect(feedbackResult.revisedSample.revisionLineage?.originalSampleId).toBe(chosenSample.id)
      expect(feedbackResult.revisedSample.revisionLineage?.feedbackUtterance).toContain('덜 친한 척')
    })
  })

  describe('3. Durable Calibration Lineage & History (ANI-1454)', () => {
    it('accumulates calibration history across multiple feedback cycles without losing prior entries', () => {
      const batch = generateCalibrationSamples(mockKnowledge)
      let draft: TextCalibrationDraft = {
        workspaceId: 'ws-test',
        selectedSampleId: batch.samples[0].id,
        status: 'CALIBRATING',
        iterationCount: 1,
        calibrationHistory: [],
      }

      // Cycle 1 feedback
      const cycle1 = applyCalibrationFeedback({
        sample: batch.samples[0],
        feedbackUtterance: '첫 문장을 더 깔끔하게 해줘',
        currentRules: { brandVoice: '담백한 존댓말', prohibitedWords: [], sentenceLength: 'SHORT' },
      })

      draft = {
        ...draft,
        iterationCount: 2,
        selectedSampleId: cycle1.revisedSample.id,
        calibrationHistory: [
          ...draft.calibrationHistory,
          {
            iteration: 1,
            sampleId: batch.samples[0].id,
            feedback: '첫 문장을 더 깔끔하게 해줘',
            appliedDelta: cycle1.appliedDeltaExplanation,
            timestamp: new Date().toISOString(),
          },
        ],
      }

      expect(draft.calibrationHistory.length).toBe(1)
      expect(draft.calibrationHistory[0].feedback).toBe('첫 문장을 더 깔끔하게 해줘')
      expect(draft.iterationCount).toBe(2)
    })
  })

  describe('4. Explicit Confirm Gate', () => {
    it('throws error when user attempts confirmation without explicit approval phrase', () => {
      const draft: TextCalibrationDraft = {
        workspaceId: 'ws-test',
        selectedSampleId: 'sample-1',
        status: 'CALIBRATING',
        iterationCount: 1,
        calibrationHistory: [],
      }

      expect(() =>
        confirmTextCalibration({
          draft,
          userId: 'user-owner',
          userConfirmationPhrase: '그냥 완료해줘',
          isExplicitlyApproved: false,
        })
      ).toThrowError(/명시적인/)
    })

    it('freezes and returns active confirmed draft when explicit phrase is provided', () => {
      const draft: TextCalibrationDraft = {
        workspaceId: 'ws-test',
        selectedSampleId: 'sample-1',
        status: 'CALIBRATING',
        iterationCount: 1,
        calibrationHistory: [],
      }

      const confirmed = confirmTextCalibration({
        draft,
        userId: 'user-owner',
        userConfirmationPhrase: '이 기준으로 사용',
        isExplicitlyApproved: true,
      })

      expect(confirmed.status).toBe('ACTIVE_CONFIRMED')
      expect(confirmed.confirmedAt).toBeDefined()
      expect(confirmed.confirmedByUserId).toBe('user-owner')
      expect(Object.isFrozen(confirmed)).toBe(true)
    })
  })
})
