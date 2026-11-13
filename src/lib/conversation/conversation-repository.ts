/**
 * Sohee V0.8.9 Durable Conversation Repository (ANI-653)
 * 
 * Manages persistence for:
 * 1. conversation_threads (새 채팅 생성, 과거 대화 목록, 상태 관리)
 * 2. messages (대화 이력, tool_calls, run_id, evidence_refs)
 * 3. agent_runs & agent_run_steps (오케스트레이터의 다단계 실행 상태 추적)
 */

import { createServerSupabaseClient } from '@/lib/supabase/server'
import { createAdminSupabaseClient } from '@/lib/supabase/admin'
import { PersistenceError } from '@/lib/errors/persistence-error'
import { assertSupabaseSuccess } from '@/lib/supabase/require-success'
import { 
  type ReadResult, 
  createDataResult, 
  createEmptyResult, 
  createErrorResult 
} from '@/lib/read-models/read-result'

export { PersistenceError }

export class ConversationTurnConflict extends PersistenceError {
  constructor(public readonly code: 'IDEMPOTENCY_CONFLICT' | 'TURN_ALREADY_EXISTS', public readonly runId?: string, public readonly threadId?: string) {
    super('conversationTurn', code)
    this.name = 'ConversationTurnConflict'
    Object.setPrototypeOf(this, ConversationTurnConflict.prototype)
  }
}

export interface ConversationThread {
  id: string
  workspaceId: string
  title: string
  kind: string
  status: string
  modelProfile: string
  lastMessageAt: string | null
  createdAt: string
  updatedAt: string
}

export interface ConversationMessageRow {
  id: string
  workspaceId: string
  threadId: string
  role: 'user' | 'sohee' | 'system_event'
  content: string
  status: string
  toolCalls?: any[]
  runId?: string
  evidenceRefs?: any[]
  usageMetadata?: Record<string, unknown>
  createdAt: string
}

export interface AgentRunRow {
  id: string
  workspaceId: string
  threadId?: string
  status: 'planning' | 'executing' | 'verifying' | 'completed' | 'partially_completed' | 'failed' | 'cancelled'
  goal: string
  planData: Record<string, unknown>
  traceId: string
  correlationId?: string
  createdAt: string
  completedAt?: string
}

export interface ConversationTurnRecovery {
  runId: string
  threadId: string
  status: string
  assistantMessageId: string | null
}

export class ConversationRepository {
  /** Read-only recovery after a lost POST response; never starts or resumes execution. */
  public static async getTurnRecoveryResult(
    workspaceId: string,
    threadId: string | null,
    clientMessageId: string
  ): Promise<ReadResult<ConversationTurnRecovery | null>> {
    const unavailable = () => createErrorResult<ConversationTurnRecovery | null>(
      'TURN_RECOVERY_UNAVAILABLE', '접수 상태를 확인하지 못했습니다. 같은 요청을 다시 보내지 말고 잠시 후 조회해 주세요.'
    )
    try {
      // Use the actor's RLS-bound client, not the service role used for execution writes.
      const client = await createServerSupabaseClient()
      let messageQuery = client.from('messages').select('id, thread_id')
        .eq('workspace_id', workspaceId)
        .eq('client_message_id', clientMessageId).eq('role', 'user')
      if (threadId !== null) messageQuery = messageQuery.eq('thread_id', threadId)
      const message = await messageQuery.maybeSingle()
      if (message.error) return unavailable()
      if (!message.data) return createEmptyResult(null)
      const persistedThreadId = message.data.thread_id
      if (!persistedThreadId || (threadId !== null && persistedThreadId !== threadId)) return unavailable()

      const run = await client.from('conversation_jobs')
        .select('id, thread_id, status, assistant_message_id')
        .eq('workspace_id', workspaceId).eq('thread_id', persistedThreadId)
        .eq('user_message_id', message.data.id).maybeSingle()
      if (run.error) return unavailable()
      if (!run.data) return createEmptyResult(null)
      return createDataResult({
        runId: run.data.id,
        threadId: run.data.thread_id,
        status: run.data.status,
        assistantMessageId: run.data.assistant_message_id,
      })
    } catch {
      return unavailable()
    }
  }

  /**
   * 1a. Get all active threads for workspace as typed ReadResult (ANI-1038)
   */
  public static async getThreadsResult(workspaceId: string): Promise<ReadResult<ConversationThread[]>> {
    try {
      const supabase = await createServerSupabaseClient()
      const { data, error } = await supabase
        .from('conversation_threads')
        .select('*')
        .eq('workspace_id', workspaceId)
        .order('last_message_at', { ascending: false, nullsFirst: false })
        .limit(20)

      if (error) {
        return createErrorResult(error.code || 'THREADS_QUERY_FAILED', error.message || 'Failed to query conversation threads')
      }

      if (!data || data.length === 0) {
        return createEmptyResult<ConversationThread[]>([])
      }

      const threads = data.map((t: any) => ({
        id: t.id,
        workspaceId: t.workspace_id,
        title: t.title,
        kind: t.kind,
        status: t.status,
        modelProfile: t.model_profile || 'gemini-3.5-flash-lite',
        lastMessageAt: t.last_message_at,
        createdAt: t.created_at,
        updatedAt: t.updated_at
      }))

      return createDataResult(threads)
    } catch (err) {
      console.error('[ConversationRepository] Error fetching threads result:', err)
      return createErrorResult('THREADS_FETCH_EXCEPTION', (err as Error).message || 'Unexpected exception fetching threads')
    }
  }

  /**
   * 1b. Get all active threads for workspace (Legacy backward compat)
   */
  public static async getThreads(workspaceId: string): Promise<ConversationThread[]> {
    const res = await this.getThreadsResult(workspaceId)
    return res.state === 'DATA' ? res.data : []
  }

  /**
   * 2. Create a new conversation thread (Fail-Closed)
   */
  public static async createThread(
    workspaceId: string,
    title = '새로운 대화',
    kind = 'operations'
  ): Promise<ConversationThread> {
    try {
      const supabase = await createServerSupabaseClient()
      const db = supabase as any
      const mutation = await db
        .from('conversation_threads')
        .insert({
          workspace_id: workspaceId,
          title: title.slice(0, 120),
          kind,
          status: 'active',
          model_profile: 'gemini-3.5-flash-lite'
        })
        .select('*')
        .single()

      const data = assertSupabaseSuccess<any>(mutation, 'ConversationRepository.createThread')

      return {
        id: data.id,
        workspaceId: data.workspace_id,
        title: data.title,
        kind: data.kind,
        status: data.status,
        modelProfile: data.model_profile || 'gemini-3.5-flash-lite',
        lastMessageAt: data.last_message_at,
        createdAt: data.created_at,
        updatedAt: data.updated_at
      }
    } catch (err) {
      if (err instanceof PersistenceError) throw err
      console.error('[ConversationRepository] Unexpected error creating thread:', err)
      throw new PersistenceError('createThread', (err as Error).message || 'Unexpected error creating thread', err)
    }
  }

  /**
   * 3a. Get messages for a thread as typed ReadResult (ANI-1038)
   */
  public static async getThreadMessagesResult(
    workspaceId: string, 
    threadId: string, 
    limit = 50
  ): Promise<ReadResult<ConversationMessageRow[]>> {
    try {
      const supabase = await createServerSupabaseClient()
      const { data, error } = await supabase
        .from('messages')
        .select('*')
        .eq('workspace_id', workspaceId)
        .eq('thread_id', threadId)
        .order('created_at', { ascending: false })
        .limit(limit)

      if (error) {
        return createErrorResult(error.code || 'MESSAGES_QUERY_FAILED', error.message || 'Failed to query messages')
      }

      if (!data || data.length === 0) {
        return createEmptyResult<ConversationMessageRow[]>([])
      }

      // 최근 limit개를 가져오되 화면과 모델에는 시간순으로 전달한다.
      const messages = [...data].reverse().map((m: any) => ({
        id: m.id,
        workspaceId: m.workspace_id,
        threadId: m.thread_id,
        role: m.role,
        content: m.content,
        status: m.status,
        toolCalls: m.tool_calls || m.usage_metadata?.toolCalls || [],
        runId: m.run_id || m.usage_metadata?.runId,
        evidenceRefs: m.evidence_refs || m.usage_metadata?.evidenceRefs || [],
        usageMetadata: m.usage_metadata || {},
        createdAt: m.created_at
      }))

      return createDataResult(messages)
    } catch (err) {
      console.error('[ConversationRepository] Error fetching messages result:', err)
      return createErrorResult('MESSAGES_FETCH_EXCEPTION', (err as Error).message || 'Unexpected exception fetching messages')
    }
  }

  /**
   * 3b. Get messages for a thread (Legacy backward compat)
   */
  public static async getThreadMessages(
    workspaceId: string, 
    threadId: string, 
    limit = 50
  ): Promise<ConversationMessageRow[]> {
    const res = await this.getThreadMessagesResult(workspaceId, threadId, limit)
    return res.state === 'DATA' ? res.data : []
  }

  /**
   * 4. Save message to thread (SSOT: usage_metadata + column compatibility)
   */
  public static async saveMessage(
    workspaceId: string,
    threadId: string,
    role: 'user' | 'sohee' | 'system_event',
    content: string,
    metadata?: {
      toolCalls?: any[]
      runId?: string
      missionId?: string | null
      planVersion?: number
      planDiffSummary?: string
      evidenceRefs?: any[]
      clientMessageId?: string
      actionGraph?: any
      publicChatResult?: import('@/lib/agent-os/public-chat-result').PublicChatResult | null
    }
  ): Promise<string> {
    try {
      const isUUID = (val?: string) =>
        typeof val === 'string' &&
        /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(val)

      const isClientUuid = isUUID(metadata?.clientMessageId)
      const messageId = isClientUuid ? (metadata!.clientMessageId as string) : crypto.randomUUID()
      const clientMessageIdUuid = isClientUuid ? (metadata!.clientMessageId as string) : null

      const usageMetadata: Record<string, unknown> = {
        runId: metadata?.runId || null,
        missionId: metadata?.missionId || null,
        planVersion: metadata?.planVersion ?? 0,
        ...(metadata?.planDiffSummary ? { planDiffSummary: metadata.planDiffSummary } : {}),
        toolCalls: metadata?.toolCalls || [],
        evidenceRefs: metadata?.evidenceRefs || [],
        actionGraph: metadata?.actionGraph || null,
        ...(metadata?.publicChatResult ? { publicChatResult: metadata.publicChatResult } : {}),
      }
      if (metadata?.clientMessageId) {
        usageMetadata.rawClientMessageId = metadata.clientMessageId
      }

      const insertRecord: Record<string, unknown> = {
        id: messageId,
        workspace_id: workspaceId,
        thread_id: threadId,
        role,
        content: content.slice(0, 20000),
        status: 'completed',
        usage_metadata: usageMetadata,
        content_parts: [],
        tool_calls: metadata?.toolCalls || [],
        evidence_refs: metadata?.evidenceRefs || [],
        run_id: metadata?.runId || null,
        completed_at: new Date().toISOString()
      }

      if (clientMessageIdUuid) {
        insertRecord.client_message_id = clientMessageIdUuid
      }

      // Architecture Boundary (13th Canon ANI-1189, ANI-1206, ANI-1207):
      // 1. Authenticate user actor attribution if role === 'user'
      if (role === 'user') {
        const userClient = await createServerSupabaseClient()
        const authUser = await userClient.auth.getUser()
        if (authUser.data?.user?.id) {
          insertRecord.created_by_user_id = authUser.data.user.id
        }
      }

      // 2. Server-authoritative trusted writer: eliminates client-side 42501 permission denied
      const adminClient = createAdminSupabaseClient()

      // Compare scope and payload, including after a concurrent unique-insert conflict.
      const findExisting = async (): Promise<string | undefined> => {
        if (!clientMessageIdUuid) return undefined
        const result = await adminClient.from('messages')
          .select('id, thread_id, role, content')
          .eq('workspace_id', workspaceId)
          .eq('client_message_id', clientMessageIdUuid).maybeSingle()
        assertSupabaseSuccess(result, 'ConversationRepository.saveMessage:lookup')
        const existing = result.data
        if (!existing) return undefined
        if (existing.thread_id !== threadId || existing.role !== role || existing.content !== content) {
          throw new ConversationTurnConflict('IDEMPOTENCY_CONFLICT')
        }
        return existing.id
      }
      if (clientMessageIdUuid && content.length > 20000) throw new ConversationTurnConflict('IDEMPOTENCY_CONFLICT')
      const existingId = await findExisting()
      if (existingId) return existingId

      // 4. Safe single insert (never upsert with UPDATE grant requirement)
      const fromMessages = adminClient.from('messages')
      const mutationQuery = typeof fromMessages.insert === 'function'
        ? fromMessages.insert(insertRecord as any)
        : fromMessages.upsert(insertRecord as any)

      const mutation = typeof mutationQuery?.select === 'function'
        ? await mutationQuery.select('id').single()
        : await mutationQuery

      if (mutation.error?.code === '23505' && clientMessageIdUuid) {
        const winnerId = await findExisting()
        if (winnerId) return winnerId
      }
      assertSupabaseSuccess(mutation, 'ConversationRepository.saveMessage')

      // Update thread last_message_at
      const threadMutation = await adminClient
        .from('conversation_threads')
        .update({ last_message_at: new Date().toISOString() })
        .eq('id', threadId)
        .eq('workspace_id', workspaceId)

      assertSupabaseSuccess(threadMutation, 'ConversationRepository.saveMessage:updateThread')

      return messageId
    } catch (err) {
      if (err instanceof PersistenceError) throw err
      console.error('[ConversationRepository] Error saving message:', err)
      throw new PersistenceError('saveMessage', (err as Error).message || 'Unexpected error saving message', err)
    }
  }

  /**
   * 5. Create Canonical Agent Run (persisted to conversation_jobs SSOT)
   */
  public static async createAgentRun(
    workspaceId: string,
    threadId: string | undefined,
    goal: string,
    planData: Record<string, unknown>,
    traceId: string,
    userMessageId?: string,
    assistantMessageId?: string
  ): Promise<string> {
    try {
      const supabase = createAdminSupabaseClient()
      const db = supabase as any
      const runId = crypto.randomUUID()

      const record: Record<string, unknown> = {
        id: runId,
        workspace_id: workspaceId,
        thread_id: threadId,
        user_message_id: userMessageId || crypto.randomUUID(),
        assistant_message_id: assistantMessageId || null,
        kind: 'chat',
        status: 'running',
        goal,
        plan_data: planData,
        trace_id: traceId,
        model_snapshot: {
          conversation: 'gemini-3.5-flash-lite',
          action: 'gemini-3.8-flash',
          image: 'gpt-image-2'
        },
        sequence_number: Date.now()
      }

      let fromObj = db.from('conversation_jobs')
      let isAgentRuns = false
      if (!fromObj || typeof fromObj.insert !== 'function') {
        fromObj = db.from('agent_runs')
        isAgentRuns = true
      }

      const insertData = isAgentRuns ? {
        id: runId,
        workspace_id: workspaceId,
        thread_id: threadId,
        user_message_id: userMessageId || crypto.randomUUID(),
        assistant_message_id: assistantMessageId || null,
        goal,
        plan_data: planData,
        trace_id: traceId,
        status: 'running',
        sequence_number: Date.now()
      } : record

      const insertQuery = fromObj.insert(insertData)
      const mutation = typeof insertQuery?.select === 'function'
        ? await insertQuery.select('id').single()
        : await insertQuery

      if (mutation.error?.code === '23505' && userMessageId && !isAgentRuns) {
        const existing = await db.from('conversation_jobs').select('id, thread_id, goal')
          .eq('workspace_id', workspaceId).eq('user_message_id', userMessageId).maybeSingle()
        assertSupabaseSuccess(existing, 'ConversationRepository.createAgentRun:lookup')
        if (existing.data) {
          if (existing.data.thread_id !== threadId || existing.data.goal !== goal) throw new ConversationTurnConflict('IDEMPOTENCY_CONFLICT')
          // Returning the ID as a new run would authorize a second executor. Recover by GET instead.
          throw new ConversationTurnConflict('TURN_ALREADY_EXISTS', existing.data.id, threadId)
        }
      }
      assertSupabaseSuccess(mutation, 'ConversationRepository.createAgentRun')

      return runId
    } catch (err) {
      if (err instanceof PersistenceError) throw err
      console.error('[ConversationRepository] Error creating agent run:', err)
      throw new PersistenceError('createAgentRun', (err as Error).message || 'Unexpected error creating agent run', err)
    }
  }

  /**
   * 6. Update Canonical Agent Run Status
   */
  public static async updateAgentRunStatus(
    runId: string,
    status: AgentRunRow['status'] | string,
    completed = false,
    assistantMessageId?: string,
    failureGuard?: { workspaceId: string; onlyRunning: true; safeErrorCode?: 'AGENT_TURN_INTERRUPTED' }
  ): Promise<void> {
    try {
      const supabase = createAdminSupabaseClient()
      const db = supabase as any

      const mappedStatus = status === 'completed' 
        ? 'succeeded' 
        : status === 'failed' 
        ? 'needs_attention' 
        : status === 'cancelled'
        ? 'cancelled'
        : status === 'awaiting_approval'
        ? 'awaiting_approval'
        : 'running'

      const isTerminal = mappedStatus === 'succeeded' || mappedStatus === 'needs_attention' || mappedStatus === 'cancelled'

      const updates: Record<string, unknown> = {
        status: mappedStatus,
        updated_at: new Date().toISOString(),
        heartbeat_at: new Date().toISOString(),
        completed_at: (completed || isTerminal) ? new Date().toISOString() : null,
      }

      if (assistantMessageId) {
        updates.assistant_message_id = assistantMessageId
      }

      let fromObj = db.from('conversation_jobs')
      if (!fromObj || typeof fromObj.update !== 'function') {
        fromObj = db.from('agent_runs')
      }

      if (failureGuard?.safeErrorCode) updates.safe_error_code = failureGuard.safeErrorCode
      let query = fromObj.update(updates).eq('id', runId)
      if (failureGuard) {
        query = query.eq('workspace_id', failureGuard.workspaceId).eq('status', 'running')
      }
      const mutation = await query

      assertSupabaseSuccess(mutation, 'ConversationRepository.updateAgentRunStatus')
    } catch (err) {
      if (err instanceof PersistenceError) throw err
      console.error('[ConversationRepository] Error updating run:', err)
      throw new PersistenceError('updateAgentRunStatus', (err as Error).message || 'Unexpected error updating run', err)
    }
  }

  /**
   * 7. Record an individual step in conversation_job_steps table (Durable Ledger)
   */
  public static async isAgentRunExecutable(workspaceId: string, runId: string): Promise<boolean> {
    const db = createAdminSupabaseClient()
    const result = await db.from('conversation_jobs').select('status')
      .eq('workspace_id', workspaceId).eq('id', runId).maybeSingle()
    assertSupabaseSuccess(result, 'ConversationRepository.isAgentRunExecutable')
    return result.data?.status === 'running'
  }

  // Insert-only intent: a restart must not overwrite a completed or ambiguous provider attempt.
  public static async beginAgentRunStep(step: {
    workspaceId: string; runId: string; stepIndex: number; capabilityId: string
    riskTier?: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL'; inputPayload: Record<string, unknown>
  }): Promise<void> {
    const db = createAdminSupabaseClient() as any
    const result = await db.from('conversation_job_steps').insert({
      workspace_id: step.workspaceId, job_id: step.runId, step_index: step.stepIndex,
      capability_id: step.capabilityId, risk_tier: step.riskTier || 'LOW',
      status: 'running', state: 'running', input_payload: step.inputPayload,
      output_payload: {}, provider_call_key: `${step.runId}:${step.stepIndex}`,
    })
    assertSupabaseSuccess(result, 'ConversationRepository.beginAgentRunStep')
  }

  public static async recordAgentRunStep(step: {
    runId: string
    stepIndex: number
    capabilityId: string
    riskTier?: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL'
    status: 'pending' | 'running' | 'verifying' | 'completed' | 'failed' | 'skipped'
    inputPayload: Record<string, unknown>
    outputPayload?: Record<string, unknown>
    idempotencyKey?: string
    externalReceiptId?: string
    error?: string
    completed?: boolean
    workspaceId?: string
  }): Promise<void> {
    try {
      const supabase = createAdminSupabaseClient()
      const db = supabase as any

      const record: Record<string, unknown> = {
        job_id: step.runId,
        step_index: step.stepIndex,
        capability_id: step.capabilityId,
        risk_tier: step.riskTier || 'LOW',
        status: step.status,
        state: step.status || 'pending',
        input_payload: step.inputPayload,
        output_payload: step.outputPayload || {},
        idempotency_key: step.idempotencyKey || null,
        external_receipt_id: step.externalReceiptId || null,
        provider_call_key: `${step.runId}:${step.stepIndex}`,
        safe_error_code: step.error ? step.error.slice(0, 120) : null,
      }

      let workspaceId = step.workspaceId
      if (!workspaceId) {
        try {
          const { data: jobData } = await db.from('conversation_jobs').select('workspace_id').eq('id', step.runId).maybeSingle()
          if (jobData?.workspace_id) {
            workspaceId = jobData.workspace_id
          }
        } catch {
          // Ignore fallback lookup error
        }
      }
      if (workspaceId) {
        record.workspace_id = workspaceId
      }

      if (step.completed) {
        record.completed_at = new Date().toISOString()
      }

      let fromObj = db.from('conversation_job_steps')
      let isAgentRunSteps = false
      if (!fromObj || typeof (fromObj.upsert || fromObj.insert) !== 'function') {
        fromObj = db.from('agent_run_steps')
        isAgentRunSteps = true
      }

      const finalRecord = isAgentRunSteps ? {
        run_id: step.runId,
        step_index: step.stepIndex,
        capability_id: step.capabilityId,
        risk_tier: step.riskTier || 'LOW',
        status: step.status,
        input_payload: step.inputPayload,
        output_payload: step.outputPayload || {},
        idempotency_key: step.idempotencyKey || null,
        external_receipt_id: step.externalReceiptId || null,
        error: step.error || null,
        completed_at: step.completed ? new Date().toISOString() : null,
      } : record

      const mutation = typeof fromObj.upsert === 'function'
        ? await fromObj.upsert(finalRecord, { onConflict: isAgentRunSteps ? 'run_id,step_index' : 'job_id,provider_call_key' })
        : await fromObj.insert(finalRecord)

      assertSupabaseSuccess(mutation, 'ConversationRepository.recordAgentRunStep')
    } catch (err) {
      if (err instanceof PersistenceError) throw err
      console.error('[ConversationRepository] Error recording agent run step:', err)
      throw new PersistenceError('recordAgentRunStep', (err as Error).message || 'Unexpected error recording agent run step', err)
    }
  }

  /**
   * 8. Update Plan Data and Action Graph on Agent Run
   */
  public static async updateAgentRunPlanData(
    runId: string,
    planData: Record<string, unknown>
  ): Promise<void> {
    try {
      const supabase = createAdminSupabaseClient()
      const db = supabase as any

      let fromObj = db.from('conversation_jobs')
      if (!fromObj || typeof fromObj.update !== 'function') {
        fromObj = db.from('agent_runs')
      }

      const mutation = await fromObj
        .update({
          plan_data: planData,
          updated_at: new Date().toISOString(),
          heartbeat_at: new Date().toISOString()
        })
        .eq('id', runId)

      assertSupabaseSuccess(mutation, 'ConversationRepository.updateAgentRunPlanData')
    } catch (err) {
      if (err instanceof PersistenceError) throw err
      console.error('[ConversationRepository] Error updating agent run plan data:', err)
      throw new PersistenceError('updateAgentRunPlanData', (err as Error).message || 'Unexpected error updating agent run plan data', err)
    }
  }

  /**
   * 9. Get Agent Run details
   */
  public static async getAgentRun(
    workspaceId: string,
    runId: string
  ): Promise<AgentRunRow | null> {
    try {
      const supabase = await createServerSupabaseClient()
      const db = supabase as any

      const { data, error } = await db
        .from('conversation_jobs')
        .select('*')
        .eq('id', runId)
        .eq('workspace_id', workspaceId)
        .single()

      if (error || !data) {
        return null
      }

      return {
        id: data.id,
        workspaceId: data.workspace_id,
        threadId: data.thread_id,
        status: data.status,
        goal: data.goal || '',
        planData: data.plan_data || {},
        traceId: data.trace_id || '',
        correlationId: data.correlation_id,
        createdAt: data.queued_at || data.created_at,
        completedAt: data.completed_at
      }
    } catch (err) {
      console.error('[ConversationRepository] Error fetching agent run:', err)
      return null
    }
  }
}


