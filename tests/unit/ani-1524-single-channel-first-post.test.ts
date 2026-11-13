import { describe, it, expect } from 'vitest'
import {
  evaluateFirstPostReadiness,
} from '@/features/quick-start/first-post-readiness'
import {
  validateFirstPostAdmission,
  proposeFirstPostMission,
  type ProposeFirstPostMissionParams,
} from '@/features/missions/conversational-first-post'
import {
  computeTutorialJourneyProgress,
  computeTutorialStagesStatus,
} from '@/features/tutorial-journey/tutorial-journey-read-model'
import type {
  SoheeReadinessSnapshot,
  SoheeReadinessFactKey,
  ReadinessFactProvenance,
} from '@/features/sohee-ready/types'

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
      verifiedAt: verified ? '2026-10-07T12:00:00Z' : null,
      freshness: verified ? 'FRESH' : 'UNKNOWN',
    } as ReadinessFactProvenance
    return acc
  }, {} as Record<SoheeReadinessFactKey, ReadinessFactProvenance>)

  const ready = isReady || defaultKeys.every((k) => facts[k].verified)

  return {
    workspaceId: 'ws-test-ani-1524',
    ready,
    facts,
    blockers: [],
    evaluatedAt: new Date().toISOString(),
  }
}

describe('ANI-1524: Single Channel First-Post Readiness & Single Read Model Journey Progress', () => {
  describe('1. Server first-post readiness evaluation', () => {
    it('passes first-post readiness with ONLY Instagram verified (Threads unverified)', () => {
      const snapshot = createSnapshot({
        INSTAGRAM_VERIFIED: true,
        THREADS_VERIFIED: false,
        BUSINESS_KNOWLEDGE_CONFIRMED: true,
        TEXT_HARNESS_CONFIRMED: true,
        IMAGE_HARNESS_CONFIRMED: true,
        OPERATING_POLICY_CONFIRMED: true,
      })

      const evaluated = evaluateFirstPostReadiness(snapshot)
      expect(evaluated.ready).toBe(true)
      expect(evaluated.blockers.length).toBe(0)
    })

    it('passes first-post readiness with ONLY Threads verified (Instagram unverified)', () => {
      const snapshot = createSnapshot({
        INSTAGRAM_VERIFIED: false,
        THREADS_VERIFIED: true,
        BUSINESS_KNOWLEDGE_CONFIRMED: true,
        TEXT_HARNESS_CONFIRMED: true,
        IMAGE_HARNESS_CONFIRMED: true,
        OPERATING_POLICY_CONFIRMED: true,
      })

      const evaluated = evaluateFirstPostReadiness(snapshot)
      expect(evaluated.ready).toBe(true)
      expect(evaluated.blockers.length).toBe(0)
    })

    it('fails first-post readiness when neither Instagram nor Threads is verified', () => {
      const snapshot = createSnapshot({
        INSTAGRAM_VERIFIED: false,
        THREADS_VERIFIED: false,
        BUSINESS_KNOWLEDGE_CONFIRMED: true,
        TEXT_HARNESS_CONFIRMED: true,
        IMAGE_HARNESS_CONFIRMED: true,
        OPERATING_POLICY_CONFIRMED: true,
      })

      const evaluated = evaluateFirstPostReadiness(snapshot)
      expect(evaluated.ready).toBe(false)
      expect(evaluated.blockers.some((b) => b.message.includes('하나 이상 연결'))).toBe(true)
    })
  })

  describe('2. validateFirstPostAdmission with single verified channel', () => {
    it('admits mission creation when ONLY Instagram is verified', () => {
      const snapshot = createSnapshot({
        INSTAGRAM_VERIFIED: true,
        THREADS_VERIFIED: false,
        BUSINESS_KNOWLEDGE_CONFIRMED: true,
        TEXT_HARNESS_CONFIRMED: true,
        IMAGE_HARNESS_CONFIRMED: true,
        OPERATING_POLICY_CONFIRMED: true,
      })
      const evaluated = evaluateFirstPostReadiness(snapshot)

      expect(() => {
        validateFirstPostAdmission('ws-test-ani-1524', evaluated)
      }).not.toThrow()
    })

    it('admits mission creation when ONLY Threads is verified', () => {
      const snapshot = createSnapshot({
        INSTAGRAM_VERIFIED: false,
        THREADS_VERIFIED: true,
        BUSINESS_KNOWLEDGE_CONFIRMED: true,
        TEXT_HARNESS_CONFIRMED: true,
        IMAGE_HARNESS_CONFIRMED: true,
        OPERATING_POLICY_CONFIRMED: true,
      })
      const evaluated = evaluateFirstPostReadiness(snapshot)

      expect(() => {
        validateFirstPostAdmission('ws-test-ani-1524', evaluated)
      }).not.toThrow()
    })

    it('throws SoheeNotReadyError when neither channel is verified', () => {
      const snapshot = createSnapshot({
        INSTAGRAM_VERIFIED: false,
        THREADS_VERIFIED: false,
        BUSINESS_KNOWLEDGE_CONFIRMED: true,
        TEXT_HARNESS_CONFIRMED: true,
        IMAGE_HARNESS_CONFIRMED: true,
        OPERATING_POLICY_CONFIRMED: true,
      })
      const evaluated = evaluateFirstPostReadiness(snapshot)

      expect(() => {
        validateFirstPostAdmission('ws-test-ani-1524', evaluated)
      }).toThrow(/SOHEE_NOT_READY/)
    })
  })

  describe('3. Tutorial Journey Progress & Stages Status (Single Read Model)', () => {
    it('marks stage 2 done and moves to TEXT_CALIBRATION with ONLY Instagram verified', () => {
      const snapshot = createSnapshot({
        BUSINESS_KNOWLEDGE_CONFIRMED: true,
        INSTAGRAM_VERIFIED: true,
        THREADS_VERIFIED: false,
      })

      const status = computeTutorialStagesStatus(snapshot)
      expect(status.stage1Done).toBe(true)
      expect(status.stage2Done).toBe(true)
      expect(status.completedCount).toBe(2)

      const journey = computeTutorialJourneyProgress(snapshot)
      expect(journey.stepIndex).toBe(3)
      expect(journey.currentStage).toBe('TEXT_CALIBRATION')
      expect(journey.primaryAction.href).toBe('/app/sohee?tab=training')
    })

    it('marks stage 2 done and moves to TEXT_CALIBRATION with ONLY Threads verified', () => {
      const snapshot = createSnapshot({
        BUSINESS_KNOWLEDGE_CONFIRMED: true,
        INSTAGRAM_VERIFIED: false,
        THREADS_VERIFIED: true,
      })

      const status = computeTutorialStagesStatus(snapshot)
      expect(status.stage1Done).toBe(true)
      expect(status.stage2Done).toBe(true)
      expect(status.completedCount).toBe(2)

      const journey = computeTutorialJourneyProgress(snapshot)
      expect(journey.stepIndex).toBe(3)
      expect(journey.currentStage).toBe('TEXT_CALIBRATION')
      expect(journey.primaryAction.href).toBe('/app/sohee?tab=training')
    })

    it('stays at stage 2 CHANNELS_SETUP only when NEITHER channel is verified', () => {
      const snapshot = createSnapshot({
        BUSINESS_KNOWLEDGE_CONFIRMED: true,
        INSTAGRAM_VERIFIED: false,
        THREADS_VERIFIED: false,
      })

      const status = computeTutorialStagesStatus(snapshot)
      expect(status.stage1Done).toBe(true)
      expect(status.stage2Done).toBe(false)
      expect(status.completedCount).toBe(1)

      const journey = computeTutorialJourneyProgress(snapshot)
      expect(journey.stepIndex).toBe(2)
      expect(journey.currentStage).toBe('CHANNELS_SETUP')
      expect(journey.primaryAction.href).toBe('/start?step=channels')
    })
  })

  describe('4. proposeFirstPostMission integration with single verified channel', () => {
    const baseMissionParams: Omit<ProposeFirstPostMissionParams, 'readiness' | 'connectedChannels'> = {
      workspaceId: 'ws-test-ani-1524',
      callerTenantId: 'ws-test-ani-1524',
      utterance: '오픈 기념 첫 인사와 매장 소개',
      knowledgeSnapshot: {
        businessName: '테스트 베이커리',
        signatureServices: ['소금빵'],
        operatingHours: '09:00 - 20:00',
        versionNumber: 1,
      },
      textHarnessSnapshot: {
        brandVoice: '친근하고 따뜻한 톤',
        versionNumber: 1,
      },
      imageHarnessSnapshot: {
        goldenImageIds: ['asset-golden-1', 'asset-golden-2', 'asset-golden-3'],
        rightsStatus: 'OWNED',
        consentStatus: 'CONFIRMED',
        versionNumber: 1,
      },
      operatingPolicySnapshot: {
        publishApprovalLevel: 'EXACT_APPROVAL',
        versionNumber: 1,
      },
    }

    it('successfully creates draft with ONLY Instagram connected and verified', () => {
      const snapshot = createSnapshot({
        INSTAGRAM_VERIFIED: true,
        THREADS_VERIFIED: false,
        BUSINESS_KNOWLEDGE_CONFIRMED: true,
        TEXT_HARNESS_CONFIRMED: true,
        IMAGE_HARNESS_CONFIRMED: true,
        OPERATING_POLICY_CONFIRMED: true,
      })
      const evaluated = evaluateFirstPostReadiness(snapshot)

      const draft = proposeFirstPostMission({
        ...baseMissionParams,
        readiness: evaluated,
        connectedChannels: [
          { provider: 'instagram', handle: 'test_bakery_ig' },
        ],
      })

      expect(draft.status).toBe('AWAITING_EXACT_APPROVAL')
      expect(draft.channels.length).toBe(1)
      expect(draft.channels[0].provider).toBe('instagram')
      expect(draft.approvalFingerprint).toBeDefined()
      expect(draft.approvalFingerprint.length).toBe(64) // SHA-256 hex
    })

    it('successfully creates draft with ONLY Threads connected and verified', () => {
      const snapshot = createSnapshot({
        INSTAGRAM_VERIFIED: false,
        THREADS_VERIFIED: true,
        BUSINESS_KNOWLEDGE_CONFIRMED: true,
        TEXT_HARNESS_CONFIRMED: true,
        IMAGE_HARNESS_CONFIRMED: true,
        OPERATING_POLICY_CONFIRMED: true,
      })
      const evaluated = evaluateFirstPostReadiness(snapshot)

      const draft = proposeFirstPostMission({
        ...baseMissionParams,
        readiness: evaluated,
        connectedChannels: [
          { provider: 'threads', handle: 'test_bakery_th' },
        ],
      })

      expect(draft.status).toBe('AWAITING_EXACT_APPROVAL')
      expect(draft.channels.length).toBe(1)
      expect(draft.channels[0].provider).toBe('threads')
      expect(draft.approvalFingerprint).toBeDefined()
      expect(draft.approvalFingerprint.length).toBe(64) // SHA-256 hex
    })
  })
})
