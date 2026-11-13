import crypto from 'node:crypto'
import type { MissionContract, BudgetCaps } from './mission-contract'
import { validateMissionContract } from './mission-contract'

export interface FieldDiff {
  field: string
  old_value: unknown
  new_value: unknown
  description_ko: string
}

export interface SubmittedEffect {
  effect_id: string
  action_type: string
  target_channel?: string | null
  status: 'SUBMITTED' | 'ACCEPTED' | 'VERIFIED'
  submitted_at?: string | null
  details?: Record<string, unknown>
}

export interface PlanDiff {
  mission_id: string
  old_contract_version: number
  new_contract_version: number
  expected_snapshot_version: number
  idempotency_key: string
  payload_hash: string
  changed_fields: FieldDiff[]
  preserved_constraints: string[]
  impacted_unexecuted_steps: string[]
  already_submitted_effects: SubmittedEffect[]
  invalidated_approvals: string[]
  requires_reapproval: boolean
  cost_difference_minor_units: number
  is_ambiguous: boolean
  clarification_prompt?: string
  proposed_contract: MissionContract
  created_at: string
}

export interface PlanDiffContext {
  missionId: string
  expectedSnapshotVersion: number
  idempotencyKey?: string
  alreadySubmittedEffects?: SubmittedEffect[]
  unexecutedSteps?: string[]
  existingApprovals?: string[]
}

/**
 * Strict allowlist sanitizer for receipt details.
 * Prevents raw tool/provider payloads or PII/secret leaks from reaching client contexts.
 */
export function sanitizeReceiptDetails(details: unknown): Record<string, unknown> | undefined {
  if (!details || typeof details !== 'object' || Array.isArray(details)) {
    return undefined
  }
  const safe: Record<string, unknown> = {}
  const allowedKeys = ['action_summary', 'published_post_id', 'post_id', 'target_url', 'provider_code', 'channel']
  for (const key of allowedKeys) {
    if (key in details && typeof (details as any)[key] === 'string') {
      safe[key] = (details as any)[key]
    }
  }
  return Object.keys(safe).length > 0 ? safe : undefined
}

/**
 * Builds the authoritative PlanDiffContext from a marketing mission row/aggregate.
 *
 * Guarantees:
 * 1. Honest projection: If no steps or receipts exist in DB, returns empty array ([]).
 *    NEVER fabricates synthetic unexecuted steps (e.g. Naver/Threads) or estimated effects.
 * 2. Canonical receipt extraction: Normalizes metadata.multi_receipts (or legacy external_action_receipt_id).
 *    Never invents current timestamps if stable creation dates are missing (displays null / time-unverified).
 *    Strips secret/PII tool details using strict safe DTO allowlist.
 * 3. Canonical approval extraction: Collects mission.approval_id, contract.approval_fingerprint,
 *    and deduplicates valid strings.
 * 4. Step status filtering: Excludes already executed/submitted steps (completed/verified/submitted/running).
 *    Only includes truly unexecuted steps (pending/planned/ready). General string steps are not assumed unexecuted.
 */
export function buildAuthoritativePlanDiffContext(
  mission: {
    id: string
    approval_id?: string | null
    external_action_receipt_id?: string | null
    target_channel?: string | null
    status?: string | null
    created_at?: string | null
    updated_at?: string | null
    metadata?: Record<string, unknown> | null
  },
  options?: {
    expectedSnapshotVersion?: number
    idempotencyKey?: string
  }
): PlanDiffContext {
  const currentSnapshotVersion =
    options?.expectedSnapshotVersion ?? Number(mission.metadata?.snapshot_version ?? 1)

  // 1. Receipts / Submitted Effects
  const effects: SubmittedEffect[] = []
  if (Array.isArray(mission.metadata?.multi_receipts)) {
    for (const r of mission.metadata.multi_receipts as any[]) {
      const effectId = String(r?.receiptId || r?.receipt_id || '')
      if (effectId) {
        const rawDate = r.createdAt || r.created_at || r.submitted_at
        const submittedAt = typeof rawDate === 'string' && rawDate.trim() ? rawDate.trim() : null
        effects.push({
          effect_id: effectId,
          action_type: r.actionType || r.action_type || 'PUBLISH',
          target_channel: r.provider || r.target_channel || null,
          status: (r.verifiedAt || r.status === 'VERIFIED') ? 'VERIFIED' : 'SUBMITTED',
          submitted_at: submittedAt,
          details: sanitizeReceiptDetails(r.details),
        })
      }
    }
  } else if (mission.external_action_receipt_id) {
    const rawDate = mission.updated_at || mission.created_at
    const submittedAt = typeof rawDate === 'string' && rawDate.trim() ? rawDate.trim() : null
    effects.push({
      effect_id: String(mission.external_action_receipt_id),
      action_type: 'PUBLISH',
      target_channel: mission.target_channel || null,
      status: mission.status === 'PUBLISHED_VERIFIED' ? 'VERIFIED' : 'SUBMITTED',
      submitted_at: submittedAt,
    })
  }

  // 2. Unexecuted Steps: strictly honest status filtering, never fabricate synthetic steps
  const UNEXECUTED_STATUSES = new Set(['pending', 'planned', 'ready', 'waiting', 'not_started', 'queued'])

  let unexecutedSteps: string[] = []
  if (Array.isArray(mission.metadata?.steps)) {
    unexecutedSteps = (mission.metadata.steps as any[])
      .filter((s) => {
        if (!s || typeof s !== 'object') return false
        const rawStatus = String(s.status || s.execution_state || s.state || '').toLowerCase()
        return UNEXECUTED_STATUSES.has(rawStatus)
      })
      .map((s) => s.summary || s.title || s.name || s.step_id || '')
      .filter((s): s is string => Boolean(s))
  } else if (Array.isArray(mission.metadata?.plan_steps)) {
    unexecutedSteps = (mission.metadata.plan_steps as any[])
      .filter((s) => {
        if (!s || typeof s !== 'object') return false
        const rawStatus = String(s.status || s.execution_state || s.state || '').toLowerCase()
        return UNEXECUTED_STATUSES.has(rawStatus)
      })
      .map((s) => s.summary || s.title || s.name || s.step_id || '')
      .filter((s): s is string => Boolean(s))
  } else if (Array.isArray(mission.metadata?.unexecuted_steps)) {
    // Explicit legacy unexecuted_steps list: strings or objects are known to be unexecuted
    unexecutedSteps = (mission.metadata.unexecuted_steps as any[])
      .map((s) => (typeof s === 'string' ? s : s?.summary || s?.title || s?.name || ''))
      .filter((s): s is string => Boolean(s))
  }

  // 3. Existing Approvals
  const approvals: string[] = []
  if (mission.approval_id) {
    approvals.push(String(mission.approval_id))
  }
  const contract = mission.metadata?.contract as any
  if (contract?.approval_fingerprint && typeof contract.approval_fingerprint === 'string') {
    approvals.push(contract.approval_fingerprint)
  }
  if (Array.isArray(mission.metadata?.active_approvals)) {
    for (const a of mission.metadata.active_approvals as any[]) {
      if (typeof a === 'string' && a.trim()) approvals.push(a.trim())
    }
  }
  const existingApprovals = Array.from(new Set(approvals))

  return {
    missionId: mission.id,
    expectedSnapshotVersion: currentSnapshotVersion,
    idempotencyKey: options?.idempotencyKey,
    alreadySubmittedEffects: effects,
    unexecutedSteps,
    existingApprovals,
  }
}

/**
 * Deterministic canonical JSON serialization with recursive key sorting.
 * Ensures deeply nested fields (e.g. budget_caps.max_cost_minor_units) produce
 * reliable, tamper-evident hash comparisons across mutations.
 */
export function canonicalStableSerialize(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value)
  }
  if (Array.isArray(value)) {
    return '[' + value.map(canonicalStableSerialize).join(',') + ']'
  }
  const obj = value as Record<string, unknown>
  const sortedKeys = Object.keys(obj).sort()
  const entries = sortedKeys.map(
    (key) => `${JSON.stringify(key)}:${canonicalStableSerialize(obj[key])}`
  )
  return '{' + entries.join(',') + '}'
}

/**
 * Computes deterministic SHA-256 payload hash for idempotent mutation verification.
 */
export function computePayloadHash(payload: unknown): string {
  const normalized = canonicalStableSerialize(payload)
  return crypto.createHash('sha256').update(normalized).digest('hex')
}

/** The reviewed terms, not a content-publishing approval or an approval fingerprint. */
export function computeContractApprovalHash(contract: unknown): string {
  const validated = validateMissionContract(contract)
  // Round-trip through JSON so omitted optional fields hash identically after persistence.
  return computePayloadHash(JSON.parse(JSON.stringify({ ...validated, approval_fingerprint: null })))
}

/**
 * Generates an idempotency key combining mission_id, contract versions and nonce.
 */
export function generatePlanDiffIdempotencyKey(
  missionId: string,
  oldVersion: number,
  newVersion: number,
  intentSeed?: string
): string {
  const seed = intentSeed || `${oldVersion}_${newVersion}`
  const hash = crypto.createHash('sha256').update(`${missionId}:${seed}`).digest('hex').slice(0, 16)
  return `idemp_plan_${missionId.slice(0, 8)}_${hash}`
}

/**
 * Compares two MissionContracts and produces a verified PlanDiff.
 *
 * Invariants:
 * 1. An empty or ambiguous proposal sets `is_ambiguous: true` with 0 external writes.
 * 2. Unexecuted steps on changed channels are marked as impacted.
 * 3. Already submitted provider effects are immutable and preserved (never rolled back retroactively).
 * 4. Content modifications or scope expansion invalidate prior approvals.
 * 5. Preserved constraints explicitly list unchanged critical parameters (budget, price, target).
 */
export function computePlanDiff(
  oldContract: MissionContract,
  proposedPatch: Partial<MissionContract>,
  context: PlanDiffContext
): PlanDiff {
  // Validate old contract strictly
  const validatedOld = validateMissionContract(oldContract)

  // Construct proposed candidate with strict protection invariants:
  // 1. owner_actor is IMMUTABLE and cannot be forged by client patch
  // 2. forbidden_actions cannot be relaxed (old forbidden actions MUST persist)
  // 3. approval_fingerprint is invalidated on any contract mutation
  const mergedForbiddenActions = Array.from(
    new Set([...validatedOld.forbidden_actions, ...(proposedPatch.forbidden_actions || [])])
  )

  const nextVersion = validatedOld.contract_version + 1
  const candidateRaw: MissionContract = {
    ...validatedOld,
    ...proposedPatch,
    contract_version: nextVersion,
    owner_actor: validatedOld.owner_actor, // Protected field: NEVER trust patch
    forbidden_actions: mergedForbiddenActions, // Protected security policy: cannot remove forbidden actions
    approval_fingerprint: null, // Approval invalidated until re-approved
  }

  // Validate the resulting contract
  const validatedNew = validateMissionContract(candidateRaw)

  const changedFields: FieldDiff[] = []
  const preservedConstraints: string[] = []
  const invalidatedApprovals: string[] = []

  // 1. Goal diff
  if (validatedOld.goal !== validatedNew.goal) {
    changedFields.push({
      field: 'goal',
      old_value: validatedOld.goal,
      new_value: validatedNew.goal,
      description_ko: `목표 변경: "${validatedOld.goal}" -> "${validatedNew.goal}"`,
    })
    invalidatedApprovals.push('goal_approval')
  } else {
    preservedConstraints.push(`목표 유지: ${validatedOld.goal}`)
  }

  // 2. Service Scope diff
  const oldScope = [...validatedOld.service_scope].sort()
  const newScope = [...validatedNew.service_scope].sort()
  const scopeChanged = JSON.stringify(oldScope) !== JSON.stringify(newScope)
  if (scopeChanged) {
    changedFields.push({
      field: 'service_scope',
      old_value: validatedOld.service_scope,
      new_value: validatedNew.service_scope,
      description_ko: `실행 채널 범위 변경: [${validatedOld.service_scope.join(', ')}] -> [${validatedNew.service_scope.join(', ')}]`,
    })
  } else {
    preservedConstraints.push(`채널 범위 유지: ${validatedOld.service_scope.join(', ')}`)
  }

  // 3. Budget Caps diff
  const oldCost = validatedOld.budget_caps.max_cost_minor_units
  const newCost = validatedNew.budget_caps.max_cost_minor_units
  const costDiff = newCost - oldCost
  if (costDiff !== 0 || validatedOld.budget_caps.currency !== validatedNew.budget_caps.currency) {
    changedFields.push({
      field: 'budget_caps',
      old_value: validatedOld.budget_caps,
      new_value: validatedNew.budget_caps,
      description_ko: `예산 변경: ${oldCost.toLocaleString()} ${validatedOld.budget_caps.currency} -> ${newCost.toLocaleString()} ${validatedNew.budget_caps.currency} (차액: ${costDiff >= 0 ? '+' : ''}${costDiff.toLocaleString()})`,
    })
    invalidatedApprovals.push('budget_approval')
  } else {
    preservedConstraints.push(`예산 상한 및 통화 유지: ${oldCost.toLocaleString()} ${validatedOld.budget_caps.currency}`)
  }

  // 4. Success Criterion diff
  const oldTarget = validatedOld.success_criterion.target_value
  const newTarget = validatedNew.success_criterion.target_value
  if (
    oldTarget !== newTarget ||
    validatedOld.success_criterion.metric !== validatedNew.success_criterion.metric
  ) {
    changedFields.push({
      field: 'success_criterion',
      old_value: validatedOld.success_criterion,
      new_value: validatedNew.success_criterion,
      description_ko: `성과 기준 변경: ${validatedOld.success_criterion.metric}=${oldTarget} -> ${validatedNew.success_criterion.metric}=${newTarget}`,
    })
    invalidatedApprovals.push('criterion_approval')
  } else {
    preservedConstraints.push(`성과 목표 유지: ${validatedOld.success_criterion.metric} ${oldTarget}${validatedOld.success_criterion.unit || ''}`)
  }

  // 5. Allowed / Forbidden Actions diff
  const oldAllowed = [...validatedOld.allowed_actions].sort().join(',')
  const newAllowed = [...validatedNew.allowed_actions].sort().join(',')
  if (oldAllowed !== newAllowed) {
    changedFields.push({
      field: 'allowed_actions',
      old_value: validatedOld.allowed_actions,
      new_value: validatedNew.allowed_actions,
      description_ko: `허용 행동 변경: [${validatedOld.allowed_actions.join(', ')}] -> [${validatedNew.allowed_actions.join(', ')}]`,
    })
    invalidatedApprovals.push('action_permissions_approval')
  }

  // 6. Observation window diff
  if (
    validatedOld.observation_window.start_at !== validatedNew.observation_window.start_at ||
    validatedOld.observation_window.end_at !== validatedNew.observation_window.end_at
  ) {
    changedFields.push({
      field: 'observation_window',
      old_value: validatedOld.observation_window,
      new_value: validatedNew.observation_window,
      description_ko: `관측 기간 변경: ${validatedOld.observation_window.start_at} ~ ${validatedOld.observation_window.end_at} -> ${validatedNew.observation_window.start_at} ~ ${validatedNew.observation_window.end_at}`,
    })
  } else {
    preservedConstraints.push(`관측 기간 유지: ${validatedOld.observation_window.start_at} ~ ${validatedOld.observation_window.end_at}`)
  }

  // 7. Calculate impacted unexecuted steps
  const unexecutedSteps = context.unexecutedSteps || []
  const impactedUnexecutedSteps: string[] = []

  const removedChannels = validatedOld.service_scope.filter(
    (ch) => !validatedNew.service_scope.includes(ch)
  )

  for (const step of unexecutedSteps) {
    const isStepForRemovedChannel = removedChannels.some((ch) =>
      step.toLowerCase().includes(ch.toLowerCase())
    )
    if (isStepForRemovedChannel || scopeChanged || changedFields.length > 0) {
      impactedUnexecutedSteps.push(step)
    }
  }

  // 8. Invalidate existing approvals if scope changed or critical fields changed
  if (context.existingApprovals && context.existingApprovals.length > 0) {
    if (scopeChanged || changedFields.length > 0) {
      invalidatedApprovals.push(...context.existingApprovals)
    }
  }

  const uniqueInvalidatedApprovals = Array.from(new Set(invalidatedApprovals))
  const requiresReapproval = uniqueInvalidatedApprovals.length > 0 || changedFields.length > 0

  const payloadHash = computePayloadHash({
    mission_id: context.missionId,
    old_version: validatedOld.contract_version,
    new_version: validatedNew.contract_version,
    changed_fields: changedFields,
    proposed_contract: validatedNew,
  })

  const idempotencyKey =
    context.idempotencyKey ||
    generatePlanDiffIdempotencyKey(
      context.missionId,
      validatedOld.contract_version,
      validatedNew.contract_version,
      payloadHash
    )

  return {
    mission_id: context.missionId,
    old_contract_version: validatedOld.contract_version,
    new_contract_version: validatedNew.contract_version,
    expected_snapshot_version: context.expectedSnapshotVersion,
    idempotency_key: idempotencyKey,
    payload_hash: payloadHash,
    changed_fields: changedFields,
    preserved_constraints: preservedConstraints,
    impacted_unexecuted_steps: impactedUnexecutedSteps,
    already_submitted_effects: context.alreadySubmittedEffects || [],
    invalidated_approvals: uniqueInvalidatedApprovals,
    requires_reapproval: requiresReapproval,
    cost_difference_minor_units: costDiff,
    is_ambiguous: false,
    proposed_contract: validatedNew,
    created_at: new Date().toISOString(),
  }
}

/**
 * Natural language intent parser for conversational mission modification.
 *
 * Rules:
 * - "인스타만, 예산 그대로": Targets current mission, restricts scope to ['instagram'],
 *   strictly preserves budget_caps and pricing. NEVER creates a new mission or changes customer price.
 * - "그만해 / 멈춰 / 일시정지": Marks request as pause intent.
 * - Ambiguous inputs ("그거 좀 바꿔줘", "다른 걸로 해봐", 대상 불명확):
 *   Marks is_ambiguous: true, clarification_prompt provided, 0 external writes.
 */
export function parseMissionModificationIntent(
  userText: string,
  currentContract: MissionContract,
  context: PlanDiffContext
): {
  planDiff: PlanDiff | null
  isAmbiguous: boolean
  isPauseIntent: boolean
  clarificationPrompt?: string
} {
  const text = userText.trim()

  // 1. Pause intent check
  if (/(?:그만해|멈춰|중지|일시정지|pause|stop)/i.test(text)) {
    return {
      planDiff: null,
      isAmbiguous: false,
      isPauseIntent: true,
      clarificationPrompt: '현재 진행 중인 미션을 일시정지(PAUSE)할게요. 이미 제출된 요청은 외부 readback으로 안전하게 확인해요.',
    }
  }

  // 2. Ambiguity check: Vague pronouns without actionable directives
  const isVague =
    /^(?:그거|이거|저거|그것|이것)?\s*(?:좀|그냥)?\s*(?:바꿔\s*줘|바꿔|수정해\s*줘|수정해|고쳐\s*줘|고쳐|다르게\s*해\s*줘|다르게|변경해\s*줘|변경해|해봐)\s*[.?]?$/i.test(text) ||
    (text.length < 5 && !/(?:인스타|스레드|예산|비용|가격)/.test(text))

  if (isVague) {
    return {
      planDiff: null,
      isAmbiguous: true,
      isPauseIntent: false,
      clarificationPrompt: '사장님, 어떤 부분을 변경할까요? (예: "인스타만 진행해줘", "예산 5만원으로 조정해줘")',
    }
  }

  // 3. '인스타만, 예산 그대로' / 채널 한정 의도
  const mentionsInstagramOnly = /(?:인스타(?:그램)?만|instagram\s*only)/i.test(text)
  const mentionsThreadsOnly = /(?:스레드만|threads\s*only)/i.test(text)
  const mentionsKeepBudget = /(?:예산\s*(?:그대로|유지|안\s*바꿈)|비용\s*그대로|가격\s*그대로)/i.test(text)

  if (mentionsInstagramOnly || mentionsThreadsOnly) {
    const targetChannel = mentionsInstagramOnly ? 'instagram' : 'threads'
    const newScope = [targetChannel]

    // Construct proposed patch
    const patch: Partial<MissionContract> = {
      service_scope: newScope,
    }

    // If user explicitly says '예산 그대로' or doesn't mention budget change, strictly preserve budget_caps
    if (mentionsKeepBudget || !/(?:예산|비용|원)/.test(text)) {
      patch.budget_caps = {
        max_cost_minor_units: currentContract.budget_caps.max_cost_minor_units,
        currency: currentContract.budget_caps.currency,
      }
    }

    const diff = computePlanDiff(currentContract, patch, context)
    return {
      planDiff: diff,
      isAmbiguous: false,
      isPauseIntent: false,
    }
  }

  // 4. Budget change intent
  const budgetMatch = text.match(/(\d+(?:,\d+)*(?:\s*만\s*원|\s*원)?)\s*(?:으로|로)?\s*(?:예산|비용)/i) ||
                      text.match(/예산\s*(\d+(?:,\d+)*(?:\s*만\s*원|\s*원)?)/i)

  if (budgetMatch) {
    const rawNumStr = budgetMatch[1].replace(/,/g, '').trim()
    let minorUnits = 0
    if (rawNumStr.includes('만')) {
      const num = parseFloat(rawNumStr.replace(/[^0-9.]/g, ''))
      minorUnits = Math.round(num * 10000)
    } else {
      const num = parseFloat(rawNumStr.replace(/[^0-9.]/g, ''))
      minorUnits = Math.round(num)
    }

    if (minorUnits > 0) {
      const patch: Partial<MissionContract> = {
        budget_caps: {
          max_cost_minor_units: minorUnits,
          currency: currentContract.budget_caps.currency,
        },
      }
      const diff = computePlanDiff(currentContract, patch, context)
      return {
        planDiff: diff,
        isAmbiguous: false,
        isPauseIntent: false,
      }
    }
  }

  // 5. Fallback: If not clear, treat as ambiguous rather than mutating without certainty
  return {
    planDiff: null,
    isAmbiguous: true,
    isPauseIntent: false,
    clarificationPrompt: '사장님의 지시 내용을 더 명확히 확인한 후 계획을 변경할게요. (확인 전에는 외부 쓰기를 하지 않아요)',
  }
}
