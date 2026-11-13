import type {
  MarketingMissionAggregate,
  MissionStatus,
  ExecutionState,
  OutcomeState,
  ObservationStatus,
  MissionContract,
  ObservationEvidence,
} from './mission-types'
export type {
  MarketingMissionAggregate,
  MissionStatus,
  ExecutionState,
  OutcomeState,
  ObservationStatus,
  MissionContract,
  ObservationEvidence,
} from './mission-types'
export {
  getHonestExecutionProgressText,
  getObservationDisplayBadge,
  type ExecutionProgressInput,
  type ObservationDisplayKind,
  type ObservationDisplayBadge,
} from './mission-display-helpers'
import { mapLegacyStatusToDualState } from './mission-state-machine'

export interface OwnerMissionSummary {
  missionId: string
  workspaceId: string
  canonicalStatus: MissionStatus
  status: MissionStatus // Alias
  displayBadgeText: string
  goal: string
  targetChannel?: string | null
  requiresOwnerAction: boolean
  isBlocked: boolean
  createdAt: string
  updatedAt: string
}

export interface AdminMissionTimeline {
  missionId: string
  workspaceId: string
  traceId: string
  canonicalStatus: MissionStatus
  status: MissionStatus // Alias
  goal: string
  strategySummary?: string | null
  targetChannel?: string | null
  targetAudience?: string | null
  requiresOwnerAction: boolean
  isBlocked: boolean
  contentId?: string | null
  contentVersionId?: string | null
  approvalId?: string | null
  externalRequestId?: string | null
  externalReceiptId?: string | null
  customerId?: string | null
  bookingId?: string | null
  outcomeId?: string | null
  nextActionId?: string | null
  providerVerified: boolean
  createdAt: string
  updatedAt: string
}

export type OwnerMissionView = OwnerMissionSummary
export type AdminMissionView = AdminMissionTimeline

export const OWNER_STATUS_BADGE_TEXT: Record<MissionStatus, string> = {
  RECEIVED: '새 마케팅 지시 수신',
  PLANNING: '마케팅 전략 수립 중',
  PRODUCING: '소희가 콘텐츠 제작 중',
  AWAITING_APPROVAL: '사장님 승인 대기 중',
  APPROVED: '승인 완료 (발행 대기)',
  EXECUTING: '소희가 발행 진행 중',
  PUBLISHED_VERIFIED: '발행 및 게시 확인 완료',
  LISTENING: '댓글/DM 반응 실시간 감지 중',
  CUSTOMER_ENGAGED: '고객과 대화/문의 상담 중',
  BOOKING_INTENT: '예약 의사 파악 (시간 조율 중)',
  BOOKED: '실제 예약 확정 완료',
  OUTCOME_OBSERVED: '방문/매출 성과 관측됨',
  LEARNING: '성과 분석 및 노하우 학습 중',
  NEXT_ACTION_READY: '다음 추천 액션 준비됨',
  COMPLETED: '업무 완료',
  BLOCKED: '진행 차단 (조치 필요)',
  FAILED: '일시 실패 (재시도 가능)',
  RESULT_UNKNOWN: '외부 발행 결과 확인 중 (중복 방지 락)',
  PAUSED: '일시 정지됨',
  CANCELLED: '취소됨',
}

function hasPublicationReadback(aggregate: MarketingMissionAggregate): boolean {
  const receipt = aggregate.external_action_receipt_id
  const confirmedAt = aggregate.metadata?.readbackConfirmedAt
  return typeof receipt === 'string' && receipt.trim().length > 0
    && typeof confirmedAt === 'string' && Number.isFinite(Date.parse(confirmedAt))
}

function publicationDisplayPending(aggregate: MarketingMissionAggregate): boolean {
  return aggregate.status === 'PUBLISHED_VERIFIED' && !hasPublicationReadback(aggregate)
}

export function buildOwnerMissionSummary(aggregate: MarketingMissionAggregate): OwnerMissionSummary {
  const isPostApproval =
    aggregate.status === 'APPROVED' ||
    aggregate.status === 'EXECUTING' ||
    aggregate.status === 'PUBLISHED_VERIFIED' ||
    aggregate.status === 'COMPLETED'

  const requiresOwnerAction =
    aggregate.status === 'AWAITING_APPROVAL' ||
    (!isPostApproval && Boolean(aggregate.metadata?.owner_action_required))

  const isBlocked = aggregate.status === 'BLOCKED'

  return {
    missionId: aggregate.id,
    workspaceId: aggregate.workspace_id,
    canonicalStatus: aggregate.status,
    status: aggregate.status,
    displayBadgeText: publicationDisplayPending(aggregate) ? '외부 게시 확인 필요' : OWNER_STATUS_BADGE_TEXT[aggregate.status] || '확인 중',
    goal: aggregate.goal,
    targetChannel: aggregate.target_channel,
    requiresOwnerAction,
    isBlocked,
    createdAt: aggregate.created_at,
    updatedAt: aggregate.updated_at,
  }
}

export function buildAdminMissionTimeline(aggregate: MarketingMissionAggregate): AdminMissionTimeline {
  const isProviderVerified = hasPublicationReadback(aggregate)

  const isPostApproval =
    aggregate.status === 'APPROVED' ||
    aggregate.status === 'EXECUTING' ||
    aggregate.status === 'PUBLISHED_VERIFIED' ||
    aggregate.status === 'COMPLETED'

  const requiresOwnerAction =
    aggregate.status === 'AWAITING_APPROVAL' ||
    (!isPostApproval && Boolean(aggregate.metadata?.owner_action_required))

  const isBlocked = aggregate.status === 'BLOCKED'

  return {
    missionId: aggregate.id,
    workspaceId: aggregate.workspace_id,
    traceId: aggregate.trace_id,
    canonicalStatus: aggregate.status,
    status: aggregate.status,
    goal: aggregate.goal,
    strategySummary: aggregate.strategy_summary,
    targetChannel: aggregate.target_channel,
    targetAudience: aggregate.target_audience,
    requiresOwnerAction,
    isBlocked,
    contentId: aggregate.content_id,
    contentVersionId: aggregate.content_version_id,
    approvalId: aggregate.approval_id,
    externalRequestId: aggregate.external_action_request_id,
    externalReceiptId: aggregate.external_action_receipt_id,
    customerId: aggregate.customer_id,
    bookingId: aggregate.booking_id,
    outcomeId: aggregate.outcome_id,
    nextActionId: aggregate.next_action_id,
    providerVerified: isProviderVerified,
    createdAt: aggregate.created_at,
    updatedAt: aggregate.updated_at,
  }
}

export interface AgentMissionContext {
  missionId: string
  workspaceId: string
  traceId: string
  canonicalStatus: MissionStatus
  executionState: ExecutionState
  outcomeState: OutcomeState
  goal: string
  currentPhaseGoal: string
  lastObservedEvidence: string | null
  nextAllowedActions: string[]
  isBlocked: boolean
}

export function buildAgentMissionContext(
  aggregate: MarketingMissionAggregate,
  nowIso = new Date().toISOString()
): AgentMissionContext {
  const currentPhaseGoal = OWNER_STATUS_BADGE_TEXT[aggregate.status] || aggregate.goal
  const { executionState, outcomeState } = mapLegacyStatusToDualState(aggregate.status, aggregate.metadata)
  const contract = (aggregate.metadata?.contract as MissionContract) || null

  let lastObservedEvidence: string | null = null
  if (aggregate.external_action_receipt_id) {
    lastObservedEvidence = `Provider Receipt: ${aggregate.external_action_receipt_id}`
  } else if (aggregate.approval_id) {
    lastObservedEvidence = `Approval Confirmed: ${aggregate.approval_id}`
  } else if (aggregate.content_id) {
    lastObservedEvidence = `Content Created: ${aggregate.content_id}`
  }

  const nextAllowedActions: string[] = []

  // Check deadline
  const isExpired = contract ? Date.parse(nowIso) > Date.parse(contract.expires_at) : false

  if (executionState === 'PAUSED' || executionState === 'PAUSING') {
    // Only resume, readback, and reconciliation allowed
    nextAllowedActions.push('RESUME_MISSION', 'READBACK_EXTERNAL', 'RECONCILE_ACCOUNTS')
  } else if (executionState === 'STOPPED' || executionState === 'CLOSED' || isExpired) {
    // Mutations blocked; readback, financial reconciliation, and observation permitted
    nextAllowedActions.push('READBACK_EXTERNAL', 'RECONCILE_ACCOUNTS', 'OBSERVE_OUTCOME')
  } else {
    // Normal active execution flow
    if (aggregate.status === 'RECEIVED' || aggregate.status === 'PLANNING') {
      nextAllowedActions.push('PRODUCE_CONTENT', 'CREATE_PLAN')
    } else if (aggregate.status === 'PRODUCING') {
      nextAllowedActions.push('REQUEST_APPROVAL', 'EXECUTE_AUTONOMOUS')
    } else if (aggregate.status === 'AWAITING_APPROVAL') {
      nextAllowedActions.push('WAIT_FOR_OWNER', 'EDIT_CONTENT')
    } else if (aggregate.status === 'APPROVED') {
      nextAllowedActions.push('EXECUTE_PUBLISH')
    } else if (aggregate.status === 'PUBLISHED_VERIFIED') {
      nextAllowedActions.push('START_LISTENING')
    } else if (aggregate.status === 'LISTENING' || aggregate.status === 'CUSTOMER_ENGAGED') {
      nextAllowedActions.push('REPLY_CUSTOMER', 'PROPOSE_SLOT')
    } else if (aggregate.status === 'BOOKING_INTENT') {
      nextAllowedActions.push('CONFIRM_BOOKING')
    } else if (aggregate.status === 'BOOKED') {
      nextAllowedActions.push('OBSERVE_OUTCOME')
    }
  }

  return {
    missionId: aggregate.id,
    workspaceId: aggregate.workspace_id,
    traceId: aggregate.trace_id,
    canonicalStatus: aggregate.status,
    executionState,
    outcomeState,
    goal: aggregate.goal,
    currentPhaseGoal,
    lastObservedEvidence,
    nextAllowedActions,
    isBlocked: aggregate.status === 'BLOCKED',
  }
}

export interface CanonicalMissionDTO {
  missionId: string
  mission_id: string
  workspaceId: string
  traceId: string
  snapshotVersion: number
  snapshot_version: number
  planVersion: number
  plan_version: number
  executionState: ExecutionState
  execution_state: ExecutionState
  outcomeState: OutcomeState
  outcome_state: OutcomeState
  canonicalStatus: MissionStatus
  userBadge: string
  userCopy: string
  goal: string
  targetChannel: string | null
  requiresOwnerAction: boolean
  isBlocked: boolean
  nextCheckAt: string | null
  observationStatus: ObservationStatus
  observedValue: number | null
  permittedActions: string[]
  permitted_actions: string[]
  errors: string[]
  createdAt: string
  updatedAt: string
}

/**
 * Derives end-user copy without exposing internal raw metadata, SHA, or UUIDs.
 */
function deriveUserFriendlyCopy(
  status: MissionStatus,
  executionState: ExecutionState,
  outcomeState: OutcomeState,
  evidence: ObservationEvidence | null
): string {
  if (outcomeState === 'ACHIEVED_VERIFIED') {
    return '목표 달성 검증 완료 · 실질 성과가 공식 확인되었습니다.'
  }
  if (outcomeState === 'NOT_ACHIEVED_IN_WINDOW') {
    return '관측 기간 종료 · 목표 수치에는 미치지 못했으나 후속 최적화 데이터가 확보되었습니다.'
  }
  if (outcomeState === 'NOT_OBSERVABLE') {
    return '관측 기간 종료 · 외부 플랫폼 데이터 미수신으로 측정이 제한되었습니다.'
  }
  if (status === 'RESULT_UNKNOWN') {
    return '요청 결과 미확인 · 외부 플랫폼에 요청 전달 후 결과를 확인 중입니다. 기존 요청부터 다시 조회합니다.'
  }
  if (executionState === 'PAUSED') {
    return '임무가 일시 정지 상태입니다. 언제든 다시 재개할 수 있습니다.'
  }
  if (executionState === 'WAITING_EXTERNAL') {
    return '외부 채널 요청 전달 완료 · 확인 영수증 및 게시 상태를 조회하고 있습니다.'
  }
  if (executionState === 'OBSERVING') {
    if (evidence?.status === 'READ_FAILED') {
      return '성과 지표 조회 실패 · 외부 플랫폼 상태 확인이 필요합니다.'
    }
    if (evidence?.status === 'VERIFIED_ZERO') {
      return '성과 지표 관측 완료 · 관측 기간 내 신규 지표가 확인되지 않았습니다.'
    }
    if (!evidence || evidence.status === 'NOT_OBSERVED') {
      return '발행 확인 완료 · 성과 지표 관측 대기 중입니다.'
    }
    return '성과 지표 관측 진행 중 · 고객 반응을 집계하고 있습니다.'
  }
  if (evidence?.status === 'READ_FAILED') {
    return '외부 성과 조회 실패 · 플랫폼 응답을 확인하지 못했습니다.'
  }
  if (status === 'AWAITING_APPROVAL') {
    return '사장님의 발행 승인을 기다리고 있습니다. 내용을 검토해 주세요.'
  }
  if (status === 'PRODUCING') {
    return '소희가 맞춤형 마케팅 콘텐츠를 제작하고 있습니다.'
  }
  return OWNER_STATUS_BADGE_TEXT[status] || '마케팅 업무를 안전하게 진행하고 있습니다.'
}

/**
 * Builds a standardized, projection-grade DTO safe for PC, Mobile R2, and Admin consoles.
 * Falls back to explicit NOT_OBSERVED for historical rows.
 */
/**
 * Safe error sanitization allowlist to prevent raw tool arguments, stack traces,
 * API keys, tokens, or customer PII from leaking to client projections.
 */
function sanitizeMissionError(raw: unknown): string {
  if (!raw) return '임무 처리 중 주의가 필요한 상태입니다.'
  const str = String(raw).toLowerCase()
  if (str.includes('timeout') || str.includes('지연') || str.includes('econnreset') || str.includes('504')) {
    return '외부 서비스 통신 지연으로 재확인이 필요합니다.'
  }
  if (str.includes('auth') || str.includes('token') || str.includes('인증') || str.includes('permission') || str.includes('401') || str.includes('403')) {
    return '외부 채널 연동 계정의 인증 갱신이 필요합니다.'
  }
  if (str.includes('rate') || str.includes('quota') || str.includes('429')) {
    return '외부 플랫폼 호출 한도를 일시적으로 초과하여 대기 중입니다.'
  }
  if (str.includes('policy') || str.includes('violation') || str.includes('규격') || str.includes('심사')) {
    return '외부 플랫폼 정책 및 콘텐츠 규격 확인이 필요합니다.'
  }
  if (str.includes('network') || str.includes('fetch') || str.includes('500') || str.includes('502') || str.includes('503')) {
    return '외부 플랫폼 서비스 응답이 일시적으로 불안정합니다.'
  }
  return '임무 수행 중 외부 확인이 필요한 사항이 발생했습니다.'
}

export function buildCanonicalMissionDTO(
  aggregate: MarketingMissionAggregate,
  nowIso = new Date().toISOString()
): CanonicalMissionDTO {
  const { executionState, outcomeState } = mapLegacyStatusToDualState(aggregate.status, aggregate.metadata)
  const contract = (aggregate.metadata?.contract as MissionContract) || null
  const evidence = (aggregate.metadata?.observation_evidence as ObservationEvidence) || null
  const snapshotVersion = Number.isSafeInteger(aggregate.metadata?.snapshot_version)
    ? (aggregate.metadata?.snapshot_version as number)
    : 1
  const planVersion = Number.isSafeInteger((contract as any)?.plan_version)
    ? ((contract as any)?.plan_version as number)
    : Number.isSafeInteger(aggregate.metadata?.plan_version)
      ? (aggregate.metadata?.plan_version as number)
      : 1

  const isPostApproval =
    aggregate.status === 'APPROVED' ||
    aggregate.status === 'EXECUTING' ||
    aggregate.status === 'PUBLISHED_VERIFIED' ||
    aggregate.status === 'COMPLETED'

  const requiresOwnerAction =
    aggregate.status === 'AWAITING_APPROVAL' ||
    (!isPostApproval && Boolean(aggregate.metadata?.owner_action_required))

  const isBlocked = aggregate.status === 'BLOCKED'

  // Determine next evaluation check timestamp based on observation window and persisted updated_at
  // Fail-closed against malformed observation_window, missing end_at, or invalid dates
  let nextCheckAt: string | null = null
  if (contract?.observation_window?.end_at && executionState === 'OBSERVING' && outcomeState === 'PENDING') {
    try {
      const endAtTime = Date.parse(contract.observation_window.end_at)
      const baseTime = Date.parse(aggregate.updated_at || aggregate.created_at || nowIso)
      if (Number.isFinite(endAtTime) && Number.isFinite(baseTime) && baseTime < endAtTime) {
        const intervalHours = Number(contract.observation_window.evaluation_interval_hours) || 1
        const nextTime = Math.min(baseTime + intervalHours * 3600 * 1000, endAtTime)
        if (Number.isFinite(nextTime)) {
          nextCheckAt = new Date(nextTime).toISOString()
        }
      }
    } catch {
      nextCheckAt = null
    }
  }

  const observationStatus: ObservationStatus = evidence?.status || 'NOT_OBSERVED'

  // Fail-closed normalization: Never leak non-finite, NaN, string, or READ_FAILED/unobserved values as numbers
  let observedValue: number | null = null
  if (observationStatus === 'OBSERVED') {
    if (typeof evidence?.observed_value === 'number' && Number.isFinite(evidence.observed_value)) {
      observedValue = evidence.observed_value
    } else {
      observedValue = null
    }
  } else if ((observationStatus as string) === 'VERIFIED_ZERO' || (observationStatus as string) === 'EMPTY_VERIFIED') {
    observedValue = 0
  } else {
    // READ_FAILED or NOT_OBSERVED must strictly have null observedValue
    observedValue = null
  }

  const publicationPending = publicationDisplayPending(aggregate)
  const userBadge = publicationPending ? '외부 게시 확인 필요' : OWNER_STATUS_BADGE_TEXT[aggregate.status] || '확인 중'
  let userCopy = deriveUserFriendlyCopy(aggregate.status, executionState, outcomeState, evidence)
  if (publicationPending) {
    if (evidence?.status === 'READ_FAILED') {
      userCopy = '성과 지표 조회 실패 · 외부 플랫폼 상태 확인이 필요합니다.'
    } else if (evidence?.status === 'OBSERVED') {
      userCopy = '성과 지표 관측 진행 중 · 게시 결과는 별도 확인이 필요해요.'
    } else if (evidence?.status === 'VERIFIED_ZERO') {
      userCopy = '성과 지표 관측 완료 · 게시 결과는 별도 확인이 필요해요.'
    } else {
      userCopy = '게시 확인 근거를 아직 확인하지 못했어요. 연결된 원고에서 외부 처리 상태를 확인해 주세요. 성과 지표 관측 대기 중이에요.'
    }
  }

  // Derive permitted actions aligned with actual server commands
  // Security: only allowlisted mounted server commands (read-only slice returns [])
  const permittedActions: string[] = []

  // Collect honest errors (fail-closed, sanitized via Korean allowlist, no raw tool args/PII/tokens/English codes)
  const rawErrors: unknown[] = []
  if (aggregate.metadata?.errors && Array.isArray(aggregate.metadata.errors)) {
    rawErrors.push(...aggregate.metadata.errors)
  } else if (aggregate.metadata?.last_error) {
    rawErrors.push(aggregate.metadata.last_error)
  }
  if (observationStatus === 'READ_FAILED') {
    rawErrors.push('외부 플랫폼 성과 지표 조회 실패')
  }
  if ((aggregate.status === 'FAILED' || executionState === 'STOPPED') && rawErrors.length === 0) {
    rawErrors.push('임무 실행 중 오류가 발생했습니다.')
  }

  const errors = Array.from(new Set(rawErrors.map(sanitizeMissionError)))

  const safeGoal = aggregate.goal && aggregate.goal.trim()
    ? aggregate.goal.trim()
    : '목표 미지정 (레거시 작업)'

  return {
    missionId: aggregate.id,
    mission_id: aggregate.id,
    workspaceId: aggregate.workspace_id,
    traceId: aggregate.trace_id,
    snapshotVersion,
    snapshot_version: snapshotVersion,
    planVersion,
    plan_version: planVersion,
    executionState,
    execution_state: executionState,
    outcomeState,
    outcome_state: outcomeState,
    canonicalStatus: aggregate.status,
    userBadge,
    userCopy,
    goal: safeGoal,
    targetChannel: aggregate.target_channel || null,
    requiresOwnerAction,
    isBlocked,
    nextCheckAt,
    observationStatus,
    observedValue,
    permittedActions,
    permitted_actions: permittedActions,
    errors,
    createdAt: aggregate.created_at,
    updatedAt: aggregate.updated_at,
  }
}

export interface CanonicalMissionSnapshot {
  snapshotVersion: string
  resolvedAt: string
  canonicalStatus: MissionStatus
  ownerView: OwnerMissionSummary
  adminView: AdminMissionTimeline
  agentView: AgentMissionContext
  canonicalDto: CanonicalMissionDTO
}

/**
 * Builds a single canonical mission projection shared across Owner UI, Admin Console, and Agent Dock.
 * Uses durable row/version-derived snapshot version to guarantee cross-device consistency.
 */
export function buildCanonicalMissionSnapshot(
  aggregate: MarketingMissionAggregate,
  snapshotVersion?: string
): CanonicalMissionSnapshot {
  const versionNum = (aggregate.metadata?.snapshot_version as number) || 1
  const updatedTimestamp = Date.parse(aggregate.updated_at || aggregate.created_at || '1970-01-01')
  const resolvedVersion =
    snapshotVersion || `snap-v${versionNum}-${aggregate.id.slice(0, 8)}-${updatedTimestamp}`

  return {
    snapshotVersion: resolvedVersion,
    resolvedAt: new Date().toISOString(),
    canonicalStatus: aggregate.status,
    ownerView: buildOwnerMissionSummary(aggregate),
    adminView: buildAdminMissionTimeline(aggregate),
    agentView: buildAgentMissionContext(aggregate),
    canonicalDto: buildCanonicalMissionDTO(aggregate),
  }
}

export const MissionReadModel = {
  toOwnerProjection: buildOwnerMissionSummary,
  toAdminProjection: buildAdminMissionTimeline,
  toAgentProjection: buildAgentMissionContext,
  toCanonicalDTO: buildCanonicalMissionDTO,
  toCanonicalSnapshot: buildCanonicalMissionSnapshot,
}