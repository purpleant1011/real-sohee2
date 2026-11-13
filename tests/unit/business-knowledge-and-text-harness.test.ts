import { describe, it, expect, beforeEach } from 'vitest'
import {
  createKnowledgeCandidate,
  confirmKnowledgeFacts,
  getGroundingKnowledge,
  type KnowledgeCandidate,
  type ConfirmedKnowledgeFact,
} from '@/features/knowledge/knowledge-manager'
import {
  createTextHarnessDraft,
  runTextHarnessTest,
  confirmTextHarnessVersion,
  type TextHarnessRules,
} from '@/features/text-harness/text-harness-manager'

describe('M2: Business Knowledge & Text Harness Labs (HF-13, HF-14, HF-15)', () => {
  describe('HF-13: Business Knowledge Lineage & Grounding Safety', () => {
    it('creates candidate with PENDING_REVIEW status', () => {
      const candidate = createKnowledgeCandidate({
        workspaceId: 'ws-test-m2',
        sourceId: 'src-menu-01',
        category: 'MENU',
        key: '대표메뉴',
        candidateValue: '한우 등심구이 180g (35,000원)',
        confidence: 0.95,
      })

      expect(candidate.status).toBe('PENDING_REVIEW')
      expect(candidate.category).toBe('MENU')
      expect(candidate.candidateValue).toContain('한우 등심구이')
    })

    it('PROHIBITS unconfirmed candidates from grounding (pre-confirm grounding = 0)', () => {
      const pendingCandidate = createKnowledgeCandidate({
        workspaceId: 'ws-test-m2',
        sourceId: 'src-menu-01',
        category: 'PRICE',
        key: '소주가격',
        candidateValue: '5,000원',
        confidence: 0.8,
      })

      // Grounding should be empty when no facts are confirmed
      const grounding = getGroundingKnowledge({
        candidates: [pendingCandidate],
        confirmedFacts: [],
      })

      expect(grounding.facts.length).toBe(0)
      expect(grounding.groundingText).toBe('')
    })

    it('promotes approved candidate to ConfirmedKnowledgeFact and generates immutable version', () => {
      const candidate: KnowledgeCandidate = {
        id: 'cand-001',
        workspaceId: 'ws-test-m2',
        sourceId: 'src-menu-01',
        category: 'MENU',
        key: '시그니처',
        candidateValue: '숙성 삼겹살 (16,000원)',
        confidence: 0.98,
        status: 'PENDING_REVIEW',
        createdAt: new Date().toISOString(),
      }

      const version = confirmKnowledgeFacts({
        workspaceId: 'ws-test-m2',
        approvedCandidates: [candidate],
        userId: 'user-owner-01',
        previousVersionNumber: 0,
      })

      expect(version.versionNumber).toBe(1)
      expect(version.factsSnapshot.length).toBe(1)
      expect(version.factsSnapshot[0].factValue).toBe('숙성 삼겹살 (16,000원)')
      expect(version.factsSnapshot[0].status).toBe('ACTIVE')

      // Grounding now includes the confirmed fact
      const grounding = getGroundingKnowledge({
        candidates: [],
        confirmedFacts: version.factsSnapshot,
      })

      expect(grounding.facts.length).toBe(1)
      expect(grounding.groundingText).toContain('숙성 삼겹살')
    })
  })

  describe('HF-14 & HF-15: Text Harness Versioning & Minimum 1 Test Run Requirement', () => {
    const defaultRules: TextHarnessRules = {
      toneAndManner: '친근하고 정중한 이웃 스타일',
      targetAudience: '2030 직장인 및 가족 고객',
      keyPhrases: ['당일 도축', '신선한 재료'],
      prohibitedWords: ['최저가', '폭탄세일', '대박'],
      positiveExamples: ['오늘 들어온 신선한 한우 등심으로 따뜻한 저녁을 준비했습니다.'],
      negativeExamples: ['역대급 대박 폭탄세일 놓치면 바보!'],
    }

    it('creates initial text harness with DRAFT status and testRunsCount=0', () => {
      const draft = createTextHarnessDraft({
        workspaceId: 'ws-test-m2',
        rules: defaultRules,
        versionNumber: 1,
      })

      expect(draft.status).toBe('DRAFT')
      expect(draft.testRunsCount).toBe(0)
      expect(draft.rules.toneAndManner).toBe('친근하고 정중한 이웃 스타일')
    })

    it('STRICTLY BLOCKS confirmation if testRunsCount is 0', () => {
      const draft = createTextHarnessDraft({
        workspaceId: 'ws-test-m2',
        rules: defaultRules,
        versionNumber: 1,
      })

      expect(() => {
        confirmTextHarnessVersion({
          draft,
          userId: 'user-owner-01',
        })
      }).toThrow(/최소 1회 이상 테스트 생성을 실행해야/)
    })

    it('increments testRunsCount and generates Instagram 2 + Threads 2 test samples', () => {
      let draft = createTextHarnessDraft({
        workspaceId: 'ws-test-m2',
        rules: defaultRules,
        versionNumber: 1,
      })

      const testRun = runTextHarnessTest({
        draft,
        sampleTopic: '봄 맞이 신메뉴 소개',
      })

      expect(testRun.instagramCopies.length).toBe(2)
      expect(testRun.threadsCopies.length).toBe(2)
      expect(testRun.updatedDraft.testRunsCount).toBe(1)

      // Test copy obeys prohibited words rule
      for (const copy of [...testRun.instagramCopies, ...testRun.threadsCopies]) {
        for (const prohibited of defaultRules.prohibitedWords) {
          expect(copy.text).not.toContain(prohibited)
        }
      }
    })

    it('successfully confirms version when testRunsCount >= 1 and supersedes prior active version', () => {
      const draft = createTextHarnessDraft({
        workspaceId: 'ws-test-m2',
        rules: defaultRules,
        versionNumber: 2,
      })

      // Simulate a test run
      draft.testRunsCount = 1

      const priorActive = {
        ...draft,
        id: 'harness-v1',
        versionNumber: 1,
        status: 'ACTIVE_CONFIRMED' as const,
      }

      const { confirmedVersion, supersededVersion } = confirmTextHarnessVersion({
        draft,
        userId: 'user-owner-01',
        priorActiveVersion: priorActive,
      })

      expect(confirmedVersion.status).toBe('ACTIVE_CONFIRMED')
      expect(confirmedVersion.confirmedByUserId).toBe('user-owner-01')
      expect(supersededVersion?.status).toBe('SUPERSEDED')
    })
  })
})
