import { describe, it, expect } from 'vitest'
import {
  extractBusinessKnowledgeDraft,
  getNextMissingKnowledgeQuestion,
  createImmutableKnowledgeSnapshot,
} from '@/features/knowledge/conversational-knowledge'
import {
  extractTextHarnessRules,
  generateDualChannelTestCopies,
  confirmTextHarnessWithExplicitGate,
} from '@/features/text-harness/conversational-text-harness'
import {
  extractConversationalVisualRules,
  createConversationalImageHarness,
  selectGoldenImages,
} from '@/features/image-harness/conversational-image-harness'

describe('Slice 8: Harness Production Wiring & Verification', () => {
  const workspaceId = '10000000-0000-4000-8000-000000000001'
  const userId = '30000000-0000-4000-8000-000000000001'

  describe('1. Conversational Knowledge Extraction and Missing Question Flow', () => {
    it('extracts structured business facts and determines the next missing question', () => {
      const utterance = '강남역 5번출구 헤어살롱이고, 10시부터 20시까지 운영해요. 시그니처 컷은 35000원입니다.'
      const extracted = extractBusinessKnowledgeDraft(utterance)

      expect(extracted.businessType).toBeDefined()
      expect(extracted.location).toBeDefined()

      const nextQuestion = getNextMissingKnowledgeQuestion(extracted)
      expect(nextQuestion).toBeDefined()
      expect(nextQuestion?.question).toBeDefined()
      expect(typeof nextQuestion?.question).toBe('string')

      // Immutable snapshot with deep freeze
      const snapshot = createImmutableKnowledgeSnapshot(
        { ...extracted, workspaceId },
        userId,
        1
      )
      expect(snapshot.id).toBeDefined()
      expect(snapshot.isImmutable).toBe(true)
      expect(Object.isFrozen(snapshot)).toBe(true)
      expect(snapshot.facts.length).toBeGreaterThanOrEqual(1)
    })
  })

  describe('2. Conversational Text Harness and Dual-Channel Generation Flow', () => {
    it('extracts voice rules and generates dual channel test copies (Instagram + Threads)', () => {
      const utterance = '20대 여성을 위한 친근하고 발랄한 말투로 써줘. 가격은 투명하게 공개하고 과장된 표현은 절대 금지야.'
      const rules = extractTextHarnessRules(utterance)

      expect(rules.brandVoice).toBeDefined()
      expect(rules.priceDisclosure).toBe('TRANSPARENT')
      expect(rules.antiExaggeration).toBe(true)

      const draft = {
        workspaceId,
        rules,
        testRunsCount: 0,
        status: 'DRAFT' as const,
      }

      const dualBatch = generateDualChannelTestCopies(draft, '레이어드 컷')

      expect(dualBatch.instagramCopies.length).toBeGreaterThanOrEqual(2)
      expect(dualBatch.threadsCopies.length).toBeGreaterThanOrEqual(2)
      expect(dualBatch.instagramCopies[0].text).toContain('레이어드 컷')
      expect(dualBatch.threadsCopies[0].text).toBeDefined()

      // Explicit confirmation gate check
      expect(() => {
        confirmTextHarnessWithExplicitGate({
          draft: { ...draft, testRunsCount: 0 },
          userId,
          userConfirmationPhrase: '이 기준으로 사용',
          isExplicitlyApproved: true,
        })
      }).toThrowError('최소 1회 이상 테스트 생성')

      const confirmed = confirmTextHarnessWithExplicitGate({
        draft: { ...draft, testRunsCount: 1 },
        userId,
        userConfirmationPhrase: '이 기준으로 사용',
        isExplicitlyApproved: true,
      })
      expect(confirmed.status).toBe('ACTIVE_CONFIRMED')
      expect(confirmed.confirmedAt).toBeDefined()
    })
  })

  describe('3. Conversational Image Harness and Visual Validation Flow', () => {
    it('extracts visual rules and validates golden images (3-5) and rights', () => {
      const utterance = '자연광 느낌의 따뜻한 톤으로 찍힌 매장 인테리어 위주로 해줘. 너무 어둡거나 왜곡된 렌즈는 금지야.'
      const visualRules = extractConversationalVisualRules(utterance)

      expect(visualRules.lighting).toContain('자연광')
      expect(visualRules.colorTone).toContain('따뜻')

      // Golden image count guard: 3~5 via selectGoldenImages
      const harness = createConversationalImageHarness({ workspaceId, visualRules })
      expect(() => selectGoldenImages(harness, ['img-1', 'img-2'])).toThrowError('INSUFFICIENT_GOLDEN_IMAGES')
      expect(() => selectGoldenImages(harness, ['img-1', 'img-2', 'img-3', 'img-4', 'img-5', 'img-6'])).toThrowError('EXCESS_GOLDEN_IMAGES')

      const validState = selectGoldenImages(harness, ['img-1', 'img-2', 'img-3'])
      expect(validState.lifecycleStatus).toBe('GOLDEN_SELECTED')
      expect(validState.goldenImageIds.length).toBe(3)
    })
  })
})
