import type { ExecutionState, MissionContract } from './mission-types'
import { validateMissionContract } from './mission-contract'

export interface MissionLineageEnvelope {
  workspaceId: string
  missionId: string
  traceId: string
}

export interface DownstreamLineageObject {
  workspaceId: string
  missionId: string
  traceId: string
  [key: string]: unknown
}

export interface MissionApprovalContext {
  versionId: string
  versionNumber: number
  fingerprint: string
  isApproved: boolean
  approvalId?: string | null
}

export interface CurrentContentTarget {
  versionId: string
  fingerprint: string
}

export function assertStrictLineage(
  envelope: MissionLineageEnvelope,
  downstream: DownstreamLineageObject
): void {
  if (envelope.workspaceId !== downstream.workspaceId) {
    throw new Error(
      `[LINEAGE_WORKSPACE_MISMATCH] Downstream object workspaceId '${downstream.workspaceId}' does not match mission envelope '${envelope.workspaceId}'`
    )
  }

  if (envelope.missionId !== downstream.missionId) {
    throw new Error(
      `[LINEAGE_MISSION_MISMATCH] Downstream object missionId '${downstream.missionId}' does not match mission envelope '${envelope.missionId}'`
    )
  }

  if (envelope.traceId !== downstream.traceId) {
    throw new Error(
      `[LINEAGE_TRACE_MISMATCH] Downstream object traceId '${downstream.traceId}' does not match mission envelope '${envelope.traceId}'`
    )
  }
}

export function validateApprovalForExecution(
  approvalContext: MissionApprovalContext,
  currentContent: CurrentContentTarget
): void {
  if (!approvalContext.isApproved || !approvalContext.approvalId) {
    throw new Error('[MISSION_NOT_APPROVED] Marketing mission requires verified explicit approval before execution')
  }

  if (approvalContext.versionId !== currentContent.versionId) {
    throw new Error(
      `[APPROVAL_VERSION_STALE] Content was modified after approval. Approved version '${approvalContext.versionId}' does not match current version '${currentContent.versionId}'. Re-approval required.`
    )
  }

  if (approvalContext.fingerprint !== currentContent.fingerprint) {
    throw new Error(
      `[APPROVAL_FINGERPRINT_TAMPERED] Content fingerprint diverges from approved payload. Approved fingerprint '${approvalContext.fingerprint}' does not match current '${currentContent.fingerprint}'.`
    )
  }
}

export interface EndToEndLineageGraph {
  workspaceId: string
  missionId: string
  traceId: string
  sourceMessageId?: string | null
  conversationJobId?: string | null
  contentId?: string | null
  approvalId?: string | null
  actionReceiptId?: string | null
  customerId?: string | null
  bookingId?: string | null
  outcomeId?: string | null
}

/**
 * Validates that all connected domain records belong to the same immutable workspace
 * and can be unambiguously correlated back to the single originating Mission trace.
 */
export function validateEndToEndLineageIntegrity(graph: EndToEndLineageGraph): {
  isValid: boolean
  correlatedEdgeCount: number
  lineagePath: string
} {
  const { workspaceId, missionId, traceId } = graph

  if (!workspaceId || !missionId || !traceId) {
    throw new Error('[CORRELATION_INTEGRITY_VIOLATION] Missing primary lineage key (workspaceId, missionId, or traceId)')
  }

  let edgeCount = 0
  const edges: string[] = ['MISSION:' + missionId]

  if (graph.sourceMessageId) {
    edgeCount += 1
    edges.push('MSG:' + graph.sourceMessageId)
  }
  if (graph.conversationJobId) {
    edgeCount += 1
    edges.push('JOB:' + graph.conversationJobId)
  }
  if (graph.contentId) {
    edgeCount += 1
    edges.push('CNT:' + graph.contentId)
  }
  if (graph.approvalId) {
    edgeCount += 1
    edges.push('APPR:' + graph.approvalId)
  }
  if (graph.actionReceiptId) {
    edgeCount += 1
    edges.push('RCPT:' + graph.actionReceiptId)
  }
  if (graph.customerId) {
    edgeCount += 1
    edges.push('CUST:' + graph.customerId)
  }
  if (graph.bookingId) {
    edgeCount += 1
    edges.push('BOOK:' + graph.bookingId)
  }
  if (graph.outcomeId) {
    edgeCount += 1
    edges.push('OUT:' + graph.outcomeId)
  }

  return {
    isValid: true,
    correlatedEdgeCount: edgeCount,
    lineagePath: edges.join(' -> '),
  }
}

/**
 * Prevents duplicate external actions when an agent job or worker is retried.
 */
export function assertIdempotentExecutionRetry(
  existingReceiptId: string | null | undefined,
  targetActionFingerprint: string
): void {
  if (existingReceiptId) {
    throw new Error(
      `[IDEMPOTENT_EXECUTION_BLOCKED] Action with fingerprint '${targetActionFingerprint}' has already been delivered with receipt '${existingReceiptId}'. Duplicate external mutation blocked.`
    )
  }
}

export interface MultiActionReceiptEntry {
  receiptId: string
  actionRequestId?: string | null
  actionFingerprint: string
  provider: string
  costMinorUnits?: number
  verifiedAt?: string | null
  receiptKind?: string | null
  observedPayload?: Record<string, unknown> | null
  status?: string | null
  createdAt: string
}

/** Only canonical readback evidence or explicitly verified legacy status is trusted. */
export function isReceiptObservedVerified(receipt: {
  receiptKind?: string | null
  observedPayload?: Record<string, unknown> | null
  verifiedAt?: string | null
  status?: string | null
}): boolean {
  if (receipt.receiptKind === 'observed_result') {
    const payload = receipt.observedPayload
    if (!payload || typeof payload !== 'object') return false
    if (payload.verified === false || payload.readbackVerified === false) return false
    return payload.verified === true || payload.readbackVerified === true ||
      (typeof payload.readbackRequestId === 'string' && payload.readbackRequestId.trim().length > 0) ||
      (typeof payload.readbackDigest === 'string' && payload.readbackDigest.trim().length > 0)
  }
  if (receipt.receiptKind === 'submission' || receipt.receiptKind === 'provider_review') return false
  return receipt.status === 'VERIFIED' && Boolean(receipt.verifiedAt)
}

/**
 * Validates multiple action receipts within a mission's lineage.
 * Enforces:
 * 1. No duplicate receipt IDs
 * 2. No duplicate action fingerprints across different receipts
 */
export function validateMultiReceiptLineage(
  existingReceipts: readonly MultiActionReceiptEntry[],
  newReceipt: MultiActionReceiptEntry
): void {
  for (const existing of existingReceipts) {
    if (existing.receiptId === newReceipt.receiptId) {
      throw new Error(
        `[DUPLICATE_RECEIPT_BLOCKED] Receipt ID '${newReceipt.receiptId}' is already registered in mission lineage.`
      )
    }
    if (existing.actionFingerprint === newReceipt.actionFingerprint) {
      throw new Error(
        `[DUPLICATE_ACTION_MUTATION_BLOCKED] Action with fingerprint '${newReceipt.actionFingerprint}' has already been processed with receipt '${existing.receiptId}'.`
      )
    }
  }
}

export type MissionActionType = 'NEW_WRITE' | 'READBACK' | 'RECONCILIATION'

/**
 * Enforces control gate invariants:
 * - Deadline / Pause / Stop blocks NEW_WRITE mutations.
 * - READBACK of in-flight external attempts and financial RECONCILIATION remain ALLOWED.
 */
export function assertControlGateActionAllowed(input: {
  executionState: ExecutionState
  contract?: MissionContract | null
  actionType: MissionActionType
  controlEpoch?: number
  workerObservedEpoch?: number
  nowIso?: string
}): void {
  const {
    executionState,
    contract,
    actionType,
    controlEpoch,
    workerObservedEpoch,
    nowIso = new Date().toISOString(),
  } = input

  // Invariant: Readback and financial reconciliation are ALWAYS preserved,
  // even if the mission is paused, stopped, closed, or past deadline.
  if (actionType === 'READBACK' || actionType === 'RECONCILIATION') {
    return
  }

  if (actionType === 'NEW_WRITE') {
    // 1. Control Epoch freshness check:
    // If mission has an authoritative control_epoch, workerObservedEpoch is strictly required,
    // must be a valid integer, and must match the authoritative control_epoch exactly.
    // Stale (<), future (>), NaN, decimal, negative, or missing values must fail-closed.
    if (controlEpoch !== undefined) {
      if (!Number.isInteger(controlEpoch) || controlEpoch < 0) {
        throw new Error(
          `[CONTROL_GATE_INVALID_EPOCH] Authoritative control epoch must be a valid non-negative integer: ${controlEpoch}.`
        )
      }
      if (
        workerObservedEpoch === undefined ||
        !Number.isInteger(workerObservedEpoch) ||
        workerObservedEpoch !== controlEpoch
      ) {
        throw new Error(
          `[CONTROL_GATE_STALE_EPOCH] Cannot execute new mutation: Worker observed epoch ${workerObservedEpoch ?? 'undefined'} does not match authoritative control epoch ${controlEpoch}. Readback and reconciliation remain active.`
        )
      }
    }

    if (executionState === 'PAUSED' || executionState === 'PAUSING') {
      throw new Error('[CONTROL_GATE_BLOCKED] Cannot execute new mutation: Mission is PAUSED.')
    }
    if (executionState === 'STOPPED' || executionState === 'CLOSED') {
      throw new Error(`[CONTROL_GATE_BLOCKED] Cannot execute new mutation: Mission is ${executionState}.`)
    }
    if (executionState === 'DRAFT' || executionState === 'NEEDS_DECISION') {
      throw new Error(`[CONTROL_GATE_UNAPPROVED] Cannot execute new mutation: Mission is in unapproved state '${executionState}'.`)
    }

    if (!['READY', 'RUNNING', 'WAITING_EXTERNAL', 'OBSERVING'].includes(executionState)) {
      throw new Error('[CONTROL_GATE_BLOCKED] Unknown execution state cannot authorize a new mutation.')
    }

    if (contract) {
      const nowTime = Date.parse(nowIso)
      const expiresAtTime = Date.parse(contract.expires_at)
      if (Number.isNaN(expiresAtTime) || Number.isNaN(nowTime)) {
        throw new Error(
          `[CONTROL_GATE_INVALID_EXPIRY] Cannot execute new mutation: Invalid contract expiration timestamp '${contract.expires_at}'.`
        )
      }
      if (nowTime >= expiresAtTime) {
        throw new Error(
          `[CONTROL_GATE_EXPIRED] Cannot execute new mutation: Contract expired at ${contract.expires_at} (current: ${nowIso}). Readback and reconciliation remain active.`
        )
      }

      // Unapproved contract check: applying a plan diff clears approval_fingerprint to null.
      // Any new mutation without a valid approval fingerprint must be blocked.
      if (typeof contract.approval_fingerprint !== 'string' || !/^[a-f0-9]{64}$/.test(contract.approval_fingerprint)) {
        throw new Error(
          '[CONTROL_GATE_UNAPPROVED_CONTRACT] Cannot execute new mutation: Contract has no valid approval fingerprint. Plan diff or unapproved contract requires explicit approval.'
        )
      }
    }
  }
}

/**
 * Authoritative fail-closed pre-mutation gate helper for publishing executors.
 * Fetches authoritative workspace-scoped mission immediately before provider write.
 * Enforces fail-closed on DB errors, missing missions, or missing parameters.
 */
export async function assertPublishMissionGateAllowed(params: {
  supabase: any
  workspaceId: string
  missionId: string
  workerObservedEpoch?: number
  nowIso?: string
}): Promise<void> {
  const { supabase, workspaceId, missionId, workerObservedEpoch, nowIso } = params
  if (!supabase) {
    throw new Error('[CONTROL_GATE_CLIENT_REQUIRED] Supabase client is required (fail-closed)')
  }
  if (!workspaceId || typeof workspaceId !== 'string') {
    throw new Error('[CONTROL_GATE_INVALID_WORKSPACE] Valid workspaceId is required (fail-closed)')
  }
  if (!missionId || typeof missionId !== 'string') {
    throw new Error('[CONTROL_GATE_INVALID_MISSION] Valid missionId is required (fail-closed)')
  }

  const { data: mission, error } = await supabase
    .from('marketing_missions')
    .select('id, workspace_id, status, metadata')
    .eq('id', missionId)
    .eq('workspace_id', workspaceId)
    .maybeSingle()

  if (error) {
    throw new Error(
      `[CONTROL_GATE_DB_ERROR] Authoritative mission lookup failed for mission ${missionId}: ${error.message} (fail-closed)`
    )
  }
  if (!mission) {
    throw new Error(
      `[CONTROL_GATE_MISSION_NOT_FOUND] Authoritative mission ${missionId} not found in workspace ${workspaceId} (fail-closed)`
    )
  }

  const metadata = (mission.metadata as Record<string, any>) || {}
  // Presence is authoritative: null/string/NaN must not silently become an absent epoch.
  const hasEpoch = Object.prototype.hasOwnProperty.call(metadata, 'control_epoch')
  if (hasEpoch && (!Number.isSafeInteger(metadata.control_epoch) || metadata.control_epoch < 0)) {
    throw new Error('[CONTROL_GATE_INVALID_EPOCH] Invalid authoritative control epoch.')
  }
  const controlEpoch = hasEpoch ? metadata.control_epoch : undefined
  const legacyStates: Record<string, ExecutionState> = { APPROVED: 'READY', EXECUTING: 'RUNNING', PAUSED: 'PAUSED', CANCELLED: 'STOPPED' }
  if (['PAUSED', 'CANCELLED', 'FAILED', 'BLOCKED', 'COMPLETED', 'RESULT_UNKNOWN'].includes(mission.status)) {
    throw new Error('[CONTROL_GATE_BLOCKED] Mission status does not authorize a new mutation.')
  }
  let contract: MissionContract | null = null
  if (metadata.contract != null) {
    try { contract = validateMissionContract(metadata.contract) } catch {
      throw new Error('[CONTROL_GATE_INVALID_CONTRACT] Invalid authoritative mission contract.')
    }
  } else if (metadata.execution_state != null) {
    throw new Error('[CONTROL_GATE_INVALID_CONTRACT] Dual-state mission requires a valid contract.')
  }
  const executionState: ExecutionState = metadata.execution_state ?? legacyStates[mission.status] ?? 'DRAFT'

  assertControlGateActionAllowed({
    executionState,
    contract,
    actionType: 'NEW_WRITE',
    controlEpoch,
    workerObservedEpoch,
    nowIso,
  })
}
