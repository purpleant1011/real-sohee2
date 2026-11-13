/**
 * src/features/release-truth/release-evidence-manifest-generator.ts
 *
 * Wave 5 · Fail-closed Release Evidence Manifest Generator (ANI-1227, ANI-1226, ANI-1199)
 *
 * Core Principle:
 * CODE_COMPLETE != VERIFIED != RELEASE_READY != DONE.
 * If any single required stage in the 8-stage Golden Mission chain is
 * NOT_OBSERVED, STALE, BLOCKED, FAILED, or UNKNOWN, the manifest generator
 * MUST fail closed (userReady: false).
 */

export type EvidenceStageStatus =
  | 'VERIFIED'
  | 'NOT_OBSERVED'
  | 'STALE'
  | 'BLOCKED'
  | 'FAILED'
  | 'UNKNOWN'

export type GoldenMissionStageId =
  | 'STAGE_1_PERSISTED_REQUEST'
  | 'STAGE_2_MISSION_SPINE'
  | 'STAGE_3_EXACT_APPROVAL'
  | 'STAGE_4_PROVIDER_PUBLISH'
  | 'STAGE_5_INBOUND_WEBHOOK'
  | 'STAGE_6_BOOKING_CONFIRMED'
  | 'STAGE_7_OUTCOME_ATTRIBUTION'
  | 'STAGE_8_SAME_TRUTH_PROJECTION'

export interface StageEvidenceRecord {
  stageId: GoldenMissionStageId
  stageName: string
  status: EvidenceStageStatus
  workspaceId: string
  missionId?: string
  observedAt: string // ISO-8601
  sourceRecordId?: string
  evidenceRef?: string
  details?: Record<string, unknown>
  failureReason?: string
}

export interface SecurityAdvisorEvidence {
  leakedPasswordProtectionStatus: 'RESOLVED' | 'EXCEPTION_APPROVED' | 'UNRESOLVED'
  exceptionApprovalReason?: string
  activeSecurityWarnings: number
  activePerformanceCriticalWarnings: number
}

export interface ReleaseEvidenceManifestInput {
  targetWorkspaceId: string
  targetMissionId: string
  manifestGeneratedAt: string // ISO-8601
  maxAllowedAgeMinutes?: number // Default: 120 minutes
  stages: StageEvidenceRecord[]
  advisorEvidence: SecurityAdvisorEvidence
  environment: 'production' | 'staging' | 'development'
}

export interface ReleaseEvidenceManifest {
  manifestVersion: '13.0.0-golden'
  manifestGeneratedAt: string
  environment: 'production' | 'staging' | 'development'
  targetWorkspaceId: string
  targetMissionId: string
  userReady: boolean
  overallStatus: 'RELEASE_READY' | 'RELEASE_BLOCKED'
  totalStages: number
  verifiedStages: number
  unverifiedStages: number
  stages: Record<GoldenMissionStageId, StageEvidenceRecord>
  blockers: string[]
  warnings: string[]
  secretLeakScanPassed: boolean
  freshnessValidationPassed: boolean
  advisorGatePassed: boolean
}

export const REQUIRED_GOLDEN_MISSION_STAGES: GoldenMissionStageId[] = [
  'STAGE_1_PERSISTED_REQUEST',
  'STAGE_2_MISSION_SPINE',
  'STAGE_3_EXACT_APPROVAL',
  'STAGE_4_PROVIDER_PUBLISH',
  'STAGE_5_INBOUND_WEBHOOK',
  'STAGE_6_BOOKING_CONFIRMED',
  'STAGE_7_OUTCOME_ATTRIBUTION',
  'STAGE_8_SAME_TRUTH_PROJECTION',
]

/**
 * Validates whether string contains unredacted secrets or PII.
 */
export function scanForSecretLeaks(data: unknown): { passed: boolean; leakSummary?: string } {
  const serialized = JSON.stringify(data)
  if (!serialized) return { passed: true }

  // 1. API Keys and Tokens
  if (/\bsk-[a-zA-Z0-9_-]{10,}\b/.test(serialized)) {
    return { passed: false, leakSummary: 'Unredacted OpenAI API Key detected' }
  }
  if (/\bAIzaSy[a-zA-Z0-9_-]{10,}\b/.test(serialized)) {
    return { passed: false, leakSummary: 'Unredacted Google API Key detected' }
  }
  if (/\bEAA[a-zA-Z0-9]{10,}\b/.test(serialized)) {
    return { passed: false, leakSummary: 'Unredacted Meta Token detected' }
  }
  if (/Bearer\s+[a-zA-Z0-9_.-]{15,}/.test(serialized)) {
    return { passed: false, leakSummary: 'Unredacted Bearer Token detected' }
  }

  // 2. Raw phone numbers (e.g. 010-1234-5678 or 01012345678)
  if (/\b01[016789]-?[0-9]{4}-?[0-9]{4}\b/.test(serialized)) {
    return { passed: false, leakSummary: 'Unredacted Korean phone number detected' }
  }

  return { passed: true }
}

/**
 * Pure fail-closed manifest generator function.
 */
export function generateReleaseEvidenceManifest(
  input: ReleaseEvidenceManifestInput
): ReleaseEvidenceManifest {
  if (!input || typeof input !== 'object') {
    return {
      manifestVersion: '13.0.0-golden',
      manifestGeneratedAt: new Date().toISOString(),
      environment: 'development',
      targetWorkspaceId: '',
      targetMissionId: '',
      userReady: false,
      overallStatus: 'RELEASE_BLOCKED',
      totalStages: REQUIRED_GOLDEN_MISSION_STAGES.length,
      verifiedStages: 0,
      unverifiedStages: REQUIRED_GOLDEN_MISSION_STAGES.length,
      stages: {} as Record<GoldenMissionStageId, StageEvidenceRecord>,
      blockers: ['Malformed Input: input must be a non-null object'],
      warnings: [],
      secretLeakScanPassed: false,
      freshnessValidationPassed: false,
      advisorGatePassed: false,
    }
  }

  const rawMaxAge = input.maxAllowedAgeMinutes
  const maxAgeMinutes = rawMaxAge === undefined ? 120 : rawMaxAge
  const blockers: string[] = []
  const warnings: string[] = []

  let freshnessValidationPassed = true
  let secretLeakScanPassed = true
  let advisorGatePassed = true

  // Validate maxAllowedAgeMinutes
  if (typeof maxAgeMinutes !== 'number' || !Number.isFinite(maxAgeMinutes) || maxAgeMinutes <= 0) {
    blockers.push(
      `Invalid maxAllowedAgeMinutes: must be a finite positive number (received ${rawMaxAge})`
    )
    freshnessValidationPassed = false
  }

  // Validate manifestGeneratedAt timestamp
  const now =
    typeof input.manifestGeneratedAt === 'string'
      ? new Date(input.manifestGeneratedAt).getTime()
      : NaN
  const isNowValid = !isNaN(now) && Number.isFinite(now)
  if (!isNowValid) {
    blockers.push(`Invalid manifestGeneratedAt timestamp: ${input.manifestGeneratedAt}`)
    freshnessValidationPassed = false
  } else {
    const wallClockNow = Date.now()
    if (now > wallClockNow + 60_000) {
      blockers.push(
        `Future manifestGeneratedAt timestamp: ${input.manifestGeneratedAt} is in the future of current wall clock`
      )
      freshnessValidationPassed = false
    }
  }

  // Validate workspace & mission IDs
  if (
    !input.targetWorkspaceId ||
    typeof input.targetWorkspaceId !== 'string' ||
    input.targetWorkspaceId.trim().length === 0
  ) {
    blockers.push('Malformed Target Workspace: targetWorkspaceId must be a non-empty string')
  }
  if (
    !input.targetMissionId ||
    typeof input.targetMissionId !== 'string' ||
    input.targetMissionId.trim().length === 0
  ) {
    blockers.push('Malformed Target Mission: targetMissionId must be a non-empty string')
  }

  // 1. Advisor Gate Check
  if (!input.advisorEvidence || typeof input.advisorEvidence !== 'object') {
    blockers.push('Advisor Gate Failed: advisorEvidence missing or malformed')
    advisorGatePassed = false
  } else {
    const {
      activeSecurityWarnings,
      activePerformanceCriticalWarnings,
      leakedPasswordProtectionStatus,
      exceptionApprovalReason,
    } = input.advisorEvidence

    const isSecurityWarningsValid =
      typeof activeSecurityWarnings === 'number' &&
      Number.isSafeInteger(activeSecurityWarnings) &&
      activeSecurityWarnings >= 0
    if (!isSecurityWarningsValid) {
      blockers.push(
        `Advisor Gate Failed: activeSecurityWarnings must be a safe non-negative integer (received ${activeSecurityWarnings})`
      )
      advisorGatePassed = false
    }

    const isPerformanceWarningsValid =
      typeof activePerformanceCriticalWarnings === 'number' &&
      Number.isSafeInteger(activePerformanceCriticalWarnings) &&
      activePerformanceCriticalWarnings >= 0
    if (!isPerformanceWarningsValid) {
      blockers.push(
        `Advisor Gate Failed: activePerformanceCriticalWarnings must be a safe non-negative integer (received ${activePerformanceCriticalWarnings})`
      )
      advisorGatePassed = false
    }

    const KNOWN_ADVISOR_STATUSES = ['RESOLVED', 'EXCEPTION_APPROVED', 'UNRESOLVED']
    if (!KNOWN_ADVISOR_STATUSES.includes(leakedPasswordProtectionStatus)) {
      blockers.push(
        `Advisor Gate Failed: leakedPasswordProtectionStatus must be one of 'RESOLVED', 'EXCEPTION_APPROVED', 'UNRESOLVED' (received '${leakedPasswordProtectionStatus}')`
      )
      advisorGatePassed = false
    } else if (leakedPasswordProtectionStatus === 'EXCEPTION_APPROVED') {
      if (
        !exceptionApprovalReason ||
        typeof exceptionApprovalReason !== 'string' ||
        exceptionApprovalReason.trim().length === 0
      ) {
        blockers.push(
          'Advisor Gate Failed: EXCEPTION_APPROVED requires a non-blank exceptionApprovalReason'
        )
        advisorGatePassed = false
      } else {
        warnings.push(
          `Advisor Gate Notice: Leaked Password Protection held under approved exception: ${exceptionApprovalReason.trim()}`
        )
      }
    }

    if (isSecurityWarningsValid && activeSecurityWarnings > 0) {
      if (leakedPasswordProtectionStatus === 'UNRESOLVED') {
        blockers.push(
          'Advisor Gate Failed: Leaked Password Protection warning is unresolved and unapproved'
        )
        advisorGatePassed = false
      } else if (leakedPasswordProtectionStatus === 'EXCEPTION_APPROVED') {
        if (activeSecurityWarnings > 1) {
          blockers.push(
            `Advisor Gate Failed: ${activeSecurityWarnings - 1} unapproved active security warnings exist beyond approved exception`
          )
          advisorGatePassed = false
        }
      } else if (leakedPasswordProtectionStatus === 'RESOLVED') {
        blockers.push(
          `Advisor Gate Failed: ${activeSecurityWarnings} unresolved active security warnings exist`
        )
        advisorGatePassed = false
      } else {
        blockers.push(
          `Advisor Gate Failed: active security warnings exist with invalid or unhandled leakedPasswordProtectionStatus '${leakedPasswordProtectionStatus}'`
        )
        advisorGatePassed = false
      }
    }

    if (isPerformanceWarningsValid && activePerformanceCriticalWarnings > 0) {
      blockers.push(
        `Advisor Gate Failed: ${activePerformanceCriticalWarnings} performance critical warnings exist`
      )
      advisorGatePassed = false
    }
  }

  // 2. Stage Map Creation & Invariant Checks
  const stageMap: Partial<Record<GoldenMissionStageId, StageEvidenceRecord>> = {}
  const seenStageIds = new Set<string>()
  const KNOWN_STAGES = new Set<string>(REQUIRED_GOLDEN_MISSION_STAGES)

  if (!Array.isArray(input.stages)) {
    blockers.push('Malformed Stages: stages must be an array')
  } else {
    for (const stage of input.stages) {
      if (!stage || typeof stage !== 'object' || !stage.stageId) {
        blockers.push('Malformed Stage Record: each stage must be an object with stageId')
        continue
      }

      // Check known stage universe
      if (!KNOWN_STAGES.has(stage.stageId)) {
        blockers.push(
          `Unknown Stage: ${stage.stageId} is not in the required Golden Mission stage universe`
        )
        continue
      }

      // Check stage uniqueness
      if (seenStageIds.has(stage.stageId)) {
        blockers.push(
          `Duplicate Stage: ${stage.stageId} is present multiple times in evidence bundle`
        )
        continue
      }
      seenStageIds.add(stage.stageId)
      stageMap[stage.stageId] = stage

      // Check workspace isolation
      if (stage.workspaceId !== input.targetWorkspaceId) {
        blockers.push(
          `Cross-Tenant Isolation Breach in ${stage.stageId}: stage workspace ${stage.workspaceId} does not match target ${input.targetWorkspaceId}`
        )
      }

      // Check mission ID consistency and lineage
      if (stage.missionId && stage.missionId !== input.targetMissionId) {
        blockers.push(
          `Mission Lineage Breach in ${stage.stageId}: stage mission ${stage.missionId} does not match target ${input.targetMissionId}`
        )
      } else if (stage.status === 'VERIFIED' && stage.stageId !== 'STAGE_1_PERSISTED_REQUEST') {
        if (!stage.missionId || typeof stage.missionId !== 'string' || stage.missionId.trim().length === 0) {
          blockers.push(
            `Missing Mission Lineage in ${stage.stageId}: stage must be bound to target mission ${input.targetMissionId}`
          )
        }
      }

      // Check evidence substantiation for VERIFIED stages
      if (stage.status === 'VERIFIED') {
        const hasRecordId = typeof stage.sourceRecordId === 'string' && stage.sourceRecordId.trim().length > 0
        const hasEvidenceRef = typeof stage.evidenceRef === 'string' && stage.evidenceRef.trim().length > 0
        if (!hasRecordId && !hasEvidenceRef) {
          blockers.push(
            `Unsubstantiated Verification in ${stage.stageId}: VERIFIED stage must have sourceRecordId or evidenceRef`
          )
        }
      }

      // Check freshness & valid timestamp
      const stageTime =
        typeof stage.observedAt === 'string' ? new Date(stage.observedAt).getTime() : NaN
      if (isNaN(stageTime) || !Number.isFinite(stageTime)) {
        blockers.push(`Invalid timestamp in ${stage.stageId}: ${stage.observedAt}`)
        freshnessValidationPassed = false
      } else if (isNowValid && stageTime > now) {
        blockers.push(
          `Future Evidence in ${stage.stageId}: observedAt ${stage.observedAt} is in the future relative to manifestGeneratedAt ${input.manifestGeneratedAt}`
        )
        freshnessValidationPassed = false
      } else if (
        isNowValid &&
        typeof maxAgeMinutes === 'number' &&
        Number.isFinite(maxAgeMinutes) &&
        maxAgeMinutes > 0
      ) {
        const ageMinutes = (now - stageTime) / (1000 * 60)
        if (ageMinutes > maxAgeMinutes) {
          blockers.push(
            `Stale Evidence in ${stage.stageId}: observed ${Math.round(ageMinutes)}m ago (exceeds ${maxAgeMinutes}m max)`
          )
          freshnessValidationPassed = false
        }
      } else if (!isNowValid) {
        freshnessValidationPassed = false
      }

      // Check Status
      if (stage.status !== 'VERIFIED') {
        blockers.push(
          `Stage Incomplete: ${stage.stageId} has status '${stage.status}' (Reason: ${stage.failureReason || 'Not fully verified'})`
        )
      }
    }
  }

  // Check all required 8 stages exist
  for (const requiredId of REQUIRED_GOLDEN_MISSION_STAGES) {
    if (!stageMap[requiredId]) {
      blockers.push(`Missing Required Stage: ${requiredId} was NOT_OBSERVED in evidence bundle`)
      stageMap[requiredId] = {
        stageId: requiredId,
        stageName: requiredId,
        status: 'NOT_OBSERVED',
        workspaceId: input.targetWorkspaceId,
        observedAt: isNowValid ? input.manifestGeneratedAt : new Date().toISOString(),
        failureReason: 'Stage not submitted in evidence bundle',
      }
    }
  }

  // Count verified stages strictly over REQUIRED_GOLDEN_MISSION_STAGES
  let verifiedCount = 0
  for (const requiredId of REQUIRED_GOLDEN_MISSION_STAGES) {
    const record = stageMap[requiredId]
    if (record && record.status === 'VERIFIED') {
      verifiedCount++
    }
  }
  const totalStages = REQUIRED_GOLDEN_MISSION_STAGES.length
  const unverifiedStages = Math.max(0, totalStages - verifiedCount)

  // 3. Secret Leak Scan across all stage details
  if (Array.isArray(input.stages)) {
    const leakResult = scanForSecretLeaks(input.stages)
    if (!leakResult.passed) {
      blockers.push(`Security Gate Failed: ${leakResult.leakSummary}`)
      secretLeakScanPassed = false
    }
  } else {
    secretLeakScanPassed = false
  }

  // 4. Determine overall readiness
  const userReady = blockers.length === 0

  return {
    manifestVersion: '13.0.0-golden',
    manifestGeneratedAt: input.manifestGeneratedAt,
    environment: input.environment,
    targetWorkspaceId: input.targetWorkspaceId,
    targetMissionId: input.targetMissionId,
    userReady,
    overallStatus: userReady ? 'RELEASE_READY' : 'RELEASE_BLOCKED',
    totalStages,
    verifiedStages: verifiedCount,
    unverifiedStages,
    stages: stageMap as Record<GoldenMissionStageId, StageEvidenceRecord>,
    blockers,
    warnings,
    secretLeakScanPassed,
    freshnessValidationPassed,
    advisorGatePassed,
  }
}
