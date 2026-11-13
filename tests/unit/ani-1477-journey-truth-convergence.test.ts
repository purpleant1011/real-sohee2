import { describe, it, expect } from 'vitest'
import {
  computeTutorialJourneyProgress,
  computeTutorialStagesStatus,
} from '@/features/tutorial-journey/tutorial-journey-read-model'
import type {
  SoheeReadinessSnapshot,
  SoheeReadinessFactKey,
  ReadinessFactProvenance,
} from '@/features/sohee-ready/types'

describe('ANI-1477 / R4-12: Tutorial Journey Truth & Stage Convergence', () => {
  function createSnapshot(
    overrides: Partial<Record<SoheeReadinessFactKey, boolean>> = {},
    isReady = false
  ): SoheeReadinessSnapshot {
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

    const ready = isReady || defaultKeys.every((k) => facts[k].verified)

    return {
      workspaceId: 'ws-test-ani-1477',
      ready,
      facts,
      blockers: [],
      evaluatedAt: new Date().toISOString(),
    }
  }

  it('Stage 1 completes when BUSINESS_KNOWLEDGE_CONFIRMED is true even if BUSINESS_VERIFIED is pending', () => {
    // NTS 사업자 진위확인이 비동기 대기 중이지만 사장님이 매장 지식 저장을 마친 상태
    const snapshot = createSnapshot({
      BUSINESS_VERIFIED: false,
      BUSINESS_KNOWLEDGE_CONFIRMED: true,
    })

    const journey = computeTutorialJourneyProgress(snapshot)
    expect(journey.stepIndex).toBe(2)
    expect(journey.currentStage).toBe('CHANNELS_SETUP')
    expect(journey.primaryAction.href).toBe('/start?step=channels')

    const status = computeTutorialStagesStatus(snapshot)
    expect(status.stage1Done).toBe(true)
    expect(status.stage2Done).toBe(false)
    expect(status.completedCount).toBe(1)
  })

  it('calculates completed stages count deterministically across progression', () => {
    // 1. 초기 상태: 완료 0/5
    const initialSnapshot = createSnapshot({})
    const initialStatus = computeTutorialStagesStatus(initialSnapshot)
    expect(initialStatus.stage1Done).toBe(false)
    expect(initialStatus.completedCount).toBe(0)

    // 2. 지식 저장 완료: 완료 1/5
    const stage1Snapshot = createSnapshot({ BUSINESS_KNOWLEDGE_CONFIRMED: true })
    const stage1Status = computeTutorialStagesStatus(stage1Snapshot)
    expect(stage1Status.stage1Done).toBe(true)
    expect(stage1Status.completedCount).toBe(1)

    // 3. 채널 연동 완료 (ANI-1524: 단일 채널만으로도 Stage 2 완료): 완료 2/5
    const stage2IgOnlySnapshot = createSnapshot({
      BUSINESS_KNOWLEDGE_CONFIRMED: true,
      INSTAGRAM_VERIFIED: true,
      THREADS_VERIFIED: false,
    })
    const stage2IgStatus = computeTutorialStagesStatus(stage2IgOnlySnapshot)
    expect(stage2IgStatus.stage1Done).toBe(true)
    expect(stage2IgStatus.stage2Done).toBe(true)
    expect(stage2IgStatus.completedCount).toBe(2)

    // 3-1. 듀얼 채널 연동 완료: 완료 2/5
    const stage2Snapshot = createSnapshot({
      BUSINESS_KNOWLEDGE_CONFIRMED: true,
      INSTAGRAM_VERIFIED: true,
      THREADS_VERIFIED: true,
    })
    const stage2Status = computeTutorialStagesStatus(stage2Snapshot)
    expect(stage2Status.stage1Done).toBe(true)
    expect(stage2Status.stage2Done).toBe(true)
    expect(stage2Status.completedCount).toBe(2)

    // 4. 텍스트 캘리브레이션 완료: 완료 3/5
    const stage3Snapshot = createSnapshot({
      BUSINESS_KNOWLEDGE_CONFIRMED: true,
      INSTAGRAM_VERIFIED: true,
      THREADS_VERIFIED: true,
      TEXT_HARNESS_CONFIRMED: true,
    })
    const stage3Status = computeTutorialStagesStatus(stage3Snapshot)
    expect(stage3Status.completedCount).toBe(3)

    // 5. 이미지 캘리브레이션 완료: 완료 4/5
    const stage4Snapshot = createSnapshot({
      BUSINESS_KNOWLEDGE_CONFIRMED: true,
      INSTAGRAM_VERIFIED: true,
      THREADS_VERIFIED: true,
      TEXT_HARNESS_CONFIRMED: true,
      IMAGE_HARNESS_CONFIRMED: true,
    })
    const stage4Status = computeTutorialStagesStatus(stage4Snapshot)
    expect(stage4Status.completedCount).toBe(4)

    // 6. 전원 준비 완료(SOHEE_READY): 완료 5/5
    const readySnapshot = createSnapshot(
      {
        BUSINESS_VERIFIED: true,
        INSTAGRAM_VERIFIED: true,
        THREADS_VERIFIED: true,
        BUSINESS_KNOWLEDGE_CONFIRMED: true,
        TEXT_HARNESS_CONFIRMED: true,
        IMAGE_HARNESS_CONFIRMED: true,
        OPERATING_POLICY_CONFIRMED: true,
      },
      true
    )
    const readyStatus = computeTutorialStagesStatus(readySnapshot)
    expect(readyStatus.stage5Done).toBe(true)
    expect(readyStatus.completedCount).toBe(5)
  })
})
