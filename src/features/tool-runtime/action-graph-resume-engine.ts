/**
 * ActionGraph Resume Engine & Strict Reconcile (ANI-964, ANI-965, ANI-966, ANI-962, ANI-967)
 *
 * Provides durable checkpointing and resume mechanics for ActionGraphs in serverless
 * and edge environments.
 *
 * Core Guarantees:
 * 1. Checkpoint Persistence: Graphs, node topologies, execution statuses, outputs, and
 *    idempotency keys are persisted directly to Supabase DB SSOT (agent_runs & agent_run_steps).
 * 2. Fail-Closed Durability: Any failure during DB save or resume halts with PersistenceError;
 *    no memory map fallback or silent fake successes.
 * 3. Idempotency & No Double-Dispatch: Already COMPLETED or VERIFIED nodes are skipped on
 *    re-execution; external mutation nodes retain unique idempotency keys.
 * 4. Strict Reconcile & RESULT_UNKNOWN Preservation: Interrupted or ambiguous external
 *    mutation nodes preserve RESULT_UNKNOWN state to prevent false completion.
 */

import { createServerSupabaseClient } from '@/lib/supabase/server'
import { createAdminSupabaseClient } from '@/lib/supabase/admin'
import { PersistenceError } from '@/lib/errors/persistence-error'
import type { ActionGraph, ActionGraphNode } from './agent-loop-engine'

export type NodeExecutionResult = {
  status?: 'COMPLETED' | 'VERIFIED' | 'FAILED' | 'RESULT_UNKNOWN' | 'BLOCKED' | string
  output?: Record<string, unknown>
  evidence?: Record<string, unknown>
  error?: { code?: string; message?: string }
}

export type NodeExecutor = (node: ActionGraphNode) => Promise<NodeExecutionResult | void>

export interface ExecuteGraphOptions {
  workspaceId: string
  executor: NodeExecutor
  onNodeCompleted?: (node: ActionGraphNode) => Promise<void>
}

export interface ResumeFromApprovalParams {
  workspaceId: string
  runId: string
  approvalId: string
  expectedRevision?: number
  expectedPolicyVersion?: string
  executor?: NodeExecutor
  onNodeCompleted?: (node: ActionGraphNode) => Promise<void>
}

export class StaleApprovalError extends Error {
  public code: string
  constructor(message: string, code = 'STALE_APPROVAL_REJECTED') {
    super(message)
    this.name = 'StaleApprovalError'
    this.code = code
    Object.setPrototypeOf(this, StaleApprovalError.prototype)
  }
}

interface GraphLease {
  workerId: string
  planFence: Record<string, unknown>
}

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export class ActionGraphResumeEngine {
  private static async executionClient(db: any, runId: string, workspaceId: string) {
    // Prove caller visibility through RLS before using the server-only write RPC.
    if (typeof db.from('conversation_jobs')?.select === 'function') {
      const { data, error } = await db.from('conversation_jobs').select('id')
        .eq('id', runId).eq('workspace_id', workspaceId).single()
      if (error || !data) throw new PersistenceError('graphExecution', 'GRAPH_LEASE_SCOPE_REJECTED', error)
      return createAdminSupabaseClient() as any
    }
    return db
  }

  /**
   * Persists the graph topology, node execution statuses, outputs, and idempotency keys to Supabase.
   */
  public static async saveCheckpoint(actionGraph: ActionGraph, workspaceId?: string, lease?: GraphLease): Promise<void> {
    const wsId = workspaceId || actionGraph.workspaceId
    if (!wsId) {
      throw new PersistenceError('saveCheckpoint', 'workspaceId is required to save ActionGraph checkpoint')
    }

    try {
      const supabase = await createServerSupabaseClient()
      const db = supabase as any

      const previousCheckpoint = actionGraph.checkpointAt
      actionGraph.checkpointAt = new Date().toISOString()
      actionGraph.workspaceId = wsId

      // The canonical graph and node intents commit in one transaction. The DB
      // owns the lease; a local token never authorizes a write on its own.
      if (typeof db.from('conversation_jobs')?.update === 'function') {
        const steps = (actionGraph.nodes || []).map((node, index) => {
          const receiptId = node.evidence?.receiptId
          return {
            workspace_id: wsId, job_id: actionGraph.runId,
            provider_call_key: `${actionGraph.runId}:${index + 1}`, step_index: index + 1,
            capability_id: node.capabilityId || node.toolName || node.actionName || node.nodeId,
            risk_tier: node.isExternalMutation ? 'HIGH' : 'LOW',
            state: mapNodeStatusToStepStatus(node.status), status: mapNodeStatusToStepStatus(node.status),
            input_payload: node.input || {},
            output_payload: { ...node.output, ...(receiptId && !UUID_REGEX.test(String(receiptId)) ? { receiptId } : {}) },
            idempotency_key: node.idempotencyKey || null,
            external_receipt_id: typeof receiptId === 'string' && UUID_REGEX.test(receiptId) ? receiptId : null,
            safe_error_code: node.error?.message?.slice(0, 120) || null, error: node.error?.message || null,
            completed_at: ['COMPLETED', 'VERIFIED'].includes(node.status) ? (node.executedAt || actionGraph.checkpointAt) : null,
          }
        })
        const persistedGraph = { ...actionGraph }
        delete persistedGraph.checkpointPlan
        const writer = await this.executionClient(db, actionGraph.runId, wsId)
        const { data, error } = await writer.rpc('car_checkpoint_graph_execution', {
          p_workspace_id: wsId, p_run_id: actionGraph.runId,
          p_worker_id: lease?.workerId || null,
          p_plan_fence: lease?.planFence || (actionGraph.checkpointPlan ? { planData: actionGraph.checkpointPlan } : null),
          p_checkpoint_at: previousCheckpoint || null, p_graph: persistedGraph, p_steps: steps,
        })
        if (error || !data) {
          throw new PersistenceError('saveCheckpoint:conversation_jobs', `GRAPH_LEASE_LOST: ${error?.message || 'checkpoint fence rejected'}`, error)
        }
        actionGraph.checkpointPlan = data.planFence.planData
        if (lease) lease.planFence = data.planFence
        return
      }

      // 1. Update conversation_jobs table (plan_data & status) with fallback to agent_runs
      let runTable = 'conversation_jobs'
      let runFrom = db.from('conversation_jobs')
      if (!runFrom || typeof runFrom.update !== 'function') {
        runTable = 'agent_runs'
        runFrom = db.from('agent_runs')
      }

      const { data: updateData, error: runError } = await runFrom
        .update({
          plan_data: {
            actionGraph,
            checkpointAt: actionGraph.checkpointAt,
          },
          updated_at: new Date().toISOString(),
          heartbeat_at: new Date().toISOString(),
        })
        .eq('id', actionGraph.runId)
        .eq('workspace_id', wsId)
        .select('id')

      if (runError) {
        console.error('[ActionGraphResumeEngine] Error saving run checkpoint:', runError)
        throw new PersistenceError(`saveCheckpoint:${runTable}`, runError.message || 'Failed to update agent run checkpoint', runError)
      }

      // Fail-Closed: Detect 0 rows updated (e.g. missing run or cross-tenant mismatch)
      if (!updateData || updateData.length === 0) {
        throw new PersistenceError(
          `saveCheckpoint:${runTable}`,
          `Agent run [${actionGraph.runId}] not found in workspace [${wsId}] (0 rows updated)`
        )
      }

      // 2. Upsert each node into steps table with fallback to agent_run_steps
      let stepTable = 'conversation_job_steps'
      let stepFrom = db.from('conversation_job_steps')
      if (!stepFrom || typeof (stepFrom.upsert || stepFrom.insert) !== 'function') {
        stepTable = 'agent_run_steps'
        stepFrom = db.from('agent_run_steps')
      }
      const isAgentRunSteps = stepTable === 'agent_run_steps'

      const nodes = actionGraph.nodes || []
      for (let i = 0; i < nodes.length; i++) {
        const node = nodes[i]
        const stepIndex = i + 1

        const rawReceiptId = (node.evidence as any)?.receiptId
        const isUuid = typeof rawReceiptId === 'string' && UUID_REGEX.test(rawReceiptId)
        const dbReceiptId = isUuid ? rawReceiptId : null

        // Preserve non-UUID receipt in output payload JSONB
        const outputPayload: Record<string, unknown> = {
          ...(node.output || {}),
          ...(rawReceiptId && !isUuid ? { receiptId: rawReceiptId } : {}),
        }

        const stepRecord: Record<string, unknown> = isAgentRunSteps ? {
          run_id: actionGraph.runId,
          step_index: stepIndex,
          capability_id: node.capabilityId || node.toolName || node.actionName || node.nodeId,
          risk_tier: node.isExternalMutation ? 'HIGH' : 'LOW',
          status: mapNodeStatusToStepStatus(node.status),
          input_payload: node.input || {},
          output_payload: outputPayload,
          idempotency_key: node.idempotencyKey || null,
          external_receipt_id: dbReceiptId,
          error: node.error?.message || null,
          completed_at: (node.status === 'COMPLETED' || node.status === 'VERIFIED') ? (node.executedAt || new Date().toISOString()) : null,
        } : {
          workspace_id: wsId,
          job_id: actionGraph.runId,
          state: mapNodeStatusToStepStatus(node.status),
          step_index: stepIndex,
          capability_id: node.capabilityId || node.toolName || node.actionName || node.nodeId,
          risk_tier: node.isExternalMutation ? 'HIGH' : 'LOW',
          status: mapNodeStatusToStepStatus(node.status),
          input_payload: node.input || {},
          output_payload: outputPayload,
          idempotency_key: node.idempotencyKey || null,
          external_receipt_id: dbReceiptId,
          provider_call_key: `${actionGraph.runId}:${stepIndex}`,
          safe_error_code: node.error?.message?.slice(0, 120) || null,
          error: node.error?.message || null,
          completed_at: (node.status === 'COMPLETED' || node.status === 'VERIFIED') ? (node.executedAt || new Date().toISOString()) : null,
        }

        const { error: stepError } = typeof stepFrom.upsert === 'function'
          ? await stepFrom.upsert(stepRecord, { onConflict: isAgentRunSteps ? 'run_id,step_index' : 'job_id,provider_call_key' })
          : await stepFrom.insert(stepRecord)

        if (stepError) {
          console.error(`[ActionGraphResumeEngine] Error recording step ${stepIndex}:`, stepError)
          throw new PersistenceError(`saveCheckpoint:${stepTable}`, stepError.message || 'Failed to record step ledger', stepError)
        }
      }
    } catch (err: any) {
      if (err instanceof PersistenceError) throw err
      console.error('[ActionGraphResumeEngine] Unexpected failure during saveCheckpoint:', err)
      throw new PersistenceError('saveCheckpoint', err.message || 'Unexpected failure saving checkpoint', err)
    }
  }

  /**
   * Reconstitutes the ActionGraph from Supabase DB SSOT with strict reconcile.
   */
  public static async resumeGraph(graphId: string, workspaceId: string): Promise<ActionGraph> {
    if (!graphId || !workspaceId) {
      throw new PersistenceError('resumeGraph', 'graphId and workspaceId are required to resume ActionGraph')
    }

    try {
      const supabase = await createServerSupabaseClient()
      const db = supabase as any

      // 1. Fetch record with workspace tenant isolation (conversation_jobs with agent_runs fallback)
      let runTable = 'conversation_jobs'
      let runFrom = db.from('conversation_jobs')
      if (!runFrom || typeof runFrom.select !== 'function') {
        runTable = 'agent_runs'
        runFrom = db.from('agent_runs')
      }

      const { data: runData, error: runError } = await runFrom
        .select('*')
        .eq('id', graphId)
        .eq('workspace_id', workspaceId)
        .single()

      if (runError || !runData) {
        console.error('[ActionGraphResumeEngine] Error fetching agent run:', runError)
        throw new PersistenceError(`resumeGraph:${runTable}`, runError?.message || `Agent run [${graphId}] not found for workspace [${workspaceId}]`, runError)
      }

      const planData = runData.plan_data || {}
      const rawGraph = (planData.actionGraph || runData.action_graph) as ActionGraph | undefined

      if (!rawGraph) {
        throw new PersistenceError(`resumeGraph:plan_data`, `No ActionGraph plan data found in agent run [${graphId}]`)
      }

      // Deep copy to disconnect from any potential cached references
      const reconstitutedGraph: ActionGraph = JSON.parse(JSON.stringify(rawGraph))
      reconstitutedGraph.workspaceId = workspaceId
      reconstitutedGraph.checkpointPlan = JSON.parse(JSON.stringify(planData))

      // 2. Fetch steps table with fallback
      let stepTable = 'conversation_job_steps'
      let stepFrom = db.from('conversation_job_steps')
      if (!stepFrom || typeof stepFrom.select !== 'function') {
        stepTable = 'agent_run_steps'
        stepFrom = db.from('agent_run_steps')
      }
      const isAgentRunSteps = stepTable === 'agent_run_steps'

      const { data: stepsData, error: stepsError } = await stepFrom
        .select('*')
        .eq(isAgentRunSteps ? 'run_id' : 'job_id', graphId)
        .order('step_index', { ascending: true })

      if (stepsError) {
        console.error('[ActionGraphResumeEngine] Error fetching agent run steps:', stepsError)
        throw new PersistenceError(`resumeGraph:${stepTable}`, stepsError.message || 'Failed to fetch agent run steps', stepsError)
      }

      // 3. Strict Reconcile nodes with DB steps
      if (reconstitutedGraph.nodes && Array.isArray(stepsData)) {
        const stepMap = new Map<number, any>()
        for (const s of stepsData) {
          stepMap.set(s.step_index, s)
        }

        for (let i = 0; i < reconstitutedGraph.nodes.length; i++) {
          const node = reconstitutedGraph.nodes[i]
          const stepIndex = i + 1
          const dbStep = stepMap.get(stepIndex)

          if (dbStep) {
            // Reconcile outputs & idempotency keys
            if (dbStep.output_payload && Object.keys(dbStep.output_payload).length > 0) {
              node.output = dbStep.output_payload
            }
            if (dbStep.idempotency_key) {
              node.idempotencyKey = dbStep.idempotency_key
            }
            const receiptId = dbStep.external_receipt_id || (dbStep.output_payload as any)?.receiptId
            if (receiptId) {
              node.evidence = { ...(node.evidence || {}), receiptId }
            }

            // Priority 1: If DB step has completed status or timestamp, synchronize COMPLETED
            if (dbStep.status === 'completed' || dbStep.completed_at) {
              node.status = 'COMPLETED'
            } else if (dbStep.status === 'failed') {
              node.status = 'FAILED'
            } else if (node.status === 'RUNNING' || dbStep.status === 'running') {
              // Priority 2: Invariant for interrupted running node
              if (node.isExternalMutation) {
                // Ambiguous external side effect: strict reconcile to RESULT_UNKNOWN
                node.status = 'RESULT_UNKNOWN'
              } else {
                // Safe read or idempotent node can restart from PENDING
                node.status = 'PENDING'
              }
            }
          }
        }
      }

      return reconstitutedGraph
    } catch (err: any) {
      if (err instanceof PersistenceError) throw err
      console.error('[ActionGraphResumeEngine] Unexpected failure during resumeGraph:', err)
      throw new PersistenceError('resumeGraph', err.message || 'Unexpected failure resuming graph', err)
    }
  }

  /**
   * Executes or resumes execution of an ActionGraph:
   * - Skips already COMPLETED or VERIFIED nodes.
   * - Resumes execution from pending or interrupted nodes.
   * - Enforces idempotency on external mutation nodes to prevent double-dispatch.
   * - Preserves RESULT_UNKNOWN state upon timeout or ambiguous execution error.
   */
  public static async executeGraph(
    actionGraph: ActionGraph,
    options: ExecuteGraphOptions
  ): Promise<ActionGraph> {
    const { workspaceId, executor, onNodeCompleted } = options
    if (!workspaceId) {
      throw new PersistenceError('executeGraph', 'workspaceId is required for execution')
    }

    if (actionGraph.workspaceId && actionGraph.workspaceId !== workspaceId) {
      throw new PersistenceError('executeGraph', `Workspace mismatch: graph belongs to ${actionGraph.workspaceId}, requested ${workspaceId}`)
    }

    actionGraph.workspaceId = workspaceId
    const nodes = actionGraph.nodes || []

    // If all nodes are already completed, return immediately without re-dispatching
    const allAlreadyCompleted = nodes.length > 0 && nodes.every((n) => n.status === 'COMPLETED' || n.status === 'VERIFIED')
    if (allAlreadyCompleted) {
      actionGraph.status = 'COMPLETED'
      return actionGraph
    }

    actionGraph.status = 'RUNNING'
    let lease: GraphLease | undefined

    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i]

      // Acceptance Criteria 1: Re-execution skips already COMPLETED or VERIFIED nodes
      if (node.status === 'COMPLETED' || node.status === 'VERIFIED') {
        continue
      }

      // Only an explicitly pending node can execute. Recovery alone is not a
      // reconciliation, renewed approval, or permission to retry an uncertain write.
      if (node.status !== 'PENDING') {
        actionGraph.status = 'BLOCKED'
        actionGraph.blockedReason = `Node [${node.nodeId}] requires reconciliation before execution (${node.status})`
        if (lease) await this.saveCheckpoint(actionGraph, workspaceId, lease)
        return actionGraph
      }

      if (!lease) {
        if (!actionGraph.checkpointAt) await this.saveCheckpoint(actionGraph, workspaceId, lease)
        const db = await createServerSupabaseClient()
        const workerId = crypto.randomUUID()
        const writer = await this.executionClient(db, actionGraph.runId, workspaceId)
        const { data, error } = await writer.rpc('car_claim_graph_execution', {
          p_workspace_id: workspaceId, p_run_id: actionGraph.runId,
          p_worker_id: workerId, p_checkpoint_at: actionGraph.checkpointAt,
          p_expected_plan: actionGraph.checkpointPlan || null,
        })
        if (error || !data?.planFence) {
          throw new PersistenceError('executeGraph', `GRAPH_LEASE_UNAVAILABLE: ${error?.message || data?.state || 'not claimed'}`, error)
        }
        lease = { workerId, planFence: data.planFence }
      }

      // Idempotency: assign unique key for external mutation node if not present
      if (node.isExternalMutation && !node.idempotencyKey) {
        node.idempotencyKey = `idem_${actionGraph.runId}_${node.nodeId}_${Date.now()}`
      }

      node.status = 'RUNNING'

      // Pre-dispatch checkpoint
      await this.saveCheckpoint(actionGraph, workspaceId, lease)

      try {
        const result = await executor(node)

        const finalStatus = result && result.status ? result.status : 'COMPLETED'
        node.status = finalStatus
        if (result && result.output) {
          node.output = result.output
        }
        if (result && result.evidence) {
          node.evidence = { ...(node.evidence || {}), ...result.evidence }
        }
        node.executedAt = new Date().toISOString()

        // Post-dispatch checkpoint
        await this.saveCheckpoint(actionGraph, workspaceId, lease)

        if (node.status !== 'COMPLETED' && node.status !== 'VERIFIED') {
          actionGraph.status = 'BLOCKED'
          actionGraph.blockedReason = `Node [${node.nodeId}] did not complete (${node.status})`
          await this.saveCheckpoint(actionGraph, workspaceId, lease)
          return actionGraph
        }

        if (onNodeCompleted) {
          await onNodeCompleted(node)
        }
      } catch (err: any) {
        // A lost lease is not a tool failure and cannot authorize another save.
        if (err instanceof PersistenceError) throw err
        const isInterruptedOrTimeout =
          err?.isUnknownResult ||
          err?.code === 'RESULT_UNKNOWN' ||
          (typeof err?.message === 'string' &&
            (err.message.includes('TIMEOUT') ||
              err.message.includes('INTERRUPT') ||
              err.message.includes('ECONNRESET') ||
              err.message.includes('ETIMEDOUT')))

        if (node.isExternalMutation && isInterruptedOrTimeout) {
          // Strictly preserve RESULT_UNKNOWN status for interrupted external mutation
          node.status = 'RESULT_UNKNOWN'
          node.error = {
            code: 'RESULT_UNKNOWN',
            message: err.message || 'Interrupted with unknown external result',
          }
          actionGraph.status = 'BLOCKED'
          actionGraph.blockedReason = `External mutation node [${node.nodeId}] entered RESULT_UNKNOWN state: ${err.message}`
        } else {
          node.status = 'FAILED'
          node.error = {
            code: err.code || 'NODE_EXECUTION_FAILED',
            message: err.message || 'Node execution failed',
          }
          actionGraph.status = 'FAILED'
          actionGraph.failureReason = err.message
        }

        // Persist failure/interrupted state to DB
        await this.saveCheckpoint(actionGraph, workspaceId, lease)
        throw err
      }
    }

    const allFinished = nodes.every((n) => n.status === 'COMPLETED' || n.status === 'VERIFIED')
    if (allFinished) {
      actionGraph.status = 'COMPLETED'
    }

    await this.saveCheckpoint(actionGraph, workspaceId, lease)
    return actionGraph
  }

  /**
   * Resumes an ActionGraph from DB and executes remaining pending/interrupted nodes.
   */
  public static async resumeAndExecute(
    graphId: string,
    workspaceId: string,
    executor: NodeExecutor
  ): Promise<ActionGraph> {
    const graph = await this.resumeGraph(graphId, workspaceId)
    return this.executeGraph(graph, { workspaceId, executor })
  }

  /**
   * Resumes an ActionGraph from a durable human-in-the-loop approval (ANI-949).
   *
   * Guarantees:
   * 1. Same ActionRun Identity: Resumes from existing runId without spawning a new run.
   * 2. Atomic Resumption from Approved Node: Approved node transitions to COMPLETED, and
   *    execution resumes from the subsequent node. Completed nodes are skipped.
   * 3. Idempotency Preservation: Preserves idempotency keys across all nodes to prevent double-dispatch.
   * 4. Fail-Closed Stale Approval Rejection: Rejects if expires_at has elapsed, if graph revision
   *    conflicts with expectedRevision or graph state, if runId mismatches, or if rejected/expired.
   */
  public static async resumeFromApproval(
    params: ResumeFromApprovalParams
  ): Promise<ActionGraph> {
    const { workspaceId, runId, approvalId, expectedRevision, expectedPolicyVersion, executor, onNodeCompleted } = params
    if (!workspaceId || !runId || !approvalId) {
      throw new PersistenceError('resumeFromApproval', 'workspaceId, runId, and approvalId are required')
    }

    try {
      const supabase = await createServerSupabaseClient()
      const db = supabase as any

      // 1. Fetch approval from agent_approvals
      let approvalRecord: Record<string, any> | null = null

      const { data: byProposal } = await db
        .from('agent_approvals')
        .select('*')
        .eq('workspace_id', workspaceId)
        .eq('proposal_id', approvalId)
        .maybeSingle()

      if (byProposal) {
        approvalRecord = byProposal
      } else {
        const { data: byId } = await db
          .from('agent_approvals')
          .select('*')
          .eq('workspace_id', workspaceId)
          .eq('id', approvalId)
          .maybeSingle()
        approvalRecord = byId || null
      }

      if (!approvalRecord) {
        throw new StaleApprovalError(
          `STALE_APPROVAL_REJECTED: Approval proposal [${approvalId}] not found for workspace [${workspaceId}]`
        )
      }

      let approvalData: Record<string, any> = approvalRecord

      // 2. ActionRun Tenant & ID Isolation Check
      if (approvalData.action_run_id && approvalData.action_run_id !== runId) {
        throw new StaleApprovalError(
          `STALE_APPROVAL_REJECTED: Approval belongs to action_run_id [${approvalData.action_run_id}], but resume requested for [${runId}]`
        )
      }

      // 3. Expiration Check
      if (approvalData.expires_at) {
        const expiryTime = new Date(approvalData.expires_at).getTime()
        if (Date.now() > expiryTime) {
          throw new StaleApprovalError(
            `STALE_APPROVAL_REJECTED: Approval proposal [${approvalId}] expired at ${approvalData.expires_at}`
          )
        }
      }

      // 4. Status Check
      if (approvalData.status === 'EXPIRED') {
        throw new StaleApprovalError(
          `STALE_APPROVAL_REJECTED: Approval proposal [${approvalId}] is EXPIRED`
        )
      }
      if (approvalData.status === 'REJECTED') {
        throw new StaleApprovalError(
          `STALE_APPROVAL_REJECTED: Approval proposal [${approvalId}] was REJECTED`
        )
      }

      // 5. Graph Revision Conflict Check
      const approvalRevision =
        approvalData.graph_revision ??
        approvalData.proposed_value?.graph_revision ??
        approvalData.proposed_value?.graphRevision

      if (expectedRevision !== undefined && approvalRevision !== undefined && approvalRevision !== expectedRevision) {
        throw new StaleApprovalError(
          `STALE_APPROVAL_REJECTED: Graph revision conflict: expected revision ${expectedRevision}, but approval has revision ${approvalRevision}`
        )
      }

      // 6. Policy Version Check
      const approvalPolicyVersion =
        approvalData.policy_version ??
        approvalData.proposed_value?.policy_version

      if (expectedPolicyVersion !== undefined && approvalPolicyVersion !== undefined && approvalPolicyVersion !== expectedPolicyVersion) {
        throw new StaleApprovalError(
          `STALE_APPROVAL_REJECTED: Policy version conflict: expected ${expectedPolicyVersion}, but approval has ${approvalPolicyVersion}`
        )
      }

      // 7. Reconstitute ActionGraph from Supabase DB SSOT with same runId
      const graph = await this.resumeGraph(runId, workspaceId)
      const currentGraphRevision = (graph as any).graphRevision ?? (graph as any).graph_revision

      if (expectedRevision !== undefined && currentGraphRevision !== undefined && currentGraphRevision !== expectedRevision) {
        throw new StaleApprovalError(
          `STALE_APPROVAL_REJECTED: Graph revision mismatch: expected revision ${expectedRevision}, but graph is at revision ${currentGraphRevision}`
        )
      }

      if (approvalRevision !== undefined && currentGraphRevision !== undefined && currentGraphRevision !== approvalRevision) {
        throw new StaleApprovalError(
          `STALE_APPROVAL_REJECTED: Stale approval: approval created for revision ${approvalRevision}, but graph is at revision ${currentGraphRevision}`
        )
      }

      // Resolve the target before consuming approval; a removed explicit target
      // must never fall through to a different waiting node.
      // 9. Find approved node and transition to COMPLETED
      const nodes = graph.nodes || []
      let approvedNodeIndex = -1

      const targetNodeId = approvalData.proposed_value?.nodeId || approvalData.target_field
      if (targetNodeId) {
        approvedNodeIndex = nodes.findIndex((n) => n.nodeId === targetNodeId)
        if (approvedNodeIndex === -1 || (approvalData.target_field && approvalData.target_field !== targetNodeId)) {
          throw new StaleApprovalError('STALE_APPROVAL_REJECTED: Approval target no longer exists in the graph')
        }
      } else {
        approvedNodeIndex = nodes.findIndex(
          (n) => (n as any).proposalId === approvalId || (n as any).proposalId === approvalData.proposal_id
        )
      }

      // Strategy 3: Match node in AWAITING_APPROVAL status
      if (approvedNodeIndex === -1) {
        approvedNodeIndex = nodes.findIndex((n) => n.status === 'AWAITING_APPROVAL')
      }

      // Strategy 4: Match node with requiresApproval not yet completed
      if (approvedNodeIndex === -1) {
        approvedNodeIndex = nodes.findIndex((n) => n.requiresApproval && n.status !== 'COMPLETED' && n.status !== 'VERIFIED')
      }

      // Strategy 5: First incomplete node
      if (approvedNodeIndex === -1) {
        approvedNodeIndex = nodes.findIndex((n) => n.status !== 'COMPLETED' && n.status !== 'VERIFIED')
      }

      if (approvedNodeIndex === -1) {
        throw new StaleApprovalError('STALE_APPROVAL_REJECTED: No approval target remains in the graph')
      }

      if (approvalData.status === 'PENDING') {
        const version = approvalData.version
        if (!Number.isInteger(version) || version < 1) {
          throw new StaleApprovalError('STALE_APPROVAL_REJECTED: Approval version is invalid')
        }
        const resolvedAt = new Date().toISOString()
        let update = db.from('agent_approvals').update({
          status: 'APPROVED', version: version + 1,
          resolved_at: resolvedAt, updated_at: resolvedAt,
        }).eq('id', approvalData.id).eq('workspace_id', workspaceId)
          .eq('status', 'PENDING').eq('version', version)
        if (approvalData.expires_at) update = update.gt('expires_at', resolvedAt)
        const { data: approved, error } = await update.select('*').single()
        if (error || !approved || approved.id !== approvalData.id || approved.workspace_id !== workspaceId ||
          approved.status !== 'APPROVED' || approved.version !== version + 1) {
          throw new StaleApprovalError('STALE_APPROVAL_REJECTED: Approval was not atomically confirmed')
        }
        approvalData = approved
      } else if (approvalData.status !== 'APPROVED') {
        throw new StaleApprovalError('STALE_APPROVAL_REJECTED: Approval is not approved')
      }

      if (approvedNodeIndex !== -1) {
        const approvedNode = nodes[approvedNodeIndex]
        approvedNode.status = 'COMPLETED'
        approvedNode.approvalStatus = 'APPROVED'
        approvedNode.executedAt = new Date().toISOString()
        if (approvalData.proposed_value) {
          approvedNode.output = {
            ...(approvedNode.output || {}),
            ...approvalData.proposed_value,
            approved: true,
            approvalId: approvalData.proposal_id || approvalId,
          }
        }
      }

      // 10. Persist approval metadata & checkpoint to DB
      (graph as any).lastApproval = {
        proposal_id: approvalData.proposal_id || approvalId,
        action_run_id: runId,
        graph_revision: approvalRevision ?? currentGraphRevision ?? 1,
        policy_version: approvalPolicyVersion ?? 'v1.0',
        cost_delta: approvalData.cost_delta ?? approvalData.proposed_value?.cost_delta ?? 0,
        expires_at: approvalData.expires_at,
        resolved_at: approvalData.resolved_at || new Date().toISOString(),
      }

      graph.status = 'RUNNING'
      await this.saveCheckpoint(graph, workspaceId)

      // 11. Continue execution from next node if executor is provided
      if (executor) {
        return await this.executeGraph(graph, {
          workspaceId,
          executor,
          onNodeCompleted,
        })
      }

      return graph
    } catch (err: any) {
      if (err instanceof StaleApprovalError || err instanceof PersistenceError) {
        throw err
      }
      console.error('[ActionGraphResumeEngine] Unexpected error in resumeFromApproval:', err)
      throw new PersistenceError('resumeFromApproval', err.message || 'Unexpected failure in resumeFromApproval', err)
    }
  }

  /**
   * Creates or records a durable approval proposal in agent_approvals table.
   * Persists proposal_id, action_run_id, graph_revision, policy_version, cost_delta, expires_at.
   */
  public static async createApprovalProposal(params: {
    workspaceId: string
    runId: string
    proposalId?: string
    sessionId?: string
    proposalType?: string
    title: string
    description: string
    targetNodeId?: string
    graphRevision?: number
    policyVersion?: string
    costDelta?: number
    expiresAt?: string
    proposedValue?: Record<string, unknown>
  }): Promise<Record<string, unknown>> {
    const proposalId = params.proposalId || `prop-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`
    const expiresAt = params.expiresAt || new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
    const graphRevision = params.graphRevision || 1
    const policyVersion = params.policyVersion || 'v1.0'
    const costDelta = params.costDelta || 0

    const row = {
      workspace_id: params.workspaceId,
      proposal_id: proposalId,
      session_id: params.sessionId || params.runId,
      action_run_id: params.runId,
      proposal_type: params.proposalType || 'ACTION_GRAPH_NODE_APPROVAL',
      title: params.title,
      description: params.description,
      target_field: params.targetNodeId || null,
      graph_revision: graphRevision,
      policy_version: policyVersion,
      cost_delta: costDelta,
      expires_at: expiresAt,
      status: 'PENDING',
      version: 1,
      proposed_value: {
        ...(params.proposedValue || {}),
        proposal_id: proposalId,
        action_run_id: params.runId,
        nodeId: params.targetNodeId,
        graph_revision: graphRevision,
        policy_version: policyVersion,
        cost_delta: costDelta,
        expires_at: expiresAt,
      },
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }

    try {
      const supabase = await createServerSupabaseClient()
      const db = supabase as any
      const { data, error } = await db.from('agent_approvals').upsert(row, { onConflict: 'workspace_id,proposal_id' }).select('*').single()
      if (error) {
        throw new PersistenceError('createApprovalProposal', error.message, error)
      }
      return data || row
    } catch (err) {
      if (err instanceof PersistenceError) throw err
      throw new PersistenceError('createApprovalProposal', (err as Error).message, err)
    }
  }
}

function mapNodeStatusToStepStatus(nodeStatus: string): 'pending' | 'running' | 'verifying' | 'completed' | 'failed' | 'skipped' {
  switch (nodeStatus) {
    case 'COMPLETED':
    case 'VERIFIED':
      return 'completed'
    case 'FAILED':
    case 'BLOCKED':
      return 'failed'
    case 'RUNNING':
      return 'running'
    case 'RESULT_UNKNOWN':
      return 'verifying'
    case 'PENDING':
    default:
      return 'pending'
  }
}
