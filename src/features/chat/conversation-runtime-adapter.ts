import type { ToolExecutionContext, ToolExecutionResult } from '@/features/tool-runtime/types'
import {
  CONVERSATION_CAPABILITY_ALLOWED_MAP,
  type ConversationCapabilityId,
} from './conversation-runtime-router'

export type Scope = Readonly<{
  workspaceId: string
  userId: string
  threadId: string
  jobId: string
  assistantMessageId: string
  capabilityId?: ConversationCapabilityId
}>

export type ReadFact = Readonly<{
  status: 'COMPLETED' | 'BLOCKED'
  capabilityId?: ConversationCapabilityId
  balance?: number | null
  summary?: string | null
  data?: unknown
}>

export type ConversationReadDependencies = {
  authorized(): Promise<boolean>
  begin(scope: Scope): Promise<void>
  dispatch(context: ToolExecutionContext): Promise<ToolExecutionResult>
  record(fact: ReadFact): Promise<void>
  finalize(content: string, successful: boolean): Promise<void>
  evidence?(capabilityId?: ConversationCapabilityId): Promise<void>
  updateTimeline?(stepId: string, status: 'in_progress' | 'completed' | 'failed', title?: string): Promise<void>
}

export type ConversationReadOptions = Readonly<{
  capabilityId?: ConversationCapabilityId
}>

const TIMELINE_STEP_MAP: Record<ConversationCapabilityId, string> = {
  'credit.status': 'credit-read',
  'interaction.list': 'interaction-read',
  'reservation.list': 'reservation-read',
  'knowledge.search': 'knowledge-read',
}

/** Reuses a claimed turn and the existing dispatcher. The job runner alone settles and terminates the job. */
export async function executePreparedConversationRead(
  scope: Scope,
  deps: ConversationReadDependencies,
  optionsOrCapabilityId?: ConversationCapabilityId | ConversationReadOptions
) {
  const capabilityId: ConversationCapabilityId =
    (typeof optionsOrCapabilityId === 'string'
      ? optionsOrCapabilityId
      : optionsOrCapabilityId?.capabilityId) ??
    scope.capabilityId ??
    'credit.status'

  const stepId = TIMELINE_STEP_MAP[capabilityId] ?? 'credit-read'
  const allowed = CONVERSATION_CAPABILITY_ALLOWED_MAP[capabilityId] ?? [capabilityId]

  async function assertAuthority() {
    if (!await deps.authorized()) throw new Error('CONVERSATION_AUTHORITY_LOST')
  }

  await assertAuthority()
  await deps.begin(scope)
  await deps.updateTimeline?.(stepId, 'in_progress')
  await assertAuthority()

  const result = await deps.dispatch({
    workspaceId: scope.workspaceId,
    actorId: scope.userId,
    actionRunId: scope.jobId,
    correlationId: scope.jobId,
    intentMode: 'DRAFT',
    allowedCapabilityIds: [...allowed],
    authorizeCapability: async id => allowed.includes(id) && await deps.authorized(),
  })

  await assertAuthority()

  let successful = false
  let content = ''
  let balance: number | null = null

  if (capabilityId === 'credit.status') {
    const value = result.data?.balance
    successful = Boolean(
      result.success &&
      result.status === 'COMPLETED' &&
      (result.toolId === 'credit.status' || !result.toolId) &&
      typeof value === 'number' &&
      Number.isSafeInteger(value) &&
      value >= 0
    )
    balance = successful ? (value as number) : null
    content = successful
      ? `조회 시점에 사용 가능한 크레딧은 ${balance!.toLocaleString('ko-KR')}크레딧이에요. 처리 중인 예약분에 따라 잔액이 달라질 수 있어요.`
      : '크레딧을 확인하지 못했어요. 설정에서 잔액과 연결 상태를 확인해 주세요.'
  } else if (capabilityId === 'interaction.list') {
    successful = Boolean(result.success && result.status === 'COMPLETED' && result.data != null)
    if (successful) {
      const reviewsCount = Array.isArray(result.data?.reviews)
        ? result.data.reviews.length
        : (typeof result.data?.reviewsCount === 'number' ? result.data.reviewsCount : (typeof result.data?.commentsCount === 'number' ? result.data.commentsCount : 0))
      const dmCount = Array.isArray(result.data?.dmThreads)
        ? result.data.dmThreads.length
        : (typeof result.data?.dmCount === 'number' ? result.data.dmCount : (typeof result.data?.threadsCount === 'number' ? result.data.threadsCount : 0))
      content = `확인된 고객 소통 내역은 댓글 ${reviewsCount}건, DM ${dmCount}건이에요. 답변이 필요한 항목을 알려주시면 제안해 드릴게요.`
    } else {
      content = '소통 피드백 내역을 확인하지 못했어요. SNS 채널 연결 상태를 확인해 주세요.'
    }
  } else if (capabilityId === 'reservation.list') {
    successful = Boolean(result.success && result.status === 'COMPLETED' && result.data != null)
    if (successful) {
      const count = typeof result.data?.count === 'number'
        ? result.data.count
        : (Array.isArray(result.data?.reservations) ? result.data.reservations.length : 0)
      content = count > 0
        ? `현재 확인된 예약 일정은 총 ${count}건이에요. 상세 일정이나 고객 정보가 필요하시면 말씀해 주세요.`
        : '현재 등록된 예약 일정이 없습니다. 새로운 예약이 접수되면 안내해 드릴게요.'
    } else {
      content = '예약 장부를 확인하지 못했어요. 예약 시스템 연결 상태를 확인해 주세요.'
    }
  } else if (capabilityId === 'knowledge.search') {
    successful = Boolean(result.success && result.status === 'COMPLETED' && result.data != null)
    if (successful) {
      const factsCount = Array.isArray(result.data?.facts) ? result.data.facts.length : 0
      const memoriesCount = Array.isArray(result.data?.memories) ? result.data.memories.length : 0
      const totalFound = typeof result.data?.totalFound === 'number'
        ? result.data.totalFound
        : (factsCount + memoriesCount)
      content = totalFound > 0
        ? `가게 지식에서 관련된 정보 ${totalFound}건을 확인했어요. 추가로 궁금한 매장 정보가 있으시면 알려주세요.`
        : '가게 지식에서 일치하는 정보를 찾지 못했어요. 매장 정보 관리에 새 정보를 등록해 주시면 학습할게요.'
    } else {
      content = '가게 지식을 확인하지 못했어요. 매장 정보 상태를 확인해 주세요.'
    }
  }

  await deps.record({
    status: successful ? 'COMPLETED' : 'BLOCKED',
    capabilityId,
    balance,
    summary: successful ? content : null,
    data: successful ? result.data : undefined,
  })

  await deps.updateTimeline?.(stepId, successful ? 'completed' : 'failed')

  if (successful && deps.evidence) await deps.evidence(capabilityId)

  await assertAuthority()
  await deps.finalize(content, successful)

  return {
    status: successful ? ('completed' as const) : ('failed' as const),
    safeErrorCode: successful ? null : ('CONVERSATION_READ_UNAVAILABLE' as const),
    billingDisposition: 'release' as const,
  }
}
