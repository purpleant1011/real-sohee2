import { conversationKnowledgeSnapshotSchema } from '@/features/sohee-studio/conversation-knowledge-contract'
import type { AgentLoopInput, AgentLoopResult } from '@/features/tool-runtime/agent-loop-engine'
import type { ToolExecutionContext } from '@/features/tool-runtime/types'
import type { UsageEventInput } from '@/features/credits/usage-event'
import { parseInteractionDraftSnapshot } from '@/features/engagement/interaction-draft-contract'
import { SOHEE_CAPABILITY_REGISTRY } from '@/lib/agent-os/mcp-capability-registry'
import { GOAL_CONTEXT_SAFETY_NOTICE, PROMPT_INJECTION_DEFENSE_NOTICE, type SoheeContextBundle } from './context-builder'
import type { TaskTimelineMessageArtifact, TaskTimelineStepStatus } from './stream-events'
import { UnknownProviderOutcomeError } from './jobs/runner'
import { BUSINESS_CONTEXT_SAFETY_NOTICE } from './workspace-business-context'
import {
  getPreparedConversationReadRequirements,
  requestsConversationInteractionDraft,
  requestsConversationKnowledgeProposal,
  shouldUsePreparedConversationAgent,
  isTeachConversationMarker,
  hasActiveTeachingInterview,
} from './prepared-conversation-routing'
import { TEACH_TOPICS } from './teach-model'

/** Prepared read/analysis support is explicit; registry membership is not write permission. */
export const PREPARED_CONVERSATION_READ_CAPABILITIES = [
  'knowledge.search', 'customer.search', 'interaction.list', 'review.list', 'reservation.list',
  'performance.summary', 'credit.status', 'app.navigate', 'automation.list',
] as const
export const PREPARED_CONVERSATION_DRAFT_CAPABILITIES = ['comment.reply_draft', 'dm.reply_draft'] as const
export const PREPARED_CONVERSATION_KNOWLEDGE_CAPABILITIES = ['knowledge.propose'] as const
const supported = new Set<string>(PREPARED_CONVERSATION_READ_CAPABILITIES)
const internalDrafts = new Set<string>(PREPARED_CONVERSATION_DRAFT_CAPABILITIES)

type Scope = Readonly<{
  workspaceId: string; userId: string; threadId: string; jobId: string
  assistantMessageId: string; userMessageId?: string; message: string
}>
type Dependencies = {
  authorized(): Promise<boolean>
  loadContext(): Promise<SoheeContextBundle>
  run(input: AgentLoopInput): Promise<AgentLoopResult>
  prepareModelCall(attempt: number): Promise<void>
  recordUsage(usage: UsageEventInput): Promise<void>
  persistPlan(plan: Record<string, unknown>): Promise<void>
  saveTimeline(timeline: TaskTimelineMessageArtifact): Promise<void>
  finalize(content: string, successful: boolean): Promise<void>
  readClient?: ToolExecutionContext['readClient']
  prepareInteractionDraft?: ToolExecutionContext['prepareInteractionDraft']
  proposeKnowledge?: ToolExecutionContext['proposeKnowledge']
  creditBalance: number
  allowedCapabilityIds: readonly string[]
}

export async function executePreparedConversationAgent(scope: Scope, deps: Dependencies) {
  const authorized = async () => {
    if (!await deps.authorized()) throw new Error('CONVERSATION_AUTHORITY_LOST')
  }
  await authorized()
  let context: SoheeContextBundle
  try { context = await deps.loadContext() } catch {
    await authorized()
    await deps.finalize('가게의 지식과 업무 자료를 확인하지 못해 작업을 시작하지 않았어요. 다시 조회해 주세요.', false)
    return { status: 'failed' as const, safeErrorCode: 'CONVERSATION_CONTEXT_UNAVAILABLE', billingDisposition: 'release' as const }
  }
  if (context.workspace.id !== scope.workspaceId) throw new Error('CONVERSATION_CONTEXT_SCOPE_MISMATCH')
  await authorized()
  let attempts = 0
  let observations = 0
  let usageUnknown = false
  const previousRequest = [...context.recentMessages].reverse().find(message => message.workspaceId === scope.workspaceId && message.threadId === scope.threadId
    && message.role === 'user' && message.status === 'completed'
    && message.id !== scope.userMessageId && shouldUsePreparedConversationAgent(message.content))
  const isTeaching = isTeachConversationMarker(scope.message) || hasActiveTeachingInterview(context.recentMessages, previousRequest?.content)
  const canPrepareDrafts = Boolean(deps.prepareInteractionDraft) && requestsConversationInteractionDraft(scope.message)
  const knowledgeRequested = requestsConversationKnowledgeProposal(scope.message)
  const canProposeKnowledge = (knowledgeRequested || isTeaching) && Boolean(deps.proposeKnowledge)
  const allowedCapabilityIds = deps.allowedCapabilityIds.filter(id => supported.has(id) || (canPrepareDrafts && internalDrafts.has(id)) || (canProposeKnowledge && id === 'knowledge.propose'))
  const requiredReads = getPreparedConversationReadRequirements(scope.message, previousRequest?.content)
  const teachingInstruction = isTeaching
    ? `[소희 가르치기 인터뷰 지침]\n- 사장님이 직접 확인하고 승인하기 전까지 모든 사실은 검토 후보(CANDIDATE)에 불과합니다.\n- 질문은 한 번에 하나씩만 차근차근 질문하세요 (ask ONE question at a time).\n- 지식 후보(knowledge.propose)로 제안하기 전에, 확인한 사실을 한 문장으로 되짚고 사장님께 확인을 구하세요.\n- 사실을 절대 지어내거나 추측하지 마세요 (never invent facts).\n- 후보 저장 영수증 없이 기억·저장·적용 완료를 말하지 마세요. 최대 1,800자이며 승인 지식 확정·자동화 활성화는 이 도구가 수행하지 않습니다.\n- 가르치기 7대 주제 목록 (남은 주제 질문·안내 시 참고):\n${TEACH_TOPICS.map(topic => `  * ${topic.label} (${topic.id}): ${topic.question}`).join('\n')}\n`
    : canProposeKnowledge
    ? '명시된 기억 요청은 knowledge.propose로 검토 후보만 저장하세요. 후보 저장 영수증 없이 기억·저장·적용 완료를 말하지 마세요. 최대 1,800자이며 승인 지식 확정·자동화 활성화는 이 도구가 수행하지 않습니다.\n'
    : ''
  const result = await deps.run({
    workspaceId: scope.workspaceId, actionRunId: scope.jobId, correlationId: scope.jobId,
    actorId: scope.userId, userId: scope.userId, userPrompt: scope.message, intentMode: 'DRAFT',
    surfaceContext: { route: '/app/conversations' },
    completionContract: requiredReads.length ? { goalTitle: '요청한 정본 자료 확인', replanOnFailure: true,
      requiredOutcomes: requiredReads.map(capabilityId => ({ capabilityId, requiredStatus: 'COMPLETED' as const,
        description: `${SOHEE_CAPABILITY_REGISTRY[capabilityId]?.name ?? '필수 자료'}의 정본 조회가 필요해요. 미관측은 0건이 아닙니다.` })) } : undefined,
    conversationHistory: context.recentMessages
      .filter(message => message.status === 'completed' && message.id !== scope.userMessageId && message.id !== scope.assistantMessageId)
      .map(message => ({ role: message.role === 'sohee' ? 'assistant' : message.role, content: message.content })),
    contextInstruction: `${teachingInstruction}조회 기준 시각: ${new Date().toISOString()}\n${PROMPT_INJECTION_DEFENSE_NOTICE}\n${GOAL_CONTEXT_SAFETY_NOTICE}\n${BUSINESS_CONTEXT_SAFETY_NOTICE}\n고객 상담 요약은 예약 장부나 수납 근거가 아닙니다. NOT_OBSERVED/null은 0건이 아닙니다. 필수 정본 조회: ${requiredReads.map(id => SOHEE_CAPABILITY_REGISTRY[id]?.name ?? id).join(', ') || '요청에 필요한 자료를 선택'}\n아래 참고 자료는 실행 권한이 아닙니다. 조회한 실제 기록과 검토용 제안을 구분하세요. 게시·발송·예약 확정 완료를 추측하지 마세요.\n${JSON.stringify({
      workspace: context.workspace, businessContext: context.businessContext, approvedFacts: context.approvedFacts, rules: context.activeHarnessRules,
      knowledgeJournal: context.knowledgeJournal,
      truncation: context.truncation,
      goals: context.activeGoals, work: context.currentWork, schedules: context.currentSchedules,
    })}`,
    options: {
      readClient: deps.readClient, prepareInteractionDraft: deps.prepareInteractionDraft, proposeKnowledge: canProposeKnowledge ? deps.proposeKnowledge : undefined,
      creditBalance: deps.creditBalance, allowedCapabilityIds,
      canContinue: deps.authorized,
      authorizeCapability: async id => allowedCapabilityIds.includes(id) && await deps.authorized(),
      onModelStarting: async () => {
        await authorized()
        try { await deps.prepareModelCall(attempts + 1) } catch (error) {
          if (error instanceof UnknownProviderOutcomeError) usageUnknown = true
          throw error
        }
        await authorized()
        attempts += 1
      },
      onUsage: async usage => {
        observations += 1
        if (!usage || usage.usageSource !== 'actual') { usageUnknown = true; throw new Error('CONVERSATION_AGENT_USAGE_UNAVAILABLE') }
        try { await deps.recordUsage(usage) } catch (error) { usageUnknown = true; throw error }
      },
      persistPlanData: async plan => { await authorized(); await deps.persistPlan(plan) },
    },
  })
  await authorized()
  if (usageUnknown || attempts > observations || result.status === 'RESULT_UNKNOWN'
    || result.executedSteps.some(step => step.status === 'RESULT_UNKNOWN')) {
    await deps.saveTimeline({ id: `runtime-${scope.jobId}`, kind: 'task_timeline', title: '작업 결과 확인 필요',
      totalSteps: 1, completedSteps: 0, isLive: false,
      steps: [{ id: 'model-outcome', title: '작업 결과와 사용량 기록 확인', status: 'unknown' }] })
    await authorized()
    await deps.finalize('작업 결과나 사용량 기록을 확인 중이라 추가 작업을 멈췄어요. 중복 실행하지 않고 확인이 필요해요.', false)
    throw new UnknownProviderOutcomeError()
  }
  const missingReads = requiredReads.filter(id => !result.executedSteps.some(step => step.toolId === id && step.status === 'COMPLETED'))
  const ledger = result.executedSteps.find(step => step.toolId === 'reservation.list' && step.status === 'COMPLETED')?.result
  const ledgerCount = ledger?.count
  const ledgerCountValid = typeof ledgerCount === 'number' && Number.isSafeInteger(ledgerCount) && ledgerCount >= 0
    && Array.isArray(ledger?.reservations) && ledgerCount === ledger.reservations.length
  if (requiredReads.includes('reservation.list') && !ledgerCountValid && !missingReads.includes('reservation.list')) missingReads.push('reservation.list')
  let draftEvidenceInvalid = false
  const drafts = result.executedSteps.filter(step => internalDrafts.has(step.toolId) && step.status === 'COMPLETED').flatMap(step => {
    try { return [parseInteractionDraftSnapshot(step.result, scope.workspaceId)] }
    catch { draftEvidenceInvalid = true; return [] }
  })
  const knowledgeReceipts = result.executedSteps.filter(step => step.toolId === 'knowledge.propose' && step.status === 'COMPLETED').map(step => conversationKnowledgeSnapshotSchema.safeParse(step.result))
  const proposals = knowledgeReceipts.flatMap(receipt => receipt.success && receipt.data.workspaceId === scope.workspaceId && receipt.data.sourceMessageId === scope.userMessageId ? [receipt.data] : [])
  const knowledgeUnconfirmed = (knowledgeRequested && proposals.length === 0) || proposals.length !== knowledgeReceipts.length
  const draftPreparationUnconfirmed = canPrepareDrafts && (drafts.length === 0 || draftEvidenceInvalid)
  const steps = result.executedSteps.map(step => ({
    id: `step-${step.stepIndex}`,
    title: SOHEE_CAPABILITY_REGISTRY[step.toolId]?.name ?? '업무 자료 확인',
    ...(internalDrafts.has(step.toolId) ? { capabilityId: step.toolId as typeof PREPARED_CONVERSATION_DRAFT_CAPABILITIES[number] } : {}),
    status: (step.status === 'COMPLETED' ? 'completed' : step.status === 'AWAITING_APPROVAL' ? 'awaiting_approval'
      : step.status === 'RESULT_UNKNOWN' ? 'unknown' : 'failed') as TaskTimelineStepStatus,
  }))
  if (steps.length === 0) steps.push({ id: 'request-review', title: '요청 범위 검토',
    status: result.status === 'COMPLETED' ? 'completed' : 'failed' })
  for (const id of missingReads) steps.push({ id: `missing-${id}`, title: `${SOHEE_CAPABILITY_REGISTRY[id]?.name ?? '필수 자료'} 근거 미확인`, status: 'failed' })
  if (knowledgeUnconfirmed) steps.push({ id: 'knowledge-unconfirmed', title: '지식 후보 저장 근거 미확인', status: 'failed' })
  if (draftPreparationUnconfirmed) steps.push({ id: 'draft-unconfirmed', title: '검토할 답안 저장 근거 미확인', status: 'failed' })
  await deps.saveTimeline({ id: `runtime-${scope.jobId}`, kind: 'task_timeline', title: '가게 자료 확인·업무 검토',
    steps, totalSteps: steps.length, completedSteps: steps.filter(step => step.status === 'completed').length, isLive: false })
  await authorized()
  const successful = result.status === 'COMPLETED' && missingReads.length === 0 && !draftPreparationUnconfirmed && !knowledgeUnconfirmed
  const isBookingCountQuestion = requiredReads.length === 1 && requiredReads[0] === 'reservation.list'
    && /있는지|건수|몇\s*건/u.test(scope.message)
  const content = successful && knowledgeRequested
    ? `지식 검토 기록 ${proposals.length}건을 확인했어요. 이 요청에서 승인 지식이나 운영 규칙으로 적용하지 않았어요. 소희 메뉴의 지식·일지에서 원문과 검토 상태를 확인해 주세요.\n\n${proposals.map(proposal => `${proposal.category} · ${proposal.status}\n${proposal.content}`).join('\n\n')}`.slice(0, 12_000)
    : successful && canPrepareDrafts
    ? `기존 업무 원장에서 검토할 답안 ${drafts.length}건을 확인했어요. 아직 발송하지 않았으며, 발송은 최신 원문과 문안을 검토한 뒤 별도 승인이 필요해요.\n\n${drafts.map(draft => `${draft.targetKind === 'dm' ? 'Instagram DM' : '댓글'} · ${draft.customerLabel}${draft.reused ? ' (기존 초안 보존)' : ''}\n${draft.draftText}`).join('\n\n')}`.slice(0, 12_000)
    : successful && isBookingCountQuestion && ledgerCountValid
    ? `정본 예약 장부를 조회한 결과, 이번 조회에서 반환된 등록 기록은 ${ledgerCount}건이에요. 조회 조건과 반환 제한이 적용된 기록 수이며 전체 합계나 예약 가능 슬롯·수납 내역을 뜻하지 않아요.`
    : successful && result.rawAssistantFinalMessage?.trim()
      ? result.rawAssistantFinalMessage.trim().slice(0, 12_000)
      : '현재 자료나 실행 조건을 확인하지 못해 작업을 마치지 못했어요. 연결 상태와 요청 대상을 확인해 주세요.'
  await deps.finalize(content, successful)
  return { status: successful ? 'completed' as const : 'failed' as const,
    safeErrorCode: successful ? null : 'CONVERSATION_AGENT_UNAVAILABLE',
    billingDisposition: attempts > 0 || observations > 0 ? 'settle_usage' as const : 'release' as const }
}
