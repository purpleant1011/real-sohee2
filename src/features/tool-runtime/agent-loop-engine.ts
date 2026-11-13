/**
 * Sohee V0.9 Agent Loop Engine (ANI-919)
 * 
 * Multi-Tool Iterative Agent Execution Loop:
 * Turn Intake ➔ Model Tool Calls ➔ Schema/Policy Gate ➔ Safe Parallel/Sequential Dispatch
 * ➔ Tool Output Re-injection ➔ Model Feedback ➔ Final Answer or Blocker/Approval Pause.
 * 
 * Acceptance Rules:
 * - 3+ dependent tools execute sequentially across iterations.
 * - Independent read tools safely execute in parallel.
 * - Tool outputs feed back to next model step in canonical OpenAI tool message format.
 * - Loop limit (maxSteps) is an explicit BLOCKED state, never fake COMPLETED.
 * - Malformed arguments return structured errors to model for autonomous retry.
 * - Full ActionGraph and durable agent_run_steps audit ledger recorded.
 */

import { ActionWorker, ActionWorkerToolCall, ActionWorkerModelError, ActionWorkerOutput } from '@/features/tool-runtime/action-worker'
import {
  SOHEE_CAPABILITY_REGISTRY,
  resolveCapabilityId,
  CapabilityDefinition
} from '@/lib/agent-os/mcp-capability-registry'
import { ToolDispatcher } from './tool-dispatcher'
import { ConversationRepository } from '@/lib/conversation/conversation-repository'
import { CanonicalSurfaceContext } from '@/features/agent-session/types'
import { AgentApprovalService } from '@/features/agent-session/agent-approval-service'
import type { InteractionIntentMode } from '@/lib/agent-os/executors/interaction-executor'
import type { ImageAsset } from '@/lib/ai/image-worker'
import type { PlanCardData, LiveExecutionCardData, DecisionCardData, EvidenceResultCardData } from '@/lib/agent-os/agent-orchestrator'
import type { ToolStatus, ToolExecutionContext } from './types'
import { activityForToolResult, type ActivityKind } from '@/features/agent-activity/activity-event'
import {
  CompletionEvaluator,
  type GoalCompletionContract
} from './completion-evaluator'
import { DynamicCapabilityDiscovery } from '@/lib/mcp-gateway/dynamic-capability-discovery'

export interface ActionGraphNode {
  nodeId: string
  actionName?: string
  title?: string
  toolName?: string
  capabilityId?: string
  status: 'PENDING' | 'RUNNING' | 'COMPLETED' | 'VERIFIED' | 'FAILED' | 'BLOCKED' | 'RESULT_UNKNOWN' | 'AWAITING_APPROVAL' | string
  isMandatory?: boolean
  requiresApproval?: boolean
  approvalStatus?: 'PENDING' | 'APPROVED' | 'REJECTED'
  proposalId?: string
  evidenceId?: string
  evidence?: Record<string, unknown>
  error?: { code?: string; message?: string }
  idempotencyKey?: string
  isExternalMutation?: boolean
  input?: Record<string, unknown>
  output?: Record<string, unknown>
  dependsOn?: string[]
  executedAt?: string
}

export interface LoopExecutionStep {
  stepIndex: number
  iteration: number
  toolCallId: string
  toolName: string
  toolId: string
  arguments: Record<string, unknown>
  status: ToolStatus | 'PENDING' | 'RUNNING'
  result?: Record<string, unknown>
  error?: { code: string; message: string; schema?: unknown }
  creditDeducted?: number
  evidence?: {
    channel?: string
    url?: string
    httpStatus?: number
    receiptId?: string
    durableProofId?: string
    hasReadbackEvidence?: boolean
    hasDurableProof?: boolean
    readbackVerified?: boolean
    [key: string]: any
  }
  proposal?: {
    proposalId: string
    title: string
    description?: string
    capabilityId?: string
    diffPayload?: Record<string, unknown>
  }
  logs?: string[]
  startedAt: string
  completedAt?: string
  durationMs?: number
}

export interface ActionGraph {
  runId: string
  workspaceId?: string
  status: 'RUNNING' | 'COMPLETED' | 'AWAITING_APPROVAL' | 'BLOCKED' | 'FAILED' | 'RESULT_UNKNOWN' | string
  iterations: number
  totalSteps: number
  steps: LoopExecutionStep[]
  nodes?: ActionGraphNode[]
  contract?: GoalCompletionContract
  checkpointAt?: string
  /** Optimistic snapshot from durable storage; excluded from persisted graph JSON. */
  checkpointPlan?: Record<string, unknown>
  graphRevision?: number
  policyVersion?: string
  lastApproval?: Record<string, unknown>
  finalEvidence?: {
    channel?: string
    url?: string
    httpStatus?: number
    receiptId?: string
    durableProofId?: string
    hasReadbackEvidence?: boolean
    hasDurableProof?: boolean
    readbackVerified?: boolean
    [key: string]: unknown
  }
  blockedReason?: string
  failureReason?: string
}

export type AgentProgressKind = 'planning' | 'step_started' | 'step_done' | 'step_failed' | 'awaiting_approval'

export interface AgentProgressEvent {
  kind: AgentProgressKind
  stepIndex: number
  title: string
  detail?: string
}

export interface AgentLoopOptions {
  onModelStarting?: () => void | Promise<void>
  persistPlanData?: (plan: Record<string, unknown>) => Promise<void>
  readClient?: ToolExecutionContext['readClient']
  prepareInteractionDraft?: ToolExecutionContext['prepareInteractionDraft']
  proposeKnowledge?: ToolExecutionContext['proposeKnowledge']
  creditBalance?: number
  onUsage?: Parameters<typeof ActionWorker.execute>[0]['onUsage']
  maxSteps?: number // Default: 5
  timeoutMs?: number // Default: 60000
  signal?: AbortSignal
  canContinue?: () => Promise<boolean>
  allowParallelReads?: boolean // Default: true
  allowedCapabilityIds?: readonly string[]
  authorizeCapability?: (capabilityId: string) => Promise<boolean>
  completionContract?: GoalCompletionContract
  onProgress?: (e: AgentProgressEvent) => void
  recordActivity?: (fact: { kind: ActivityKind; stepId?: string; dedupeKey: string }) => Promise<void>
}

export interface AgentLoopInput {
  workspaceId: string
  sessionId?: string
  actionRunId: string
  correlationId: string
  userPrompt: string
  conversationHistory?: Array<{ role: string; content: string }>
  contextInstruction?: string
  surfaceContext?: CanonicalSurfaceContext | Record<string, unknown> | string
  intentMode?: InteractionIntentMode
  isTestAccount?: boolean
  actorId?: string
  userId?: string
  options?: AgentLoopOptions
  completionContract?: GoalCompletionContract
  actionGraphNodes?: ActionGraphNode[]
}

export interface AgentLoopResult {
  status: 'COMPLETED' | 'AWAITING_APPROVAL' | 'BLOCKED' | 'FAILED' | 'RESULT_UNKNOWN'
  actionGraph: ActionGraph
  executedSteps: LoopExecutionStep[]
  lastToolExecutionResult?: Record<string, unknown>
  accumulatedToolResults: Record<string, unknown>[]
  totalTokens: number
  totalCreditsDeducted: number
  primaryToolName?: string
  approvalProposal?: {
    proposalId: string
    title: string
    description?: string
    capabilityId?: string
    diffPayload?: Record<string, unknown>
  }
  failureDetails?: {
    errorCode: string
    message: string
    step: string
  }
  rawAssistantFinalMessage?: string
  cards: {
    planCard: PlanCardData | null
    liveExecutionCard: LiveExecutionCardData | null
    approvalCard: DecisionCardData | null
    evidenceResultCard: EvidenceResultCardData | null
    failureCard: { errorCode: string; message: string; step: string } | null
  }
  mcpAction?: Record<string, unknown> | null
  visualImage?: ImageAsset | null
}

const SAFE_READ_CAPABILITIES = new Set([
  'automation.list',
  'knowledge.search',
  'customer.search',
  'interaction.list',
  'performance.summary',
  'credit.status',
  'credits.get',
  'ads.campaigns.list',
  'results.metrics.get',
  'content.calendar.list',
  'customers.list',
  'channel.list',
  'review.list',
  'reservation.list',
  'mcp_search_knowledge',
  'mcp_check_credits',
  'mcp_get_ad_campaigns',
  'mcp_get_marketing_performance',
  'mcp_get_content_calendar',
  'mcp_get_customer_metrics'
])

export class AgentLoopEngine {
  public static async runLoop(input: AgentLoopInput): Promise<AgentLoopResult> {
    return this.run(input)
  }

  public static async run(input: AgentLoopInput): Promise<AgentLoopResult> {
    const canContinue = input.options?.canContinue
    if (!canContinue) return this.runWithControl(input)

    // Durable server cancellation must interrupt active requests, not only the next dispatch.
    // A browser disconnect is deliberately not a cancellation source for canonical runs.
    const controller = new AbortController()
    const signal = input.options?.signal
      ? AbortSignal.any([input.options.signal, controller.signal])
      : controller.signal
    let active = true
    let timer: ReturnType<typeof setTimeout> | undefined
    const poll = async () => {
      try {
        if (!await canContinue()) controller.abort()
      } catch {
        // Lost authority is not permission to continue an external request.
        controller.abort()
      }
      if (active && !signal.aborted) timer = setTimeout(poll, 1000)
    }
    timer = setTimeout(poll, 1000)
    try {
      return await this.runWithControl({ ...input, options: { ...input.options, signal } })
    } finally {
      active = false
      clearTimeout(timer)
    }
  }

  private static async runWithControl(input: AgentLoopInput): Promise<AgentLoopResult> {
    const maxSteps = input.options?.maxSteps ?? 5
    const timeoutMs = input.options?.timeoutMs ?? 60000
    const allowParallelReads = input.options?.allowParallelReads ?? true
    const startTime = Date.now()

    // Dynamic Capability Discovery (ANI-973)
    const discovery = await DynamicCapabilityDiscovery.getRelevantOperationalCapabilities({
      goal: input.userPrompt,
      surfaceContext: input.surfaceContext,
      workspaceId: input.workspaceId,
      allowedCapabilityIds: input.options?.allowedCapabilityIds,
    })
    const serverAllowlist = input.options?.allowedCapabilityIds
    const tools: Array<Record<string, unknown>> = discovery.openAiTools.filter(tool =>
      serverAllowlist === undefined || serverAllowlist.some(id => resolveCapabilityId(id) === resolveCapabilityId(tool.function.name)))
    const allowedCapabilityIds = discovery.openAiTools.filter(tool => tools.includes(tool))
      .map(tool => resolveCapabilityId(tool.function.name))
    const history = input.conversationHistory || []

    const surfaceText = input.surfaceContext
      ? `[현재 화면 위치 및 작업 맥락: ${typeof input.surfaceContext === 'string' ? input.surfaceContext : JSON.stringify(input.surfaceContext)}]\n\n${input.userPrompt}`
      : input.userPrompt

    // Build the iterative conversation message array
    const messages: Array<{
      role: 'system' | 'user' | 'assistant' | 'tool'
      content?: string | null
      tool_calls?: any[]
      tool_call_id?: string
    }> = [
      {
        role: 'system',
        content: `너는 소희 에이전트 OS의 실제 도메인 작업과 MCP 도구를 실행하는 'Action Worker'야.
[원칙]
1. 사장님의 명령을 분석하여 어떤 도구를 어떤 파라미터로 실행할지 정확하고 엄격하게 결정해.
2. 여러 단계가 필요하면 순차적으로 도구를 호출해. 이전 도구의 실행 결과(tool output)를 바탕으로 후속 도구를 실행해.
3. 환각(Hallucination)을 금지하며 필요한 파라미터를 누락 없이 구성해.
4. 만약 도구 실행 결과에서 에러(MALFORMED_ARGUMENTS 등)가 반환되면 누락되거나 잘못된 인자를 수정하여 다시 올바르게 호출해.
5. 도구 목록에 없거나 제외된 기능(예: 리뷰 답글, 예약 발행, 문자/SMS 발송 등)은 절대로 임의로 실행했다고 하거나 지원한다고 지어내지 말고, 추가 도구 호출 없이 "아직 지원하지 않는 기능입니다"라고 정직하게 안내하고 현재 대신 할 수 있는 대안을 제시해.
6. 필요한 모든 작업이 완료되었거나 도구 호출이 더 이상 필요하지 않으면 추가 도구 호출 없이 최종 답변 문구를 제시해.
${input.contextInstruction || ''}`
      },
      ...(input.contextInstruction ? history : history.slice(-8)).filter(m => m.role === 'user' || m.role === 'assistant').map(m => ({
        role: (m.role === 'assistant' ? 'assistant' : 'user') as 'assistant' | 'user',
        content: m.content
      })),
      {
        role: 'user',
        content: surfaceText
      }
    ]

    const actionGraph: ActionGraph = {
      runId: input.actionRunId,
      status: 'RUNNING',
      iterations: 0,
      totalSteps: 0,
      steps: [],
      nodes: input.actionGraphNodes,
      contract: input.completionContract || input.options?.completionContract
    }

    const executedSteps: LoopExecutionStep[] = []
    const accumulatedToolResults: Record<string, unknown>[] = []
    let totalTokens = 0
    let totalCreditsDeducted = 0
    let primaryToolName: string | undefined
    let approvalProposal: AgentLoopResult['approvalProposal']
    let failureDetails: AgentLoopResult['failureDetails']
    let rawAssistantFinalMessage: string | undefined
    let mcpAction: Record<string, unknown> | null = null
    let visualImage: ImageAsset | null = null

    const allLogs: string[] = [
      '작업 의도 및 권한 게이트 확인 완료',
      `실행 모드: ${input.intentMode || 'DRAFT'}`,
      `동적 역량 디스커버리 완료 (서피스: ${discovery.surface}, 활성 도구: ${discovery.operationalCapabilities.length}종, 제외: ${discovery.exclusionReasons.length}종)`
    ]

    const emitProgress = (event: AgentProgressEvent) => {
      if (input.options?.onProgress) {
        try {
          input.options.onProgress(event)
        } catch {
          // Swallow callback errors to ensure execution continues safely
        }
      }
    }

    emitProgress({
      kind: 'planning',
      stepIndex: 0,
      title: '작업 계획 수립 중',
      detail: '요청하신 작업을 분석하여 실행 계획을 수립하고 있습니다.'
    })

    let iteration = 0
    let globalStepIndex = 0

    if (tools.length === 0) {
      actionGraph.status = 'BLOCKED'
      actionGraph.blockedReason = '현재 요청에 실행 가능한 도구가 없어요.'
      failureDetails = { errorCode: 'NO_ALLOWED_CAPABILITIES', message: actionGraph.blockedReason, step: 'CAPABILITY_DISCOVERY' }
    }
    while (tools.length > 0 && iteration < maxSteps) {
      // 1. Timeout Check
      if (Date.now() - startTime > timeoutMs) {
        actionGraph.status = 'BLOCKED'
        actionGraph.blockedReason = `도구 실행 제한 시간(${timeoutMs}ms) 초과로 작업이 중단되었습니다.`
        failureDetails = {
          errorCode: 'TIMEOUT',
          message: actionGraph.blockedReason,
          step: 'AGENT_LOOP_TIMEOUT'
        }
        allLogs.push(`[TIMEOUT] 실행 시간 초과 (${timeoutMs}ms)`)
        break
      }

      // 2. Abort Signal Check
      if (input.options?.signal?.aborted || (input.options?.canContinue && !await input.options.canContinue())) {
        actionGraph.status = 'BLOCKED'
        actionGraph.blockedReason = '사용자 또는 시스템에 의해 작업이 중단되었습니다.'
        failureDetails = {
          errorCode: 'ABORTED',
          message: actionGraph.blockedReason,
          step: 'AGENT_LOOP_ABORTED'
        }
        allLogs.push('[ABORTED] 작업 중단 신호 감지')
        break
      }

      iteration++
      actionGraph.iterations = iteration

      // 3. Action Worker Model Call
      let actionResult: ActionWorkerOutput
      try {
        await input.options?.onModelStarting?.()
        actionResult = await ActionWorker.planAndCallTools({
          messages,
          tools,
          signal: input.options?.signal,
          deadlineAt: startTime + timeoutMs,
          onUsage: input.options?.onUsage,
        })
      } catch (err: unknown) {
        const modelErr =
          err instanceof ActionWorkerModelError
            ? err
            : new ActionWorkerModelError({
                code: 'MODEL_ERROR',
                message: err instanceof Error ? err.message : String(err),
                isRetryable: false,
                cause: err
              })

        actionGraph.status = 'FAILED'
        actionGraph.failureReason = `[${modelErr.code}] ${modelErr.message}`
        failureDetails = {
          errorCode: modelErr.code,
          message: modelErr.message,
          step: 'ACTION_WORKER_MODEL_CALL'
        }
        allLogs.push(`[MODEL_ERROR] (${modelErr.code}) ${modelErr.message}`)

        if (actionGraph.nodes && actionGraph.nodes.length > 0) {
          const targetNodeStatus = modelErr.isRetryable ? 'RETRIABLE_ERROR' : 'FAILED'
          for (const node of actionGraph.nodes) {
            if (node.status === 'PENDING' || node.status === 'RUNNING') {
              node.status = targetNodeStatus
              node.error = {
                code: modelErr.code,
                message: modelErr.message
              }
              break
            }
          }
        }

        break
      }
      totalTokens += actionResult.totalTokens

      // If no tool calls produced: Evaluate completion contract rather than blindly completing
      if (!actionResult.toolCalls || actionResult.toolCalls.length === 0) {
        rawAssistantFinalMessage = actionResult.rawContent

        // Update ActionGraph final evidence if any step completed with evidence before evaluating
        const lastEvidenceStep = [...executedSteps].reverse().find(s => s.evidence?.url || s.evidence?.receiptId)
        if (lastEvidenceStep?.evidence) {
          const ev = lastEvidenceStep.evidence as Record<string, any>
          actionGraph.finalEvidence = {
            channel: ev.channel as string | undefined,
            url: ev.url as string | undefined,
            httpStatus: ev.httpStatus as number | undefined,
            receiptId: ev.receiptId as string | undefined,
            durableProofId: ev.durableProofId as string | undefined,
            hasReadbackEvidence: ev.hasReadbackEvidence as boolean | undefined,
            hasDurableProof: ev.hasDurableProof as boolean | undefined,
            readbackVerified: ev.readbackVerified as boolean | undefined
          }
        }

        const contract = actionGraph.contract || input.completionContract || input.options?.completionContract
        const evalResult = CompletionEvaluator.evaluate(actionGraph, contract)

        if (evalResult.passed) {
          actionGraph.status = 'COMPLETED'
          allLogs.push(`[Iteration ${iteration}] 추가 도구 호출 없이 목표 완결 계약 충족 검증 완료`)
          break
        } else {
          const missingReads = contract?.requiredOutcomes?.filter(outcome => outcome.isMandatory !== false
            && outcome.capabilityId && !executedSteps.some(step => step.toolId === outcome.capabilityId && step.status === 'COMPLETED')) ?? []
          const canReplanReads = evalResult.status === 'REPLAN_REQUIRED'
            && evalResult.errorCode === 'UNMET_COMPLETION_PREDICATES'
            && missingReads.length > 0
            && missingReads.every(outcome => SAFE_READ_CAPABILITIES.has(outcome.capabilityId!))
            && iteration < maxSteps
          if (canReplanReads) {
            messages.push({ role: 'assistant', content: actionResult.rawContent || '조회 근거를 다시 확인합니다.' })
            messages.push({ role: 'user', content: `완료에 필요한 정본 조회가 누락되었습니다: ${missingReads.map(outcome => outcome.capabilityId).join(', ')}. 허용된 조회 도구로 실제 자료를 확인하세요. 미관측을 0건으로 해석하거나 외부 쓰기를 실행하지 마세요.` })
            rawAssistantFinalMessage = undefined
            allLogs.push(`[Iteration ${iteration}] 필수 읽기 근거 누락으로 제한된 재계획`)
            continue
          }
          const targetStatus = evalResult.status === 'REPLAN_REQUIRED' ? 'FAILED' : (evalResult.status || 'FAILED')
          actionGraph.status = targetStatus
          actionGraph.failureReason = evalResult.reasons.join('; ') || 'UNMET_COMPLETION_PREDICATES'
          failureDetails = {
            errorCode: evalResult.errorCode || 'UNMET_COMPLETION_PREDICATES',
            message: `목표 완결 계약 미충족: ${evalResult.reasons.join(', ')}`,
            step: 'COMPLETION_EVALUATION'
          }
          allLogs.push(`[FAILED] 목표 완결 계약 미충족 (${failureDetails.errorCode}): ${failureDetails.message}`)
          break
        }
      }

      // Store assistant message with tool calls into loop messages
      if (actionResult.rawChoiceMessage) {
        messages.push(actionResult.rawChoiceMessage)
      } else {
        messages.push({
          role: 'assistant',
          content: actionResult.rawContent || null,
          tool_calls: actionResult.toolCalls.map(tc => ({
            id: tc.id,
            type: 'function',
            function: {
              name: tc.toolName,
              arguments: JSON.stringify(tc.arguments)
            }
          }))
        })
      }

      // 4. Inspect tool calls in this iteration
      const currentToolCalls = actionResult.toolCalls
      if (!primaryToolName && currentToolCalls.length > 0) {
        primaryToolName = resolveCapabilityId(currentToolCalls[0].toolName)
      }

      // Determine parallel vs sequential execution
      const allSafeReads = currentToolCalls.every(tc => {
        const capId = resolveCapabilityId(tc.toolName)
        return SAFE_READ_CAPABILITIES.has(capId) || SAFE_READ_CAPABILITIES.has(tc.toolName)
      })
      const executeInParallel = allowParallelReads && allSafeReads && currentToolCalls.length > 1

      allLogs.push(
        `[Iteration ${iteration}] 도구 호출 ${currentToolCalls.length}건 감지 (${executeInParallel ? '안전 병렬 실행' : '순차 실행'}): ${currentToolCalls.map(t => t.toolName).join(', ')}`
      )

      let shouldPauseForApproval = false
      let shouldBlockLoop = false
      let requiresReconciliation = false

      // Helper to process a single tool call
      const executeSingleToolCall = async (tc: ActionWorkerToolCall, stepIdx: number): Promise<LoopExecutionStep> => {
        const stepStartedAt = new Date().toISOString()
        const capId = resolveCapabilityId(tc.toolName)
        const capDef: CapabilityDefinition | undefined = SOHEE_CAPABILITY_REGISTRY[capId]
        const taskTitle = getKoreanTaskName(tc.toolName)

        const interrupted = async (): Promise<LoopExecutionStep | undefined> => {
          let authorized = allowedCapabilityIds.includes(capId)
          if (authorized && input.options?.authorizeCapability) {
            try { authorized = await input.options.authorizeCapability(capId) } catch { authorized = false }
          }
          if (!authorized) return {
            stepIndex: stepIdx, iteration, toolCallId: tc.id, toolName: tc.toolName,
            toolId: capId, arguments: tc.arguments, status: 'BLOCKED',
            error: { code: 'UNAUTHORIZED_SCOPE', message: '이 요청에 허용되지 않은 도구입니다.' },
            startedAt: stepStartedAt, completedAt: new Date().toISOString(),
          }
          const stopped = input.options?.signal?.aborted || (input.options?.canContinue && !await input.options.canContinue())
          const code = stopped ? 'ABORTED' : Date.now() >= startTime + timeoutMs ? 'TIMEOUT' : undefined
          if (!code) return undefined
          return {
            stepIndex: stepIdx, iteration, toolCallId: tc.id, toolName: tc.toolName,
            toolId: capId, arguments: tc.arguments, status: 'BLOCKED',
            error: { code, message: '작업 중단 또는 제한 시간 초과로 추가 실행을 차단했습니다.' },
            startedAt: stepStartedAt, completedAt: new Date().toISOString(),
          }
        }
        const beforeValidation = await interrupted()
        if (beforeValidation) return beforeValidation

        // Argument Validation Gate (Fail-Closed, Structured Error to Model)
        if (tc.argumentParseError) {
          emitProgress({
            kind: 'step_failed',
            stepIndex: stepIdx,
            title: taskTitle,
            detail: `${taskTitle} 작업 중 오류가 발생했습니다.`
          })
          const stepResult: LoopExecutionStep = {
            stepIndex: stepIdx,
            iteration,
            toolCallId: tc.id,
            toolName: tc.toolName,
            toolId: capId,
            arguments: tc.arguments,
            status: 'FAILED',
            error: {
              code: 'INVALID_JSON_ARGUMENTS',
              message: `인자 JSON 파싱 실패: ${tc.argumentParseError}`
            },
            startedAt: stepStartedAt,
            completedAt: new Date().toISOString(),
            durationMs: Date.now() - new Date(stepStartedAt).getTime()
          }
          return stepResult
        }

        // Normalize common aliases (e.g. content -> caption for publishing)
        if ((capId === 'publish.create' || tc.toolName === 'mcp_publish_live') && tc.arguments.content && !tc.arguments.caption) {
          tc.arguments.caption = tc.arguments.content;
        }

        if (capDef?.parametersSchema?.required && Array.isArray(capDef.parametersSchema.required)) {
          const missing = capDef.parametersSchema.required.filter(
            (key: string) => tc.arguments[key] === undefined || tc.arguments[key] === null || tc.arguments[key] === ''
          )
          if (missing.length > 0) {
            emitProgress({
              kind: 'step_failed',
              stepIndex: stepIdx,
              title: taskTitle,
              detail: `${taskTitle} 작업 중 오류가 발생했습니다.`
            })
            const stepResult: LoopExecutionStep = {
              stepIndex: stepIdx,
              iteration,
              toolCallId: tc.id,
              toolName: tc.toolName,
              toolId: capId,
              arguments: tc.arguments,
              status: 'FAILED',
              error: {
                code: 'MALFORMED_ARGUMENTS',
                message: `도구 [${tc.toolName}]에 필수 파라미터가 누락되었습니다: [${missing.join(', ')}]. 파라미터 스키마를 확인하고 재시도하십시오.`,
                schema: capDef.parametersSchema
              },
              startedAt: stepStartedAt,
              completedAt: new Date().toISOString(),
              durationMs: Date.now() - new Date(stepStartedAt).getTime()
            }
            return stepResult
          }
        }

        // The durable intent must exist before a domain handler can produce a side effect.
        await ConversationRepository.beginAgentRunStep({
          runId: input.actionRunId, stepIndex: stepIdx, capabilityId: capId,
          riskTier: capDef?.riskTier || 'LOW', inputPayload: tc.arguments,
          workspaceId: input.workspaceId,
        })
        const beforeDispatch = await interrupted()
        if (beforeDispatch) return beforeDispatch

        // Real Domain Dispatch via ToolDispatcher (ANI-920)
        const dispatchRes = await ToolDispatcher.dispatch(
          tc.toolName,
          tc.arguments,
          {
            workspaceId: input.workspaceId,
            readClient: input.options?.readClient,
            prepareInteractionDraft: input.options?.prepareInteractionDraft,
            proposeKnowledge: input.options?.proposeKnowledge,
            creditBalance: input.options?.creditBalance,
            sessionId: input.sessionId,
            actionRunId: input.actionRunId,
            correlationId: input.correlationId,
            intentMode: input.intentMode || 'DRAFT',
            isTestAccount: input.isTestAccount,
            actorId: input.actorId || input.userId,
            signal: input.options?.signal,
            deadlineAt: startTime + timeoutMs,
            canContinue: input.options?.canContinue,
            allowedCapabilityIds,
            authorizeCapability: input.options?.authorizeCapability,
            onExecutionStarting: async () => {
              if (await interrupted()) throw new Error('AGENT_EXECUTION_STOPPED')
              await input.options?.recordActivity?.({
                kind: capDef?.isWrite ? 'capability_checked' : 'tool_read_started',
                stepId: String(stepIdx), dedupeKey: `step:${stepIdx}:start`,
              })
              emitProgress({ kind: 'step_started', stepIndex: stepIdx, title: taskTitle })
            },
          }
        )
        await input.options?.recordActivity?.({
          kind: activityForToolResult(dispatchRes), stepId: String(stepIdx), dedupeKey: `step:${stepIdx}:result`,
        })

        const stepCompletedAt = new Date().toISOString()
        const durationMs = Date.now() - new Date(stepStartedAt).getTime()

        const stepResult: LoopExecutionStep = {
          stepIndex: stepIdx,
          iteration,
          toolCallId: tc.id,
          toolName: tc.toolName,
          toolId: dispatchRes.toolId || capId,
          arguments: tc.arguments,
          status: dispatchRes.status,
          result: {
            success: dispatchRes.success,
            toolId: dispatchRes.toolId,
            status: dispatchRes.status,
            ...(dispatchRes.data || {}),
            ...(dispatchRes.error ? { error: dispatchRes.error } : {})
          },
          error: dispatchRes.error,
          creditDeducted: dispatchRes.creditDeducted || 0,
          evidence: dispatchRes.evidence as any,
          proposal: dispatchRes.proposal,
          logs: dispatchRes.logs,
          startedAt: stepStartedAt,
          completedAt: stepCompletedAt,
          durationMs
        }

        // Record to DB Durable agent_run_steps Ledger
        await ConversationRepository.recordAgentRunStep({
          runId: input.actionRunId,
          stepIndex: stepIdx,
          capabilityId: stepResult.toolId,
          riskTier: capDef?.riskTier || 'LOW',
          status: mapStepStatus(dispatchRes.status),
          inputPayload: tc.arguments,
          outputPayload: dispatchRes.data || {},
          idempotencyKey: (dispatchRes as any).idempotencyKey || ((dispatchRes as any).metadata?.idempotencyKey as string | undefined),
          externalReceiptId: dispatchRes.evidence?.receiptId,
          error: dispatchRes.error?.message,
          completed: dispatchRes.status === 'COMPLETED' || dispatchRes.status === 'FAILED',
          workspaceId: input.workspaceId
        })

        // Persist durable approval proposal if awaiting human-in-the-loop decision
        if (dispatchRes.status === 'AWAITING_APPROVAL' && dispatchRes.proposal) {
          await AgentApprovalService.createProposal({
            workspaceId: input.workspaceId,
            sessionId: input.sessionId || `sess-${input.actionRunId}`,
            actionRunId: input.actionRunId,
            proposalId: dispatchRes.proposal.proposalId,
            proposalType: (dispatchRes.proposal as any).proposalType || 'ACTION_APPROVAL',
            title: dispatchRes.proposal.title,
            description: dispatchRes.proposal.description || '',
            proposedValue: (dispatchRes.proposal as any).proposedValue || tc.arguments,
          });
        }

        // Side-effect mapping (UI Assets / MCP Actions)
        if (dispatchRes.toolId === 'image.generate' || dispatchRes.toolId === 'mcp_generate_visual_image') {
          if (dispatchRes.data) {
            visualImage = {
              assetId: String(dispatchRes.data.assetId || ''),
              url: String(dispatchRes.data.imageUrl || ''),
              prompt: String(dispatchRes.data.prompt || ''),
              style: String(dispatchRes.data.style || ''),
              dimensions: String(dispatchRes.data.dimensions || '1024x1024'),
              modelId: 'gpt-image-2',
              costSC: dispatchRes.creditDeducted || 150,
              provenanceId: input.actionRunId,
              createdAt: new Date().toISOString(),
              status: 'VERIFIED_READY',
            }
          }
        } else if (dispatchRes.toolId === 'app.navigate' || dispatchRes.toolId === 'mcp_navigate_console') {
          if (dispatchRes.data) {
            mcpAction = {
              type: 'NAVIGATE_MENU',
              menu: String(dispatchRes.data.navigatedUrl || '/app'),
              entityId: dispatchRes.data.entityId ? String(dispatchRes.data.entityId) : undefined,
            }
          }
        } else if (dispatchRes.toolId === 'autonomy.update' || dispatchRes.toolId === 'mcp_control_autonomy') {
          mcpAction = {
            type: 'SET_AUTONOMY',
            isRunning: dispatchRes.data?.desiredMode === 'RUNNING',
          }
        } else if (dispatchRes.toolId === 'emergency_killswitch' || dispatchRes.toolId === 'mcp_emergency_killswitch') {
          mcpAction = {
            type: 'SET_KILLSWITCH',
            isKilled: dispatchRes.data?.killSwitchActive === true,
            reason: String(tc.arguments.reason || ''),
          }
        }

        if (dispatchRes.status === 'AWAITING_APPROVAL') {
          emitProgress({
            kind: 'awaiting_approval',
            stepIndex: stepIdx,
            title: taskTitle,
            detail: '사장님의 확인 및 승인이 필요합니다.'
          })
        } else if (dispatchRes.success) {
          emitProgress({
            kind: 'step_done',
            stepIndex: stepIdx,
            title: taskTitle,
            detail: `${taskTitle} 작업이 완료되었습니다.`
          })
        } else {
          emitProgress({
            kind: 'step_failed',
            stepIndex: stepIdx,
            title: taskTitle,
            detail: `${taskTitle} 작업 중 오류가 발생했습니다.`
          })
        }

        return stepResult
      }

      // Execute current iteration's tool calls
      if (executeInParallel) {
        const stepPromises = currentToolCalls.map((tc, idx) =>
          executeSingleToolCall(tc, globalStepIndex + idx + 1)
        )
        const stepResults = await Promise.all(stepPromises)
        globalStepIndex += stepResults.length

        for (const sr of stepResults) {
          executedSteps.push(sr)
          actionGraph.steps.push(sr)
          if (sr.result) accumulatedToolResults.push(sr.result)
          totalCreditsDeducted += sr.creditDeducted || 0
          if (sr.logs) allLogs.push(...sr.logs)

          // Re-inject tool response to model
          messages.push({
            role: 'tool',
            tool_call_id: sr.toolCallId,
            content: JSON.stringify(sr.result || (sr.error ? { error: sr.error } : { status: sr.status }))
          })

          if (sr.status === 'AWAITING_APPROVAL') {
            shouldPauseForApproval = true
            approvalProposal = sr.proposal
          } else if (sr.status === 'BLOCKED' || sr.status === 'RESULT_UNKNOWN') {
            requiresReconciliation ||= sr.status === 'RESULT_UNKNOWN'
            shouldBlockLoop = true
            actionGraph.blockedReason = sr.error?.message || '실행 차단됨'
          }
        }
      } else {
        // Sequential Execution
        for (const tc of currentToolCalls) {
          globalStepIndex++
          const sr = await executeSingleToolCall(tc, globalStepIndex)
          executedSteps.push(sr)
          actionGraph.steps.push(sr)
          if (sr.result) accumulatedToolResults.push(sr.result)
          totalCreditsDeducted += sr.creditDeducted || 0
          if (sr.logs) allLogs.push(...sr.logs)

          // Re-inject tool response to model
          messages.push({
            role: 'tool',
            tool_call_id: sr.toolCallId,
            content: JSON.stringify(sr.result || (sr.error ? { error: sr.error } : { status: sr.status }))
          })

          if (sr.status === 'AWAITING_APPROVAL') {
            shouldPauseForApproval = true
            approvalProposal = sr.proposal
            allLogs.push(`[AWAITING_APPROVAL] 사장님 승인이 필요하여 단계 중단: ${sr.toolId}`)
            break
          } else if (sr.status === 'BLOCKED' || sr.status === 'RESULT_UNKNOWN') {
            requiresReconciliation ||= sr.status === 'RESULT_UNKNOWN'
            shouldBlockLoop = true
            actionGraph.blockedReason = sr.error?.message || '실행 차단됨'
            allLogs.push(`[BLOCKED] 실행 조건 미충족으로 중단: ${sr.toolId}`)
            break
          }
        }
      }

      // An ambiguous effect must be reconciled, never fed back as a retryable tool failure.
      if (requiresReconciliation) {
        actionGraph.status = 'RESULT_UNKNOWN'
        failureDetails = {
          errorCode: 'RESULT_UNKNOWN',
          message: '실행 결과를 확인할 수 없어 재실행하지 않고 결과 대사를 기다립니다.',
          step: primaryToolName || 'AGENT_LOOP'
        }
        break
      }

      // Handle pause or block conditions
      if (shouldPauseForApproval) {
        actionGraph.status = 'AWAITING_APPROVAL'
        break
      }

      if (shouldBlockLoop) {
        actionGraph.status = 'BLOCKED'
        failureDetails = {
          errorCode: 'EXECUTION_BLOCKED',
          message: actionGraph.blockedReason || '도구 실행이 차단되었습니다.',
          step: primaryToolName || 'AGENT_LOOP'
        }
        break
      }

      // 5. Check Loop Limit: Acceptance criteria requires EXPLICIT BLOCKER, never fake COMPLETED
      if (iteration >= maxSteps) {
        actionGraph.status = 'BLOCKED'
        actionGraph.blockedReason = `도구 실행 최대 단계(${maxSteps}회)에 도달하여 안전을 위해 실행이 중단되었습니다.`
        failureDetails = {
          errorCode: 'MAX_STEPS_EXCEEDED',
          message: actionGraph.blockedReason,
          step: 'AGENT_LOOP_LIMIT'
        }
        allLogs.push(`[BLOCKED] 최대 실행 반복 횟수(${maxSteps}회) 도달`)
        break
      }
    }

    actionGraph.totalSteps = executedSteps.length

    // Update ActionGraph final evidence if any step completed with evidence
    const lastEvidenceStep = [...executedSteps].reverse().find(s => s.evidence?.url || s.evidence?.receiptId)
    if (lastEvidenceStep?.evidence) {
      const ev = lastEvidenceStep.evidence as Record<string, any>
      actionGraph.finalEvidence = {
        channel: ev.channel as string | undefined,
        url: ev.url as string | undefined,
        httpStatus: ev.httpStatus as number | undefined,
        receiptId: ev.receiptId as string | undefined,
        durableProofId: ev.durableProofId as string | undefined,
        hasReadbackEvidence: ev.hasReadbackEvidence as boolean | undefined,
        hasDurableProof: ev.hasDurableProof as boolean | undefined,
        readbackVerified: ev.readbackVerified as boolean | undefined
      }
    }

    if (actionGraph.status === 'RUNNING') {
      const contract = actionGraph.contract || input.completionContract || input.options?.completionContract
      const evalResult = CompletionEvaluator.evaluate(actionGraph, contract)
      if (evalResult.passed) {
        actionGraph.status = 'COMPLETED'
      } else {
        const targetStatus: 'FAILED' | 'BLOCKED' = evalResult.status === 'REPLAN_REQUIRED' ? 'FAILED' : (evalResult.status as any || 'FAILED')
        actionGraph.status = targetStatus
        actionGraph.failureReason = evalResult.reasons.join('; ') || 'UNMET_COMPLETION_PREDICATES'
        if (!failureDetails) {
          failureDetails = {
            errorCode: evalResult.errorCode || 'UNMET_COMPLETION_PREDICATES',
            message: `목표 완결 계약 미충족: ${evalResult.reasons.join(', ')}`,
            step: 'COMPLETION_EVALUATION'
          }
        }
      }
    }

    // Persist complete ActionGraph to AgentRun plan_data
    const checkpoint = {
      actionGraph, totalCreditsDeducted, totalTokens,
      iterations: actionGraph.iterations, finalStatus: actionGraph.status,
    }
    if (input.options?.persistPlanData) await input.options.persistPlanData(checkpoint)
    else await ConversationRepository.updateAgentRunPlanData(input.actionRunId, checkpoint)

    // Construct UI Cards
    const cards = buildCards({
      actionGraph,
      executedSteps,
      allLogs,
      approvalProposal,
      failureDetails,
      totalCreditsDeducted,
      primaryToolName
    })

    const finalLoopStatus: 'BLOCKED' | 'COMPLETED' | 'AWAITING_APPROVAL' | 'FAILED' =
      actionGraph.status === 'RUNNING'
        ? 'COMPLETED'
        : actionGraph.status === 'RESULT_UNKNOWN'
          ? 'BLOCKED'
        : (actionGraph.status === 'COMPLETED' || actionGraph.status === 'AWAITING_APPROVAL' || actionGraph.status === 'BLOCKED')
          ? (actionGraph.status as 'BLOCKED' | 'COMPLETED' | 'AWAITING_APPROVAL')
          : 'FAILED'

    return {
      status: finalLoopStatus,
      actionGraph,
      executedSteps,
      lastToolExecutionResult: executedSteps[executedSteps.length - 1]?.result,
      accumulatedToolResults,
      totalTokens,
      totalCreditsDeducted,
      primaryToolName,
      approvalProposal,
      failureDetails,
      rawAssistantFinalMessage,
      cards,
      mcpAction,
      visualImage
    }
  }
}

function mapStepStatus(status: string): 'pending' | 'running' | 'verifying' | 'completed' | 'failed' | 'skipped' {
  switch (status) {
    case 'COMPLETED':
      return 'completed'
    case 'FAILED':
    case 'BLOCKED':
      return 'failed'
    case 'RESULT_UNKNOWN':
      return 'verifying'
    case 'AWAITING_APPROVAL':
      return 'running'
    default:
      return 'running'
  }
}

const KOREAN_CAPABILITY_NAMES: Record<string, string> = {
  'content.generate': '콘텐츠 원고 작성',
  'content.rewrite': '콘텐츠 원고 수정',
  'image.generate': '이미지 생성',
  'publish.create': '채널 발행',
  'comment.reply': '댓글 답글 작성',
  'dm.send': 'DM 발송',
  'customer.search': '고객 조회',
  'reservation.create': '예약 등록',
  'app.navigate': '화면 이동',
}

export function getKoreanTaskName(toolIdOrName?: string): string {
  if (!toolIdOrName) return '작업'
  if (KOREAN_CAPABILITY_NAMES[toolIdOrName]) return KOREAN_CAPABILITY_NAMES[toolIdOrName]
  const capDef = SOHEE_CAPABILITY_REGISTRY[toolIdOrName]
  if (capDef?.name) return capDef.name
  return '작업'
}

export function mapRiskToKoreanLabel(risk?: string): string {
  if (risk === 'LOW') return '안전'
  if (risk === 'MEDIUM') return '주의'
  if (risk === 'HIGH' || risk === 'CRITICAL') return '확인 필요'
  return '확인 필요'
}

function buildCards(params: {
  actionGraph: ActionGraph
  executedSteps: LoopExecutionStep[]
  allLogs: string[]
  approvalProposal?: AgentLoopResult['approvalProposal']
  failureDetails?: AgentLoopResult['failureDetails']
  totalCreditsDeducted: number
  primaryToolName?: string
}): AgentLoopResult['cards'] {
  const { actionGraph, executedSteps, allLogs, approvalProposal, failureDetails, totalCreditsDeducted, primaryToolName } = params

  // 1. Plan Card (Multi-step visibility)
  let planCard: PlanCardData | null = null
  if (executedSteps.length > 0) {
    const koreanTaskName = getKoreanTaskName(primaryToolName)
    planCard = {
      planId: `plan-${actionGraph.runId}`,
      title: `${koreanTaskName} 계획`,
      steps: executedSteps.map(s => {
        const capDef = SOHEE_CAPABILITY_REGISTRY[s.toolId]
        const risk = capDef?.riskTier || 'LOW'
        return {
          name: capDef?.name || s.toolId,
          sc: s.creditDeducted || 0,
          risk,
          riskLabel: mapRiskToKoreanLabel(risk),
        }
      }),
      totalSC: totalCreditsDeducted,
      requiresApproval: executedSteps.some(s => s.status === 'AWAITING_APPROVAL')
    }
  }

  // 2. Live Execution Card
  const progressPercentage = actionGraph.status === 'COMPLETED'
    ? 100
    : actionGraph.status === 'AWAITING_APPROVAL'
    ? 50
    : actionGraph.status === 'BLOCKED' || actionGraph.status === 'FAILED'
    ? Math.min(90, Math.round((executedSteps.length / Math.max(1, actionGraph.iterations)) * 100))
    : 100

  const executionStatus: LiveExecutionCardData['status'] =
    actionGraph.status === 'COMPLETED'
      ? 'COMPLETED'
      : actionGraph.status === 'AWAITING_APPROVAL'
      ? 'RUNNING'
      : 'FAILED'

  const lastStep = executedSteps[executedSteps.length - 1]
  const lastTaskName = getKoreanTaskName(lastStep?.toolId)

  let stepStatusSuffix = '진행 중'
  if (actionGraph.status === 'COMPLETED') {
    stepStatusSuffix = '완료'
  } else if (actionGraph.status === 'AWAITING_APPROVAL') {
    stepStatusSuffix = '승인 대기'
  } else if (actionGraph.status === 'BLOCKED') {
    stepStatusSuffix = '확인 필요'
  } else if (actionGraph.status === 'FAILED') {
    stepStatusSuffix = '실패'
  }

  const currentStepName = `${lastTaskName} ${stepStatusSuffix}`

  const userFacingLogs = allLogs.filter(log => {
    if (!log) return false
    if (/서피스|활성\s*도구|Iteration|실행\s*모드/i.test(log)) return false
    return true
  })

  const liveExecutionCard: LiveExecutionCardData = {
    planId: `plan-${actionGraph.runId}`,
    progressPercentage,
    currentStepName,
    status: executionStatus,
    logs: userFacingLogs
  }

  // 3. Approval Card
  let approvalCard: DecisionCardData | null = null
  if (actionGraph.status === 'AWAITING_APPROVAL' && approvalProposal) {
    approvalCard = {
      decisionId: approvalProposal.proposalId,
      title: approvalProposal.title,
      options: [
        { id: 'approve', label: '승인 및 즉시 실행', description: approvalProposal.description },
        { id: 'reject', label: '취소' }
      ]
    }
  }

  // 4. Evidence Result Card
  let evidenceResultCard: EvidenceResultCardData | null = null
  if (actionGraph.finalEvidence?.url) {
    evidenceResultCard = {
      settledSC: totalCreditsDeducted,
      verifiedUrls: [{
        channel: actionGraph.finalEvidence.channel || 'WEB',
        url: actionGraph.finalEvidence.url,
        httpStatus: actionGraph.finalEvidence.httpStatus || 200
      }],
      navUrl: actionGraph.finalEvidence.url,
      navLabel: '실제 게시물 확인'
    }
  }

  // 5. Failure Card
  let failureCard: { errorCode: string; message: string; step: string } | null = null
  if (failureDetails) {
    failureCard = {
      errorCode: failureDetails.errorCode,
      message: failureDetails.message,
      step: failureDetails.step
    }
  } else if (actionGraph.status === 'FAILED' || actionGraph.status === 'BLOCKED') {
    failureCard = {
      errorCode: actionGraph.status,
      message: actionGraph.blockedReason || '작업 실행 실패',
      step: primaryToolName || 'AGENT_LOOP'
    }
  }

  return {
    planCard,
    liveExecutionCard,
    approvalCard,
    evidenceResultCard,
    failureCard
  }
}
