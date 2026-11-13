import { describe, it, expect } from 'vitest'
import {
  computeTutorialJourneyProgress,
} from '@/features/tutorial-journey/tutorial-journey-read-model'
import type { SoheeReadinessSnapshot, SoheeReadinessFactKey, ReadinessFactProvenance } from '@/features/sohee-ready/types'

function makeSnapshot(
  factsMap: Partial<Record<SoheeReadinessFactKey, { verified: boolean; status: string }>>
): SoheeReadinessSnapshot {
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
    const entry = factsMap[k] ?? { verified: false, status: 'PENDING' }
    acc[k] = {
      key: k,
      verified: entry.verified,
      status: entry.status as any,
      source: 'test',
      evidenceId: entry.verified ? `ev-${k}` : null,
      version: 1,
      verifiedAt: entry.verified ? '2026-09-14T10:00:00Z' : null,
      freshness: 'FRESH',
    }
    return acc
  }, {} as Record<SoheeReadinessFactKey, ReadinessFactProvenance>)

  return {
    workspaceId: 'ws-cross-route-test',
    ready: allKeys.every((k) => facts[k].verified),
    facts,
    blockers: [],
    evaluatedAt: new Date().toISOString(),
  }
}

describe('ANI-1443 Acceptance: Cross-route tutorial consistency & deterministic truth', () => {
  it('does NOT translate PENDING business or CONNECTED_UNVERIFIED channel into verified facts', () => {
    const snapshot = makeSnapshot({
      BUSINESS_VERIFIED: { verified: false, status: 'PENDING' },
      INSTAGRAM_VERIFIED: { verified: false, status: 'CONNECTED_UNVERIFIED' },
      THREADS_VERIFIED: { verified: false, status: 'PENDING' },
    })

    const progress = computeTutorialJourneyProgress(snapshot)

    expect(progress.readinessCount).toBe(0)
    expect(progress.isCompleted).toBe(false)
    expect(progress.currentStage).toBe('BUSINESS_LEARNING')
    expect(progress.primaryAction.href).toBe('/app/sohee?tab=training')
  })

  it('maintains identical readinessCount across routes regardless of how many times evaluated', () => {
    const snap = makeSnapshot({
      BUSINESS_VERIFIED: { verified: true, status: 'VERIFIED' },
      BUSINESS_KNOWLEDGE_CONFIRMED: { verified: true, status: 'CONFIRMED' },
      INSTAGRAM_VERIFIED: { verified: true, status: 'VERIFIED' },
    })

    const eval1 = computeTutorialJourneyProgress(snap)
    const eval2 = computeTutorialJourneyProgress(snap)
    const eval3 = computeTutorialJourneyProgress(snap)

    expect(eval1.readinessCount).toBe(3)
    expect(eval2.readinessCount).toBe(3)
    expect(eval3.readinessCount).toBe(3)
    // 2026-10-07 ANI-1524: single channel verified satisfies CHANNELS_SETUP -> proceeds to TEXT_CALIBRATION
    expect(eval1.currentStage).toBe('TEXT_CALIBRATION')
    expect(eval2.currentStage).toBe('TEXT_CALIBRATION')
  })
})
