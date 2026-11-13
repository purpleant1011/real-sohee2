import { describe, it, expect } from 'vitest'
import {
  computeTutorialJourneyProgress,
  type TutorialJourneyStage,
  type TutorialJourneyProgress,
} from '@/features/tutorial-journey/tutorial-journey-read-model'
import type { SoheeReadinessSnapshot, SoheeReadinessFactKey, ReadinessFactProvenance } from '@/features/sohee-ready/types'

function createMockSnapshot(overrides: Partial<Record<SoheeReadinessFactKey, boolean>> = {}): SoheeReadinessSnapshot {
  const defaultKeys: SoheeReadinessFactKey[] = [
    'BUSINESS_VERIFIED',
    'INSTAGRAM_VERIFIED',
    'THREADS_VERIFIED',
    'BUSINESS_KNOWLEDGE_CONFIRMED',
    'TEXT_HARNESS_CONFIRMED',
    'IMAGE_HARNESS_CONFIRMED',
    'OPERATING_POLICY_CONFIRMED',
  ]

  const facts = defaultKeys.reduce((acc, key) => {
    const verified = overrides[key] ?? false
    acc[key] = {
      key,
      verified,
      status: verified ? 'VERIFIED' : 'PENDING',
      source: 'test',
      evidenceId: verified ? `ev-${key}` : null,
      version: verified ? 1 : null,
      verifiedAt: verified ? '2026-09-14T10:00:00Z' : null,
      freshness: verified ? 'FRESH' : 'UNKNOWN',
    } as ReadinessFactProvenance
    return acc
  }, {} as Record<SoheeReadinessFactKey, ReadinessFactProvenance>)

  const ready = defaultKeys.every((k) => facts[k].verified)

  return {
    workspaceId: 'ws-test-tutorial-123',
    ready,
    facts,
    blockers: [],
    evaluatedAt: new Date().toISOString(),
  }
}

describe('ANI-1443: Canonical Tutorial Journey Read Model', () => {
  it('identifies FIRST_MEETING when knowledge is empty and welcome interaction is not done', () => {
    const snapshot = createMockSnapshot({})
    const progress = computeTutorialJourneyProgress(snapshot, { hasWelcomeInteraction: false })

    expect(progress.currentStage).toBe('FIRST_MEETING')
    expect(progress.stepIndex).toBe(1)
    expect(progress.totalSteps).toBe(5)
    expect(progress.primaryAction.href).toBe('/start')
    expect(progress.primaryAction.label).toContain('첫인사')
    expect(progress.readinessCount).toBe(0)
  })

  it('identifies BUSINESS_LEARNING when welcome done but knowledge not confirmed', () => {
    const snapshot = createMockSnapshot({ BUSINESS_VERIFIED: false })
    const progress = computeTutorialJourneyProgress(snapshot, { hasWelcomeInteraction: true })

    expect(progress.currentStage).toBe('BUSINESS_LEARNING')
    expect(progress.stepIndex).toBe(1)
    expect(progress.primaryAction.href).toBe('/app/sohee?tab=training')
    expect(progress.primaryAction.label).toContain('매장 지식')
    expect(progress.optionalParallelActions.length).toBeGreaterThan(0)
  })

  it('identifies CHANNELS_SETUP when knowledge confirmed but dual channels not verified', () => {
    const snapshot = createMockSnapshot({
      BUSINESS_VERIFIED: true,
      BUSINESS_KNOWLEDGE_CONFIRMED: true,
      INSTAGRAM_VERIFIED: false,
      THREADS_VERIFIED: false,
    })
    const progress = computeTutorialJourneyProgress(snapshot)

    expect(progress.currentStage).toBe('CHANNELS_SETUP')
    expect(progress.stepIndex).toBe(2)
    expect(progress.primaryAction.href).toBe('/start?step=channels')
    expect(progress.primaryAction.label).toContain('채널 연동')
  })

  it('identifies TEXT_CALIBRATION when channels verified but text harness not confirmed', () => {
    const snapshot = createMockSnapshot({
      BUSINESS_VERIFIED: true,
      BUSINESS_KNOWLEDGE_CONFIRMED: true,
      INSTAGRAM_VERIFIED: true,
      THREADS_VERIFIED: true,
      TEXT_HARNESS_CONFIRMED: false,
    })
    const progress = computeTutorialJourneyProgress(snapshot)

    expect(progress.currentStage).toBe('TEXT_CALIBRATION')
    expect(progress.stepIndex).toBe(3)
    expect(progress.primaryAction.href).toBe('/app/sohee?tab=training')
    expect(progress.primaryAction.label).toContain('글쓰기')
  })

  it('identifies IMAGE_CALIBRATION when text harness confirmed but image harness not confirmed', () => {
    const snapshot = createMockSnapshot({
      BUSINESS_VERIFIED: true,
      BUSINESS_KNOWLEDGE_CONFIRMED: true,
      INSTAGRAM_VERIFIED: true,
      THREADS_VERIFIED: true,
      TEXT_HARNESS_CONFIRMED: true,
      IMAGE_HARNESS_CONFIRMED: false,
    })
    const progress = computeTutorialJourneyProgress(snapshot)

    expect(progress.currentStage).toBe('IMAGE_CALIBRATION')
    expect(progress.stepIndex).toBe(4)
    expect(progress.primaryAction.href).toBe('/app/sohee?tab=training')
    expect(progress.primaryAction.label).toContain('이미지')
  })

  it('identifies FIRST_POST_PREP when all prior harnesses confirmed', () => {
    const snapshot = createMockSnapshot({
      BUSINESS_VERIFIED: true,
      BUSINESS_KNOWLEDGE_CONFIRMED: true,
      INSTAGRAM_VERIFIED: true,
      THREADS_VERIFIED: true,
      TEXT_HARNESS_CONFIRMED: true,
      IMAGE_HARNESS_CONFIRMED: true,
      OPERATING_POLICY_CONFIRMED: false,
    })
    const progress = computeTutorialJourneyProgress(snapshot)

    expect(progress.currentStage).toBe('FIRST_POST_PREP')
    expect(progress.stepIndex).toBe(5)
    expect(progress.primaryAction.href).toBe('/app/sohee?tab=command')
  })

  it('identifies FIRST_POST_PREP (all 7 ready) when ready=true before publish', () => {
    const snapshot = createMockSnapshot({
      BUSINESS_VERIFIED: true,
      BUSINESS_KNOWLEDGE_CONFIRMED: true,
      INSTAGRAM_VERIFIED: true,
      THREADS_VERIFIED: true,
      TEXT_HARNESS_CONFIRMED: true,
      IMAGE_HARNESS_CONFIRMED: true,
      OPERATING_POLICY_CONFIRMED: true,
    })
    const progress = computeTutorialJourneyProgress(snapshot, { isFirstPostPublished: false })

    expect(progress.currentStage).toBe('FIRST_POST_PREP')
    expect(progress.stepIndex).toBe(5)
    expect(progress.readinessCount).toBe(7)
    expect(progress.primaryAction.href).toBe('/start/preview')
    expect(progress.primaryAction.label).toContain('첫 게시물')
  })

  it('identifies FIRST_POST_DONE when first post is verified', () => {
    const snapshot = createMockSnapshot({
      BUSINESS_VERIFIED: true,
      BUSINESS_KNOWLEDGE_CONFIRMED: true,
      INSTAGRAM_VERIFIED: true,
      THREADS_VERIFIED: true,
      TEXT_HARNESS_CONFIRMED: true,
      IMAGE_HARNESS_CONFIRMED: true,
      OPERATING_POLICY_CONFIRMED: true,
    })
    const progress = computeTutorialJourneyProgress(snapshot, { isFirstPostPublished: true })

    expect(progress.currentStage).toBe('FIRST_POST_DONE')
    expect(progress.stepIndex).toBe(5)
    expect(progress.isCompleted).toBe(true)
  })

  it('ensures deterministic mapping from 7 canonical facts to 5-step user journey without skipping or jumping', () => {
    // Stage counts should increase strictly monotonically
    const steps = [
      computeTutorialJourneyProgress(createMockSnapshot({})),
      computeTutorialJourneyProgress(createMockSnapshot({ BUSINESS_VERIFIED: true, BUSINESS_KNOWLEDGE_CONFIRMED: true })),
      computeTutorialJourneyProgress(createMockSnapshot({ BUSINESS_VERIFIED: true, BUSINESS_KNOWLEDGE_CONFIRMED: true, INSTAGRAM_VERIFIED: true, THREADS_VERIFIED: true })),
      computeTutorialJourneyProgress(createMockSnapshot({ BUSINESS_VERIFIED: true, BUSINESS_KNOWLEDGE_CONFIRMED: true, INSTAGRAM_VERIFIED: true, THREADS_VERIFIED: true, TEXT_HARNESS_CONFIRMED: true })),
      computeTutorialJourneyProgress(createMockSnapshot({ BUSINESS_VERIFIED: true, BUSINESS_KNOWLEDGE_CONFIRMED: true, INSTAGRAM_VERIFIED: true, THREADS_VERIFIED: true, TEXT_HARNESS_CONFIRMED: true, IMAGE_HARNESS_CONFIRMED: true, OPERATING_POLICY_CONFIRMED: true })),
    ]

    expect(steps[0].stepIndex).toBe(1)
    expect(steps[1].stepIndex).toBe(2)
    expect(steps[2].stepIndex).toBe(3)
    expect(steps[3].stepIndex).toBe(4)
    expect(steps[4].stepIndex).toBe(5)
  })
})
