import { describe, it, expect } from 'vitest'
import {
  extractFirstMeetingIntent,
  recordCandidateRevision,
  type LearningCandidate,
} from '@/features/onboarding/first-meeting/first-meeting-service'
import {
  createStateAwareGuidance,
} from '@/features/onboarding/guidance/sohee-guidance-contract'
import { computeTutorialJourneyProgress } from '@/features/tutorial-journey/tutorial-journey-read-model'
import type { SoheeReadinessSnapshot, SoheeReadinessFactKey, ReadinessFactProvenance } from '@/features/sohee-ready/types'

function makeMockSnapshot(verifiedKeys: SoheeReadinessFactKey[] = []): SoheeReadinessSnapshot {
  const allKeys: SoheeReadinessFactKey[] = [
    'BUSINESS_VERIFIED',
    'INSTAGRAM_VERIFIED',
    'THREADS_VERIFIED',
    'BUSINESS_KNOWLEDGE_CONFIRMED',
    'TEXT_HARNESS_CONFIRMED',
    'IMAGE_HARNESS_CONFIRMED',
    'OPERATING_POLICY_CONFIRMED',
  ]
  const facts = allKeys.reduce((acc, k) => {
    const verified = verifiedKeys.includes(k)
    acc[k] = {
      key: k,
      verified,
      status: verified ? 'VERIFIED' : 'PENDING',
      source: 'test',
      evidenceId: verified ? `ev-${k}` : null,
      version: 1,
      verifiedAt: verified ? '2026-09-14T10:00:00Z' : null,
      freshness: 'FRESH',
    }
    return acc
  }, {} as Record<SoheeReadinessFactKey, ReadinessFactProvenance>)

  return {
    workspaceId: 'ws-learning-test',
    ready: allKeys.every((k) => facts[k].verified),
    facts,
    blockers: [],
    evaluatedAt: new Date().toISOString(),
  }
}

describe('ANI-1444 & ANI-1445 & ANI-1448: First Meeting, Business Learning & State-Aware Guidance', () => {
  describe('1. ANI-1444: First Meeting Intent Extraction', () => {
    it('extracts goal and anti-pattern into structured candidates without promoting to confirmed truth', () => {
      const userSpeech = '인스타 홍보를 잘해줬으면 좋겠고 광고 같은 말투는 싫어'
      const candidates = extractFirstMeetingIntent(userSpeech)

      expect(candidates.length).toBeGreaterThanOrEqual(2)

      const goalCandidate = candidates.find((c) => c.key === 'marketing_goal')
      expect(goalCandidate).toBeDefined()
      expect(goalCandidate?.value).toContain('인스타')
      expect(goalCandidate?.status).toBe('CANDIDATE')

      const toneCandidate = candidates.find((c) => c.key === 'brand_tone')
      expect(toneCandidate).toBeDefined()
      expect(toneCandidate?.value).toContain('광고')
      expect(toneCandidate?.status).toBe('CANDIDATE')
    })
  })

  describe('2. ANI-1445: Conversational Business Learning & Revision Lineage', () => {
    it('preserves previous value lineage when user corrects a candidate', () => {
      const initialCandidate: LearningCandidate = {
        key: 'target_audience',
        label: '주요 타깃',
        value: '2030 여성 직장인',
        status: 'CANDIDATE',
        version: 1,
        sourceUtterance: '주로 2030 직장인 분들이 많이 와요',
        previousValues: [],
      }

      const revised = recordCandidateRevision(
        initialCandidate,
        '40대 고객층도 요즘 부쩍 늘었어',
        '40대 고객 포함 2040 직장인'
      )

      expect(revised.version).toBe(2)
      expect(revised.value).toBe('40대 고객 포함 2040 직장인')
      expect(revised.previousValues.length).toBe(1)
      expect(revised.previousValues[0].value).toBe('2030 여성 직장인')
      expect(revised.previousValues[0].sourceUtterance).toBe('주로 2030 직장인 분들이 많이 와요')
      expect(revised.status).toBe('CANDIDATE') // Must remain candidate until explicit confirm
    })
  })

  describe('3. ANI-1448: State-Aware Sohee Guidance Contract', () => {
    it('produces plain Korean guidance without exposing AI chain-of-thought or internal jargon', () => {
      const snap = makeMockSnapshot(['BUSINESS_VERIFIED'])
      const progress = computeTutorialJourneyProgress(snap)

      const candidates: LearningCandidate[] = [
        {
          key: 'business_type',
          label: '업종',
          value: '헤어살롱',
          status: 'CANDIDATE',
          version: 1,
          sourceUtterance: '청라에서 1인 미용실 해요',
          previousValues: [],
        },
      ]

      const guidance = createStateAwareGuidance(progress, candidates)

      expect(guidance.acknowledgement).toBeDefined()
      expect(guidance.understoodCandidates?.length).toBe(1)
      expect(guidance.understoodCandidates?.[0].value).toBe('헤어살롱')
      expect(guidance.nextQuestion).toBeDefined()
      expect(guidance.quickReplies.length).toBeGreaterThan(0)

      // Technical jargon must be excluded
      const combinedText = JSON.stringify(guidance)
      expect(combinedText).not.toContain('Harness')
      expect(combinedText).not.toContain('HF-')
      expect(combinedText).not.toContain('ledger')
      expect(combinedText).not.toContain('capability receipt')
    })
  })
})
