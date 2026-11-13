import { describe, it, expect } from 'vitest'
import {
  LearningCandidateEngine,
  type CandidateOutcomeInput,
} from '@/features/learning/learning-candidate-engine'

describe('[RC-06][Regression] Outcome Attribution & Learning Candidate Evidence Threshold (ANI-1331)', () => {
  const engine = new LearningCandidateEngine()
  const workspaceId = '00000000-0000-4000-8000-0000000000a2'
  const missionId = 'mis-byreum-learning-001'

  describe('1. Evidence Class and Sample Threshold (N>=3 Gate)', () => {
    it('returns null for UNKNOWN evidence class without fabricating candidates', () => {
      const input: CandidateOutcomeInput = {
        workspaceId,
        missionId,
        evidenceClass: 'UNKNOWN',
        confidence: 0,
      }

      const candidate = engine.createCandidateFromOutcome(input)
      expect(candidate).toBeNull()
    })

    it('isolates single or insufficient sample (N < 3) to REVIEW_REQUIRED instead of active CANDIDATE', () => {
      const singleEventInput: CandidateOutcomeInput = {
        workspaceId,
        missionId,
        evidenceClass: 'VERIFIED',
        confidence: 90,
        sampleCount: 1, // Single event!
        metric: { bookings: 1, revenueKrw: 180000 },
        evidenceRefs: ['booking:bk-1'],
      }

      const candidate = engine.createCandidateFromOutcome(singleEventInput)
      expect(candidate).not.toBeNull()
      // Strict Assertion: Single event MUST NOT be immediately promoted to active CANDIDATE
      expect(candidate?.status).toBe('REVIEW_REQUIRED')
    })

    it('promotes to active CANDIDATE only when evidenceClass is VERIFIED and sampleCount >= 3', () => {
      const verifiedMultiSampleInput: CandidateOutcomeInput = {
        workspaceId,
        missionId,
        evidenceClass: 'VERIFIED',
        confidence: 95,
        sampleCount: 3, // N >= 3 satisfied!
        metric: { bookings: 3, revenueKrw: 540000, conversionRate: 0.35 },
        evidenceRefs: ['booking:bk-1', 'booking:bk-2', 'booking:bk-3'],
      }

      const candidate = engine.createCandidateFromOutcome(verifiedMultiSampleInput)
      expect(candidate).not.toBeNull()
      expect(candidate?.status).toBe('CANDIDATE')
      expect(candidate?.sampleCount).toBe(3)
    })
  })

  describe('2. Dynamic Impact Calculation (No Fixed Default Fabrication)', () => {
    it('does NOT fabricate fixed 15~20% growth when metrics indicate different values or are missing', () => {
      const inputNoMetric: CandidateOutcomeInput = {
        workspaceId,
        missionId,
        evidenceClass: 'INFERRED',
        confidence: 60,
        sampleCount: 1,
      }

      const candidate = engine.createCandidateFromOutcome(inputNoMetric)
      expect(candidate).not.toBeNull()
      // Should not have the hardcoded fabricated string '15~20%'
      expect(candidate?.proposedImpact.expectedGrowth).not.toContain('15~20%')
    })
  })

  describe('3. Stop Condition & Superseding Guard', () => {
    it('supersedes candidate when failure threshold or conversion rate drops below limit', () => {
      const validCandidate = engine.createCandidateFromOutcome({
        workspaceId,
        missionId,
        evidenceClass: 'VERIFIED',
        confidence: 95,
        sampleCount: 4,
        metric: { bookings: 4, revenueKrw: 720000, conversionRate: 0.4 },
        evidenceRefs: ['bk:1', 'bk:2', 'bk:3', 'bk:4'],
      })!

      expect(validCandidate.status).toBe('CANDIDATE')

      // Simulate conversion drop
      const superseded = engine.evaluateStopCondition(validCandidate, {
        currentConversionRate: 0.1, // Below minThreshold 0.2
        recentFailure: true,
      })

      expect(superseded.status).toBe('SUPERSEDED')
      expect(superseded.supersededReason).toContain('Stop condition triggered')
    })
  })
})
