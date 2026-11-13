import { describe, it, expect, beforeEach } from 'vitest'
import {
  EvidenceClassifier,
  type SourceChainInput,
  type ClassifiedAttribution,
} from '@/features/attribution/evidence-classifier'
import {
  CanonicalOutcomeAggregator,
  type MissionOutcomeRecord,
} from '@/features/learning/canonical-outcome-aggregator'
import {
  LearningCandidateEngine,
  type LearningCandidate,
} from '@/features/learning/learning-candidate-engine'
import {
  NextBestActionPlanner,
  type NBAPlannerInput,
} from '@/features/learning/next-best-action-planner'
import {
  ResultsStorylineModel,
  type StorylineProjection,
} from '@/features/learning/results-storyline-model'

describe('V0.91 Wave 5 · Verified Outcome → Learning → Next Action (ANI-1256 ~ ANI-1260)', () => {
  const workspaceId = '00000000-0000-4000-8000-0000000000a2'
  const missionId = 'msn-byreum-wave5-001'

  // --------------------------------------------------------------------------
  // 1. ANI-1256: Attribution Evidence Classifier
  // --------------------------------------------------------------------------
  describe('1. ANI-1256: Attribution Evidence Classifier · VERIFIED / INFERRED / UNKNOWN 3단계 증거 귀속', () => {
    let classifier: EvidenceClassifier

    beforeEach(() => {
      classifier = new EvidenceClassifier()
    })

    it('MUST classify complete 5-link source chain as VERIFIED with confidence 1.0', () => {
      const fullChain: SourceChainInput = {
        workspaceId,
        missionId,
        providerPostReference: 'ig_post_1001',
        externalActionReceiptId: 'rcpt_meta_2001',
        inboundMessageId: 'msg_dm_3001',
        customerId: 'cust_001',
        bookingId: 'book_confirmed_4001',
        revenueKrw: 180000,
        postPublishedAt: '2026-09-10T09:00:00.000Z',
        bookingCreatedAt: '2026-09-10T10:30:00.000Z',
      }

      const result: ClassifiedAttribution = classifier.classify(fullChain)

      expect(result.evidenceClass).toBe('VERIFIED')
      expect(result.confidence).toBe(1.0)
      expect(result.hasDirectChain).toBe(true)
      expect(result.sourceIds).toEqual([
        'ig_post_1001',
        'rcpt_meta_2001',
        'msg_dm_3001',
        'cust_001',
        'book_confirmed_4001',
      ])
      expect(result.revenueKrw).toBe(180000)
    })

    it('MUST classify temporally correlated but untracked action as INFERRED with explicit rationale and confidence < 0.8', () => {
      const inferredChain: SourceChainInput = {
        workspaceId,
        missionId,
        providerPostReference: 'ig_post_1002',
        externalActionReceiptId: 'rcpt_meta_2002',
        inboundMessageId: null, // Direct link missing!
        customerId: 'cust_002',
        bookingId: 'book_confirmed_4002',
        revenueKrw: 120000,
        postPublishedAt: '2026-09-10T09:00:00.000Z',
        bookingCreatedAt: '2026-09-10T10:00:00.000Z', // 1 hour later
      }

      const result = classifier.classify(inferredChain)

      expect(result.evidenceClass).toBe('INFERRED')
      expect(result.confidence).toBeLessThan(0.8)
      expect(result.hasDirectChain).toBe(false)
      expect(result.inferenceRationale).toContain('시계열적 상관관계')
    })

    it('MUST classify broken/unsubstantiated chain as UNKNOWN and forbid blind promotion to VERIFIED', () => {
      const brokenChain: SourceChainInput = {
        workspaceId,
        missionId,
        providerPostReference: null,
        externalActionReceiptId: null,
        inboundMessageId: null,
        customerId: null,
        bookingId: null,
        revenueKrw: undefined,
      }

      const result = classifier.classify(brokenChain)

      expect(result.evidenceClass).toBe('UNKNOWN')
      expect(result.confidence).toBe(0.0)

      // Attempting to force promotion must throw
      expect(() => {
        classifier.assertPromotableToVerified(result)
      }).toThrowError(/INVALID_EVIDENCE_PROMOTION/)
    })

    it('MUST NOT fabricate default revenue (e.g. 150000 KRW) when revenue is absent', () => {
      const noRevenueChain: SourceChainInput = {
        workspaceId,
        missionId,
        providerPostReference: 'ig_post_1003',
        externalActionReceiptId: 'rcpt_meta_2003',
        customerId: 'cust_003',
        bookingId: 'book_003',
        revenueKrw: undefined, // Missing revenue!
      }

      const result = classifier.classify(noRevenueChain)
      expect(result.revenueKrw).toBeUndefined()
      expect(result.revenueStatus).toBe('NOT_OBSERVED')
    })
  })

  // --------------------------------------------------------------------------
  // 2. ANI-1257: Canonical Outcome Aggregator
  // --------------------------------------------------------------------------
  describe('2. ANI-1257: Canonical Outcome Aggregator · 게시→반응→예약→매출 실제 결과 집계', () => {
    let aggregator: CanonicalOutcomeAggregator

    beforeEach(() => {
      aggregator = new CanonicalOutcomeAggregator()
    })

    it('MUST aggregate verified bookings and revenue idempotently without duplicate inflation', () => {
      const rawRecords: MissionOutcomeRecord[] = [
        {
          missionId,
          type: 'BOOKING',
          recordId: 'book_101',
          revenueKrw: 150000,
          status: 'CONFIRMED',
          observedAt: '2026-09-10T10:00:00.000Z',
        },
        // Duplicate webhook delivery of same booking!
        {
          missionId,
          type: 'BOOKING',
          recordId: 'book_101',
          revenueKrw: 150000,
          status: 'CONFIRMED',
          observedAt: '2026-09-10T10:00:05.000Z',
        },
        {
          missionId,
          type: 'INBOUND_INQUIRY',
          recordId: 'inq_201',
          status: 'QUALIFIED',
          observedAt: '2026-09-10T09:30:00.000Z',
        },
      ]

      const summary = aggregator.aggregate(missionId, rawRecords)

      expect(summary.totalBookings).toBe(1) // Duplicates stripped!
      expect(summary.totalRevenueKrw).toBe(150000)
      expect(summary.totalInboundInquiries).toBe(1)
      expect(summary.status).toBe('OBSERVED')
    })

    it('MUST return NOT_OBSERVED status and retain null metrics instead of falsified 0', () => {
      const summary = aggregator.aggregate(missionId, [])

      expect(summary.status).toBe('NOT_OBSERVED')
      expect(summary.totalBookings).toBeNull()
      expect(summary.totalRevenueKrw).toBeNull()
      expect(summary.narrativeSummary).toContain('아직 관찰된 인바운드 반응이나 예약 성과가 없습니다')
    })
  })

  // --------------------------------------------------------------------------
  // 3. ANI-1258: Learning Candidate Engine
  // --------------------------------------------------------------------------
  describe('3. ANI-1258: Learning Candidate Engine · 오직 VERIFIED 근거 기반 학습 및 Stop Condition', () => {
    let learningEngine: LearningCandidateEngine

    beforeEach(() => {
      learningEngine = new LearningCandidateEngine()
    })

    it('MUST generate candidate only when evidence is VERIFIED, and reject UNKNOWN outcomes', () => {
      // 1. UNKNOWN outcome must NOT generate any learning candidate
      const unknownOutcome = {
        missionId,
        workspaceId,
        evidenceClass: 'UNKNOWN' as const,
        confidence: 0.0,
      }
      const candidateUnknown = learningEngine.createCandidateFromOutcome(unknownOutcome)
      expect(candidateUnknown).toBeNull()

      // 2. INFERRED outcome must be flagged as REVIEW_REQUIRED
      const inferredOutcome = {
        missionId,
        workspaceId,
        evidenceClass: 'INFERRED' as const,
        confidence: 0.65,
        observationSummary: '인스타 스토리 게시 후 주말 예약 1건 유치',
        metric: { revenueKrw: 120000, bookings: 1 },
      }
      const candidateInferred = learningEngine.createCandidateFromOutcome(inferredOutcome)
      expect(candidateInferred).toBeDefined()
      expect(candidateInferred?.status).toBe('REVIEW_REQUIRED')

      // 3. VERIFIED outcome automatically generates active candidate (N>=3 Gate satisfied)
      const verifiedOutcome = {
        missionId,
        workspaceId,
        evidenceClass: 'VERIFIED' as const,
        confidence: 1.0,
        sampleCount: 3,
        observationSummary: '원장님 1:1 맞춤 자연눈썹 비포애프터 게시 후 180,000원 예약 유치',
        metric: { revenueKrw: 180000, bookings: 3 },
        channel: 'INSTAGRAM_FEED',
        evidenceRefs: ['post:ig_1001', 'book:4001', 'book:4002'],
      }
      const candidateVerified = learningEngine.createCandidateFromOutcome(verifiedOutcome)
      expect(candidateVerified).toBeDefined()
      expect(candidateVerified?.status).toBe('CANDIDATE')
      expect(candidateVerified?.stopCondition.maxFailureCount).toBe(3)
      expect(candidateVerified?.interpretation.whyItWorked).toBeDefined()
    })

    it('MUST supersede candidate when stop condition or contradictory evidence is triggered', () => {
      const activeCandidate: LearningCandidate = {
        candidateId: 'cand_101',
        workspaceId,
        missionId,
        status: 'CANDIDATE',
        observation: { summary: '주말 슬롯 마감 프로모션 효과 검증' },
        interpretation: { hypothesis: 'h1', rationale: 'r1', whyItWorked: 'w1' },
        proposedImpact: { expectedGrowth: '20%', targetMetric: 'bookings' },
        stopCondition: {
          metricKey: 'conversionRate',
          minThreshold: 0.25,
          maxFailureCount: 2,
        },
        failureCount: 2, // Exceeded!
        createdAt: '2026-09-10T10:00:00.000Z',
        version: 1,
      }

      const updated = learningEngine.evaluateStopCondition(activeCandidate, {
        currentConversionRate: 0.15, // Dropped below 0.25
        recentFailure: true,
      })

      expect(updated.status).toBe('SUPERSEDED')
      expect(updated.supersededReason).toContain('Stop condition triggered')
    })
  })

  // --------------------------------------------------------------------------
  // 4. ANI-1259: Next Best Action (NBA) Planner
  // --------------------------------------------------------------------------
  describe('4. ANI-1259: Evidence-Backed Next Best Action Planner', () => {
    let nbaPlanner: NextBestActionPlanner

    beforeEach(() => {
      nbaPlanner = new NextBestActionPlanner()
    })

    it('MUST propose high-converting follow-up action for verified successful missions', () => {
      const input: NBAPlannerInput = {
        workspaceId,
        sourceMissionId: missionId,
        businessGoal: '주말 예약 슬롯 100% 충원',
        latestOutcome: {
          status: 'OBSERVED',
          evidenceClass: 'VERIFIED',
          bookingsCount: 2,
          revenueKrw: 360000,
          channel: 'INSTAGRAM_FEED',
        },
        availableCredit: 50,
        riskTier: 'LOW',
        recentFailedActionTypes: [],
      }

      const nba = nbaPlanner.plan(input)

      expect(nba).toBeDefined()
      expect(nba.channel).toBe('INSTAGRAM_FEED')
      expect(nba.title).toContain('추가 슬롯')
      expect(nba.confidence).toBeGreaterThanOrEqual(90)
      expect(nba.requiresApproval).toBe(true)
      expect(nba.evidenceRefs).toContain(`mission:${missionId}`)
    })

    it('MUST suppress repeated failed actions and adjust recommendations', () => {
      const input: NBAPlannerInput = {
        workspaceId,
        sourceMissionId: missionId,
        businessGoal: '주간 예약 증대',
        latestOutcome: {
          status: 'OBSERVED',
          evidenceClass: 'VERIFIED',
          bookingsCount: 0,
          revenueKrw: 0,
          channel: 'INSTAGRAM_FEED',
        },
        availableCredit: 50,
        riskTier: 'LOW',
        recentFailedActionTypes: ['POST_GENERIC_FEED'], // Generic feed previously failed
      }

      const nba = nbaPlanner.plan(input)

      expect(nba.actionType).not.toBe('POST_GENERIC_FEED')
      expect(nba.title).toContain('네이버 플레이스') // Pivot to alternative channel
      expect(nba.reasoningSummary).toContain('이전 동일 액션의 실패 이력')
    })
  })

  // --------------------------------------------------------------------------
  // 5. ANI-1260: Results Storyline Model
  // --------------------------------------------------------------------------
  describe('5. ANI-1260: Results Storyline Model · 인과 근거 5단계 스토리라인', () => {
    let storylineModel: ResultsStorylineModel

    beforeEach(() => {
      storylineModel = new ResultsStorylineModel()
    })

    it('MUST project full 5-stage causal chain with visual evidence badges', () => {
      const projection: StorylineProjection = storylineModel.buildStoryline({
        missionId,
        workspaceId,
        actionTitle: '바이름 가을 네일 이벤트 피드 발행',
        publishReceiptId: 'rcpt_101',
        inboundConversationsCount: 3,
        confirmedBookingId: 'book_202',
        revenueKrw: 180000,
        evidenceClass: 'VERIFIED',
        nextBestActionTitle: '주말 추가 예약 슬롯 인스타 스토리 발행',
      })

      expect(projection.stages).toHaveLength(5)
      expect(projection.stages[0].stageName).toBe('ACTION')
      expect(projection.stages[1].stageName).toBe('EXTERNAL_VERIFIED')
      expect(projection.stages[2].stageName).toBe('CUSTOMER_RESPONSE')
      expect(projection.stages[3].stageName).toBe('BOOKING_REVENUE')
      expect(projection.stages[4].stageName).toBe('LEARNING_NBA')

      expect(projection.stages[3].badge).toBe('VERIFIED')
      expect(projection.stages[3].metricValue).toBe('₩180,000')
      expect(projection.isVerifiedLineage).toBe(true)
    })
  })
})
