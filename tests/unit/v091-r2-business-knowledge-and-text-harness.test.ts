import { describe, it, expect } from 'vitest'
import {
  extractBusinessKnowledgeDraft,
  getNextMissingKnowledgeQuestion,
  createImmutableKnowledgeSnapshot,
  type ConversationalBusinessKnowledgeDraft,
} from '@/features/knowledge/conversational-knowledge'
import {
  extractTextHarnessRules,
  generateDualChannelTestCopies,
  reviseTextHarnessCandidate,
  confirmTextHarnessWithExplicitGate,
  type ConversationalTextHarnessDraft,
} from '@/features/text-harness/conversational-text-harness'

describe('ANI-1430: Conversational Business Knowledge + Text Harness', () => {
  describe('1. Conversational Business Knowledge Extraction & Targeted Questioning', () => {
    it('extracts partial business dimensions and identifies missing critical fields', () => {
      const utterance = '청라에 있는 1인 미용실이고 매주 월요일은 쉬어'
      const draft = extractBusinessKnowledgeDraft(utterance)

      expect(draft.location).toBe('청라')
      expect(draft.businessType).toBe('1인 미용실')
      expect(draft.operatingHours).toContain('월요일')

      // Empty fields remain undefined
      expect(draft.pricing).toBeUndefined()
      expect(draft.reservationPolicy).toBeUndefined()

      // Targeted question should ask about missing fields (e.g. reservation or pricing)
      const nextQuestion = getNextMissingKnowledgeQuestion(draft)
      expect(nextQuestion).not.toBeNull()
      expect(nextQuestion?.field).toMatch(/reservationPolicy|pricing|primaryServices/)
    })

    it('extracts full 9 business dimensions when user provides rich context', () => {
      const fullUtterance = `
        청라 호수공원 근처 1인 미용실 헤어스튜디오이고, 화-일 10시부터 8시까지 영업해요.
        100% 네이버 예약제이고, 대표 서비스는 시그니처 레이어드컷과 퍼스널컬러 염색입니다.
        컷은 3만원, 염색은 12만원부터 시작해요. 2030 직장인 여성 고객이 주 타깃이고,
        주차는 건물 지하 2시간 무료입니다. 시술 중에는 전화를 받지 못하니 예약창 메시지 부탁드려요!
      `
      const draft = extractBusinessKnowledgeDraft(fullUtterance)

      expect(draft.location).toContain('청라')
      expect(draft.businessType).toContain('1인 미용실')
      expect(draft.operatingHours).toContain('10시')
      expect(draft.reservationPolicy).toContain('예약제')
      expect(draft.primaryServices).toContain('레이어드컷')
      expect(draft.pricing).toContain('3만원')
      expect(draft.targetAudience).toContain('2030')
      expect(draft.faq).toContain('주차')
      expect(draft.cautions).toContain('전화')

      // Since all critical fields are present, getNextMissingKnowledgeQuestion returns null or complete signal
      const nextQuestion = getNextMissingKnowledgeQuestion(draft)
      expect(nextQuestion).toBeNull()
    })

    it('creates an immutable snapshot version when owner confirms business knowledge', () => {
      const draft: ConversationalBusinessKnowledgeDraft = {
        workspaceId: 'ws-test-1',
        businessType: '헤어살롱',
        location: '인천 서구 청라동',
        operatingHours: '10:00 - 20:00',
        reservationPolicy: '네이버 예약제',
        primaryServices: '디자인펌, 퍼스널 컷',
        pricing: '컷 30,000원~',
        targetAudience: '2030 여성',
        faq: '건물 주차 가능',
        cautions: '10분 지각 시 자동 취소',
      }

      const snapshot = createImmutableKnowledgeSnapshot(draft, 'user-owner-1')
      expect(snapshot.id).toMatch(/^bkv_\d+/)
      expect(snapshot.workspaceId).toBe('ws-test-1')
      expect(snapshot.versionNumber).toBe(1)
      expect(snapshot.isImmutable).toBe(true)
      expect(snapshot.confirmedBy).toBe('user-owner-1')
      expect(snapshot.facts.length).toBe(9)
      expect(Object.isFrozen(snapshot)).toBe(true)
      expect(Object.isFrozen(snapshot.facts)).toBe(true)
      expect(Object.isFrozen(snapshot.facts[0])).toBe(true)
    })
  })

  describe('2. Conversational Text Harness Extraction & Dual-Channel Test Generation', () => {
    it('extracts brand voice, sentence length, CTA, price rules, and exaggeration guard', () => {
      const utterance = `
        말투는 너무 가볍지 않고 다정하고 정중한 존댓말로 써줘. 문장은 짧고 읽기 편하게 끊어주고,
        마지막엔 네이버 예약 링크로 안내하는 CTA를 넣어줘. 가격은 투명하게 명시하고,
        '대박 할인', '전국 최저가' 같은 과장된 표현은 절대 쓰지 마.
      `
      const rules = extractTextHarnessRules(utterance)

      expect(rules.brandVoice).toBe('다정하고 정중한 존댓말')
      expect(rules.sentenceLength).toBe('SHORT')
      expect(rules.callToAction).toBe('RESERVATION_LINK')
      expect(rules.priceDisclosure).toBe('TRANSPARENT')
      expect(rules.antiExaggeration).toBe(true)
      expect(rules.prohibitedWords).toContain('대박 할인')
      expect(rules.prohibitedWords).toContain('전국 최저가')
    })

    it('generates at least 2 Instagram copies and 2 Threads copies in dual-channel preview', () => {
      const draft: ConversationalTextHarnessDraft = {
        workspaceId: 'ws-test-1',
        rules: {
          brandVoice: '다정하고 정중한 존댓말',
          sentenceLength: 'SHORT',
          callToAction: 'RESERVATION_LINK',
          priceDisclosure: 'TRANSPARENT',
          antiExaggeration: true,
          prohibitedWords: ['초특가'],
          instagramStyle: '감성적이고 정돈된 비주얼 캡션',
          threadsStyle: '자연스럽고 친근한 일상 대화형',
        },
        testRunsCount: 0,
        status: 'DRAFT',
      }

      const testBatch = generateDualChannelTestCopies(draft, '봄맞이 레이어드컷')

      expect(testBatch.instagramCopies.length).toBeGreaterThanOrEqual(2)
      expect(testBatch.threadsCopies.length).toBeGreaterThanOrEqual(2)
      expect(testBatch.updatedDraft.testRunsCount).toBe(1)

      // Verify Instagram copy properties
      expect(testBatch.instagramCopies[0].channel).toBe('instagram')
      expect(testBatch.instagramCopies[0].text).toContain('봄맞이 레이어드컷')
      expect(testBatch.instagramCopies[0].text).not.toContain('초특가')

      // Verify Threads copy properties
      expect(testBatch.threadsCopies[0].channel).toBe('threads')
      expect(testBatch.threadsCopies[0].text).toContain('봄맞이 레이어드컷')
    })

    it('refines candidate copies based on user feedback (Like/Dislike/Revision)', () => {
      const initialCopy = {
        id: 'copy-ig-1',
        channel: 'instagram' as const,
        text: '봄맞이 산뜻한 레이어드컷 어떠세요? 매장에서 정성껏 준비했습니다.',
      }

      const revised = reviseTextHarnessCandidate(initialCopy, {
        feedbackType: 'revised',
        userCorrection: '가격 35,000원 표기를 추가하고 예약 마감 문구를 넣어줘',
      })

      expect(revised.text).toContain('35,000원')
      expect(revised.text).toContain('예약 마감')
      expect(revised.revisionLineage?.originalCopyId).toBe('copy-ig-1')
      expect(revised.revisionLineage?.userCorrection).toContain('가격 35,000원')
    })
  })

  describe('3. Invariant Gates: Explicit Confirm Boundary & Fail-Closed Grounding', () => {
    it('strictly blocks TEXT_HARNESS_CONFIRMED without explicit confirmation', () => {
      const draft: ConversationalTextHarnessDraft = {
        workspaceId: 'ws-test-1',
        rules: {
          brandVoice: '친근한',
          sentenceLength: 'SHORT',
          callToAction: 'DM_INQUIRY',
          priceDisclosure: 'INQUIRY',
          antiExaggeration: true,
          prohibitedWords: [],
          instagramStyle: '감성',
          threadsStyle: '일상',
        },
        testRunsCount: 1,
        status: 'DRAFT',
      }

      // Explicit flag is false (e.g. user just said "좋아보여")
      expect(() =>
        confirmTextHarnessWithExplicitGate({
          draft,
          userId: 'user-1',
          userConfirmationPhrase: '좋아보여',
          isExplicitlyApproved: false,
        })
      ).toThrowError(/명시적인 '이 기준으로 사용' 승인이 필요합니다/)
    })

    it('strictly blocks TEXT_HARNESS_CONFIRMED if test run count is 0', () => {
      const untestedDraft: ConversationalTextHarnessDraft = {
        workspaceId: 'ws-test-1',
        rules: {
          brandVoice: '친근한',
          sentenceLength: 'SHORT',
          callToAction: 'DM_INQUIRY',
          priceDisclosure: 'INQUIRY',
          antiExaggeration: true,
          prohibitedWords: [],
          instagramStyle: '감성',
          threadsStyle: '일상',
        },
        testRunsCount: 0,
        status: 'DRAFT',
      }

      expect(() =>
        confirmTextHarnessWithExplicitGate({
          draft: untestedDraft,
          userId: 'user-1',
          userConfirmationPhrase: '이 기준으로 사용',
          isExplicitlyApproved: true,
        })
      ).toThrowError(/최소 1회 이상 테스트 생성을 실행해야/)
    })

    it('successfully confirms and generates immutable version when explicitly approved with test run >= 1', () => {
      const testedDraft: ConversationalTextHarnessDraft = {
        workspaceId: 'ws-test-1',
        rules: {
          brandVoice: '다정하고 정중한 존댓말',
          sentenceLength: 'SHORT',
          callToAction: 'RESERVATION_LINK',
          priceDisclosure: 'TRANSPARENT',
          antiExaggeration: true,
          prohibitedWords: ['초특가'],
          instagramStyle: '감성',
          threadsStyle: '일상',
        },
        testRunsCount: 1,
        status: 'DRAFT',
      }

      const confirmed = confirmTextHarnessWithExplicitGate({
        draft: testedDraft,
        userId: 'user-1',
        userConfirmationPhrase: '이 기준으로 사용',
        isExplicitlyApproved: true,
      })

      expect(confirmed.status).toBe('ACTIVE_CONFIRMED')
      expect(confirmed.confirmedAt).toBeDefined()
      expect(confirmed.confirmedByUserId).toBe('user-1')
      expect(Object.isFrozen(confirmed)).toBe(true)
    })
  })
})
