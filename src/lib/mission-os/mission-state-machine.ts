import type {
  MissionStatus,
  MissionEvent,
  MissionActorType,
  MarketingMissionAggregate,
  ExecutionState,
  OutcomeState,
  MissionContract,
  ObservationEvidence,
} from './mission-types'
export type {
  MissionStatus,
  MissionEvent,
  MissionActorType,
  MarketingMissionAggregate,
  ExecutionState,
  OutcomeState,
  MissionContract,
  ObservationEvidence,
} from './mission-types'
import { evaluateOutcomeState } from './mission-contract'

export const VALID_MISSION_TRANSITIONS: Record<MissionStatus, readonly MissionStatus[]> = {
  RECEIVED: ['PLANNING', 'COMPLETED', 'FAILED', 'CANCELLED', 'PAUSED', 'BLOCKED'],
  PLANNING: ['PRODUCING', 'AWAITING_APPROVAL', 'COMPLETED', 'BLOCKED', 'FAILED', 'CANCELLED', 'PAUSED'],
  PRODUCING: ['AWAITING_APPROVAL', 'COMPLETED', 'BLOCKED', 'FAILED', 'CANCELLED', 'PAUSED'],
  AWAITING_APPROVAL: ['APPROVED', 'BOOKED', 'PRODUCING', 'BLOCKED', 'CANCELLED', 'PAUSED'],
  APPROVED: ['EXECUTING', 'BOOKED', 'AWAITING_APPROVAL', 'BLOCKED', 'CANCELLED', 'PAUSED'],
  EXECUTING: ['PUBLISHED_VERIFIED', 'RESULT_UNKNOWN', 'BOOKED', 'COMPLETED', 'FAILED', 'BLOCKED', 'PAUSED'],
  RESULT_UNKNOWN: ['PUBLISHED_VERIFIED', 'FAILED', 'EXECUTING', 'CANCELLED', 'PAUSED'],
  PUBLISHED_VERIFIED: ['LISTENING', 'BOOKED', 'FAILED', 'COMPLETED'],
  LISTENING: ['CUSTOMER_ENGAGED', 'BOOKED', 'COMPLETED', 'PAUSED'],
  CUSTOMER_ENGAGED: ['BOOKING_INTENT', 'BOOKED', 'LISTENING', 'COMPLETED', 'PAUSED'],
  BOOKING_INTENT: ['BOOKED', 'CUSTOMER_ENGAGED', 'COMPLETED', 'PAUSED'],
  BOOKED: ['OUTCOME_OBSERVED', 'COMPLETED', 'PAUSED'],
  OUTCOME_OBSERVED: ['LEARNING', 'COMPLETED'],
  LEARNING: ['NEXT_ACTION_READY', 'COMPLETED'],
  NEXT_ACTION_READY: ['COMPLETED', 'PLANNING'],
  COMPLETED: [],
  FAILED: ['PLANNING', 'PRODUCING', 'EXECUTING', 'CANCELLED', 'PAUSED'],
  PAUSED: [
    'RECEIVED',
    'PLANNING',
    'PRODUCING',
    'AWAITING_APPROVAL',
    'APPROVED',
    'EXECUTING',
    'LISTENING',
    'CUSTOMER_ENGAGED',
    'BOOKING_INTENT',
    'BOOKED',
    'CANCELLED',
  ],
  BLOCKED: ['PLANNING', 'PRODUCING', 'AWAITING_APPROVAL', 'APPROVED', 'CANCELLED', 'PAUSED'],
  CANCELLED: [],
}

export function canTransitionMission(from: MissionStatus, to: MissionStatus): boolean {
  if (from === to) return true
  const allowed = VALID_MISSION_TRANSITIONS[from]
  return Boolean(allowed && allowed.includes(to))
}

export function assertValidMissionTransition(from: MissionStatus, to: MissionStatus): void {
  if (!canTransitionMission(from, to)) {
    throw new Error(
      `[INVALID_MISSION_TRANSITION] Cannot transition marketing mission from '${from}' to '${to}'. Allowed transitions: ${
        (VALID_MISSION_TRANSITIONS[from] || []).join(', ') || 'none'
      }`
    )
  }
}

export interface TransitionEvidenceCheckInput {
  fromStatus: MissionStatus
  toStatus: MissionStatus
  mission: Partial<MarketingMissionAggregate>
  reason?: string
}

/**
 * Validates that an evidence-backed state transition possesses the required canonical artifacts.
 * Prevents false-green completions and state promotions based purely on LLM hallucinations or optimistic UI.
 */
export function assertEvidenceBackedTransition(input: TransitionEvidenceCheckInput): void {
  const { toStatus, mission, reason } = input

  // 1. Structural transition legality
  assertValidMissionTransition(input.fromStatus, toStatus)

  // 2. Evidence verification per target state
  switch (toStatus) {
    case 'AWAITING_APPROVAL': {
      if (!mission.content_id) {
        throw new Error('[MISSING_TRANSITION_EVIDENCE] AWAITING_APPROVAL requires valid content_id draft evidence')
      }
      break
    }
    case 'APPROVED': {
      if (!mission.approval_id) {
        throw new Error('[MISSING_TRANSITION_EVIDENCE] APPROVED requires verified approval_id record')
      }
      break
    }
    case 'EXECUTING': {
      if (!mission.approval_id && input.fromStatus !== 'APPROVED') {
        throw new Error('[MISSING_TRANSITION_EVIDENCE] EXECUTING requires preceding approval_id or APPROVED status')
      }
      break
    }
    case 'PUBLISHED_VERIFIED': {
      const hasReceipt = Boolean(mission.external_action_receipt_id)
      const hasPostRef = Boolean(mission.metadata?.provider_post_reference || mission.metadata?.readbackConfirmedAt)
      if (!hasReceipt && !hasPostRef) {
        throw new Error('[MISSING_TRANSITION_EVIDENCE] PUBLISHED_VERIFIED requires provider receipt or verified post reference')
      }
      break
    }
    case 'CUSTOMER_ENGAGED': {
      if (!mission.customer_id) {
        throw new Error('[MISSING_TRANSITION_EVIDENCE] CUSTOMER_ENGAGED requires linked customer_id')
      }
      break
    }
    case 'BOOKED': {
      if (!mission.booking_id) {
        throw new Error('[MISSING_TRANSITION_EVIDENCE] BOOKED requires verified booking_id from reservation canonical ledger')
      }
      break
    }
    case 'OUTCOME_OBSERVED': {
      const hasOutcome = Boolean(mission.outcome_id || mission.metadata?.outcome_evidence)
      if (!hasOutcome) {
        throw new Error('[MISSING_TRANSITION_EVIDENCE] OUTCOME_OBSERVED requires outcome_id or verified attribution evidence')
      }
      break
    }
    case 'FAILED':
    case 'BLOCKED':
    case 'RESULT_UNKNOWN':
    case 'CANCELLED': {
      if (!reason || !reason.trim()) {
        throw new Error(`[MISSING_TRANSITION_EVIDENCE] Transition to '${toStatus}' requires an explicit explanation/reason`)
      }
      break
    }
  }
}

export function projectMissionStateFromEvents(events: readonly MissionEvent[]): MissionStatus {
  if (!events || events.length === 0) {
    return 'RECEIVED'
  }

  // Sort events chronologically
  const sorted = [...events].sort(
    (a, b) => new Date(a.occurred_at).getTime() - new Date(b.occurred_at).getTime()
  )

  return sorted[sorted.length - 1].to_status
}

/**
 * Valid transitions for execution_state:
 * DRAFT -> NEEDS_DECISION, READY, STOPPED, CLOSED
 * NEEDS_DECISION -> READY, STOPPED, CLOSED
 * READY -> RUNNING, PAUSED, STOPPED
 * RUNNING -> WAITING_EXTERNAL, OBSERVING, PAUSING, PAUSED, STOPPED, CLOSED
 * WAITING_EXTERNAL -> OBSERVING, RUNNING, PAUSED, STOPPED, CLOSED
 * OBSERVING -> RUNNING, PAUSED, STOPPED, CLOSED
 * PAUSING -> PAUSED, STOPPED
 * PAUSED -> READY, RUNNING, STOPPED, CLOSED
 * STOPPED -> CLOSED
 * CLOSED -> []
 */
export const VALID_EXECUTION_TRANSITIONS: Record<ExecutionState, readonly ExecutionState[]> = {
  DRAFT: ['NEEDS_DECISION', 'READY', 'STOPPED', 'CLOSED'],
  NEEDS_DECISION: ['READY', 'STOPPED', 'CLOSED'],
  READY: ['RUNNING', 'PAUSED', 'STOPPED'],
  RUNNING: ['WAITING_EXTERNAL', 'OBSERVING', 'PAUSING', 'PAUSED', 'STOPPED', 'CLOSED'],
  WAITING_EXTERNAL: ['OBSERVING', 'RUNNING', 'PAUSED', 'STOPPED', 'CLOSED'],
  OBSERVING: ['RUNNING', 'PAUSED', 'STOPPED', 'CLOSED'],
  PAUSING: ['PAUSED', 'STOPPED'],
  PAUSED: ['READY', 'RUNNING', 'STOPPED', 'CLOSED'],
  STOPPED: ['CLOSED'],
  CLOSED: [],
}

export function canTransitionExecutionState(from: ExecutionState, to: ExecutionState): boolean {
  if (from === to) return true
  const allowed = VALID_EXECUTION_TRANSITIONS[from]
  return Boolean(allowed && allowed.includes(to))
}

export function assertValidExecutionTransition(from: ExecutionState, to: ExecutionState): void {
  if (!canTransitionExecutionState(from, to)) {
    throw new Error(
      `[INVALID_EXECUTION_TRANSITION] Cannot transition execution state from '${from}' to '${to}'. Allowed: ${
        (VALID_EXECUTION_TRANSITIONS[from] || []).join(', ') || 'none'
      }`
    )
  }
}

/**
 * Valid transitions for outcome_state:
 * PENDING -> ACHIEVED_VERIFIED, NOT_ACHIEVED_IN_WINDOW, NOT_OBSERVABLE, WITHDRAWN
 * ACHIEVED_VERIFIED -> [] (immutable once verified, except explicit audited late-correction)
 * NOT_ACHIEVED_IN_WINDOW -> ACHIEVED_VERIFIED (only with late correction evidence)
 * NOT_OBSERVABLE -> PENDING, ACHIEVED_VERIFIED, NOT_ACHIEVED_IN_WINDOW
 * WITHDRAWN -> []
 */
export const VALID_OUTCOME_TRANSITIONS: Record<OutcomeState, readonly OutcomeState[]> = {
  PENDING: ['ACHIEVED_VERIFIED', 'NOT_ACHIEVED_IN_WINDOW', 'NOT_OBSERVABLE', 'WITHDRAWN'],
  ACHIEVED_VERIFIED: [],
  NOT_ACHIEVED_IN_WINDOW: ['ACHIEVED_VERIFIED'],
  NOT_OBSERVABLE: ['PENDING', 'ACHIEVED_VERIFIED', 'NOT_ACHIEVED_IN_WINDOW'],
  WITHDRAWN: [],
}

export function canTransitionOutcomeState(from: OutcomeState, to: OutcomeState): boolean {
  if (from === to) return true
  const allowed = VALID_OUTCOME_TRANSITIONS[from]
  return Boolean(allowed && allowed.includes(to))
}

export function assertValidOutcomeTransition(from: OutcomeState, to: OutcomeState): void {
  if (!canTransitionOutcomeState(from, to)) {
    throw new Error(
      `[INVALID_OUTCOME_TRANSITION] Cannot transition outcome state from '${from}' to '${to}'. Allowed: ${
        (VALID_OUTCOME_TRANSITIONS[from] || []).join(', ') || 'none'
      }`
    )
  }
}

/**
 * Invariant validation preventing false-green completions:
 * 1. Provider action receipts or published status alone DO NOT satisfy goal achievement.
 * 2. An outcome can only be marked ACHIEVED_VERIFIED if valid observation evidence is provided
 *    and target criteria are met.
 * 3. NOT_OBSERVED, READ_FAILED, and VERIFIED_ZERO (< target) strictly prohibit ACHIEVED_VERIFIED.
 */
export function assertOutcomeEvidenceInvariant(input: {
  targetOutcome: OutcomeState
  contract?: MissionContract | null
  evidence?: ObservationEvidence | null
  receiptId?: string | null
  nowIso?: string
}): void {
  const { targetOutcome, contract, evidence, receiptId } = input

  if (targetOutcome === 'ACHIEVED_VERIFIED') {
    if (!contract) {
      throw new Error('[UNVERIFIED_OUTCOME_VIOLATION] Cannot claim ACHIEVED_VERIFIED without an active MissionContract')
    }

    if (!evidence) {
      if (receiptId) {
        throw new Error(
          '[POSTED_IS_NOT_ACHIEVED] External publish/action receipt proves delivery, NOT goal achievement. Outcome remains PENDING/NOT_OBSERVED until verified observations occur.'
        )
      }
      throw new Error('[UNVERIFIED_OUTCOME_VIOLATION] Cannot transition to ACHIEVED_VERIFIED without ObservationEvidence')
    }

    if (evidence.status === 'NOT_OBSERVED') {
      throw new Error('[UNVERIFIED_OUTCOME_VIOLATION] Observation status is NOT_OBSERVED; cannot claim ACHIEVED_VERIFIED')
    }

    if (evidence.status === 'READ_FAILED') {
      throw new Error('[UNVERIFIED_OUTCOME_VIOLATION] Observation read failed; cannot claim ACHIEVED_VERIFIED')
    }

    if (evidence.status === 'VERIFIED_ZERO') {
      if (contract.success_criterion.target_value > 0) {
        throw new Error(
          `[UNVERIFIED_OUTCOME_VIOLATION] Target value is ${contract.success_criterion.target_value} but observed value is verified 0.`
        )
      }
    }

    if (evidence.status === 'OBSERVED') {
      const val = evidence.observed_value ?? 0
      if (val < contract.success_criterion.target_value) {
        throw new Error(
          `[UNVERIFIED_OUTCOME_VIOLATION] Observed value ${val} is below contract target ${contract.success_criterion.target_value}`
        )
      }
    }

    if (evaluateOutcomeState(contract, evidence, input.nowIso) !== 'ACHIEVED_VERIFIED') {
      throw new Error('[UNVERIFIED_OUTCOME_VIOLATION] Verified value, observation timing and authorized source are required')
    }
  }
}

const VALID_EXECUTION_STATE_SET = new Set<ExecutionState>([
  'DRAFT',
  'NEEDS_DECISION',
  'READY',
  'RUNNING',
  'WAITING_EXTERNAL',
  'OBSERVING',
  'PAUSING',
  'PAUSED',
  'STOPPED',
  'CLOSED',
])

const VALID_OUTCOME_STATE_SET = new Set<OutcomeState>([
  'PENDING',
  'ACHIEVED_VERIFIED',
  'NOT_ACHIEVED_IN_WINDOW',
  'NOT_OBSERVABLE',
  'WITHDRAWN',
])

/**
 * Maps legacy MissionStatus to dual ExecutionState and OutcomeState.
 * Guarantees backward-compatibility for historical rows.
 * Legacy COMPLETED never automatically infers ACHIEVED_VERIFIED unless explicit verified evidence exists.
 */
export function mapLegacyStatusToDualState(
  status: MissionStatus,
  metadata?: Record<string, unknown>
): { executionState: ExecutionState; outcomeState: OutcomeState } {
  // If explicitly stored in metadata with valid enums, use them
  if (
    metadata?.execution_state &&
    typeof metadata.execution_state === 'string' &&
    VALID_EXECUTION_STATE_SET.has(metadata.execution_state as ExecutionState)
  ) {
    const exec = metadata.execution_state as ExecutionState
    const out =
      metadata.outcome_state &&
      typeof metadata.outcome_state === 'string' &&
      VALID_OUTCOME_STATE_SET.has(metadata.outcome_state as OutcomeState)
        ? (metadata.outcome_state as OutcomeState)
        : 'PENDING'
    return { executionState: exec, outcomeState: out }
  }

  const contract = (metadata?.contract as MissionContract) || null
  const evidence = (metadata?.observation_evidence as ObservationEvidence) || null

  switch (status) {
    case 'RECEIVED':
    case 'PLANNING':
    case 'PRODUCING':
      return { executionState: 'DRAFT', outcomeState: 'PENDING' }

    case 'AWAITING_APPROVAL':
      return { executionState: 'NEEDS_DECISION', outcomeState: 'PENDING' }

    case 'APPROVED':
      return { executionState: 'READY', outcomeState: 'PENDING' }

    case 'EXECUTING':
    case 'RESULT_UNKNOWN':
      return { executionState: 'WAITING_EXTERNAL', outcomeState: 'PENDING' }

    case 'PUBLISHED_VERIFIED':
    case 'LISTENING':
    case 'CUSTOMER_ENGAGED':
    case 'BOOKING_INTENT':
      return { executionState: 'OBSERVING', outcomeState: 'PENDING' }

    case 'BOOKED':
    case 'OUTCOME_OBSERVED':
    case 'LEARNING':
    case 'NEXT_ACTION_READY': {
      // Must evaluate through evaluateOutcomeState with target/timing/source validation
      const evaluatedOutcome = contract
        ? evaluateOutcomeState(contract, evidence)
        : 'PENDING'
      return {
        executionState: 'OBSERVING',
        outcomeState: evaluatedOutcome,
      }
    }

    case 'COMPLETED': {
      // Legacy COMPLETED must NOT default to ACHIEVED_VERIFIED without contract + verified evidence!
      const evaluatedOutcome = contract
        ? evaluateOutcomeState(contract, evidence)
        : 'PENDING'
      return {
        executionState: 'CLOSED',
        outcomeState: evaluatedOutcome,
      }
    }

    case 'PAUSED':
      return { executionState: 'PAUSED', outcomeState: 'PENDING' }

    case 'BLOCKED':
    case 'FAILED':
      return { executionState: 'STOPPED', outcomeState: 'PENDING' }

    case 'CANCELLED':
      return { executionState: 'CLOSED', outcomeState: 'WITHDRAWN' }

    default:
      return { executionState: 'DRAFT', outcomeState: 'PENDING' }
  }
}
