import 'server-only'

/**
 * ANI-1882 / V0.94 Task 10: 내부 통제 학습과 다음 임무 계약
 *
 * 기억의 4대 범주 분리:
 * 1. 확정된 가게 사실 (STORE_FACT)
 * 2. 사장님 취향 (OWNER_PREFERENCE)
 * 3. 아직 검증되지 않은 성과 가설 (PERFORMANCE_HYPOTHESIS)
 * 4. 목적·보존정책으로 제한되는 고객 정보 (CUSTOMER_DATA)
 *
 * 핵심 불변식:
 * - 가설은 다음 plan version에만 제한적으로 제안되며, 기존 승인 원고/예산/가격/동의/고객사실을 절대 자동변경하지 않는다 (변경 건수 = 0).
 * - 표본 1건, 미관측, 데이터 부족, 늦은 취소는 결론을 보류(PENDING_FURTHER_OBSERVATION)하며 인과를 단정하지 않는다.
 * - 거절/대체된 가설은 재노출이 억제되며, 테넌트 간 가설/취향 누출은 완전 차단된다.
 */

export type MemoryCategory =
  | 'STORE_FACT'
  | 'OWNER_PREFERENCE'
  | 'PERFORMANCE_HYPOTHESIS'
  | 'CUSTOMER_DATA'

export type SampleConfidence = 'INSUFFICIENT' | 'PRELIMINARY' | 'MODERATE' | 'STRONG'

export type ConclusionState =
  | 'PENDING_FURTHER_OBSERVATION'
  | 'INCONCLUSIVE'
  | 'OBSERVED_CORRELATION'

export interface LearningObservation {
  period: {
    start: string
    end: string
  }
  sampleSize: number
  coverage: string
  baseline: Record<string, unknown> | null
  evidenceRefs: string[]
  summary: string
  channel: string
  metric: {
    bookings: number
    revenueKrw: number
    inboundCount: number
  }
}

export interface LearningInterpretation {
  hypothesis: string
  rationale: string
  sampleConfidence: SampleConfidence
  isCausalAssertion: false // 인과 단정은 항상 불가(통제된 관측 상관에 한함)
  conclusionState: ConclusionState
  whyItWorked?: string
}

export interface LearningProposedImpact {
  targetScope: 'NEXT_PLAN_ONLY'
  targetMetric: string
  expectedImpact: string
  projectedRevenueKrw: number | null
  rollbackVersion: number
}

export interface LearningStopCondition {
  threshold: string
  maxFailureCount: number
  reviewIntervalHours: number
  stopAction: string
}

export interface LearningCandidatePayload {
  id?: string
  workspace_id?: string
  status?: string
  observation: LearningObservation
  interpretation: LearningInterpretation
  proposed_impact: LearningProposedImpact
  stop_condition: LearningStopCondition
}

export interface NextPlanVersionContext {
  workspaceId: string
  currentPlanVersion: number
  appliedLearningCandidateIds: string[]
  draftNotes: string[]
}

export class HypothesisSeparationViolationError extends Error {
  constructor(message: string) {
    super(`[HYPOTHESIS_SEPARATION_VIOLATION] ${message}`)
    this.name = 'HypothesisSeparationViolationError'
  }
}

export class TenantLearningLeakError extends Error {
  constructor(message: string) {
    super(`[TENANT_LEARNING_LEAK] ${message}`)
    this.name = 'TenantLearningLeakError'
  }
}

export class UnapprovedHypothesisApplicationError extends Error {
  constructor(message: string) {
    super(`[UNAPPROVED_HYPOTHESIS_APPLICATION] ${message}`)
    this.name = 'UnapprovedHypothesisApplicationError'
  }
}

/**
 * 표본 수 및 유효 예약 상태, 비교 기준선(baseline) 유무에 따른 결론 보류 및 신뢰도 판정
 * - baseline/비교 관측 없으면 개수와 무관하게 인과/양의 상관/예측수익 단정 금지
 */
export function evaluateSampleSufficiency(params: {
  confirmedBookingsCount: number
  inboundCount: number
  cancelledBookingsCount?: number
  isLateCancellation?: boolean
  hasBaseline?: boolean
}): {
  isSampleSufficient: boolean
  sampleConfidence: SampleConfidence
  conclusionState: ConclusionState
  reason: string
} {
  const {
    confirmedBookingsCount,
    inboundCount,
    cancelledBookingsCount = 0,
    isLateCancellation = false,
    hasBaseline = false,
  } = params

  if (isLateCancellation || (confirmedBookingsCount === 0 && cancelledBookingsCount > 0)) {
    return {
      isSampleSufficient: false,
      sampleConfidence: 'INSUFFICIENT',
      conclusionState: 'INCONCLUSIVE',
      reason: '예약이 취소되었거나 늦은 취소로 인해 성과 결론을 보류합니다.',
    }
  }

  const effectiveSamples = confirmedBookingsCount + inboundCount
  if (effectiveSamples === 0) {
    return {
      isSampleSufficient: false,
      sampleConfidence: 'INSUFFICIENT',
      conclusionState: 'INCONCLUSIVE',
      reason: '관측된 유효 표본이 없어 결론을 도출할 수 없습니다.',
    }
  }

  // 대조군/비교 기준선(baseline)이 없으면 개수와 무관하게 인과 및 양의 상관관계 단정 금지
  if (!hasBaseline) {
    return {
      isSampleSufficient: false,
      sampleConfidence: 'INSUFFICIENT',
      conclusionState: 'PENDING_FURTHER_OBSERVATION',
      reason: `비교 기준선(baseline) 없는 단순 동시 관측(${confirmedBookingsCount}건)이므로 인과 관계 및 양의 상관관계 주장을 보류합니다.`,
    }
  }

  if (confirmedBookingsCount < 30) {
    return {
      isSampleSufficient: false,
      sampleConfidence: 'PRELIMINARY',
      conclusionState: 'PENDING_FURTHER_OBSERVATION',
      reason: `기준선 대비 소규모 표본(${confirmedBookingsCount}건)이므로 추가 관측이 필요합니다.`,
    }
  }

  return {
    isSampleSufficient: true,
    sampleConfidence: 'MODERATE',
    conclusionState: 'OBSERVED_CORRELATION',
    reason: `기준선 대비 유효 표본(${confirmedBookingsCount}건)의 상관 패턴이 관측되었습니다.`,
  }
}

/**
 * 가설 분리 불변식 검증
 * - 가설이 확정 사실(시술, 가격), 사장님 취향, 기존 승인 원고, 동의 내역을 자동 수정하려 하면 차단
 */
export function validateHypothesisSeparation(params: {
  candidate: LearningCandidatePayload
  attemptedMutations?: {
    storeFacts?: Record<string, unknown>
    ownerPreferences?: Record<string, unknown>
    approvedDrafts?: Array<{ id: string; modified: boolean }>
    consents?: Array<{ id: string; modified: boolean }>
  }
}): void {
  const { candidate, attemptedMutations } = params

  if (candidate.proposed_impact.targetScope !== 'NEXT_PLAN_ONLY') {
    throw new HypothesisSeparationViolationError(
      `학습 가설의 적용 범위는 오직 'NEXT_PLAN_ONLY'이어야 합니다 (현재: ${candidate.proposed_impact.targetScope}).`
    )
  }

  if (attemptedMutations) {
    if (attemptedMutations.storeFacts && Object.keys(attemptedMutations.storeFacts).length > 0) {
      throw new HypothesisSeparationViolationError(
        '성과 가설은 확정된 가게 사실(가격, 시술, 영업시간 등)을 자동 변경할 수 없습니다.'
      )
    }
    if (attemptedMutations.ownerPreferences && Object.keys(attemptedMutations.ownerPreferences).length > 0) {
      throw new HypothesisSeparationViolationError(
        '성과 가설은 사장님 고유 취향을 자동 변경할 수 없습니다.'
      )
    }
    if (attemptedMutations.approvedDrafts && attemptedMutations.approvedDrafts.some((d) => d.modified)) {
      throw new HypothesisSeparationViolationError(
        '성과 가설은 과거 이미 승인된 원고를 소급 수정할 수 없습니다.'
      )
    }
    if (attemptedMutations.consents && attemptedMutations.consents.some((c) => c.modified)) {
      throw new HypothesisSeparationViolationError(
        '성과 가설은 고객 동의 내역을 변경할 수 없습니다.'
      )
    }
  }
}

/**
 * 테넌트 격리 보장: Workspace A의 가설이 Workspace B로 침범하는 것을 방지
 */
export function assertTenantIsolation(workspaceIdA: string, workspaceIdB: string): void {
  if (workspaceIdA !== workspaceIdB) {
    throw new TenantLearningLeakError(
      `워크스페이스(${workspaceIdA})의 학습 가설/취향이 다른 워크스페이스(${workspaceIdB})로 누출될 수 없습니다.`
    )
  }
}

/**
 * 승인된 가설을 다음 plan version에만 한정하여 적용
 * - persisted candidate의 승인(approved) 상태 및 workspace_id 일치 엄격 검증
 * - 기존 승인 원고/예산/가격/동의/고객사실 변경 건수 = 0 보장
 */
export function applyApprovedHypothesisToNextPlan(params: {
  workspaceId: string
  candidateId: string
  candidate: LearningCandidatePayload
  currentPlanVersion: number
  existingApprovedDraftsCount: number
}): {
  nextPlanVersion: number
  appliedLearningCandidateId: string
  rollbackVersion: number
  mutatedApprovedDraftsCount: 0
  mutatedStoreFactsCount: 0
  note: string
} {
  const {
    workspaceId,
    candidateId,
    candidate,
    currentPlanVersion,
  } = params

  // 1. Identity & Tenant boundary assertion (Fail-closed)
  if (!candidateId || typeof candidateId !== 'string' || !candidateId.trim()) {
    throw new UnapprovedHypothesisApplicationError(
      '적용 대상 candidateId가 유효하지 않습니다.'
    )
  }

  if (!candidate.id || candidate.id !== candidateId) {
    throw new UnapprovedHypothesisApplicationError(
      `가설 식별자(candidate.id: '${candidate.id ?? ''}')가 요청된 candidateId('${candidateId}')와 일치하지 않거나 누락되었습니다.`
    )
  }

  if (!candidate.workspace_id || typeof candidate.workspace_id !== 'string' || !candidate.workspace_id.trim()) {
    throw new TenantLearningLeakError(
      '가설의 워크스페이스 식별자(workspace_id)가 누락되어 테넌트 격리를 검증할 수 없습니다.'
    )
  }

  assertTenantIsolation(candidate.workspace_id, workspaceId)

  // 2. Persisted status assertion: candidate MUST be strictly 'approved'
  if (candidate.status !== 'approved') {
    throw new UnapprovedHypothesisApplicationError(
      `승인되지 않은 가설(현재 상태: '${candidate.status ?? 'undefined'}')은 다음 계획에 적용할 수 없습니다. 사전 검토 승인이 필요합니다.`
    )
  }

  // 3. Separation invariant
  validateHypothesisSeparation({ candidate })

  return {
    nextPlanVersion: currentPlanVersion + 1,
    appliedLearningCandidateId: candidateId,
    rollbackVersion: currentPlanVersion,
    mutatedApprovedDraftsCount: 0,
    mutatedStoreFactsCount: 0,
    note: `[Plan v${currentPlanVersion + 1}] 승인 가설 '${candidate.interpretation.hypothesis}'이(가) 다음 콘텐츠 기획에만 참고 사항으로 반영되었습니다.`,
  }
}

/**
 * 아직 승인 전인 가설을 초안 아이디어로만 제안하는 순수 헬퍼 (미배선/초안 제안용)
 */
export function proposeHypothesisToNextPlanDraft(params: {
  workspaceId: string
  candidateId: string
  candidate: LearningCandidatePayload
  currentPlanVersion: number
}): {
  targetPlanVersion: number
  candidateId: string
  isDraftProposal: true
  note: string
} {
  const { workspaceId, candidateId, candidate, currentPlanVersion } = params
  if (candidate.workspace_id) {
    assertTenantIsolation(candidate.workspace_id, workspaceId)
  }
  return {
    targetPlanVersion: currentPlanVersion + 1,
    candidateId,
    isDraftProposal: true,
    note: `[초안 제안] 가설 '${candidate.interpretation.hypothesis}' 검토를 다음 계획 v${currentPlanVersion + 1}에 제안합니다.`,
  }
}

/**
 * 거절되거나 보류/대체된 가설 필터링 (반복 재노출 방지)
 */
export function filterSuppressedOrRejectedHypotheses<
  T extends { id: string; status: string; review_reason?: string | null }
>(candidates: T[]): T[] {
  return candidates.filter(
    (c) => c.status !== 'rejected' && c.status !== 'superseded'
  )
}
