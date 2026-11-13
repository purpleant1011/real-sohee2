/**
 * src/features/release-truth/__tests__/release-evidence-manifest.test.ts
 *
 * Tests for ANI-1227, ANI-1226, ANI-1199 Fail-closed Evidence Manifest Generator
 */

import { describe, it, expect } from 'vitest'
import {
  generateReleaseEvidenceManifest,
  scanForSecretLeaks,
  StageEvidenceRecord,
  REQUIRED_GOLDEN_MISSION_STAGES,
} from '../release-evidence-manifest-generator'

const CANONICAL_BYREUM_WS = '00000000-0000-4000-8000-0000000000a2'
const CANONICAL_MISSION_ID = 'm-20260910-byreum-golden-001'
const BASE_TIME = '2026-09-10T05:00:00.000Z'

function createFullVerifiedStages(baseTime: string = BASE_TIME): StageEvidenceRecord[] {
  return REQUIRED_GOLDEN_MISSION_STAGES.map((stageId, idx) => {
    const minutesOffset = idx * 2
    const stageDate = new Date(new Date(baseTime).getTime() - minutesOffset * 60 * 1000)
    return {
      stageId,
      stageName: stageId.replace('STAGE_', ''),
      status: 'VERIFIED',
      workspaceId: CANONICAL_BYREUM_WS,
      missionId: CANONICAL_MISSION_ID,
      observedAt: stageDate.toISOString(),
      sourceRecordId: `rec-${stageId.toLowerCase()}`,
      evidenceRef: `proof://${stageId.toLowerCase()}`,
      details: { stepSuccess: true },
    }
  })
}

describe('Release Evidence Manifest Generator & Fail-closed Gate (ANI-1227, ANI-1226, ANI-1199)', () => {
  it('1. MUST approve release (userReady=true) only when all 8 stages are verified and fresh', () => {
    const stages = createFullVerifiedStages()
    const manifest = generateReleaseEvidenceManifest({
      targetWorkspaceId: CANONICAL_BYREUM_WS,
      targetMissionId: CANONICAL_MISSION_ID,
      manifestGeneratedAt: BASE_TIME,
      stages,
      advisorEvidence: {
        leakedPasswordProtectionStatus: 'EXCEPTION_APPROVED',
        exceptionApprovalReason: 'Supabase dashboard manual toggle scheduled for staging signoff',
        activeSecurityWarnings: 1,
        activePerformanceCriticalWarnings: 0,
      },
      environment: 'production',
    })

    expect(manifest.userReady).toBe(true)
    expect(manifest.overallStatus).toBe('RELEASE_READY')
    expect(manifest.verifiedStages).toBe(8)
    expect(manifest.unverifiedStages).toBe(0)
    expect(manifest.blockers.length).toBe(0)
    expect(manifest.warnings.length).toBe(1)
    expect(manifest.secretLeakScanPassed).toBe(true)
    expect(manifest.freshnessValidationPassed).toBe(true)
    expect(manifest.advisorGatePassed).toBe(true)
  })

  it('2. MUST fail closed (userReady=false) if any stage is NOT_OBSERVED, STALE, or FAILED', () => {
    const stages = createFullVerifiedStages()
    // Stage 5 (Inbound Webhook) is NOT_OBSERVED
    stages[4] = {
      ...stages[4],
      status: 'NOT_OBSERVED',
      failureReason: 'No live inbound webhook recorded from Meta',
    }

    const manifest = generateReleaseEvidenceManifest({
      targetWorkspaceId: CANONICAL_BYREUM_WS,
      targetMissionId: CANONICAL_MISSION_ID,
      manifestGeneratedAt: BASE_TIME,
      stages,
      advisorEvidence: {
        leakedPasswordProtectionStatus: 'RESOLVED',
        activeSecurityWarnings: 0,
        activePerformanceCriticalWarnings: 0,
      },
      environment: 'production',
    })

    expect(manifest.userReady).toBe(false)
    expect(manifest.overallStatus).toBe('RELEASE_BLOCKED')
    expect(manifest.blockers).toContain(
      "Stage Incomplete: STAGE_5_INBOUND_WEBHOOK has status 'NOT_OBSERVED' (Reason: No live inbound webhook recorded from Meta)"
    )
  })

  it('3. MUST fail closed when evidence timestamp is older than maxAllowedAgeMinutes', () => {
    const stages = createFullVerifiedStages()
    // Stage 4 is 5 hours old (300 minutes)
    const oldDate = new Date(new Date(BASE_TIME).getTime() - 300 * 60 * 1000)
    stages[3] = {
      ...stages[3],
      observedAt: oldDate.toISOString(),
    }

    const manifest = generateReleaseEvidenceManifest({
      targetWorkspaceId: CANONICAL_BYREUM_WS,
      targetMissionId: CANONICAL_MISSION_ID,
      manifestGeneratedAt: BASE_TIME,
      maxAllowedAgeMinutes: 60, // 1 hour max
      stages,
      advisorEvidence: {
        leakedPasswordProtectionStatus: 'RESOLVED',
        activeSecurityWarnings: 0,
        activePerformanceCriticalWarnings: 0,
      },
      environment: 'production',
    })

    expect(manifest.userReady).toBe(false)
    expect(manifest.freshnessValidationPassed).toBe(false)
    expect(manifest.blockers.some(b => b.includes('Stale Evidence in STAGE_4_PROVIDER_PUBLISH'))).toBe(true)
  })

  it('4. MUST detect cross-tenant contamination and fail closed', () => {
    const stages = createFullVerifiedStages()
    // Inject demo workspace ID into stage 6
    stages[5] = {
      ...stages[5],
      workspaceId: 'b1000000-0000-4000-8000-000000000001',
    }

    const manifest = generateReleaseEvidenceManifest({
      targetWorkspaceId: CANONICAL_BYREUM_WS,
      targetMissionId: CANONICAL_MISSION_ID,
      manifestGeneratedAt: BASE_TIME,
      stages,
      advisorEvidence: {
        leakedPasswordProtectionStatus: 'RESOLVED',
        activeSecurityWarnings: 0,
        activePerformanceCriticalWarnings: 0,
      },
      environment: 'production',
    })

    expect(manifest.userReady).toBe(false)
    expect(manifest.blockers.some(b => b.includes('Cross-Tenant Isolation Breach'))).toBe(true)
  })

  it('5. MUST fail closed if unredacted API key or Korean phone number leaks in details', () => {
    const stages = createFullVerifiedStages()
    stages[0].details = {
      rawSecret: 'sk-abcdef1234567890123456',
      customerPhone: '010-9876-5432',
    }

    const manifest = generateReleaseEvidenceManifest({
      targetWorkspaceId: CANONICAL_BYREUM_WS,
      targetMissionId: CANONICAL_MISSION_ID,
      manifestGeneratedAt: BASE_TIME,
      stages,
      advisorEvidence: {
        leakedPasswordProtectionStatus: 'RESOLVED',
        activeSecurityWarnings: 0,
        activePerformanceCriticalWarnings: 0,
      },
      environment: 'production',
    })

    expect(manifest.userReady).toBe(false)
    expect(manifest.secretLeakScanPassed).toBe(false)
    expect(manifest.blockers.some(b => b.includes('Security Gate Failed'))).toBe(true)
  })

  it('6. MUST fail closed when Supabase Security Advisor warning is UNRESOLVED', () => {
    const stages = createFullVerifiedStages()

    const manifest = generateReleaseEvidenceManifest({
      targetWorkspaceId: CANONICAL_BYREUM_WS,
      targetMissionId: CANONICAL_MISSION_ID,
      manifestGeneratedAt: BASE_TIME,
      stages,
      advisorEvidence: {
        leakedPasswordProtectionStatus: 'UNRESOLVED',
        activeSecurityWarnings: 1,
        activePerformanceCriticalWarnings: 0,
      },
      environment: 'production',
    })

    expect(manifest.userReady).toBe(false)
    expect(manifest.advisorGatePassed).toBe(false)
    expect(manifest.blockers.some(b => b.includes('Advisor Gate Failed'))).toBe(true)
  })

  it('7. MUST fail closed when manifestGeneratedAt is invalid timestamp', () => {
    const stages = createFullVerifiedStages()

    const manifest = generateReleaseEvidenceManifest({
      targetWorkspaceId: CANONICAL_BYREUM_WS,
      targetMissionId: CANONICAL_MISSION_ID,
      manifestGeneratedAt: 'invalid-manifest-date',
      stages,
      advisorEvidence: {
        leakedPasswordProtectionStatus: 'RESOLVED',
        activeSecurityWarnings: 0,
        activePerformanceCriticalWarnings: 0,
      },
      environment: 'production',
    })

    expect(manifest.userReady).toBe(false)
    expect(manifest.overallStatus).toBe('RELEASE_BLOCKED')
    expect(manifest.freshnessValidationPassed).toBe(false)
    expect(manifest.blockers.some(b => b.includes('Invalid manifestGeneratedAt'))).toBe(true)
  })

  it('8. MUST fail closed when manifestGeneratedAt is in the future', () => {
    const stages = createFullVerifiedStages()
    const futureTime = new Date(Date.now() + 10 * 365 * 24 * 60 * 60 * 1000).toISOString()

    const manifest = generateReleaseEvidenceManifest({
      targetWorkspaceId: CANONICAL_BYREUM_WS,
      targetMissionId: CANONICAL_MISSION_ID,
      manifestGeneratedAt: futureTime,
      stages,
      advisorEvidence: {
        leakedPasswordProtectionStatus: 'RESOLVED',
        activeSecurityWarnings: 0,
        activePerformanceCriticalWarnings: 0,
      },
      environment: 'production',
    })

    expect(manifest.userReady).toBe(false)
    expect(manifest.overallStatus).toBe('RELEASE_BLOCKED')
    expect(manifest.freshnessValidationPassed).toBe(false)
    expect(manifest.blockers.some(b => b.includes('Future manifestGeneratedAt'))).toBe(true)
  })

  it('9. MUST fail closed when stage observedAt is in the future relative to manifestGeneratedAt', () => {
    const stages = createFullVerifiedStages()
    // Stage 1 observed 30 minutes in future after manifest generation
    const futureStageTime = new Date(new Date(BASE_TIME).getTime() + 30 * 60 * 1000).toISOString()
    stages[0] = {
      ...stages[0],
      observedAt: futureStageTime,
    }

    const manifest = generateReleaseEvidenceManifest({
      targetWorkspaceId: CANONICAL_BYREUM_WS,
      targetMissionId: CANONICAL_MISSION_ID,
      manifestGeneratedAt: BASE_TIME,
      stages,
      advisorEvidence: {
        leakedPasswordProtectionStatus: 'RESOLVED',
        activeSecurityWarnings: 0,
        activePerformanceCriticalWarnings: 0,
      },
      environment: 'production',
    })

    expect(manifest.userReady).toBe(false)
    expect(manifest.overallStatus).toBe('RELEASE_BLOCKED')
    expect(manifest.freshnessValidationPassed).toBe(false)
    expect(manifest.blockers.some(b => b.includes('Future Evidence in STAGE_1_PERSISTED_REQUEST'))).toBe(true)
  })

  it('10. MUST fail closed on duplicate stage entries and prevent verifiedStages > totalStages or negative unverifiedStages', () => {
    const stages = createFullVerifiedStages()
    // Add duplicate STAGE_1_PERSISTED_REQUEST making 9 verified stage entries
    stages.push({
      ...stages[0],
      sourceRecordId: 'rec-stage1-duplicate',
    })

    const manifest = generateReleaseEvidenceManifest({
      targetWorkspaceId: CANONICAL_BYREUM_WS,
      targetMissionId: CANONICAL_MISSION_ID,
      manifestGeneratedAt: BASE_TIME,
      stages,
      advisorEvidence: {
        leakedPasswordProtectionStatus: 'RESOLVED',
        activeSecurityWarnings: 0,
        activePerformanceCriticalWarnings: 0,
      },
      environment: 'production',
    })

    expect(manifest.userReady).toBe(false)
    expect(manifest.overallStatus).toBe('RELEASE_BLOCKED')
    expect(manifest.blockers.some(b => b.includes('Duplicate Stage: STAGE_1_PERSISTED_REQUEST'))).toBe(true)
    expect(manifest.verifiedStages).toBeLessThanOrEqual(8)
    expect(manifest.unverifiedStages).toBeGreaterThanOrEqual(0)
    expect(manifest.verifiedStages + manifest.unverifiedStages).toBe(manifest.totalStages)
  })

  it('11. MUST fail closed on unknown stageId outside of Golden Mission stage universe', () => {
    const stages = createFullVerifiedStages()
    // Inject unknown stage
    stages.push({
      stageId: 'STAGE_9_UNKNOWN_EXTERNAL' as any,
      stageName: 'Unknown External Stage',
      status: 'VERIFIED',
      workspaceId: CANONICAL_BYREUM_WS,
      missionId: CANONICAL_MISSION_ID,
      observedAt: BASE_TIME,
    })

    const manifest = generateReleaseEvidenceManifest({
      targetWorkspaceId: CANONICAL_BYREUM_WS,
      targetMissionId: CANONICAL_MISSION_ID,
      manifestGeneratedAt: BASE_TIME,
      stages,
      advisorEvidence: {
        leakedPasswordProtectionStatus: 'RESOLVED',
        activeSecurityWarnings: 0,
        activePerformanceCriticalWarnings: 0,
      },
      environment: 'production',
    })

    expect(manifest.userReady).toBe(false)
    expect(manifest.overallStatus).toBe('RELEASE_BLOCKED')
    expect(manifest.blockers.some(b => b.includes('Unknown Stage: STAGE_9_UNKNOWN_EXTERNAL'))).toBe(true)
    expect(manifest.unverifiedStages).toBeGreaterThanOrEqual(0)
  })

  it('12. MUST fail closed when maxAllowedAgeMinutes is not a finite positive number', () => {
    const stages = createFullVerifiedStages()

    for (const invalidMaxAge of [-10, 0, NaN, Infinity, -Infinity]) {
      const manifest = generateReleaseEvidenceManifest({
        targetWorkspaceId: CANONICAL_BYREUM_WS,
        targetMissionId: CANONICAL_MISSION_ID,
        manifestGeneratedAt: BASE_TIME,
        maxAllowedAgeMinutes: invalidMaxAge,
        stages,
        advisorEvidence: {
          leakedPasswordProtectionStatus: 'RESOLVED',
          activeSecurityWarnings: 0,
          activePerformanceCriticalWarnings: 0,
        },
        environment: 'production',
      })

      expect(manifest.userReady).toBe(false)
      expect(manifest.freshnessValidationPassed).toBe(false)
      expect(manifest.blockers.some(b => b.includes('Invalid maxAllowedAgeMinutes'))).toBe(true)
    }
  })

  it('13. MUST fail closed on malformed input data safely without throwing', () => {
    // @ts-expect-error test malformed null input
    const manifestNull = generateReleaseEvidenceManifest(null)
    expect(manifestNull.userReady).toBe(false)
    expect(manifestNull.overallStatus).toBe('RELEASE_BLOCKED')
    expect(manifestNull.blockers.some(b => b.includes('Malformed Input'))).toBe(true)

    const manifestBadStages = generateReleaseEvidenceManifest({
      targetWorkspaceId: CANONICAL_BYREUM_WS,
      targetMissionId: CANONICAL_MISSION_ID,
      manifestGeneratedAt: BASE_TIME,
      stages: 'not-an-array' as unknown as StageEvidenceRecord[],
      advisorEvidence: {
        leakedPasswordProtectionStatus: 'RESOLVED',
        activeSecurityWarnings: 0,
        activePerformanceCriticalWarnings: 0,
      },
      environment: 'production',
    })
    expect(manifestBadStages.userReady).toBe(false)
    expect(manifestBadStages.blockers.some(b => b.includes('Malformed Stages'))).toBe(true)
  })

  it('14. MUST fail closed when mission-bound stage (STAGE_2+) lacks mission lineage', () => {
    const stages = createFullVerifiedStages()
    // STAGE_2 lacks missionId
    stages[1] = {
      ...stages[1],
      missionId: undefined,
    }

    const manifest = generateReleaseEvidenceManifest({
      targetWorkspaceId: CANONICAL_BYREUM_WS,
      targetMissionId: CANONICAL_MISSION_ID,
      manifestGeneratedAt: BASE_TIME,
      stages,
      advisorEvidence: {
        leakedPasswordProtectionStatus: 'RESOLVED',
        activeSecurityWarnings: 0,
        activePerformanceCriticalWarnings: 0,
      },
      environment: 'production',
    })

    expect(manifest.userReady).toBe(false)
    expect(manifest.blockers.some(b => b.includes('Missing Mission Lineage in STAGE_2_MISSION_SPINE'))).toBe(true)
  })

  it('15. MUST fail closed when VERIFIED stage has neither sourceRecordId nor evidenceRef', () => {
    const stages = createFullVerifiedStages()
    // STAGE_4 has no sourceRecordId and no evidenceRef
    stages[3] = {
      ...stages[3],
      sourceRecordId: '',
      evidenceRef: undefined,
    }

    const manifest = generateReleaseEvidenceManifest({
      targetWorkspaceId: CANONICAL_BYREUM_WS,
      targetMissionId: CANONICAL_MISSION_ID,
      manifestGeneratedAt: BASE_TIME,
      stages,
      advisorEvidence: {
        leakedPasswordProtectionStatus: 'RESOLVED',
        activeSecurityWarnings: 0,
        activePerformanceCriticalWarnings: 0,
      },
      environment: 'production',
    })

    expect(manifest.userReady).toBe(false)
    expect(manifest.blockers.some(b => b.includes('Unsubstantiated Verification in STAGE_4_PROVIDER_PUBLISH'))).toBe(true)
  })

  it('16. MUST fail closed when activeSecurityWarnings > 0 despite leakedPasswordStatus RESOLVED or exceeding exception', () => {
    const stages = createFullVerifiedStages()

    // 16a. activeSecurityWarnings > 0 and RESOLVED
    const manifestResolvedWithWarnings = generateReleaseEvidenceManifest({
      targetWorkspaceId: CANONICAL_BYREUM_WS,
      targetMissionId: CANONICAL_MISSION_ID,
      manifestGeneratedAt: BASE_TIME,
      stages,
      advisorEvidence: {
        leakedPasswordProtectionStatus: 'RESOLVED',
        activeSecurityWarnings: 2,
        activePerformanceCriticalWarnings: 0,
      },
      environment: 'production',
    })
    expect(manifestResolvedWithWarnings.userReady).toBe(false)
    expect(manifestResolvedWithWarnings.advisorGatePassed).toBe(false)
    expect(manifestResolvedWithWarnings.blockers.some(b => b.includes('2 unresolved active security warnings exist'))).toBe(true)

    // 16b. activeSecurityWarnings > 1 and EXCEPTION_APPROVED
    const manifestExcessExceptions = generateReleaseEvidenceManifest({
      targetWorkspaceId: CANONICAL_BYREUM_WS,
      targetMissionId: CANONICAL_MISSION_ID,
      manifestGeneratedAt: BASE_TIME,
      stages,
      advisorEvidence: {
        leakedPasswordProtectionStatus: 'EXCEPTION_APPROVED',
        exceptionApprovalReason: 'Approved for test',
        activeSecurityWarnings: 3,
        activePerformanceCriticalWarnings: 0,
      },
      environment: 'production',
    })
    expect(manifestExcessExceptions.userReady).toBe(false)
    expect(manifestExcessExceptions.advisorGatePassed).toBe(false)
    expect(manifestExcessExceptions.blockers.some(b => b.includes('2 unapproved active security warnings exist beyond approved exception'))).toBe(true)

    // 16c. negative, float or NaN warnings
    const manifestNegativeWarnings = generateReleaseEvidenceManifest({
      targetWorkspaceId: CANONICAL_BYREUM_WS,
      targetMissionId: CANONICAL_MISSION_ID,
      manifestGeneratedAt: BASE_TIME,
      stages,
      advisorEvidence: {
        leakedPasswordProtectionStatus: 'RESOLVED',
        activeSecurityWarnings: -1,
        activePerformanceCriticalWarnings: NaN,
      },
      environment: 'production',
    })
    expect(manifestNegativeWarnings.userReady).toBe(false)
    expect(manifestNegativeWarnings.advisorGatePassed).toBe(false)
    expect(manifestNegativeWarnings.blockers.some(b => b.includes('safe non-negative integer'))).toBe(true)
  })

  it('17. MUST fail closed when targetWorkspaceId or targetMissionId is whitespace-only', () => {
    const stages = createFullVerifiedStages()

    const manifestWhitespace = generateReleaseEvidenceManifest({
      targetWorkspaceId: '   ',
      targetMissionId: ' \t\n ',
      manifestGeneratedAt: BASE_TIME,
      stages,
      advisorEvidence: {
        leakedPasswordProtectionStatus: 'RESOLVED',
        activeSecurityWarnings: 0,
        activePerformanceCriticalWarnings: 0,
      },
      environment: 'production',
    })

    expect(manifestWhitespace.userReady).toBe(false)
    expect(manifestWhitespace.overallStatus).toBe('RELEASE_BLOCKED')
    expect(manifestWhitespace.blockers.some(b => b.includes('Malformed Target Workspace'))).toBe(true)
    expect(manifestWhitespace.blockers.some(b => b.includes('Malformed Target Mission'))).toBe(true)
  })

  it('18. MUST fail closed when advisor leakedPasswordProtectionStatus is unknown or EXCEPTION_APPROVED reason is blank', () => {
    const stages = createFullVerifiedStages()

    // 18a. Unknown enum status
    const manifestUnknownStatus = generateReleaseEvidenceManifest({
      targetWorkspaceId: CANONICAL_BYREUM_WS,
      targetMissionId: CANONICAL_MISSION_ID,
      manifestGeneratedAt: BASE_TIME,
      stages,
      advisorEvidence: {
        leakedPasswordProtectionStatus: 'UNKNOWN_STATUS' as any,
        activeSecurityWarnings: 1,
        activePerformanceCriticalWarnings: 0,
      },
      environment: 'production',
    })
    expect(manifestUnknownStatus.userReady).toBe(false)
    expect(manifestUnknownStatus.advisorGatePassed).toBe(false)
    expect(manifestUnknownStatus.blockers.some(b => b.includes('leakedPasswordProtectionStatus must be one of'))).toBe(true)

    // 18b. EXCEPTION_APPROVED with blank reason
    const manifestBlankReason = generateReleaseEvidenceManifest({
      targetWorkspaceId: CANONICAL_BYREUM_WS,
      targetMissionId: CANONICAL_MISSION_ID,
      manifestGeneratedAt: BASE_TIME,
      stages,
      advisorEvidence: {
        leakedPasswordProtectionStatus: 'EXCEPTION_APPROVED',
        exceptionApprovalReason: '   \t  ',
        activeSecurityWarnings: 1,
        activePerformanceCriticalWarnings: 0,
      },
      environment: 'production',
    })
    expect(manifestBlankReason.userReady).toBe(false)
    expect(manifestBlankReason.advisorGatePassed).toBe(false)
    expect(manifestBlankReason.blockers.some(b => b.includes('EXCEPTION_APPROVED requires a non-blank exceptionApprovalReason'))).toBe(true)

    // 18c. Non-integer float warning counts
    const manifestFloatWarnings = generateReleaseEvidenceManifest({
      targetWorkspaceId: CANONICAL_BYREUM_WS,
      targetMissionId: CANONICAL_MISSION_ID,
      manifestGeneratedAt: BASE_TIME,
      stages,
      advisorEvidence: {
        leakedPasswordProtectionStatus: 'RESOLVED',
        activeSecurityWarnings: 1.5,
        activePerformanceCriticalWarnings: 0,
      },
      environment: 'production',
    })
    expect(manifestFloatWarnings.userReady).toBe(false)
    expect(manifestFloatWarnings.advisorGatePassed).toBe(false)
    expect(manifestFloatWarnings.blockers.some(b => b.includes('safe non-negative integer'))).toBe(true)
  })
})
