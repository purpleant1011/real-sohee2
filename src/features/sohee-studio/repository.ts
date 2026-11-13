import 'server-only'

import type {
  GoalPriority,
  GoalStatus,
  KnowledgeProposal,
  KnowledgeView,
  SoheeGoal,
  StudioStatus,
  EvidenceRef,
  EvidenceKind,
} from './types'

export interface StudioProposal extends KnowledgeProposal {
  kind: 'fact' | 'goal'
  confirmedTargetId?: string | null
  expectedFactCreatedAt?: string
}

export interface StudioThreadRow {
  id: string
  workspace_id: string
  kind: 'studio'
  title: string
  status: 'active' | 'archived'
  last_message_at?: string | null
  created_at: string
  updated_at: string
}

export interface StudioMessageItem {
  id: string
  workspace_id: string
  thread_id: string
  role: 'user' | 'sohee' | 'system_event'
  content: string
  status: 'queued' | 'streaming' | 'completed' | 'failed' | 'cancelled'
  client_message_id?: string | null
  reply_to_message_id?: string | null
  model_name?: string | null
  usage_metadata?: Record<string, any>
  created_by_user_id?: string | null
  created_at: string
  completed_at?: string | null
}

export interface CuriosityDecision {
  workspaceId: string
  questionKey: string
  status: 'snoozed' | 'not_applicable'
  updatedBy: string
  createdAt: string
  updatedAt: string
}

export interface CreateProposalInput {
  kind: 'fact' | 'goal'
  category: string
  content: string
  replacesFactId?: string
  expectedFactCreatedAt?: string
  idempotencyKey?: string
}

export interface SaveProposalParams extends CreateProposalInput {
  workspaceId: string
  sourceMessageId: string
  userId: string
}

export interface PersistTurnParams {
  workspaceId: string
  threadId: string
  userMessage: {
    clientMessageId: string
    content: string
    userId: string
  }
  assistantMessage: {
    content: string
    modelName?: string
    usageMetadata?: Record<string, any>
    status?: 'completed' | 'failed'
  }
  proposals?: CreateProposalInput[]
}

export interface PersistTurnResult {
  userMessage: StudioMessageItem
  assistantMessage: StudioMessageItem
  proposals: StudioProposal[]
  idempotent: boolean
}

export interface DecideProposalParams {
  workspaceId: string
  proposalId: string
  decision: 'confirm' | 'reject'
  userId: string
  revisedContent?: string
  validFrom?: string
  validUntil?: string | null
}

export interface DecideProposalResult {
  success: boolean
  id: string
  status: 'confirmed' | 'rejected'
  confirmedTargetId?: string | null
  kind: 'fact' | 'goal'
  idempotent?: boolean
}

export interface DecideQuestionParams {
  workspaceId: string
  questionKey: string
  status: 'snoozed' | 'not_applicable'
  userId: string
}

export interface UpdateGoalParams {
  workspaceId: string
  userId: string
  goalId: string
  expectedVersion: number
  title?: string
  desiredOutcome?: string
  priority?: GoalPriority
  status?: GoalStatus
}

export interface EnsureUserMessageParams {
  workspaceId: string
  threadId: string
  clientMessageId: string
  content: string
  userId: string
}

export interface ClaimAssistantTurnParams {
  workspaceId: string
  threadId: string
  userMessageId: string
  assistantMessageId?: string
  modelName?: string
}

export interface FinalizeAssistantTurnParams {
  workspaceId: string
  threadId: string
  assistantMessageId: string
  content: string
  status?: 'completed' | 'failed'
  usageMetadata?: Record<string, any>
  proposals?: CreateProposalInput[]
  userId: string
}

export interface SupabaseClientLike {
  from(table: string): any
  rpc(fn: string, args: Record<string, any>): any
}

async function resolveClient(client?: SupabaseClientLike): Promise<SupabaseClientLike> {
  if (client) return client
  const { createAdminSupabaseClient } = await import('@/lib/supabase/admin')
  return createAdminSupabaseClient() as unknown as SupabaseClientLike
}

function mapProposalRow(row: any, fallbackThreadId?: string): StudioProposal {
  const evidence: EvidenceRef[] = [
    {
      kind: 'owner_statement',
      sourceId: row.source_message_id,
      observedAt: row.created_at,
    },
  ]

  return {
    id: row.id,
    workspaceId: row.workspace_id,
    threadId: row.thread_id ?? fallbackThreadId ?? '',
    sourceMessageId: row.source_message_id,
    kind: row.kind,
    category: row.category,
    proposedContent: row.content,
    replacesFactId: row.replaces_fact_id ?? undefined,
    expectedFactCreatedAt: row.expected_fact_created_at ?? undefined,
    expectedFactVersion: undefined,
    evidence,
    status: row.status as StudioStatus,
    confirmedTargetId: row.confirmed_target_id ?? undefined,
    createdAt: row.created_at,
  }
}

function mapGoalRow(row: any): SoheeGoal {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    title: row.title,
    desiredOutcome: row.desired_outcome,
    metric: row.metric ?? undefined,
    dueAt: row.due_at ?? undefined,
    priority: row.priority,
    status: row.status,
    sourceMessageId: row.source_message_id ?? undefined,
    version: row.version ?? 1,
    updatedBy: row.updated_by ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

/**
 * 1. 활성 스튜디오 스레드 조회 또는 생성
 */
export async function getOrCreateStudioThread(
  workspaceId: string,
  client?: SupabaseClientLike,
): Promise<StudioThreadRow> {
  if (!workspaceId?.trim()) {
    throw new Error('invalid_argument: workspaceId is required')
  }

  const supabase = await resolveClient(client)

  // 1. 기존 active 스튜디오 스레드 확인
  const { data: existing, error: selectError } = await supabase
    .from('conversation_threads')
    .select('id, workspace_id, kind, title, status, last_message_at, created_at, updated_at')
    .eq('workspace_id', workspaceId.trim())
    .eq('kind', 'studio')
    .eq('status', 'active')
    .maybeSingle()

  if (selectError) {
    throw new Error(selectError.message || 'STUDIO_THREAD_QUERY_FAILED')
  }

  if (existing) {
    return existing as StudioThreadRow
  }

  // 2. 신규 생성 시도
  const now = new Date().toISOString()
  const { data: created, error: insertError } = await supabase
    .from('conversation_threads')
    .insert({
      workspace_id: workspaceId.trim(),
      kind: 'studio',
      title: '소희 스튜디오',
      status: 'active',
      created_at: now,
      updated_at: now,
    })
    .select('id, workspace_id, kind, title, status, last_message_at, created_at, updated_at')
    .single()

  if (insertError) {
    // Unique race condition fallback (23505)
    const { data: fallback, error: fallbackError } = await supabase
      .from('conversation_threads')
      .select('id, workspace_id, kind, title, status, last_message_at, created_at, updated_at')
      .eq('workspace_id', workspaceId.trim())
      .eq('kind', 'studio')
      .eq('status', 'active')
      .maybeSingle()

    if (fallbackError || !fallback) {
      throw new Error(insertError.message || 'STUDIO_THREAD_CREATION_FAILED')
    }
    return fallback as StudioThreadRow
  }

  return created as StudioThreadRow
}

/**
 * 2. 스튜디오 메시지 목록 및 연결된 제안들 조회
 */
export async function listStudioMessages(
  workspaceId: string,
  threadId: string,
  options?: { limit?: number },
  client?: SupabaseClientLike,
): Promise<{ messages: StudioMessageItem[]; proposals: StudioProposal[] }> {
  if (!workspaceId?.trim()) throw new Error('invalid_argument: workspaceId is required')
  if (!threadId?.trim()) throw new Error('invalid_argument: threadId is required')

  const supabase = await resolveClient(client)
  const rawLimit = options?.limit ?? 50
  const limit = Math.max(1, Math.min(rawLimit, 100))

  // 1. 메시지 조회 (최신순 DESC + deterministic id DESC로 조회 후 오름차순 ASC로 reverse)
  const { data: messageRows, error: msgError } = await supabase
    .from('messages')
    .select('*')
    .eq('workspace_id', workspaceId.trim())
    .eq('thread_id', threadId.trim())
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(limit)

  if (msgError) {
    throw new Error(msgError.message || 'STUDIO_MESSAGES_QUERY_FAILED')
  }

  // 최신 N개를 시간 순서(과거->최신 ASC)로 정렬하여 UI 및 AI 히스토리에 제공
  const messages: StudioMessageItem[] = (messageRows ?? []).slice().reverse()
  const messageIds = messages.map((m) => m.id).filter(Boolean)

  if (messageIds.length === 0) {
    return { messages: [], proposals: [] }
  }

  // 2. 연결된 제안 조회
  const { data: proposalRows, error: propError } = await supabase
    .from('sohee_studio_proposals')
    .select('*')
    .eq('workspace_id', workspaceId.trim())
    .in('source_message_id', messageIds)
    .order('created_at', { ascending: true })

  if (propError) {
    throw new Error(propError.message || 'STUDIO_PROPOSALS_QUERY_FAILED')
  }

  const proposals = (proposalRows ?? []).map((p: any) => mapProposalRow(p, threadId.trim()))

  return { messages, proposals }
}

/**
 * 3. 사용자-어시스턴트 턴 원자적/멱등 저장 (Ensure -> Claim -> Finalize 위임 단일화)
 */
export async function persistTurn(
  params: PersistTurnParams,
  client?: SupabaseClientLike,
): Promise<PersistTurnResult> {
  const { workspaceId, threadId, userMessage, assistantMessage, proposals = [] } = params

  if (!workspaceId?.trim()) throw new Error('invalid_argument: workspaceId is required')
  if (!threadId?.trim()) throw new Error('invalid_argument: threadId is required')
  if (!userMessage?.clientMessageId?.trim()) throw new Error('invalid_argument: clientMessageId is required')
  if (!userMessage?.content?.trim()) throw new Error('invalid_argument: user content is required')
  if (!userMessage?.userId?.trim()) throw new Error('invalid_argument: userId is required')

  const supabase = await resolveClient(client)

  // 1. 유저 메시지 멱등 확보 (내용 불일치 시 STUDIO_TURN_CONFLICT 에러)
  const { message: userMsg, created } = await ensureUserMessage(
    {
      workspaceId,
      threadId,
      clientMessageId: userMessage.clientMessageId,
      content: userMessage.content,
      userId: userMessage.userId,
    },
    supabase,
  )

  if (!created) {
    // 이미 존재하는 턴인 경우: 기존 어시스턴트 메시지 및 제안들 조회하여 반환
    const { data: assistantReply, error: replyError } = await supabase
      .from('messages')
      .select('*')
      .eq('workspace_id', workspaceId.trim())
      .eq('reply_to_message_id', userMsg.id)
      .maybeSingle()

    if (replyError) {
      throw new Error(replyError.message || 'EXISTING_REPLY_QUERY_FAILED')
    }

    const { data: existingProposals, error: propError } = await supabase
      .from('sohee_studio_proposals')
      .select('*')
      .eq('workspace_id', workspaceId.trim())
      .eq('source_message_id', userMsg.id)
      .order('created_at', { ascending: true })

    if (propError) {
      throw new Error(propError.message || 'EXISTING_PROPOSALS_QUERY_FAILED')
    }

    return {
      userMessage: userMsg,
      assistantMessage: (assistantReply as StudioMessageItem) ?? ({} as StudioMessageItem),
      proposals: (existingProposals ?? []).map((p: any) => mapProposalRow(p)),
      idempotent: true,
    }
  }

  // 2. 어시스턴트 turn claim (DB 유니크 인덱스로 concurrent 중복 선점 방지)
  const { message: claimedAssistant } = await claimAssistantTurn(
    {
      workspaceId,
      threadId,
      userMessageId: userMsg.id,
      modelName: assistantMessage.modelName,
    },
    supabase,
  )

  // 3. finalize: DB RPC를 통한 어시스턴트 메시지 완료 및 제안 원자적 저장 (단일 트랜잭션)
  const { assistantMessage: finalizedAssistant, proposals: savedProposals } = await finalizeAssistantTurn(
    {
      workspaceId,
      threadId,
      assistantMessageId: claimedAssistant.id,
      content: assistantMessage.content,
      status: assistantMessage.status ?? 'completed',
      usageMetadata: assistantMessage.usageMetadata,
      proposals,
      userId: userMessage.userId,
    },
    supabase,
  )

  return {
    userMessage: userMsg,
    assistantMessage: finalizedAssistant,
    proposals: savedProposals,
    idempotent: false,
  }
}

/**
 * 3-1. 유저 메시지 멱등 확보 (중복 전송 방지 및 Replay 불일치 시 STUDIO_TURN_CONFLICT)
 */
export async function ensureUserMessage(
  params: EnsureUserMessageParams,
  client?: SupabaseClientLike,
): Promise<{ message: StudioMessageItem; created: boolean }> {
  const { workspaceId, threadId, clientMessageId, content, userId } = params
  if (!workspaceId?.trim()) throw new Error('invalid_argument: workspaceId is required')
  if (!threadId?.trim()) throw new Error('invalid_argument: threadId is required')
  if (!clientMessageId?.trim()) throw new Error('invalid_argument: clientMessageId is required')
  if (!content?.trim()) throw new Error('invalid_argument: content is required')
  if (!userId?.trim()) throw new Error('invalid_argument: userId is required')

  const supabase = await resolveClient(client)

  // 멱등성 검사
  const { data: existing, error: selectError } = await supabase
    .from('messages')
    .select('*')
    .eq('workspace_id', workspaceId.trim())
    .eq('client_message_id', clientMessageId.trim())
    .maybeSingle()

  if (selectError) throw new Error(selectError.message || 'USER_MESSAGE_CHECK_FAILED')
  if (existing) {
    if (
      existing.thread_id !== threadId.trim() ||
      existing.content !== content.trim() ||
      existing.created_by_user_id !== userId.trim()
    ) {
      throw new Error('conflict: clientMessageId replay with different content or thread (STUDIO_TURN_CONFLICT)')
    }
    return { message: existing as StudioMessageItem, created: false }
  }

  const now = new Date().toISOString()
  const { data: created, error: insertError } = await supabase
    .from('messages')
    .insert({
      workspace_id: workspaceId.trim(),
      thread_id: threadId.trim(),
      role: 'user',
      content: content.trim(),
      status: 'completed',
      client_message_id: clientMessageId.trim(),
      created_by_user_id: userId.trim(),
      created_at: now,
      completed_at: now,
    })
    .select('*')
    .single()

  if (insertError) {
    const { data: fallback, error: fallbackError } = await supabase
      .from('messages')
      .select('*')
      .eq('workspace_id', workspaceId.trim())
      .eq('client_message_id', clientMessageId.trim())
      .maybeSingle()

    if (fallbackError || !fallback) {
      throw new Error(insertError.message || 'USER_MESSAGE_INSERT_FAILED')
    }

    if (
      fallback.thread_id !== threadId.trim() ||
      fallback.content !== content.trim() ||
      fallback.created_by_user_id !== userId.trim()
    ) {
      throw new Error('conflict: clientMessageId replay with different content or thread (STUDIO_TURN_CONFLICT)')
    }

    return { message: fallback as StudioMessageItem, created: false }
  }

  return { message: created as StudioMessageItem, created: true }
}

/**
 * 3-2. 어시스턴트 턴 Claim (streaming 상태로 선점하여 concurrent provider 중복 호출 방지)
 */
export async function claimAssistantTurn(
  params: ClaimAssistantTurnParams,
  client?: SupabaseClientLike,
): Promise<{ message: StudioMessageItem; claimed: boolean }> {
  const { workspaceId, threadId, userMessageId, assistantMessageId, modelName } = params
  if (!workspaceId?.trim()) throw new Error('invalid_argument: workspaceId is required')
  if (!threadId?.trim()) throw new Error('invalid_argument: threadId is required')
  if (!userMessageId?.trim()) throw new Error('invalid_argument: userMessageId is required')

  const supabase = await resolveClient(client)

  const { data: existing, error: selectError } = await supabase
    .from('messages')
    .select('*')
    .eq('workspace_id', workspaceId.trim())
    .eq('thread_id', threadId.trim())
    .eq('reply_to_message_id', userMessageId.trim())
    .eq('role', 'sohee')
    .maybeSingle()

  if (selectError) throw new Error(selectError.message || 'ASSISTANT_REPLY_CHECK_FAILED')
  if (existing) return { message: existing as StudioMessageItem, claimed: false }

  const now = new Date().toISOString()
  const insertPayload: Record<string, any> = {
    workspace_id: workspaceId.trim(),
    thread_id: threadId.trim(),
    role: 'sohee',
    content: '응답을 준비하고 있습니다.',
    status: 'streaming',
    reply_to_message_id: userMessageId.trim(),
    model_name: modelName ?? null,
    usage_metadata: { soheeStudioTurn: 'true' },
    created_at: now,
  }
  if (assistantMessageId?.trim()) {
    insertPayload.id = assistantMessageId.trim()
  }

  const { data: created, error: insertError } = await supabase
    .from('messages')
    .insert(insertPayload)
    .select('*')
    .single()

  if (insertError) {
    // Unique reply index race condition fallback
    const { data: fallback, error: fallbackError } = await supabase
      .from('messages')
      .select('*')
      .eq('workspace_id', workspaceId.trim())
      .eq('thread_id', threadId.trim())
      .eq('reply_to_message_id', userMessageId.trim())
      .eq('role', 'sohee')
      .maybeSingle()

    if (fallbackError || !fallback) {
      throw new Error(insertError.message || 'ASSISTANT_CLAIM_FAILED')
    }
    return { message: fallback as StudioMessageItem, claimed: false }
  }

  return { message: created as StudioMessageItem, claimed: true }
}

/**
 * 3-3. 어시스턴트 턴 Finalize (완료 상태 갱신 및 제안 원자적 DB RPC 호출 - 순차 fallback 없음)
 */
export async function finalizeAssistantTurn(
  params: FinalizeAssistantTurnParams,
  client?: SupabaseClientLike,
): Promise<{ assistantMessage: StudioMessageItem; proposals: StudioProposal[] }> {
  const {
    workspaceId,
    threadId,
    assistantMessageId,
    content,
    status = 'completed',
    usageMetadata,
    proposals = [],
    userId,
  } = params

  if (!workspaceId?.trim()) throw new Error('invalid_argument: workspaceId is required')
  if (!threadId?.trim()) throw new Error('invalid_argument: threadId is required')
  if (!assistantMessageId?.trim()) throw new Error('invalid_argument: assistantMessageId is required')
  if (!content?.trim()) throw new Error('invalid_argument: content is required')
  if (!userId?.trim()) throw new Error('invalid_argument: userId is required')

  const supabase = await resolveClient(client)

  // 단일 원자적 DB RPC 호출 (부분 실패/불일치 원천 차단)
  const { data: rpcData, error: rpcError } = await supabase.rpc('finalize_studio_turn', {
    p_workspace_id: workspaceId.trim(),
    p_thread_id: threadId.trim(),
    p_assistant_message_id: assistantMessageId.trim(),
    p_content: content.trim(),
    p_status: status,
    p_usage_metadata: usageMetadata ?? {},
    p_proposals: proposals,
    p_user_id: userId.trim(),
  })

  if (rpcError || !rpcData?.success) {
    throw new Error(rpcError?.message || 'ASSISTANT_FINALIZE_RPC_FAILED')
  }

  const rawMsg = rpcData.assistant_message
  const rawProps = rpcData.proposals ?? []

  return {
    assistantMessage: rawMsg as StudioMessageItem,
    proposals: (rawProps as any[]).map((p: any) => mapProposalRow(p)),
  }
}

/**
 * 4. 단일 제안 저장 (fact 또는 goal)
 */
export async function saveProposal(
  params: SaveProposalParams,
  client?: SupabaseClientLike,
): Promise<StudioProposal> {
  const {
    workspaceId,
    sourceMessageId,
    kind,
    category,
    content,
    replacesFactId,
    expectedFactCreatedAt,
    idempotencyKey,
    userId,
  } = params

  if (!workspaceId?.trim()) throw new Error('invalid_argument: workspaceId is required')
  if (!sourceMessageId?.trim()) throw new Error('invalid_argument: sourceMessageId is required')
  if (!kind || !['fact', 'goal'].includes(kind)) throw new Error('invalid_argument: kind must be fact or goal')
  if (!category?.trim()) throw new Error('invalid_argument: category is required')
  const maxCategoryLen = kind === 'goal' ? 200 : 120
  if (category.trim().length > maxCategoryLen) {
    throw new Error(`invalid_argument: category exceeds maximum length of ${maxCategoryLen} for kind ${kind}`)
  }
  if (!content?.trim()) throw new Error('invalid_argument: content is required')
  if (!userId?.trim()) throw new Error('invalid_argument: userId is required')

  const supabase = await resolveClient(client)

  // 멱등키가 있는 경우 사전 확인
  if (idempotencyKey?.trim()) {
    const { data: existing, error: checkError } = await supabase
      .from('sohee_studio_proposals')
      .select('*')
      .eq('workspace_id', workspaceId.trim())
      .eq('idempotency_key', idempotencyKey.trim())
      .maybeSingle()

    if (checkError) {
      throw new Error(checkError.message || 'PROPOSAL_IDEMPOTENCY_CHECK_FAILED')
    }

    if (existing) {
      return mapProposalRow(existing)
    }
  }

  const now = new Date().toISOString()
  const { data: inserted, error: insertError } = await supabase
    .from('sohee_studio_proposals')
    .insert({
      workspace_id: workspaceId.trim(),
      source_message_id: sourceMessageId.trim(),
      kind,
      category: category.trim(),
      content: content.trim(),
      replaces_fact_id: replacesFactId ?? null,
      expected_fact_created_at: expectedFactCreatedAt ?? null,
      idempotency_key: idempotencyKey?.trim() ?? null,
      status: 'proposed',
      created_by: userId.trim(),
      created_at: now,
      updated_at: now,
    })
    .select('*')
    .single()

  if (insertError || !inserted) {
    throw new Error(insertError?.message || 'PROPOSAL_INSERT_FAILED')
  }

  return mapProposalRow(inserted)
}

/**
 * 5. 제안 확정/거절 DB RPC 호출 (원자적 교정/생성)
 */
export async function decideProposal(
  params: DecideProposalParams,
  client?: SupabaseClientLike,
): Promise<DecideProposalResult> {
  const { workspaceId, proposalId, decision, userId, revisedContent } = params

  if (!workspaceId?.trim()) throw new Error('invalid_argument: workspaceId is required')
  if (!proposalId?.trim()) throw new Error('invalid_argument: proposalId is required')
  if (!decision || !['confirm', 'reject'].includes(decision)) {
    throw new Error('invalid_argument: decision must be confirm or reject')
  }
  if (!userId?.trim()) throw new Error('invalid_argument: userId is required')

  const hasValidity = params.validFrom !== undefined || params.validUntil !== undefined
  let validity: { p_valid_from: string; p_valid_until: string | null } | undefined
  if (hasValidity) {
    const dated = /^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/
    const from = params.validFrom
    const until = params.validUntil
    if (decision !== 'confirm' || !from || !dated.test(from) || !Number.isFinite(Date.parse(from)) ||
      (until != null && (!dated.test(until) || !Number.isFinite(Date.parse(until)) || Date.parse(until) <= Date.parse(from)))) {
      throw new Error('invalid_argument: explicit validFrom and increasing validUntil are required')
    }
    validity = { p_valid_from: new Date(from).toISOString(), p_valid_until: until ? new Date(until).toISOString() : null }
  }
  const supabase = await resolveClient(client)

  const { data, error } = await supabase.rpc(validity ? 'decide_studio_proposal_with_validity' : 'decide_studio_proposal', {
    p_workspace_id: workspaceId.trim(),
    p_proposal_id: proposalId.trim(),
    p_decision: decision,
    p_user_id: userId.trim(),
    p_revised_content: revisedContent?.trim() ? revisedContent.trim() : null,
    ...validity,
  })

  if (error) {
    throw new Error(error.message || 'DECIDE_PROPOSAL_RPC_FAILED')
  }

  const res = typeof data === 'string' ? JSON.parse(data) : data

  return {
    success: !!res?.success,
    id: res?.id ?? proposalId,
    status: res?.status,
    confirmedTargetId: res?.confirmed_target_id ?? null,
    kind: res?.kind,
    idempotent: !!res?.idempotent,
  }
}

/**
 * 6. 목표 목록 조회
 */
export async function listGoals(
  workspaceId: string,
  options?: { status?: GoalStatus | GoalStatus[] },
  client?: SupabaseClientLike,
): Promise<SoheeGoal[]> {
  if (!workspaceId?.trim()) throw new Error('invalid_argument: workspaceId is required')

  const supabase = await resolveClient(client)

  let query = supabase
    .from('sohee_goals')
    .select('*')
    .eq('workspace_id', workspaceId.trim())

  if (options?.status) {
    if (Array.isArray(options.status)) {
      query = query.in('status', options.status)
    } else {
      query = query.eq('status', options.status)
    }
  }

  const { data, error } = await query.order('created_at', { ascending: false })

  if (error || !Array.isArray(data)) {
    throw new Error(error?.message || 'GOALS_QUERY_FAILED')
  }

  return data.map(mapGoalRow)
}

/**
 * 6-1. 목표 수정 / 일시중지 / 상태 변경 (낙관적 락 버전 검사)
 */
export async function updateGoal(
  params: UpdateGoalParams,
  client?: SupabaseClientLike,
): Promise<SoheeGoal> {
  const { workspaceId, userId, goalId, expectedVersion, title, desiredOutcome, priority, status } = params

  if (!workspaceId?.trim()) throw new Error('invalid_argument: workspaceId is required')
  if (!goalId?.trim()) throw new Error('invalid_argument: goalId is required')
  if (!userId?.trim()) throw new Error('invalid_argument: userId is required')
  if (typeof expectedVersion !== 'number' || expectedVersion < 1) {
    throw new Error('invalid_argument: expectedVersion must be a positive integer')
  }

  const supabase = await resolveClient(client)
  const now = new Date().toISOString()

  // 1. 기존 목표 확인 (존재 여부 및 버전 확인)
  const { data: existing, error: fetchError } = await supabase
    .from('sohee_goals')
    .select('*')
    .eq('workspace_id', workspaceId.trim())
    .eq('id', goalId.trim())
    .maybeSingle()

  if (fetchError || !existing) {
    throw new Error('goal_not_found: Goal does not exist')
  }

  if (existing.version !== expectedVersion) {
    throw new Error(`conflict: goal version conflict (expected ${expectedVersion}, current ${existing.version})`)
  }

  const updates: Record<string, any> = {
    version: expectedVersion + 1,
    updated_by: userId.trim(),
    updated_at: now,
  }
  if (title?.trim()) updates.title = title.trim()
  if (desiredOutcome?.trim()) updates.desired_outcome = desiredOutcome.trim()
  if (priority) updates.priority = priority
  if (status) updates.status = status

  const { data: updated, error: updateError } = await supabase
    .from('sohee_goals')
    .update(updates)
    .eq('workspace_id', workspaceId.trim())
    .eq('id', goalId.trim())
    .eq('version', expectedVersion)
    .select('*')
    .maybeSingle()

  if (updateError || !updated) {
    throw new Error(updateError?.message || 'conflict: concurrent goal update failed')
  }

  return mapGoalRow(updated)
}

/**
 * 7. 질문 결정 목록 조회
 */
export async function listDecisions(
  workspaceId: string,
  client?: SupabaseClientLike,
): Promise<CuriosityDecision[]> {
  if (!workspaceId?.trim()) throw new Error('invalid_argument: workspaceId is required')

  const supabase = await resolveClient(client)

  const { data, error } = await supabase
    .from('sohee_curiosity_decisions')
    .select('*')
    .eq('workspace_id', workspaceId.trim())
    .order('updated_at', { ascending: false })

  if (error || !Array.isArray(data)) {
    throw new Error(error?.message || 'CURIOSITY_DECISIONS_QUERY_FAILED')
  }

  return data.map((row: any) => ({
    workspaceId: row.workspace_id,
    questionKey: row.question_key,
    status: row.status,
    updatedBy: row.updated_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }))
}

/**
 * 8. 질문 보류/해당없음 결정 저장 (upsert)
 */
export async function decideQuestion(
  params: DecideQuestionParams,
  client?: SupabaseClientLike,
): Promise<CuriosityDecision> {
  const { workspaceId, questionKey, status, userId } = params

  if (!workspaceId?.trim()) throw new Error('invalid_argument: workspaceId is required')
  if (!questionKey?.trim()) throw new Error('invalid_argument: questionKey is required')
  if (!status || !['snoozed', 'not_applicable'].includes(status)) {
    throw new Error('invalid_argument: status must be snoozed or not_applicable')
  }
  if (!userId?.trim()) throw new Error('invalid_argument: userId is required')

  const supabase = await resolveClient(client)
  const now = new Date().toISOString()

  const { data, error } = await supabase
    .from('sohee_curiosity_decisions')
    .upsert({
      workspace_id: workspaceId.trim(),
      question_key: questionKey.trim(),
      status,
      updated_by: userId.trim(),
      updated_at: now,
    })
    .select('*')
    .single()

  if (error || !data) {
    throw new Error(error?.message || 'DECIDE_QUESTION_UPSERT_FAILED')
  }

  return {
    workspaceId: data.workspace_id,
    questionKey: data.question_key,
    status: data.status,
    updatedBy: data.updated_by,
    createdAt: data.created_at,
    updatedAt: data.updated_at,
  }
}

/**
 * 9. 전체 제안 목록 조회 (상태 필터링 가능)
 */
export async function listProposals(
  workspaceId: string,
  options?: { status?: StudioStatus | StudioStatus[]; kind?: 'fact' | 'goal' },
  client?: SupabaseClientLike,
): Promise<StudioProposal[]> {
  if (!workspaceId?.trim()) throw new Error('invalid_argument: workspaceId is required')

  const supabase = await resolveClient(client)

  let query = supabase
    .from('sohee_studio_proposals')
    .select('*')
    .eq('workspace_id', workspaceId.trim())

  if (options?.status) {
    if (Array.isArray(options.status)) {
      query = query.in('status', options.status)
    } else {
      query = query.eq('status', options.status)
    }
  }

  if (options?.kind) {
    query = query.eq('kind', options.kind)
  }

  const { data, error } = await query.order('created_at', { ascending: false })

  if (error || !Array.isArray(data)) {
    throw new Error(error?.message || 'STUDIO_PROPOSALS_LIST_FAILED')
  }

  return data.map((row: any) => mapProposalRow(row))
}

/**
 * 10. 확정 지식 상세 목록 조회 (실제 source_location 기반 출처)
 */
export async function listKnowledgeDetails(
  workspaceId: string,
  optionsOrClient?: { status?: 'active' | 'superseded' | 'expired' } | SupabaseClientLike,
  client?: SupabaseClientLike,
): Promise<KnowledgeView[]> {
  if (!workspaceId?.trim()) throw new Error('invalid_argument: workspaceId is required')

  const options =
    optionsOrClient && typeof (optionsOrClient as any).from !== 'function'
      ? (optionsOrClient as { status?: 'active' | 'superseded' | 'expired' })
      : undefined
  const providedClient =
    optionsOrClient && typeof (optionsOrClient as any).from === 'function'
      ? (optionsOrClient as SupabaseClientLike)
      : client

  const supabase = await resolveClient(providedClient)

  // 1. 팩트 조회 (옵션 status 필터 적용)
  let query = supabase
    .from('knowledge_facts')
    .select('*')
    .eq('workspace_id', workspaceId.trim())

  if (options?.status) {
    query = query.eq('status', options.status)
  }

  const { data: factsData, error: factsError } = await query
    .order('valid_from', { ascending: false })
    .limit(200)

  if (factsError) {
    throw new Error(factsError.message || 'KNOWLEDGE_DETAILS_FACTS_FAILED')
  }

  const facts = factsData ?? []
  if (facts.length === 0) return []

  const candidateIds = facts.map((f: any) => f.source_candidate_id).filter(Boolean)
  const candidateMap = new Map<string, any>()

  if (candidateIds.length > 0) {
    const { data: cands, error: candsError } = await supabase
      .from('knowledge_candidates')
      .select('id, knowledge_source_id, source_location, source_excerpt, evidence_document_id')
      .eq('workspace_id', workspaceId.trim())
      .in('id', candidateIds)

    if (candsError) {
      throw new Error(candsError.message || 'KNOWLEDGE_CANDIDATES_FAILED')
    }

    if (Array.isArray(cands)) {
      for (const c of cands) {
        if (c?.id) candidateMap.set(c.id, c)
      }
    }
  }

  return facts.map((fact: any) => {
    const cand = candidateMap.get(fact.source_candidate_id)
    const loc = (cand?.source_location ?? '').toLowerCase()
    let kind: EvidenceKind = 'unknown'

    if (cand) {
      if (cand.evidence_document_id) {
        kind = 'imported_source'
      } else if (loc.includes('file:') || /\.(pdf|png|jpe?g|webp|csv|xlsx?|docx?|txt|hwp)$/i.test(loc)) {
        kind = 'approved_document'
      } else if (loc.includes('naver') || loc.includes('url:')) {
        kind = 'imported_source'
      } else if (
        loc.includes('chat') ||
        loc.includes('user:') ||
        loc.includes('statement') ||
        loc.includes('studio') ||
        loc.includes('proposal')
      ) {
        kind = 'owner_statement'
      } else if (!loc && !cand.evidence_document_id) {
        // 온보딩(20260818164410_v08_onboarding_profile.sql 640~656) 및 직접 등록:
        // 후보가 존재하고 evidence_document_id가 없으며 source_location이 null/empty인 경우
        kind = 'owner_statement'
      } else {
        kind = 'unknown'
      }
    }

    const source: EvidenceRef = {
      kind,
      sourceId: cand?.knowledge_source_id ?? fact.source_candidate_id ?? fact.id,
      excerpt: cand?.source_excerpt ?? undefined,
      observedAt: fact.approved_at ?? fact.created_at,
      evidenceDocumentId: cand?.evidence_document_id ?? undefined,
    }

    return {
      id: fact.id,
      category: fact.category,
      content: fact.content,
      status: fact.status,
      source,
      approvedAt: fact.approved_at ?? fact.created_at,
      validFrom: fact.valid_from ?? fact.created_at,
      validUntil: fact.valid_until ?? undefined,
      supersedesFactId: fact.supersedes_fact_id ?? undefined,
      usedBy: [],
      createdAt: fact.created_at,
      versionTimestamp: fact.created_at,
    }
  })
}
