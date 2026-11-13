import type { MissionActorType } from './mission-types'

export type ExecutionState =
  | 'DRAFT'
  | 'NEEDS_DECISION'
  | 'READY'
  | 'RUNNING'
  | 'WAITING_EXTERNAL'
  | 'OBSERVING'
  | 'PAUSING'
  | 'PAUSED'
  | 'STOPPED'
  | 'CLOSED'

export type OutcomeState =
  | 'PENDING'
  | 'ACHIEVED_VERIFIED'
  | 'NOT_ACHIEVED_IN_WINDOW'
  | 'NOT_OBSERVABLE'
  | 'WITHDRAWN'

export type ObservationStatus =
  | 'NOT_OBSERVED'
  | 'VERIFIED_ZERO'
  | 'READ_FAILED'
  | 'OBSERVED'

export interface SuccessCriterion {
  metric: string
  target_value: number
  baseline_value?: number
  unit?: string
}

export interface ObservationWindow {
  start_at: string
  end_at: string
  evaluation_interval_hours?: number
}

export interface BudgetCaps {
  max_cost_minor_units: number
  currency: string
}

export interface AttentionPolicy {
  max_escalations: number
  notify_on_breach: boolean
}

export interface OwnerActor {
  actor_type: MissionActorType
  actor_id?: string | null
}

export interface MissionContract {
  contract_version: number
  goal: string
  success_criterion: SuccessCriterion
  observation_window: ObservationWindow
  service_scope: string[]
  allowed_actions: string[]
  forbidden_actions: string[]
  budget_caps: BudgetCaps
  attention_policy: AttentionPolicy
  fact_version_refs: string[] | Record<string, string>
  policy_version: string
  approval_fingerprint: string | null
  owner_actor: OwnerActor
  effective_at: string
  expires_at: string
}

export interface ObservationEvidence {
  status: ObservationStatus
  observed_value?: number | null
  observed_at?: string | null
  source_channel?: string | null
  receipt_id?: string | null
  error_code?: string | null
  error_message?: string | null
}

const VALID_ACTOR_TYPES: readonly MissionActorType[] = ['user', 'agent', 'system', 'provider', 'operator']

/**
 * Validates ISO date string format and chronological order.
 */
function isValidIsoDate(str: unknown): str is string {
  if (typeof str !== 'string' || !str.trim()) return false
  const time = Date.parse(str)
  return !Number.isNaN(time)
}

/**
 * Validates a MissionContract object against structural invariants:
 * - contract_version >= 1 integer
 * - Non-empty goal
 * - target_value finite, non-NaN, >= 0
 * - observation_window.start_at < observation_window.end_at
 * - effective_at < expires_at
 * - max_cost_minor_units finite integer >= 0
 * - non-empty service_scope with valid non-empty string entries
 * - allowed_actions, forbidden_actions valid string arrays
 * - owner_actor.actor_type strictly member of VALID_ACTOR_TYPES
 * - attention_policy.max_escalations integer >= 0
 */
export function validateMissionContract(input: unknown): MissionContract {
  if (!input || typeof input !== 'object') {
    throw new Error('[INVALID_MISSION_CONTRACT] Contract payload must be an object')
  }

  const c = input as Partial<MissionContract>

  if (typeof c.contract_version !== 'number' || !Number.isInteger(c.contract_version) || c.contract_version < 1) {
    throw new Error(`[INVALID_MISSION_CONTRACT] contract_version must be a positive integer, got ${c.contract_version}`)
  }

  if (typeof c.goal !== 'string' || !c.goal.trim()) {
    throw new Error('[INVALID_MISSION_CONTRACT] goal must be a non-empty string')
  }

  if (!c.success_criterion || typeof c.success_criterion !== 'object') {
    throw new Error('[INVALID_MISSION_CONTRACT] success_criterion is required')
  }
  if (typeof c.success_criterion.metric !== 'string' || !c.success_criterion.metric.trim()) {
    throw new Error('[INVALID_MISSION_CONTRACT] success_criterion.metric must be a non-empty string')
  }
  if (
    typeof c.success_criterion.target_value !== 'number' ||
    !Number.isFinite(c.success_criterion.target_value) ||
    Number.isNaN(c.success_criterion.target_value) ||
    c.success_criterion.target_value < 0
  ) {
    throw new Error(
      `[INVALID_MISSION_CONTRACT] success_criterion.target_value must be a finite non-negative number, got ${c.success_criterion.target_value}`
    )
  }
  if (
    c.success_criterion.baseline_value !== undefined &&
    c.success_criterion.baseline_value !== null &&
    (typeof c.success_criterion.baseline_value !== 'number' ||
      !Number.isFinite(c.success_criterion.baseline_value) ||
      Number.isNaN(c.success_criterion.baseline_value))
  ) {
    throw new Error('[INVALID_MISSION_CONTRACT] success_criterion.baseline_value must be a finite number if provided')
  }

  if (!c.observation_window || typeof c.observation_window !== 'object') {
    throw new Error('[INVALID_MISSION_CONTRACT] observation_window is required')
  }
  if (!isValidIsoDate(c.observation_window.start_at)) {
    throw new Error('[INVALID_MISSION_CONTRACT] observation_window.start_at must be a valid ISO 8601 date string')
  }
  if (!isValidIsoDate(c.observation_window.end_at)) {
    throw new Error('[INVALID_MISSION_CONTRACT] observation_window.end_at must be a valid ISO 8601 date string')
  }
  if (Date.parse(c.observation_window.end_at) <= Date.parse(c.observation_window.start_at)) {
    throw new Error(
      `[INVALID_MISSION_CONTRACT] observation_window.end_at (${c.observation_window.end_at}) must be strictly after start_at (${c.observation_window.start_at})`
    )
  }

  if (
    c.observation_window.evaluation_interval_hours !== undefined &&
    c.observation_window.evaluation_interval_hours !== null &&
    (typeof c.observation_window.evaluation_interval_hours !== 'number' ||
      !Number.isFinite(c.observation_window.evaluation_interval_hours) ||
      c.observation_window.evaluation_interval_hours <= 0)
  ) {
    throw new Error('[INVALID_MISSION_CONTRACT] evaluation_interval_hours must be a positive number if provided')
  }

  if (!Array.isArray(c.service_scope) || c.service_scope.length === 0) {
    throw new Error('[INVALID_MISSION_CONTRACT] service_scope must be a non-empty array of strings')
  }
  for (const scopeItem of c.service_scope) {
    if (typeof scopeItem !== 'string' || !scopeItem.trim()) {
      throw new Error('[INVALID_MISSION_CONTRACT] Every service_scope item must be a non-empty string')
    }
  }

  if (!Array.isArray(c.allowed_actions)) {
    throw new Error('[INVALID_MISSION_CONTRACT] allowed_actions must be an array of strings')
  }
  for (const actionItem of c.allowed_actions) {
    if (typeof actionItem !== 'string' || !actionItem.trim()) {
      throw new Error('[INVALID_MISSION_CONTRACT] Every allowed_actions item must be a non-empty string')
    }
  }

  if (!Array.isArray(c.forbidden_actions)) {
    throw new Error('[INVALID_MISSION_CONTRACT] forbidden_actions must be an array of strings')
  }
  for (const actionItem of c.forbidden_actions) {
    if (typeof actionItem !== 'string' || !actionItem.trim()) {
      throw new Error('[INVALID_MISSION_CONTRACT] Every forbidden_actions item must be a non-empty string')
    }
  }

  if (!c.budget_caps || typeof c.budget_caps !== 'object') {
    throw new Error('[INVALID_MISSION_CONTRACT] budget_caps is required')
  }
  if (
    typeof c.budget_caps.max_cost_minor_units !== 'number' ||
    !Number.isFinite(c.budget_caps.max_cost_minor_units) ||
    !Number.isInteger(c.budget_caps.max_cost_minor_units) ||
    c.budget_caps.max_cost_minor_units < 0
  ) {
    throw new Error(
      `[INVALID_MISSION_CONTRACT] budget_caps.max_cost_minor_units must be a non-negative integer, got ${c.budget_caps.max_cost_minor_units}`
    )
  }
  if (typeof c.budget_caps.currency !== 'string' || !c.budget_caps.currency.trim()) {
    throw new Error('[INVALID_MISSION_CONTRACT] budget_caps.currency must be a non-empty string')
  }

  if (!c.attention_policy || typeof c.attention_policy !== 'object') {
    throw new Error('[INVALID_MISSION_CONTRACT] attention_policy is required')
  }
  if (
    typeof c.attention_policy.max_escalations !== 'number' ||
    !Number.isFinite(c.attention_policy.max_escalations) ||
    !Number.isInteger(c.attention_policy.max_escalations) ||
    c.attention_policy.max_escalations < 0
  ) {
    throw new Error('[INVALID_MISSION_CONTRACT] attention_policy.max_escalations must be a non-negative integer')
  }

  if (typeof c.policy_version !== 'string' || !c.policy_version.trim()) {
    throw new Error('[INVALID_MISSION_CONTRACT] policy_version must be a non-empty string')
  }

  if (!c.owner_actor || typeof c.owner_actor !== 'object' || !c.owner_actor.actor_type) {
    throw new Error('[INVALID_MISSION_CONTRACT] owner_actor must contain valid actor_type')
  }
  if (!VALID_ACTOR_TYPES.includes(c.owner_actor.actor_type)) {
    throw new Error(
      `[INVALID_MISSION_CONTRACT] Invalid owner_actor.actor_type '${c.owner_actor.actor_type}'. Allowed: ${VALID_ACTOR_TYPES.join(', ')}`
    )
  }

  if (!isValidIsoDate(c.effective_at)) {
    throw new Error('[INVALID_MISSION_CONTRACT] effective_at must be a valid ISO 8601 date string')
  }
  if (!isValidIsoDate(c.expires_at)) {
    throw new Error('[INVALID_MISSION_CONTRACT] expires_at must be a valid ISO 8601 date string')
  }
  if (Date.parse(c.expires_at) <= Date.parse(c.effective_at)) {
    throw new Error(
      `[INVALID_MISSION_CONTRACT] expires_at (${c.expires_at}) must be strictly after effective_at (${c.effective_at})`
    )
  }

  let normalizedApprovalFingerprint: string | null = null
  if (c.approval_fingerprint !== undefined && c.approval_fingerprint !== null) {
    if (typeof c.approval_fingerprint !== 'string') {
      throw new Error(
        '[INVALID_MISSION_CONTRACT] approval_fingerprint must be a valid 64-character lowercase hex string or null'
      )
    }
    const fp = c.approval_fingerprint.trim()
    if (!/^[a-f0-9]{64}$/.test(fp)) {
      throw new Error(
        '[INVALID_MISSION_CONTRACT] approval_fingerprint must be a valid 64-character lowercase hex string or null'
      )
    }
    normalizedApprovalFingerprint = fp
  }

  return {
    contract_version: c.contract_version,
    goal: c.goal.trim(),
    success_criterion: {
      metric: c.success_criterion.metric.trim(),
      target_value: c.success_criterion.target_value,
      baseline_value: c.success_criterion.baseline_value,
      unit: c.success_criterion.unit,
    },
    observation_window: {
      start_at: c.observation_window.start_at,
      end_at: c.observation_window.end_at,
      evaluation_interval_hours: c.observation_window.evaluation_interval_hours,
    },
    service_scope: c.service_scope.map((s) => s.trim()),
    allowed_actions: c.allowed_actions.map((a) => a.trim()),
    forbidden_actions: c.forbidden_actions.map((f) => f.trim()),
    budget_caps: {
      max_cost_minor_units: c.budget_caps.max_cost_minor_units,
      currency: c.budget_caps.currency.trim().toUpperCase(),
    },
    attention_policy: {
      max_escalations: c.attention_policy.max_escalations,
      notify_on_breach: Boolean(c.attention_policy.notify_on_breach),
    },
    fact_version_refs: c.fact_version_refs || {},
    policy_version: c.policy_version.trim(),
    approval_fingerprint: normalizedApprovalFingerprint,
    owner_actor: {
      actor_type: c.owner_actor.actor_type,
      actor_id: c.owner_actor.actor_id ?? null,
    },
    effective_at: c.effective_at,
    expires_at: c.expires_at,
  }
}

/**
 * Checks whether an observation occurred strictly inside the contract window.
 */
function isObservedInsideWindow(observedAtIso: string, window: ObservationWindow): boolean {
  const t = Date.parse(observedAtIso)
  const start = Date.parse(window.start_at)
  const end = Date.parse(window.end_at)
  return !Number.isNaN(t) && t >= start && t <= end
}

/**
 * Checks whether the source channel is within the contract's authorized service scope.
 */
function isSourceChannelAuthorized(sourceChannel: string | null | undefined, serviceScope: string[]): boolean {
  if (!sourceChannel || !sourceChannel.trim()) return false
  return serviceScope.some((s) => s.toLowerCase() === sourceChannel.trim().toLowerCase())
}

/**
 * Evaluates outcome state from contract and observation evidence.
 *
 * INVARIANTS & HONEST TRUTH:
 * 1. A provider receipt or published post DOES NOT equal ACHIEVED_VERIFIED.
 * 2. An outcome can only be ACHIEVED_VERIFIED if:
 *    - Observation status is OBSERVED (or VERIFIED_ZERO when target is 0)
 *    - observed_at is strictly within observation_window [start_at, end_at]
 *    - source_channel is within service_scope
 *    - observed_value meets or exceeds success_criterion.target_value
 * 3. NOT_OBSERVED after deadline -> NOT_OBSERVABLE (NOT NOT_ACHIEVED: unobserved != zero).
 * 4. READ_FAILED after deadline -> NOT_OBSERVABLE.
 * 5. VERIFIED_ZERO or OBSERVED (< target) within window and past deadline -> NOT_ACHIEVED_IN_WINDOW (proven failure).
 */
export function evaluateOutcomeState(
  contract: MissionContract | null,
  evidence: ObservationEvidence | null,
  nowIso = new Date().toISOString()
): OutcomeState {
  if (!contract) {
    return 'PENDING'
  }

  const nowTime = Date.parse(nowIso)
  if (!Number.isFinite(nowTime)) return 'PENDING'
  const windowEndTime = Date.parse(contract.observation_window.end_at)
  const isPastWindow = nowTime > windowEndTime

  // 1. No evidence or unobserved
  if (!evidence || evidence.status === 'NOT_OBSERVED') {
    // Unobserved != failed: if window expired without observation, it is NOT_OBSERVABLE
    if (isPastWindow) {
      return 'NOT_OBSERVABLE'
    }
    return 'PENDING'
  }

  // 2. Read failed (provider outage, auth error, network fault)
  if (evidence.status === 'READ_FAILED') {
    if (isPastWindow) {
      return 'NOT_OBSERVABLE'
    }
    return 'PENDING'
  }

  // Helper to validate timing: must be inside window AND not in the future relative to nowIso
  const isTimingValid = (observedAt?: string | null): boolean => {
    if (!observedAt) return false
    const t = Date.parse(observedAt)
    if (Number.isNaN(t)) return false
    if (t > nowTime) return false // Reject future observation evidence!
    return isObservedInsideWindow(observedAt, contract.observation_window)
  }

  // 3. Verified Zero (verified that 0 conversions / bookings occurred)
  if (evidence.status === 'VERIFIED_ZERO') {
    const hasValidTiming = isTimingValid(evidence.observed_at)
    const hasValidSource = isSourceChannelAuthorized(evidence.source_channel, contract.service_scope)

    // If timing or source is invalid, observation itself is unverified -> NOT_OBSERVABLE if window passed
    if (!hasValidTiming || !hasValidSource) {
      if (isPastWindow) {
        return 'NOT_OBSERVABLE'
      }
      return 'PENDING'
    }

    if (contract.success_criterion.target_value === 0) {
      return 'ACHIEVED_VERIFIED'
    }
    if (isPastWindow) {
      return 'NOT_ACHIEVED_IN_WINDOW'
    }
    return 'PENDING'
  }

  // 4. Observed value
  if (evidence.status === 'OBSERVED') {
    const val = evidence.observed_value
    const hasValidValue = typeof val === 'number' && Number.isFinite(val)
    const hasValidTiming = isTimingValid(evidence.observed_at)
    const hasValidSource = isSourceChannelAuthorized(evidence.source_channel, contract.service_scope)

    // Only if timing, source, and value are all verified
    if (hasValidValue && hasValidTiming && hasValidSource) {
      if (val >= contract.success_criterion.target_value) {
        return 'ACHIEVED_VERIFIED'
      }
      if (isPastWindow) {
        return 'NOT_ACHIEVED_IN_WINDOW'
      }
      return 'PENDING'
    }

    // Invalid observation evidence (out of window timing, future timestamp, or untrusted source)
    if (isPastWindow) {
      return 'NOT_OBSERVABLE'
    }
    return 'PENDING'
  }

  return 'PENDING'
}
