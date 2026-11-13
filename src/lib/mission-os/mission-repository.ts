import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/supabase/database.types'
import {
  assertValidMissionTransition,
  assertValidOutcomeTransition,
  type MissionStatus,
  type MissionActorType,
  type MarketingMissionAggregate,
  type MissionEvent,
  assertOutcomeEvidenceInvariant,
} from './mission-state-machine'
import {
  assertStrictLineage,
  assertControlGateActionAllowed,
  type MultiActionReceiptEntry,
  validateMultiReceiptLineage,
  isReceiptObservedVerified,
} from './mission-lineage-guard'
import {
  validateMissionContract,
  evaluateOutcomeState,
  type MissionContract,
  type ObservationEvidence,
  type ExecutionState,
  type OutcomeState,
} from './mission-contract'
import type { PlanDiff } from './mission-plan-diff'

export interface ApplyPlanDiffParams {
  workspaceId: string
  missionId: string
  traceId: string
  expectedSnapshotVersion: number
  diff: PlanDiff
  actorType?: MissionActorType
  actorId?: string | null
}

export interface PauseMissionParams {
  workspaceId: string
  missionId: string
  traceId: string
  expectedSnapshotVersion: number
  actorType?: MissionActorType
  actorId?: string | null
  reason?: string
}

export interface CreateMissionWithContractParams {
  workspaceId: string
  traceId: string
  contract: unknown
  initialExecutionState?: ExecutionState
  sourceMessageId?: string | null
  sourceConversationJobId?: string | null
  actorType?: MissionActorType
  actorId?: string | null
}

export interface UpdateMissionContractParams {
  workspaceId: string
  missionId: string
  traceId: string
  expectedSnapshotVersion: number
  newContract: unknown
  actorType?: MissionActorType
  actorId?: string | null
}

export interface RecordObservationEvidenceParams {
  workspaceId: string
  missionId: string
  traceId: string
  expectedSnapshotVersion: number
  evidence: ObservationEvidence
  actorType?: MissionActorType
  actorId?: string | null
  nowIso?: string
}

export interface RecordActionReceiptParams {
  workspaceId: string
  missionId: string
  traceId: string
  expectedSnapshotVersion: number
  receipt: MultiActionReceiptEntry
  actorType?: MissionActorType
  actorId?: string | null
  nowIso?: string
}

export interface CreateMissionParams {
  workspaceId: string
  traceId: string
  goal: string
  strategySummary?: string | null
  targetChannel?: string | null
  targetAudience?: string | null
  sourceMessageId?: string | null
  sourceConversationJobId?: string | null
  metadata?: Record<string, unknown>
  actorType?: MissionActorType
  actorId?: string | null
}

export interface TransitionMissionParams {
  workspaceId: string
  missionId: string
  traceId: string
  toStatus: MissionStatus
  actorType: MissionActorType
  actorId?: string | null
  eventName: string
  payload?: Record<string, unknown>
  downstreamUpdates?: Partial<Omit<MarketingMissionAggregate, 'id' | 'workspace_id' | 'trace_id' | 'status' | 'created_at' | 'updated_at'>>
}

export interface UpdateMissionLineageParams {
  workspaceId: string
  missionId: string
  traceId: string
  sourceConversationJobId?: string | null
  contentItemId?: string | null
  contentVersionId?: string | null
  approvalId?: string | null
  creativeBundleId?: string | null
  actionRequestId?: string | null
  actionAttemptId?: string | null
  actionReceiptId?: string | null
  providerPostReference?: string | null
  customerId?: string | null
  bookingId?: string | null
  actorType?: MissionActorType
  actorId?: string | null
  reason?: string
}

export class MissionRepository {
  constructor(private client: SupabaseClient<Database>) {}

  async createMission(params: CreateMissionParams): Promise<MarketingMissionAggregate> {
    const {
      workspaceId,
      traceId,
      goal,
      strategySummary = null,
      targetChannel = null,
      targetAudience = null,
      sourceMessageId = null,
      sourceConversationJobId = null,
      metadata = {},
      actorType = 'user',
      actorId = null,
    } = params

    const now = new Date().toISOString()

    const { data: mission, error: missionError } = await (this.client as any)
      .from('marketing_missions')
      .insert({
        workspace_id: workspaceId,
        trace_id: traceId,
        status: 'RECEIVED',
        goal,
        strategy_summary: strategySummary,
        target_channel: targetChannel,
        target_audience: targetAudience,
        source_message_id: sourceMessageId,
        source_conversation_job_id: sourceConversationJobId,
        metadata,
        created_at: now,
        updated_at: now,
      })
      .select()
      .single()

    if (missionError || !mission) {
      throw new Error(`[MISSION_CREATE_FAILED] ${missionError?.message || 'Unknown database error'}`)
    }

    // Append-only audit transition event
    const { error: eventError } = await (this.client as any)
      .from('mission_events')
      .insert({
        workspace_id: workspaceId,
        mission_id: mission.id,
        trace_id: traceId,
        from_status: null,
        to_status: 'RECEIVED',
        actor_type: actorType,
        actor_id: actorId,
        event_name: 'MISSION_RECEIVED',
        payload: { goal, targetChannel, strategySummary },
        occurred_at: now,
      })

    if (eventError) {
      console.warn('[MissionRepository] Notice: event append warning:', eventError)
    }

    return mission as MarketingMissionAggregate
  }

  async transitionMission(params: TransitionMissionParams): Promise<MarketingMissionAggregate> {
    const {
      workspaceId,
      missionId,
      traceId,
      toStatus,
      actorType,
      actorId = null,
      eventName,
      payload = {},
      downstreamUpdates = {},
    } = params

    // 1. Fetch current mission aggregate with strict workspace check
    const { data: current, error: fetchError } = await (this.client as any)
      .from('marketing_missions')
      .select()
      .eq('id', missionId)
      .eq('workspace_id', workspaceId)
      .single()

    if (fetchError || !current) {
      throw new Error(`[MISSION_NOT_FOUND] Mission '${missionId}' not found in workspace '${workspaceId}'`)
    }

    // 2. Strict lineage invariant check
    assertStrictLineage(
      { workspaceId, missionId, traceId },
      { workspaceId: current.workspace_id, missionId: current.id, traceId: current.trace_id }
    )

    // 3. State machine validation
    assertValidMissionTransition(current.status as MissionStatus, toStatus)

    const now = new Date().toISOString()

    // 4. Update mission aggregate
    const mergedMetadata = {
      ...(current.metadata || {}),
      ...((downstreamUpdates as any).metadata || {}),
    }

    // Contract-bearing missions must NOT use legacy transitionMission mutator
    // to prevent desync of dual-state execution/outcome machines or dropping downstream updates.
    if (current.metadata?.contract) {
      throw new Error(
        '[CONTRACT_COMMAND_REQUIRED] Cannot transition contract-bearing mission using legacy transitionMission. Use dedicated contract lifecycle commands.'
      )
    }

    const updatePayload: Record<string, unknown> = {
      status: toStatus,
      updated_at: now,
      ...downstreamUpdates,
      metadata: mergedMetadata,
    }

    const { data: updated, error: updateError } = await (this.client as any)
      .from('marketing_missions')
      .update(updatePayload)
      .eq('id', missionId)
      .eq('workspace_id', workspaceId)
      .select()
      .single()

    if (updateError || !updated) {
      throw new Error(`[MISSION_TRANSITION_FAILED] ${updateError?.message || 'Update failed'}`)
    }

    // 5. Append transition event
    const { error: eventError } = await (this.client as any)
      .from('mission_events')
      .insert({
        workspace_id: workspaceId,
        mission_id: missionId,
        trace_id: traceId,
        from_status: current.status,
        to_status: toStatus,
        actor_type: actorType,
        actor_id: actorId,
        event_name: eventName,
        payload,
        occurred_at: now,
      })

    if (eventError) {
      console.warn('[MissionRepository] Notice: event append error on transition:', eventError)
    }

    return updated as MarketingMissionAggregate
  }

  async getMissionById(missionId: string, workspaceId: string): Promise<MarketingMissionAggregate | null> {
    const { data, error } = await (this.client as any)
      .from('marketing_missions')
      .select()
      .eq('id', missionId)
      .eq('workspace_id', workspaceId)
      .maybeSingle()

    if (error) {
      throw new Error(`[MISSION_FETCH_ERROR] ${error.message || 'Database error fetching mission'}`)
    }
    if (!data) return null
    return data as MarketingMissionAggregate
  }

  async listWorkspaceMissions(workspaceId: string, limit = 20): Promise<MarketingMissionAggregate[]> {
    const { data, error } = await (this.client as any)
      .from('marketing_missions')
      .select()
      .eq('workspace_id', workspaceId)
      .order('created_at', { ascending: false })
      .limit(limit)

    if (error) {
      throw new Error(`[MISSION_LIST_ERROR] ${error.message || 'Database error listing missions'}`)
    }
    if (!data) return []
    return data as MarketingMissionAggregate[]
  }

  async updateMissionLineage(params: UpdateMissionLineageParams): Promise<MarketingMissionAggregate> {
    const {
      workspaceId,
      missionId,
      traceId,
      actorType = 'agent',
      actorId = null,
      reason = 'Update mission lineage bindings',
      ...updates
    } = params

    // 1. Fetch current mission aggregate with strict workspace check
    const { data: current, error: fetchError } = await (this.client as any)
      .from('marketing_missions')
      .select()
      .eq('id', missionId)
      .eq('workspace_id', workspaceId)
      .single()

    if (fetchError || !current) {
      throw new Error(`[MISSION_NOT_FOUND] Mission '${missionId}' not found in workspace '${workspaceId}'`)
    }

    // 2. Strict lineage invariant check
    assertStrictLineage(
      { workspaceId, missionId, traceId },
      { workspaceId: current.workspace_id, missionId: current.id, traceId: current.trace_id }
    )

    const now = new Date().toISOString()
    const updatePayload: Record<string, unknown> = {
      updated_at: now,
    }

    if (updates.sourceConversationJobId !== undefined) updatePayload.source_conversation_job_id = updates.sourceConversationJobId
    if (updates.contentItemId !== undefined) updatePayload.content_id = updates.contentItemId
    if (updates.contentVersionId !== undefined) updatePayload.content_version_id = updates.contentVersionId
    if (updates.approvalId !== undefined) updatePayload.approval_id = updates.approvalId
    if (updates.creativeBundleId !== undefined) {
      updatePayload.metadata = {
        ...(current.metadata || {}),
        creative_bundle_id: updates.creativeBundleId,
      }
    }
    if (updates.actionRequestId !== undefined) updatePayload.external_action_request_id = updates.actionRequestId
    if (updates.actionAttemptId !== undefined) updatePayload.external_action_attempt_id = updates.actionAttemptId
    if (updates.actionReceiptId !== undefined) updatePayload.external_action_receipt_id = updates.actionReceiptId
    if (updates.providerPostReference !== undefined) {
      updatePayload.metadata = {
        ...(current.metadata || {}),
        provider_post_reference: updates.providerPostReference,
      }
    }
    if (updates.customerId !== undefined) updatePayload.customer_id = updates.customerId
    if (updates.bookingId !== undefined) updatePayload.booking_id = updates.bookingId

    // Contract-bearing missions must NOT use legacy updateMissionLineage mutator
    // to prevent silent dropping of lineage fields or desynchronization.
    if (current.metadata?.contract) {
      throw new Error(
        '[CONTRACT_COMMAND_REQUIRED] Cannot update contract-bearing mission using legacy updateMissionLineage. Use dedicated contract commands.'
      )
    }

    const { data: updated, error: updateError } = await (this.client as any)
      .from('marketing_missions')
      .update(updatePayload)
      .eq('id', missionId)
      .eq('workspace_id', workspaceId)
      .select()
      .single()

    if (updateError || !updated) {
      throw new Error(`[MISSION_UPDATE_FAILED] ${updateError?.message || 'Update lineage failed'}`)
    }

    return updated as MarketingMissionAggregate
  }

  /**
   * Creates a mission aggregate backed by a typed, validated versioned MissionContract.
   * Initializes snapshot_version to 1 and enforces schema-compliant dual state in metadata.
   */
  async createMissionWithContract(params: CreateMissionWithContractParams): Promise<MarketingMissionAggregate> {
    const {
      workspaceId,
      traceId,
      initialExecutionState,
      sourceMessageId = null,
      sourceConversationJobId = null,
      actorType = 'user',
      actorId = null,
    } = params

    // 1. Validate contract invariants (fail-closed)
    const contract = validateMissionContract(params.contract)

    const execState: ExecutionState =
      initialExecutionState || (contract.approval_fingerprint ? 'READY' : 'DRAFT')
    const outState: OutcomeState = 'PENDING'
    const status: MissionStatus = contract.approval_fingerprint ? 'APPROVED' : 'RECEIVED'

    const initialMetadata: Record<string, unknown> = {
      contract,
      snapshot_version: 1,
      execution_state: execState,
      outcome_state: outState,
      observation_evidence: null,
      multi_receipts: [],
    }

    // Atomic creation: never fall back to separate inserts when the RPC is absent.
    const { data: mission, error: rpcError } = await (this.client as any).rpc(
      'create_mission_with_contract_atomic',
      {
        p_workspace_id: workspaceId,
        p_trace_id: traceId,
        p_status: status,
        p_goal: contract.goal,
        p_strategy_summary: `Contract v${contract.contract_version} (${contract.success_criterion.metric})`,
        p_target_channel: contract.service_scope[0] || null,
        p_target_audience: null,
        p_source_message_id: sourceMessageId,
        p_source_conversation_job_id: sourceConversationJobId,
        p_metadata: initialMetadata,
        p_actor_type: actorType,
        p_actor_id: actorId,
        p_event_name: 'MISSION_CONTRACT_INITIALIZED',
        p_event_payload: {
          contract_version: contract.contract_version,
          execution_state: execState,
          outcome_state: outState,
          snapshot_version: 1,
        },
      }
    )

    if (rpcError || !mission) {
      throw new Error(`[MISSION_CREATE_FAILED] ${rpcError?.message || 'Unknown database error'}`)
    }

    return mission as MarketingMissionAggregate
  }

  /**
   * Updates an existing MissionContract with optimistic concurrency validation against snapshot_version.
   * If snapshot_version does not match expectedSnapshotVersion, fails closed with STALE_SNAPSHOT_VERSION.
   */
  async updateMissionContract(params: UpdateMissionContractParams): Promise<MarketingMissionAggregate> {
    const {
      workspaceId,
      missionId,
      traceId,
      expectedSnapshotVersion,
      newContract,
      actorType = 'agent',
      actorId = null,
    } = params

    if (expectedSnapshotVersion === null || expectedSnapshotVersion === undefined) {
      throw new Error('[INVALID_SNAPSHOT_VERSION] expectedSnapshotVersion cannot be null or undefined')
    }

    // 1. Fetch current aggregate strictly within workspace
    const { data: current, error: fetchError } = await (this.client as any)
      .from('marketing_missions')
      .select()
      .eq('id', missionId)
      .eq('workspace_id', workspaceId)
      .single()

    if (fetchError || !current) {
      throw new Error(`[MISSION_NOT_FOUND] Mission '${missionId}' not found in workspace '${workspaceId}'`)
    }

    // 2. Strict lineage check
    assertStrictLineage(
      { workspaceId, missionId, traceId },
      { workspaceId: current.workspace_id, missionId: current.id, traceId: current.trace_id }
    )

    // 3. Validate updated contract
    const validated = validateMissionContract(newContract)

    // Enforce contract_version strictly increments
    const currentContract = (current.metadata?.contract as MissionContract) || null
    if (currentContract && validated.contract_version <= currentContract.contract_version) {
      throw new Error(
        `[CONTRACT_VERSION_NOT_INCREMENTED] New contract version (${validated.contract_version}) must be strictly greater than current version (${currentContract.contract_version})`
      )
    }

    const currentEvidence = (current.metadata?.observation_evidence as ObservationEvidence) || null

    // Unconditionally invalidate stale observation evidence and reset outcome_state to PENDING.
    // ObservationEvidence lacks metric/contract_version bindings, so reusing evidence across contract versions
    // risks falsely retaining ACHIEVED (e.g. when success_criterion.metric changes from bookings to revenue).
    const newEvidence: ObservationEvidence | null = null
    const newOutcomeState: OutcomeState = 'PENDING'

    // Status synchronization: if legacy status was OUTCOME_OBSERVED, revert to safe initial status (RECEIVED).
    // Receipt existence alone must never elevate status to PUBLISHED_VERIFIED when contract changes.
    let nextStatus = current.status
    if (current.status === 'OUTCOME_OBSERVED') {
      nextStatus = 'RECEIVED'
    }

    const updatedMetadata = {
      ...(current.metadata || {}),
      contract: validated,
      observation_evidence: newEvidence,
      outcome_state: newOutcomeState,
    }

    // 4. Atomic optimistic concurrency RPC update with row-level lock
    const { data: updated, error: rpcError } = await (this.client as any).rpc(
      'update_mission_snapshot_atomic',
      {
        p_workspace_id: workspaceId,
        p_mission_id: missionId,
        p_expected_snapshot_version: expectedSnapshotVersion,
        p_new_metadata: updatedMetadata,
        p_new_status: nextStatus !== current.status ? nextStatus : null,
        p_new_goal: validated.goal,
        p_actor_type: actorType,
        p_actor_id: actorId,
        p_event_name: 'MISSION_CONTRACT_UPDATED',
        p_event_payload: {
          previous_contract_version: currentContract?.contract_version ?? null,
          new_contract_version: validated.contract_version,
          outcome_state: newOutcomeState,
          evidence_invalidated: newEvidence === null && currentEvidence !== null,
        },
      }
    )

    if (rpcError || !updated) {
      throw new Error(`[MISSION_UPDATE_FAILED] ${rpcError?.message || 'RPC update failed'}`)
    }

    return updated as MarketingMissionAggregate
  }

  /**
   * Records observation evidence and deterministically evaluates outcome state.
   * Guarantees receipt alone != achieved, unobserved != zero, and optimistic concurrency versioning.
   */
  async recordObservationEvidence(params: RecordObservationEvidenceParams): Promise<MarketingMissionAggregate> {
    const {
      workspaceId,
      missionId,
      traceId,
      expectedSnapshotVersion,
      evidence,
      actorType = 'system',
      actorId = null,
      nowIso = new Date().toISOString(),
    } = params

    if (expectedSnapshotVersion === null || expectedSnapshotVersion === undefined) {
      throw new Error('[INVALID_SNAPSHOT_VERSION] expectedSnapshotVersion cannot be null or undefined')
    }

    // 1. Fetch current
    const { data: current, error: fetchError } = await (this.client as any)
      .from('marketing_missions')
      .select()
      .eq('id', missionId)
      .eq('workspace_id', workspaceId)
      .single()

    if (fetchError || !current) {
      throw new Error(`[MISSION_NOT_FOUND] Mission '${missionId}' not found in workspace '${workspaceId}'`)
    }

    // 2. Strict lineage check
    assertStrictLineage(
      { workspaceId, missionId, traceId },
      { workspaceId: current.workspace_id, missionId: current.id, traceId: current.trace_id }
    )

    const contract = (current.metadata?.contract as MissionContract) || null

    // 3. Evaluate outcome state with fail-closed invariants
    const nextOutcome = evaluateOutcomeState(contract, evidence, nowIso)

    const currentOutcome = (current.metadata?.outcome_state as OutcomeState) || 'PENDING'
    if (currentOutcome !== nextOutcome) {
      assertValidOutcomeTransition(currentOutcome, nextOutcome)
    }

    // 4. Enforce evidence invariant: posted receipt alone != ACHIEVED_VERIFIED
    assertOutcomeEvidenceInvariant({
      targetOutcome: nextOutcome,
      contract,
      evidence,
      receiptId: current.external_action_receipt_id,
      nowIso,
    })

    const updatedMetadata = {
      ...(current.metadata || {}),
      observation_evidence: currentOutcome === 'ACHIEVED_VERIFIED' && current.metadata?.observation_evidence
        ? current.metadata.observation_evidence
        : evidence,
      outcome_state: nextOutcome,
    }

    // Legacy status synchronization if outcome achieved
    let newStatus = current.status
    if (nextOutcome === 'ACHIEVED_VERIFIED' && current.status !== 'COMPLETED') {
      newStatus = 'OUTCOME_OBSERVED'
    }

    // 5. Atomic optimistic concurrency RPC update
    const { data: updated, error: rpcError } = await (this.client as any).rpc(
      'update_mission_snapshot_atomic',
      {
        p_workspace_id: workspaceId,
        p_mission_id: missionId,
        p_expected_snapshot_version: expectedSnapshotVersion,
        p_new_metadata: updatedMetadata,
        p_new_status: newStatus,
        p_actor_type: actorType,
        p_actor_id: actorId,
        p_event_name: 'MISSION_OUTCOME_EVALUATED',
        p_event_payload: {
          outcome_state: nextOutcome,
          observation_status: evidence.status,
          observed_value: evidence.observed_value,
        },
      }
    )

    if (rpcError || !updated) {
      throw new Error(`[MISSION_OUTCOME_RECORD_FAILED] ${rpcError?.message || 'RPC update failed'}`)
    }

    return updated as MarketingMissionAggregate
  }

  /**
   * Records an external action receipt in the mission's multi-receipt lineage.
   * Validates control gates (deadline/paused blocks new mutations, but readback/reconciliation remain active)
   * and prevents duplicate receipt IDs or action fingerprints.
   */
  async recordActionReceipt(params: RecordActionReceiptParams): Promise<MarketingMissionAggregate> {
    const {
      workspaceId,
      missionId,
      traceId,
      expectedSnapshotVersion,
      receipt,
      actorType = 'provider',
      actorId = null,
      nowIso = new Date().toISOString(),
    } = params

    if (expectedSnapshotVersion === null || expectedSnapshotVersion === undefined) {
      throw new Error('[INVALID_SNAPSHOT_VERSION] expectedSnapshotVersion cannot be null or undefined')
    }

    // 1. Fetch current
    const { data: current, error: fetchError } = await (this.client as any)
      .from('marketing_missions')
      .select()
      .eq('id', missionId)
      .eq('workspace_id', workspaceId)
      .single()

    if (fetchError || !current) {
      throw new Error(`[MISSION_NOT_FOUND] Mission '${missionId}' not found in workspace '${workspaceId}'`)
    }

    // 2. Strict lineage check
    assertStrictLineage(
      { workspaceId, missionId, traceId },
      { workspaceId: current.workspace_id, missionId: current.id, traceId: current.trace_id }
    )

    const contract = (current.metadata?.contract as MissionContract) || null
    const executionState = (current.metadata?.execution_state as ExecutionState) || 'RUNNING'

    // 3. Control gate check: recording a provider receipt is READBACK (preserved after PAUSED/expired!)
    assertControlGateActionAllowed({
      executionState,
      contract,
      actionType: 'READBACK',
      nowIso,
    })

    // 4. Lineage duplicate prevention in metadata
    const existingReceipts = (current.metadata?.multi_receipts as MultiActionReceiptEntry[]) || []
    validateMultiReceiptLineage(existingReceipts, receipt)

    // 5. Execution state progression: unverified receipt stays in WAITING_EXTERNAL (or preserves paused/stopped)
    const preserveStates: ExecutionState[] = ['PAUSED', 'PAUSING', 'STOPPED', 'CLOSED']
    const isReceiptVerified = isReceiptObservedVerified(receipt)
    const nextExecutionState: ExecutionState = preserveStates.includes(executionState)
      ? executionState
      : isReceiptVerified
        ? 'OBSERVING'
        : 'WAITING_EXTERNAL'

    const updatedReceipts = [...existingReceipts, receipt]

    const updatedMetadata = {
      ...(current.metadata || {}),
      multi_receipts: updatedReceipts,
      execution_state: nextExecutionState,
    }

    // 6. Atomic snapshot RPC: updates metadata, snapshots, atomic join entry, and audit event in a single transaction
    const { data: updated, error: rpcError } = await (this.client as any).rpc(
      'update_mission_snapshot_atomic',
      {
        p_workspace_id: workspaceId,
        p_mission_id: missionId,
        p_expected_snapshot_version: expectedSnapshotVersion,
        p_new_metadata: updatedMetadata,
        p_new_receipt_id: receipt.receiptId,
        p_actor_type: actorType,
        p_actor_id: actorId,
        p_event_name: 'ACTION_RECEIPT_RECORDED',
        p_event_payload: {
          receipt_id: receipt.receiptId,
          action_fingerprint: receipt.actionFingerprint,
          provider: receipt.provider,
        },
        p_receipt_entry: {
          receipt_id: receipt.receiptId,
          action_request_id: receipt.actionRequestId,
          action_fingerprint: receipt.actionFingerprint,
          provider: receipt.provider,
          cost_minor_units: receipt.costMinorUnits || 0,
          verified_at: receipt.verifiedAt || null,
          receipt_kind: receipt.receiptKind || null,
          observed_payload: receipt.observedPayload || null,
        },
      }
    )

    if (rpcError || !updated) {
      throw new Error(`[RECORD_RECEIPT_FAILED] ${rpcError?.message || 'RPC update failed'}`)
    }

    return updated as MarketingMissionAggregate
  }

  /** Durably bind once; retries are permitted only for the same workspace and mission. */
  async bindActionRequest(workspaceId: string, missionId: string, actionRequestId: string): Promise<void> {
    const { data, error } = await (this.client as any)
      .from('external_action_requests')
      .update({ mission_id: missionId })
      .eq('id', actionRequestId)
      .eq('workspace_id', workspaceId)
      .is('mission_id', null)
      .select('id, mission_id')
      .maybeSingle()
    if (error) throw new Error(`[BIND_ACTION_REQUEST_FAILED] ${error.message}`)
    if (data) return
    const { data: existing, error: fetchError } = await (this.client as any)
      .from('external_action_requests')
      .select('id, mission_id')
      .eq('id', actionRequestId)
      .eq('workspace_id', workspaceId)
      .maybeSingle()
    if (fetchError) throw new Error(`[BIND_ACTION_REQUEST_FAILED] ${fetchError.message}`)
    if (!existing) throw new Error(`[BIND_ACTION_REQUEST_FAILED] Action request '${actionRequestId}' not found in workspace '${workspaceId}'`)
    if (existing.mission_id === missionId) return
    throw new Error(`[BIND_ACTION_REQUEST_FAILED] Action request '${actionRequestId}' is already bound to another mission '${existing.mission_id}'`)
  }

  /**
   * Applies a verified PlanDiff to an existing mission atomically.
   * Enforces:
   * 1. Concurrency conflict check against expectedSnapshotVersion (returns 409 conflict error if stale)
   * 2. Idempotency key verification (no duplicate re-application)
   * 3. Contract version increment
   * 4. Atomic snapshot update and audit event recording via update_mission_snapshot_atomic RPC
   */
  async applyPlanDiffAtomic(params: ApplyPlanDiffParams): Promise<{
    mission: MarketingMissionAggregate
    diff: PlanDiff
  }> {
    const {
      workspaceId,
      missionId,
      traceId,
      expectedSnapshotVersion,
      diff,
      actorType = 'user',
      actorId = null,
    } = params

    if (expectedSnapshotVersion === null || expectedSnapshotVersion === undefined) {
      throw new Error('[INVALID_SNAPSHOT_VERSION] expectedSnapshotVersion cannot be null or undefined')
    }

    // 1. Fetch current mission
    const { data: current, error: fetchError } = await (this.client as any)
      .from('marketing_missions')
      .select()
      .eq('id', missionId)
      .eq('workspace_id', workspaceId)
      .single()

    if (fetchError || !current) {
      throw new Error(`[MISSION_NOT_FOUND] Mission '${missionId}' not found in workspace '${workspaceId}'`)
    }

    // 2. Lineage invariant check
    assertStrictLineage(
      { workspaceId, missionId, traceId },
      { workspaceId: current.workspace_id, missionId: current.id, traceId: current.trace_id }
    )

    // 3. Idempotency replay check (BEFORE stale check to safely replay duplicate submissions)
    const existingIdempMap: Record<string, string> =
      current.metadata?.applied_plan_idempotency_map &&
      typeof current.metadata.applied_plan_idempotency_map === 'object'
        ? current.metadata.applied_plan_idempotency_map
        : {}

    const existingIdempKeys: string[] = Array.isArray(current.metadata?.applied_plan_idempotency_keys)
      ? current.metadata.applied_plan_idempotency_keys
      : Object.keys(existingIdempMap)

    if (diff.idempotency_key in existingIdempMap || existingIdempKeys.includes(diff.idempotency_key)) {
      const recordedHash = existingIdempMap[diff.idempotency_key]
      if (recordedHash && recordedHash !== diff.payload_hash) {
        throw new Error(
          `[IDEMPOTENCY_CONFLICT] Idempotency key '${diff.idempotency_key}' was previously applied with a different payload hash.`
        )
      }
      return {
        mission: current as MarketingMissionAggregate,
        diff,
      }
    }

    // 4. Concurrency conflict detection (OCC)
    const currentSnapshotVersion = Number(current.metadata?.snapshot_version ?? 1)
    if (currentSnapshotVersion !== expectedSnapshotVersion) {
      throw new Error(
        `[STALE_SNAPSHOT_VERSION] Concurrency conflict: current snapshot version ${currentSnapshotVersion} does not match expected ${expectedSnapshotVersion}. Re-evaluation required.`
      )
    }

    // 5. Validate proposed contract and ensure protected fields are uncompromised
    const validatedNewContract = validateMissionContract(diff.proposed_contract)

    const updatedMetadata = {
      ...(current.metadata || {}),
      contract: validatedNewContract,
      last_plan_diff: diff,
      applied_plan_idempotency_keys: [...existingIdempKeys, diff.idempotency_key],
      applied_plan_idempotency_map: {
        ...existingIdempMap,
        [diff.idempotency_key]: diff.payload_hash,
      },
      // Invariant: Applying a plan diff invalidates existing approval.
      // Reset execution_state to NEEDS_DECISION and clear approval_id to prevent stale approval dispatch.
      execution_state: 'NEEDS_DECISION',
      approval_id: null,
      // Invariant: Preserve existing outcome_state and already submitted effects (NEVER force PENDING reset)
      outcome_state: current.metadata?.outcome_state || 'PENDING',
    }

    // 6. Execute atomic update via RPC
    // Note: p_new_status must match chk_marketing_missions_status ('AWAITING_APPROVAL').
    // execution_state in metadata tracks dual-state engine ('NEEDS_DECISION').
    const { data: updated, error: rpcError } = await (this.client as any).rpc(
      'update_mission_snapshot_atomic',
      {
        p_workspace_id: workspaceId,
        p_mission_id: missionId,
        p_expected_snapshot_version: expectedSnapshotVersion,
        p_new_metadata: updatedMetadata,
        p_new_status: 'AWAITING_APPROVAL',
        p_new_goal: validatedNewContract.goal,
        p_actor_type: actorType,
        p_actor_id: actorId,
        p_event_name: 'MISSION_PLAN_DIFF_APPLIED',
        p_event_payload: {
          idempotency_key: diff.idempotency_key,
          old_contract_version: diff.old_contract_version,
          new_contract_version: diff.new_contract_version,
          cost_difference_minor_units: diff.cost_difference_minor_units,
          changed_fields: diff.changed_fields,
        },
      }
    )

    if (rpcError || !updated) {
      throw new Error(`[PLAN_DIFF_APPLY_FAILED] ${rpcError?.message || 'Atomic RPC plan diff apply failed'}`)
    }

    return {
      mission: updated as MarketingMissionAggregate,
      diff,
    }
  }

  /**
   * Pauses a mission atomically:
   * 1. Increments control_epoch in metadata
   * 2. Sets execution_state to 'PAUSED' and status to 'PAUSED'
   * 3. Prevents any pending worker mutation with stale epoch, while preserving in-flight readback
   */
  async pauseMissionAtomic(params: PauseMissionParams): Promise<MarketingMissionAggregate> {
    const {
      workspaceId,
      missionId,
      traceId,
      expectedSnapshotVersion,
      actorType = 'user',
      actorId = null,
      reason = 'User paused mission',
    } = params

    if (expectedSnapshotVersion === null || expectedSnapshotVersion === undefined) {
      throw new Error('[INVALID_SNAPSHOT_VERSION] expectedSnapshotVersion cannot be null or undefined')
    }

    // 1. Fetch current
    const { data: current, error: fetchError } = await (this.client as any)
      .from('marketing_missions')
      .select()
      .eq('id', missionId)
      .eq('workspace_id', workspaceId)
      .single()

    if (fetchError || !current) {
      throw new Error(`[MISSION_NOT_FOUND] Mission '${missionId}' not found in workspace '${workspaceId}'`)
    }

    // 2. Lineage invariant check
    assertStrictLineage(
      { workspaceId, missionId, traceId },
      { workspaceId: current.workspace_id, missionId: current.id, traceId: current.trace_id }
    )

    // 3. Concurrency check
    const currentSnapshotVersion = Number(current.metadata?.snapshot_version ?? 1)
    if (currentSnapshotVersion !== expectedSnapshotVersion) {
      throw new Error(
        `[STALE_SNAPSHOT_VERSION] Concurrency conflict: current snapshot version ${currentSnapshotVersion} does not match expected ${expectedSnapshotVersion}`
      )
    }

    // 4. Increment control_epoch to invalidate in-flight worker dispatch
    const currentEpoch = Number(current.metadata?.control_epoch ?? 0)
    const nextEpoch = currentEpoch + 1

    const updatedMetadata = {
      ...(current.metadata || {}),
      control_epoch: nextEpoch,
      execution_state: 'PAUSED',
      pause_reason: reason,
      paused_at: new Date().toISOString(),
    }

    // 5. Atomic snapshot RPC
    const { data: updated, error: rpcError } = await (this.client as any).rpc(
      'update_mission_snapshot_atomic',
      {
        p_workspace_id: workspaceId,
        p_mission_id: missionId,
        p_expected_snapshot_version: expectedSnapshotVersion,
        p_new_metadata: updatedMetadata,
        p_new_status: 'PAUSED',
        p_actor_type: actorType,
        p_actor_id: actorId,
        p_event_name: 'MISSION_PAUSED',
        p_event_payload: {
          control_epoch: nextEpoch,
          reason,
          previous_status: current.status,
        },
      }
    )

    if (rpcError || !updated) {
      throw new Error(`[PAUSE_MISSION_FAILED] ${rpcError?.message || 'Atomic RPC pause failed'}`)
    }

    return updated as MarketingMissionAggregate
  }
}